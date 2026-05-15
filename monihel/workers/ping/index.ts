import 'dotenv/config'
import { Job, Worker } from 'bullmq'
import type { Endpoint } from '@prisma/client'
import {
    circuitBreaker,
    handleType,
    ConsecutiveBreaker,
    Policy,
} from 'cockatiel'
import { redis, queueConnection } from '../../api/src/lib/redis'
import prisma from '../../api/src/lib/prisma'
import {
    alertQueue,
    dbWriteQueue,
    PING_QUEUE_CRITICAL,
    PING_QUEUE_STANDARD,
    PING_QUEUE_BULK,
} from '../../api/src/queues/pingQueue'
import { env } from '../../api/src/config/env'
import { createLogger } from '../../api/src/lib/logger'
import {
    jobsProcessedTotal,
    jobDurationSeconds,
    pingsTotal,
    pingResponseTimeMs,
    circuitBreakerState,
} from '../../api/src/lib/metrics'
import { startWorkerHealthServer } from '../../api/src/lib/workerHealth'
import { pingEndpoint } from './pingService'

const logger = createLogger('worker-ping')

// ─── Circuit breaker ─────────────────────────────────────────────────────────
// Wrap the network ping so that consistent failures (e.g. DNS storms, runaway
// target) open the breaker and short-circuit fast instead of piling up workers.
const breaker = circuitBreaker(handleType(Error), {
    halfOpenAfter: 5 * 60 * 1000,                  // probe again after 5min
    breaker: new ConsecutiveBreaker(3),            // 3 consecutive failures → open
})

breaker.onBreak(() => { circuitBreakerState.inc({ event: 'open' });    logger.warn('circuit breaker OPEN') })
breaker.onReset(() => { circuitBreakerState.inc({ event: 'close' });   logger.info('circuit breaker CLOSED') })
breaker.onHalfOpen(() => { circuitBreakerState.inc({ event: 'halfOpen' }) })

async function runPingWithBreaker(url: string, authType: any, authValue: any) {
    try {
        return await breaker.execute(() => pingEndpoint(url, authType, authValue))
    } catch (err: any) {
        if (err?.isBrokenCircuitError) {
            circuitBreakerState.inc({ event: 'reject' })
            // Treat short-circuited calls as TIMEOUT so they still register downtime.
            return { status: 'TIMEOUT' as const, statusCode: null, responseTimeMs: 0 }
        }
        throw err
    }
}

// ─── Shared handler used by every lane ───────────────────────────────────────
async function handlePing(job: Job, queueName: string) {
    const endHist = jobDurationSeconds.startTimer({ queue: queueName })
    const { endpointId } = job.data

    try {
        const details = await getEndpointConfig(endpointId)
        if (!details || !details.isActive || details.isMuted) {
            jobsProcessedTotal.inc({ queue: queueName, status: 'completed' })
            return
        }

        const pingResult = await runPingWithBreaker(details.url, details.authType, details.authValue)
        pingsTotal.inc({ result: pingResult.status })
        pingResponseTimeMs.observe({ result: pingResult.status }, pingResult.responseTimeMs)

        await Promise.all([
            dbWriteQueue.add('metricWrite', { endpointId, ...pingResult }),
            redis.setex(`endpoint:status:${endpointId}`, 300, JSON.stringify(pingResult)),
            redis.publish(`user-events:${details.userId}`, JSON.stringify({ endpointId, ...pingResult })),
        ])

        if (pingResult.status === 'DOWN' || pingResult.status === 'TIMEOUT') {
            const failCount = await redis.incr(`fails:${endpointId}`)
            if (failCount === 1) await redis.expire(`fails:${endpointId}`, 60 * 60 * 24)
            if (failCount < details.alertThreshold) return

            // Belt-and-braces dedup: Redis lock + DB-level Serializable transaction.
            // The lock optimizes the common case; the Serializable tx is the
            // correctness backstop if Redis fails or the lock expires.
            const lockKey = `alert:lock:${endpointId}`
            const gotLock = await redis.set(lockKey, '1', 'EX', 30, 'NX')
            if (!gotLock) return

            try {
                await prisma.$transaction(
                    async (tx) => {
                        const active = await tx.alert.findFirst({
                            where: { endpointId, status: 'TRIGGERED' },
                        })
                        if (active) return
                        const alert = await tx.alert.create({
                            data: { status: 'TRIGGERED', endpointId },
                        })
                        await tx.alertDigest.create({
                            data: {
                                endpointId,
                                status: 'PENDING',
                                alertId: alert.id,
                                userId: details.userId,
                            },
                        })
                    },
                    { isolationLevel: 'Serializable' }
                )
            } finally {
                await redis.del(lockKey)
            }
            return
        }

        if (pingResult.status === 'UP') {
            const failCount = await redis.get(`fails:${endpointId}`)
            if (!failCount || parseInt(failCount) === 0) return

            await redis.del(`fails:${endpointId}`)

            const activeAlert = await prisma.alert.findFirst({
                where: { endpointId, status: 'TRIGGERED' },
            })
            if (!activeAlert) return

            await prisma.alert.update({
                where: { id: activeAlert.id },
                data: { status: 'RESOLVED', resolvedAt: new Date() },
            })

            await alertQueue.add('recovery', {
                userId: details.userId,
                endpointId,
                alertId: activeAlert.id,
            })
        }
        jobsProcessedTotal.inc({ queue: queueName, status: 'completed' })
    } catch (err) {
        jobsProcessedTotal.inc({ queue: queueName, status: 'failed' })
        throw err
    } finally {
        endHist()
    }
}

// ─── One Worker per lane (different concurrency / rate caps later if needed) ─
const workerOpts = (queueName: string) => ({
    connection: queueConnection,
    concurrency: env.PING_WORKER_CONCURRENCY,
    lockDuration: 30_000,
    limiter: {
        max: env.PING_WORKER_RATE_MAX,
        duration: env.PING_WORKER_RATE_DURATION_MS,
    },
})

const workers = [PING_QUEUE_CRITICAL, PING_QUEUE_STANDARD, PING_QUEUE_BULK].map(name =>
    new Worker(name, (job: Job) => handlePing(job, name), workerOpts(name))
)

for (const w of workers) {
    w.on('completed', (job) => logger.debug({ queue: w.name, jobId: job.id }, 'job completed'))
    w.on('failed',    (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'))
}

startWorkerHealthServer({
    port: env.PING_WORKER_PORT,
    serviceName: 'worker-ping',
    logger,
    isHealthy: () => workers.every(w => !w.isPaused()),
})

async function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down ping workers')
    try {
        await Promise.allSettled(workers.map(w => w.close()))
    } catch (err) {
        logger.error({ err }, 'shutdown error')
    }
    process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

const getEndpointConfig = async (endpointId: string): Promise<Endpoint | null> => {
    const cached = await redis.get(`endpoint:config:${endpointId}`)
    if (cached != null) return JSON.parse(cached) as Endpoint

    const details = await prisma.endpoint.findFirst({
        where: { id: endpointId },
    })
    if (details) {
        await redis.setex(`endpoint:config:${endpointId}`, 300, JSON.stringify(details))
    }
    return details
}
