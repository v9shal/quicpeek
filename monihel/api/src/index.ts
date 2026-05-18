import http from 'http'
import app from './app'
import { env } from './config/env'
import { initWebSocket } from './websocket/gateway'
import { disconnectRedis } from './lib/redis'
import { logger } from './lib/logger'
import prisma from './lib/prisma'
import {
    allPingQueues,
    schedulePingJob,
    dbWriteQueue,
    alertQueue,
    deadLetterQueue,
    startDeadLetterForwarder,
} from './queues/pingQueue'

const httpServer = http.createServer(app)
initWebSocket(httpServer)

const stopDLQ = startDeadLetterForwarder()

// ─── Recreate missing BullMQ repeat jobs on startup ───────────────────────────
async function recreateMissingJobs(): Promise<void> {
    const activeEndpoints = await prisma.endpoint.findMany({
        where: { isActive: true },
        select: { id: true, userId: true, priority: true, checkIntervalSec: true },
    })

    // Build a set of every endpoint already scheduled in any lane.
    const scheduled = new Set<string>()
    for (const q of allPingQueues) {
        const jobs = await q.getRepeatableJobs()
        for (const j of jobs) if (j.id) scheduled.add(j.id)
    }

    let recreated = 0
    for (const ep of activeEndpoints) {
        if (scheduled.has(`endpoint:${ep.id}`)) continue
        await schedulePingJob({
            endpointId: ep.id,
            userId: ep.userId,
            priority: ep.priority,
            checkIntervalSec: ep.checkIntervalSec,
        })
        recreated++
    }

    logger.info({ activeEndpoints: activeEndpoints.length, recreated }, 'startup repeat-job sync done')
}

httpServer.listen(env.PORT, '0.0.0.0', async () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening')
    try {
        await recreateMissingJobs()
    } catch (err: any) {
        logger.error({ err: err?.message ?? err }, 'failed to recreate repeat jobs')
    }
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down')
    httpServer.close(async () => {
        try {
            await stopDLQ()
            await Promise.allSettled([
                ...allPingQueues.map(q => q.close()),
                dbWriteQueue.close(),
                alertQueue.close(),
                deadLetterQueue.close(),
            ])
            await disconnectRedis()
            await prisma.$disconnect()
        } catch (err) {
            logger.error({ err }, 'cleanup error')
        }
        process.exit(0)
    })
    setTimeout(() => process.exit(1), 5000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.once('SIGUSR2', () => shutdown('SIGUSR2'))