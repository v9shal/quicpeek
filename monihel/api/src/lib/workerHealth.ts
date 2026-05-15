import http from 'http'
import type { Logger } from 'pino'
import { registry } from './metrics'

interface WorkerHealthOptions {
    port: number
    serviceName: string
    logger: Logger
    /** Optional probe — return true if the worker is healthy. */
    isHealthy?: () => boolean | Promise<boolean>
}

/**
 * Tiny HTTP server every worker exposes for liveness + metrics scraping.
 *
 *   GET /health   — 200 ok, 503 if isHealthy() returns false
 *   GET /metrics  — Prometheus exposition format
 *
 * Designed to be cheap: no Express, no middleware.
 */
export function startWorkerHealthServer(opts: WorkerHealthOptions): http.Server {
    const { port, serviceName, logger, isHealthy } = opts

    const server = http.createServer(async (req, res) => {
        try {
            if (req.url === '/health') {
                const ok = isHealthy ? await isHealthy() : true
                res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ service: serviceName, status: ok ? 'ok' : 'unhealthy' }))
                return
            }
            if (req.url === '/metrics') {
                res.writeHead(200, { 'Content-Type': registry.contentType })
                res.end(await registry.metrics())
                return
            }
            res.writeHead(404).end()
        } catch (err: any) {
            logger.error({ err: err?.message }, 'health server error')
            res.writeHead(500).end()
        }
    })

    server.listen(port, '0.0.0.0', () => {
        logger.info({ port }, `${serviceName} health server listening`)
    })

    return server
}
