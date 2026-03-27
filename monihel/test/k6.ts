import http from 'k6/http'
import { check } from 'k6'
import { Counter, Trend, Rate } from 'k6/metrics'
import type { Options } from 'k6/options'

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

const endpointCreated   = new Counter('endpoints_created')
const endpointConflict  = new Counter('endpoints_conflict')
const endpointFailed    = new Counter('endpoints_failed')
const createDuration    = new Trend('create_endpoint_duration', true)
const createSuccessRate = new Rate('create_endpoint_success_rate')

export const options: Options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50  },  // ramp to 50 VUs
        { duration: '30s', target: 50  },  // hold at 50
        { duration: '10s', target: 150 },  // spike to 150
        { duration: '30s', target: 150 },  // hold the spike
        { duration: '10s', target: 0   },  // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // ≥ 95 % of create-endpoint calls succeed (201 or 409)
    create_endpoint_success_rate:  ['rate>0.95'],
    // 95th percentile response time under 1 s
    create_endpoint_duration:      ['p(95)<1000'],
    // overall HTTP error rate < 5 %
    http_req_failed:               ['rate<0.05'],
  },
}

const BASE_URL = 'http://localhost:4000'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface SetupData { token: string }

// ── setup(): login once, share the JWT with all VUs ──────────────────────────
export function setup(): SetupData {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ login: 'testuser', password: 'Test@1234' }),
    { headers: JSON_HEADERS }
  )

  if (res.status !== 200) {
    throw new Error(`[setup] Login failed ${res.status}: ${res.body}`)
  }

  const token = (JSON.parse(res.body as string) as any).data.accessToken as string
  console.log('[setup] Logged in — token acquired')
  return { token }
}

// ── default(): every VU calls POST /api/endpoints continuously ───────────────
export default function (data: SetupData) {
  const payload = JSON.stringify({
    name:             `stress-${randomString(5)}`,
    url:              `https://${randomString(12)}.example.com`,
    checkIntervalSec: 60,
    priority:         'LOW',
  })

  const res = http.post(`${BASE_URL}/api/endpoints`, payload, {
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${data.token}`,
    },
  })

  // Track timing in our custom trend
  createDuration.add(res.timings.duration)

  const ok = res.status === 201 || res.status === 409
  createSuccessRate.add(ok)

  if (res.status === 201) {
    endpointCreated.add(1)
  } else if (res.status === 409) {
    endpointConflict.add(1)
  } else {
    endpointFailed.add(1)
    console.error(`[VU${__VU} ITER${__ITER}] Unexpected ${res.status}: ${res.body}`)
  }

  check(res, {
    'status 201 or 409': () => ok,
    'has body':          () => (res.body as string).length > 0,
  })

  // No sleep — maximum throughput stress test
}
