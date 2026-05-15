import { Queue, QueueEvents } from 'bullmq'
import { Priority } from '@prisma/client'
import { queueConnection } from '../lib/redis'
import { logger } from '../lib/logger'

/**
 * Queue architecture
 * ------------------
 *  ping-critical   ─┐
 *  ping-standard   ─┼─► (ping worker)  ─► metricWrite ─► (dbWrite worker)
 *  ping-bulk       ─┘                                 └─► recovery     ─► (alert worker)
 *
 *  ping-dlq         ← terminal failures from any lane (for manual inspection / replay)
 *
 * Priority lanes prevent one large user from starving another. The ping
 * worker subscribes to all three lanes.
 */

export interface PingJobData {
    endpointId: string
    userId: string
    priority: Priority
}

export interface MetricWriteJobData {
    endpointId: string
    status: 'UP' | 'DOWN' | 'TIMEOUT'
    statusCode: number | null
    responseTimeMs: number
}

export interface AlertJobData {
    userId: string
    endpointId: string
    alertId: string
}

export interface DeadJobData {
    sourceQueue: string
    originalJobId: string | undefined
    failedReason: string
    attemptsMade: number
    data: unknown
    failedAt: string
}

export const PING_QUEUE_CRITICAL = 'ping-critical'
export const PING_QUEUE_STANDARD = 'ping-standard'
export const PING_QUEUE_BULK = 'ping-bulk'
export const PING_QUEUE_DLQ = 'ping-dlq'

const pingDefaults = {
    connection: queueConnection,
    defaultJobOptions: {
        removeOnComplete: { count: 100, age: 60 * 60 },
        removeOnFail: { count: 500 },
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2_000 },
    },
}

export const pingQueueCritical = new Queue<PingJobData>(PING_QUEUE_CRITICAL, pingDefaults)
export const pingQueueStandard = new Queue<PingJobData>(PING_QUEUE_STANDARD, pingDefaults)
export const pingQueueBulk = new Queue<PingJobData>(PING_QUEUE_BULK, pingDefaults)

export const allPingQueues = [pingQueueCritical, pingQueueStandard, pingQueueBulk]

/** Map a Priority enum to the queue it should be scheduled on. */
export function queueForPriority(priority: Priority): Queue<PingJobData> {
    switch (priority) {
        case Priority.CRITICAL: return pingQueueCritical
        case Priority.MEDIUM:   return pingQueueStandard
        case Priority.LOW:
        default:                return pingQueueBulk
    }
}

/** Find which lane currently owns the repeat job for an endpoint. */
export async function findPingQueueForEndpoint(endpointId: string) {
    const jobId = `endpoint:${endpointId}`
    for (const q of allPingQueues) {
        const jobs = await q.getRepeatableJobs()
        const j = jobs.find(j => j.id === jobId)
        if (j) return { queue: q, repeatKey: j.key }
    }
    return null
}

/** Remove the repeat job for an endpoint from whichever lane holds it. */
export async function removePingRepeatJob(endpointId: string): Promise<void> {
    const found = await findPingQueueForEndpoint(endpointId)
    if (found) await found.queue.removeRepeatableByKey(found.repeatKey)
}

/** Schedule (or reschedule) a repeating ping job for an endpoint. */
export async function schedulePingJob(args: {
    endpointId: string
    userId: string
    priority: Priority
    checkIntervalSec: number
}): Promise<void> {
    await removePingRepeatJob(args.endpointId)
    const q = queueForPriority(args.priority)
    await q.add(
        'ping',
        { endpointId: args.endpointId, userId: args.userId, priority: args.priority },
        {
            repeat: { every: args.checkIntervalSec * 1000 },
            jobId: `endpoint:${args.endpointId}`,
        }
    )
}

// ─── downstream queues (names preserved to match existing workers) ─────────
export const dbWriteQueue = new Queue<MetricWriteJobData>('metricWrite', {
    connection: queueConnection,
    defaultJobOptions: {
        removeOnComplete: { count: 100, age: 600 },
        removeOnFail: { count: 200 },
        attempts: 10,
        backoff: { type: 'exponential', delay: 2_000 },
    },
})

export const alertQueue = new Queue<AlertJobData>('recovery', {
    connection: queueConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
    },
})

/** Dead Letter Queue — terminal failures from any worker land here. */
export const deadLetterQueue = new Queue<DeadJobData>(PING_QUEUE_DLQ, {
    connection: queueConnection,
    defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
    },
})

/**
 * Wire QueueEvents on every queue so terminal failures are forwarded to the DLQ.
 * Call once from the API process; returns a teardown function.
 */
export function startDeadLetterForwarder(): () => Promise<void> {
    const watched: QueueEvents[] = []

    for (const q of [...allPingQueues, dbWriteQueue, alertQueue]) {
        const events = new QueueEvents(q.name, { connection: queueConnection })

        events.on('failed', async ({ jobId, failedReason }) => {
            try {
                const job = await q.getJob(jobId)
                if (!job) return
                const maxAttempts = job.opts.attempts ?? 1
                if (job.attemptsMade < maxAttempts) return

                await deadLetterQueue.add(
                    'dead',
                    {
                        sourceQueue: q.name,
                        originalJobId: jobId,
                        failedReason,
                        attemptsMade: job.attemptsMade,
                        data: job.data,
                        failedAt: new Date().toISOString(),
                    },
                    { jobId: `${q.name}:${jobId}` }
                )
                logger.warn(
                    { queue: q.name, jobId, failedReason, attempts: job.attemptsMade },
                    'job moved to DLQ'
                )
            } catch (err: any) {
                logger.error({ err: err?.message, queue: q.name, jobId }, 'DLQ forward failed')
            }
        })

        watched.push(events)
    }

    return async () => {
        await Promise.allSettled(watched.map(e => e.close()))
    }
}

/**
 * @deprecated kept for backwards compatibility with older imports.
 * Use `schedulePingJob()` / `queueForPriority()` instead.
 */
export const pingQueue = pingQueueStandard