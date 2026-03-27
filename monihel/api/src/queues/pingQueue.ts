import { Queue } from 'bullmq'
import type { Priority } from '@prisma/client'

export interface PingJobData {
  endpointId: string
  userId: string
  priority: Priority
}

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

export const pingQueue = new Queue<PingJobData>('ping', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})
