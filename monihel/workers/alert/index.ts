// Alert worker entry point
import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import { sendRecoveryEmail } from './emailService'
import type { alert as AlertJobData } from '../../api/src/queues/pingQueue'

const connection = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

const worker = new Worker<AlertJobData>(
    'recovery',
    async (job: Job<AlertJobData>) => {
        const { userId, endpointId, alertId } = job.data
        console.log(`[alert:worker] job=${job.id} userId=${userId} endpointId=${endpointId}`)
        await sendRecoveryEmail({ userId, endpointId, alertId })
    },
    {
        connection,
        concurrency: 5,
    }
)

worker.on('completed', (job: Job) => {
    console.log(`[alert:worker] job=${job.id} — recovery email sent`)
})

worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[alert:worker] job=${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})

async function shutdown() {
    console.log('[alert:worker] shutting down...')
    await worker.close()
    process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)
