// Digest worker entry point
import 'dotenv/config'
import { runDigest } from './digestService'

const INTERVAL_MS = 5 * 60 * 1000  

async function tick(): Promise<void> {
    console.log(`[digest] tick at ${new Date().toISOString()}`)
    try {
        await runDigest()
    } catch (err: any) {
        console.error('[digest] Unhandled error during runDigest:', err.message)
    }
}

// Run immediately on startup, then every 5 minutes
tick()
const timer = setInterval(tick, INTERVAL_MS)
console.log(`[digest] Scheduler started — running every ${INTERVAL_MS / 1000}s`)

async function shutdown() {
    console.log('[digest] Shutting down...')
    clearInterval(timer)
    process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)
