import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import { Pool } from 'pg'
import { MetricWriteJobData } from '../../api/src/queues/pingQueue'
import { queueConnection } from '../../api/src/lib/redis'
import { env } from '../../api/src/config/env'
import { createLogger } from '../../api/src/lib/logger'
import { jobsProcessedTotal, jobDurationSeconds } from '../../api/src/lib/metrics'
import { startWorkerHealthServer } from '../../api/src/lib/workerHealth'

const logger = createLogger('worker-dbwrite')
const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'pg pool error')
})


interface MetricRow {
  endpointId:    string
  timestamp:     Date
  status:        'UP' | 'DOWN' | 'TIMEOUT'
  responseTimeMs: number
  statusCode:    number | null
}

let batch: MetricRow[] = []
const BATCH_INTERVAL_MS = 10_000
const BATCH_SIZE_CAP    = 1_000

/**
 * Idempotent flush: ON CONFLICT (endpoint_id, timestamp) DO NOTHING means
 * that even if a job is re-delivered after a worker crash, the row will not
 * be duplicated. The composite PK on (endpoint_id, timestamp) is the dedup key.
 */
async function flushBatch(): Promise<void> {
  if (batch.length === 0) return

  const rows = batch.splice(0, BATCH_SIZE_CAP)

  const values: unknown[] = []
  const placeholders = rows.map((row, i) => {
    const base = i * 5
    values.push(
      row.endpointId,
      row.timestamp,
      row.status,
      row.responseTimeMs,
      row.statusCode
    )
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
  })

  const sql = `
    INSERT INTO endpoint_metrics
      (endpoint_id, timestamp, status, response_time_ms, status_code)
    VALUES
      ${placeholders.join(', ')}
    ON CONFLICT (endpoint_id, timestamp) DO NOTHING
  `

  try {
    const result = await pool.query(sql, values)
    logger.info({ batched: rows.length, inserted: result.rowCount }, 'flushed metric batch')
  } catch (err) {
    batch.unshift(...rows)
    throw err
  }
}


const flushTimer = setInterval(async () => {
  try {
    await flushBatch()
  } catch (err: any) {
    logger.error({ err: err.message }, 'periodic flush failed')
  }
}, BATCH_INTERVAL_MS)


const worker = new Worker<MetricWriteJobData>(
  'metricWrite',
  async (job: Job<MetricWriteJobData>) => {
    const end = jobDurationSeconds.startTimer({ queue: 'metricWrite' })
    try {
      const { endpointId, status, responseTimeMs, statusCode } = job.data
      const timestamp = new Date(job.timestamp)
      batch.push({ endpointId, timestamp, status, responseTimeMs, statusCode })

      if (batch.length >= BATCH_SIZE_CAP) await flushBatch()
      jobsProcessedTotal.inc({ queue: 'metricWrite', status: 'completed' })
    } catch (err) {
      jobsProcessedTotal.inc({ queue: 'metricWrite', status: 'failed' })
      throw err
    } finally {
      end()
    }
  },
  {
    connection: queueConnection,
    concurrency: 1,
  }
)

worker.on('completed', (job: Job) => {
  logger.debug({ jobId: job.id, batchSize: batch.length }, 'job collected')
})

worker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed')
})

startWorkerHealthServer({
  port: env.DBWRITE_WORKER_PORT,
  serviceName: 'worker-dbwrite',
  logger,
  isHealthy: () => !worker.isPaused(),
})


async function shutdown() {
  logger.info('shutting down — flushing remaining batch')
  clearInterval(flushTimer)
  await worker.close()
  await flushBatch()
  await pool.end()
  logger.info('shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)


