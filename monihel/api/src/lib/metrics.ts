import client, { Counter, Histogram, Registry } from 'prom-client'

/**
 * Shared Prometheus registry + business metrics.
 *
 * Each process creates its own registry (default global one is fine) and
 * exposes /metrics. In production, run prometheus to scrape each pod.
 */

export const registry: Registry = client.register

// Standard process metrics (CPU, event loop lag, GC, memory, ...)
client.collectDefaultMetrics({ register: registry })

// ─── HTTP ─────────────────────────────────────────────────────────────────────
export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests received',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
})

export const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
})

// ─── Queue / Workers ──────────────────────────────────────────────────────────
export const jobsProcessedTotal = new Counter({
    name: 'jobs_processed_total',
    help: 'Total jobs processed by workers',
    labelNames: ['queue', 'status'] as const, // status: completed|failed|dead
    registers: [registry],
})

export const jobDurationSeconds = new Histogram({
    name: 'job_duration_seconds',
    help: 'Job processing duration in seconds',
    labelNames: ['queue'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [registry],
})

// ─── Pings ────────────────────────────────────────────────────────────────────
export const pingsTotal = new Counter({
    name: 'pings_total',
    help: 'Total endpoint pings',
    labelNames: ['result'] as const, // UP|DOWN|TIMEOUT
    registers: [registry],
})

export const pingResponseTimeMs = new Histogram({
    name: 'ping_response_time_ms',
    help: 'Response time of pinged endpoints in ms',
    labelNames: ['result'] as const,
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
})

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const alertsTotal = new Counter({
    name: 'alerts_total',
    help: 'Total alerts created/resolved',
    labelNames: ['type'] as const, // triggered|resolved|deduped
    registers: [registry],
})

// ─── Circuit breaker ──────────────────────────────────────────────────────────
export const circuitBreakerState = new Counter({
    name: 'circuit_breaker_events_total',
    help: 'Circuit breaker state transitions',
    labelNames: ['event'] as const, // open|halfOpen|close|reject
    registers: [registry],
})
