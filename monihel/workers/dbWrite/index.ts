import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import { Pool } from 'pg'
import { MetricWriteJobData } from '../../api/src/queues/pingQueue'

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

pool.on('error', (err) => {
  console.error('[dbWrite] pg pool error:', err.message)
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
    console.log(`[dbWrite] flushed ${rows.length} rows → ${result.rowCount} inserted`)
  } catch (err) {
    batch.unshift(...rows)
    throw err
  }
}


const flushTimer = setInterval(async () => {
  try {
    await flushBatch()
  } catch (err: any) {
    console.error('[dbWrite] periodic flush failed:', err.message)
  }
}, BATCH_INTERVAL_MS)


const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

const worker = new Worker<MetricWriteJobData>(
  'metricWrite',
  async (job: Job<MetricWriteJobData>) => {
    const { endpointId, status, responseTimeMs, statusCode } = job.data

    const timestamp = new Date(job.timestamp)

    batch.push({ endpointId, timestamp, status, responseTimeMs, statusCode })

    if (batch.length >= BATCH_SIZE_CAP) {
      await flushBatch()
    }
  },
  {
    connection,
    concurrency: 1,
  }
)

worker.on('completed', (job: Job) => {
  console.log(`[dbWrite] job=${job.id} collected (batch size: ${batch.length})`)
})

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[dbWrite] job=${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})


async function shutdown() {
  console.log('[dbWrite] shutting down — flushing remaining batch...')
  clearInterval(flushTimer)
  await worker.close()
  await flushBatch()
  await pool.end()
  console.log('[dbWrite] shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

