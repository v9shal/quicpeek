import http from 'http'
import crypto from 'crypto'
import os from 'os'
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

// ─── License validation ───────────────────────────────────────────────────────
async function validateLicense(): Promise<void> {
    const key = process.env.LICENSE_KEY
    if (!key) {
        console.error('\n❌  LICENSE_KEY is not set.')
        console.error('    Purchase Monihel at https://monihel.in to get a key.')
        console.error('    Then add LICENSE_KEY=MNHL-XXXX-XXXX-XXXX to your .env\n')
        process.exit(1)
    }

    // Stable instance ID: hash of hostname + DATABASE_URL
    const instanceId = crypto
        .createHash('sha256')
        .update(os.hostname() + (process.env.DATABASE_URL || ''))
        .digest('hex')
        .slice(0, 32)

    const validateUrl = process.env.LICENSE_VALIDATE_URL ||
        'https://quicpeek-production.up.railway.app/v1/licenses/validate'

    try {
        const res = await fetch(validateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, instanceId }),
            signal: AbortSignal.timeout(10_000),
        })
        const data = await res.json() as { valid: boolean; error?: string }
        if (!data.valid) {
            console.error(`\n❌  License invalid: ${data.error}`)
            console.error('    Purchase a new key at https://monihel.in\n')
            process.exit(1)
        }
        logger.info({ instanceId }, 'license validated ✅')
    } catch (err: any) {
        // Grace: if validation server unreachable, warn but don't block
        logger.warn({ err: err?.message }, 'license server unreachable — continuing')
    }
}

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
        await validateLicense()
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