import pino from 'pino'
import { env } from '../config/env'

/**
 * Centralized structured logger.
 * - JSON output in production (machine parseable)
 * - Pretty output in development
 * - Service tag for filtering when multiple processes log to the same sink
 */

const isDev = !env.isProd

export function createLogger(service: string) {
    return pino({
        level: env.LOG_LEVEL,
        base: { service, pid: process.pid },
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
            paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'password',
                'authValue',
                'token',
                'refreshToken',
                'accessToken',
            ],
            remove: true,
        },
        ...(isDev && {
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
            },
        }),
    })
}

// Default logger (API). Workers create their own with a different service tag.
export const logger = createLogger('api')
