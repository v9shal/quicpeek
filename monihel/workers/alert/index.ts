// Alert worker entry point
import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import { sendRecoveryEmail } from './emailService'
import type { AlertJobData } from '../../api/src/queues/pingQueue'
import { queueConnection } from '../../api/src/lib/redis'
import { env } from '../../api/src/config/env'
import { createLogger } from '../../api/src/lib/logger'
import { jobsProcessedTotal, jobDurationSeconds, alertsTotal } from '../../api/src/lib/metrics'
import { startWorkerHealthServer } from '../../api/src/lib/workerHealth'

const logger = createLogger('worker-alert')

const worker = new Worker<AlertJobData>(
    'recovery',
    async (job: Job<AlertJobData>) => {
        const end = jobDurationSeconds.startTimer({ queue: 'recovery' })
        try {
            const { userId, endpointId, alertId } = job.data
            logger.info({ jobId: job.id, userId, endpointId }, 'processing recovery')
            await sendRecoveryEmail({ userId, endpointId, alertId })
            alertsTotal.inc({ type: 'resolved' })
            jobsProcessedTotal.inc({ queue: 'recovery', status: 'completed' })
        } catch (err) {
            jobsProcessedTotal.inc({ queue: 'recovery', status: 'failed' })
            throw err
        } finally {
            end()
        }
    },
    {
        connection: queueConnection,
        concurrency: 5,
    }
)

worker.on('completed', (job: Job) => {
    logger.debug({ jobId: job.id }, 'recovery email sent')
})

worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed')
})

startWorkerHealthServer({
    port: env.ALERT_WORKER_PORT,
    serviceName: 'worker-alert',
    logger,
    isHealthy: () => !worker.isPaused(),
})

async function shutdown() {
    logger.info('shutting down')
    await worker.close()
    process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

