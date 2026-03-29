import http from 'http'
import app from './app'
import { initWebSocket } from './websocket/gateway'
import { disconnectRedis } from './lib/redis'
import prisma from './lib/prisma'
import { pingQueue } from './queues/pingQueue'

const httpServer = http.createServer(app)
initWebSocket(httpServer)

// ─── Recreate missing BullMQ repeat jobs on startup ───────────────────────────
async function recreateMissingJobs(): Promise<void> {
    const [activeEndpoints, existingJobs] = await Promise.all([
        prisma.endpoint.findMany({
            where: { isActive: true },
            select: { id: true, userId: true, priority: true, checkIntervalSec: true },
        }),
        pingQueue.getRepeatableJobs(),
    ])

    const scheduledIds = new Set(existingJobs.map(j => j.id))
    let recreated = 0

    for (const ep of activeEndpoints) {
        const jobId = `endpoint:${ep.id}`
        if (!scheduledIds.has(jobId)) {
            await pingQueue.add(
                'ping',
                { endpointId: ep.id, userId: ep.userId, priority: ep.priority },
                { repeat: { every: ep.checkIntervalSec * 1000 }, jobId }
            )
            recreated++
        }
    }

    console.log(`[startup] ${activeEndpoints.length} active endpoints — recreated ${recreated} missing BullMQ jobs`)
}

httpServer.listen(4000, async () => {
    console.log('Server running on port 4000')
    await recreateMissingJobs()
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down...`)
    httpServer.close(async () => {
        await disconnectRedis()
        process.exit(0)
    })
    setTimeout(() => process.exit(1), 3000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.once('SIGUSR2', () => shutdown('SIGUSR2'))