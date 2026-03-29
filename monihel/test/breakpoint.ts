/**
 * breakpoint.ts — Monihel API breaking-point load test
 *
 * Strategy:
 *  1. setup()  — login once, seed 300 unique endpoints in DB, return token + endpoint IDs
 *  2. default() — two weighted scenarios run concurrently:
 *       • "creators"  (20 % of VUs) → POST /api/endpoints  (write pressure)
 *       • "readers"   (80 % of VUs) → GET  /api/endpoints  (read pressure)
 *  3. Ramp: 0 → 300 VUs over 2 min, hold 3 min, then spike to 600 for 1 min → ramp down
 *
 * Run: k6 run test/breakpoint.ts
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend, Rate, Gauge } from 'k6/metrics'
import type { Options } from 'k6/options'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

// 300 reliable public URLs that return 2xx (mix of categories for realism)
const PUBLIC_URLS: string[] = [
  // JSONPlaceholder — stable mock REST API
  ...Array.from({ length: 100 }, (_, i) => `https://jsonplaceholder.typicode.com/posts/${(i % 100) + 1}`),
  // httpbin — reflects requests, always 200
  ...Array.from({ length: 100 }, (_, i) => `https://httpbin.org/status/200`),
  // reqres — another stable mock API
  ...Array.from({ length: 100 }, (_, i) => `https://reqres.in/api/users/${(i % 12) + 1}`),
]

// ─── Custom metrics ───────────────────────────────────────────────────────────

const createOk        = new Counter('endpoint_create_ok')
const createFail      = new Counter('endpoint_create_fail')
const getOk           = new Counter('endpoint_get_ok')
const getFail         = new Counter('endpoint_get_fail')
const createLatency   = new Trend('endpoint_create_latency_ms', true)
const getLatency      = new Trend('endpoint_get_latency_ms', true)
const createRate      = new Rate('endpoint_create_success_rate')
const getRate         = new Rate('endpoint_get_success_rate')
const activeVUs       = new Gauge('active_vus')

// ─── Scenario config ─────────────────────────────────────────────────────────

export const options: Options = {
  scenarios: {
    // 80 % of VUs hammer GET (read path — typical prod ratio)
    readers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m',   target: 240 },  // ramp to 240 VUs
        { duration: '2m',   target: 240 },  // hold
        { duration: '30s',  target: 480 },  // spike
        { duration: '1m',   target: 480 },  // hold spike → find breaking point
        { duration: '30s',  target: 0   },  // ramp down
      ],
      gracefulRampDown: '20s',
      exec: 'readerScenario',
    },

    // 20 % of VUs hammer POST (write path — DB + Redis + BullMQ pressure)
    creators: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m',   target: 60  },
        { duration: '2m',   target: 60  },
        { duration: '30s',  target: 120 },
        { duration: '1m',   target: 120 },
        { duration: '30s',  target: 0   },
      ],
      gracefulRampDown: '20s',
      exec: 'creatorScenario',
    },
  },

  thresholds: {
    // API must handle 95% of requests under 1 s
    'endpoint_create_latency_ms': ['p(95)<1000', 'p(99)<3000'],
    'endpoint_get_latency_ms':    ['p(95)<500',  'p(99)<1500'],

    // Success rates
    'endpoint_create_success_rate': ['rate>0.95'],
    'endpoint_get_success_rate':    ['rate>0.98'],

    // Overall HTTP error rate < 5 %
    'http_req_failed': ['rate<0.05'],

    // 95th percentile across all HTTP requests < 2 s
    'http_req_duration': ['p(95)<2000'],
  },
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetupData {
  token: string
}

const BASE_URL    = 'http://localhost:4000'
const JSON_HDR    = { 'Content-Type': 'application/json' }

// ─── setup() — runs ONCE before all VUs ──────────────────────────────────────

export function setup(): SetupData {
  // 1. Login
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ login: 'testuser', password: 'Test@1234' }),
    { headers: JSON_HDR }
  )
  if (loginRes.status !== 200) {
    throw new Error(`[setup] Login failed: ${loginRes.status} ${loginRes.body}`)
  }
  const token = (JSON.parse(loginRes.body as string) as any).data.accessToken as string
  console.log('[setup] Login OK')

  // 2. Pre-seed 300 endpoints from our public URL list so GET requests have data
  const authHdrs = { ...JSON_HDR, Authorization: `Bearer ${token}` }
  let seeded = 0
  for (let i = 0; i < PUBLIC_URLS.length; i++) {
    const url = PUBLIC_URLS[i]
    const r = http.post(
      `${BASE_URL}/api/endpoints`,
      JSON.stringify({
        name:             `seed-${i}-${randomString(4)}`,
        url:              `https://seed-${randomString(16)}.example.com`,
        checkIntervalSec: 60,
        priority:         i % 3 === 0 ? 'CRITICAL' : i % 3 === 1 ? 'MEDIUM' : 'LOW',
      }),
      { headers: authHdrs }
    )
    if (r.status === 201 || r.status === 409) seeded++
  }
  console.log(`[setup] Seeded ${seeded}/300 endpoints`)

  return { token }
}

// ─── Reader scenario — GET /api/endpoints ────────────────────────────────────

export function readerScenario(data: SetupData): void {
  activeVUs.add(1)

  const res = http.get(`${BASE_URL}/api/endpoints`, {
    headers: {
      ...JSON_HDR,
      Authorization: `Bearer ${data.token}`,
    },
  })

  getLatency.add(res.timings.duration)

  const ok = res.status === 200
  getRate.add(ok)

  if (ok) {
    getOk.add(1)
  } else {
    getFail.add(1)
    console.error(`[reader VU${__VU}] GET failed: ${res.status}`)
  }

  check(res, {
    'GET 200': () => ok,
    'has endpoints array': () => {
      try { return Array.isArray((JSON.parse(res.body as string) as any).endpoints ?? (JSON.parse(res.body as string) as any)) }
      catch { return false }
    },
  })

  // Realistic think time: 200–800 ms between requests
  sleep(0.2 + Math.random() * 0.6)
}

// ─── Creator scenario — POST /api/endpoints ───────────────────────────────────

export function creatorScenario(data: SetupData): void {
  activeVUs.add(1)

  const res = http.post(
    `${BASE_URL}/api/endpoints`,
    JSON.stringify({
      name:             `load-${randomString(6)}`,
      // guaranteed-unique URL per call → always 201, never 409
      url:              `https://${randomString(20)}.example.com`,
      checkIntervalSec: 60,
      priority:         'LOW',
    }),
    {
      headers: {
        ...JSON_HDR,
        Authorization: `Bearer ${data.token}`,
      },
    }
  )

  createLatency.add(res.timings.duration)

  const ok = res.status === 201 || res.status === 409
  createRate.add(ok)

  if (res.status === 201) {
    createOk.add(1)
  } else if (res.status === 409) {
    createOk.add(1) // conflict is still OK — idempotent
  } else {
    createFail.add(1)
    console.error(`[creator VU${__VU}] POST failed: ${res.status} — ${res.body}`)
  }

  check(res, {
    'POST 201 or 409': () => ok,
    'has endpoint id': () => {
      try { return !!(JSON.parse(res.body as string) as any)?.endpoint?.id || res.status === 409 }
      catch { return false }
    },
  })

  // Writers pause slightly less than readers — more aggressive
  sleep(0.1 + Math.random() * 0.3)
}
