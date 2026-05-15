// Digest worker entry point
import 'dotenv/config'
import { runDigest } from './digestService'
import { env } from '../../api/src/config/env'
import { createLogger } from '../../api/src/lib/logger'
import { startWorkerHealthServer } from '../../api/src/lib/workerHealth'

const logger = createLogger('worker-digest')
const INTERVAL_MS = 5 * 60 * 1000

let lastTickAt = Date.now()
let lastTickOk = true

async function tick(): Promise<void> {
    logger.info('tick')
    lastTickAt = Date.now()
    try {
        await runDigest()
        lastTickOk = true
    } catch (err: any) {
        lastTickOk = false
        logger.error({ err: err.message }, 'unhandled error during runDigest')
    }
}

// Run immediately on startup, then every 5 minutes
tick()
const timer = setInterval(tick, INTERVAL_MS)
logger.info({ intervalSec: INTERVAL_MS / 1000 }, 'scheduler started')

startWorkerHealthServer({
    port: env.DIGEST_WORKER_PORT,
    serviceName: 'worker-digest',
    logger,
    // Healthy if last tick succeeded and ran within 2× the interval window.
    isHealthy: () => lastTickOk && Date.now() - lastTickAt < INTERVAL_MS * 2,
})

async function shutdown() {
    logger.info('shutting down')
    clearInterval(timer)
    process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

