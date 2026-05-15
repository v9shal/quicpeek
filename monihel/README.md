# Monihel — Uptime Monitoring Backend

Production-ready uptime monitoring backend with real-time alerts, priority queue lanes, circuit breaking, and Prometheus observability. Built with **Node.js 22**, **TypeScript**, **Express 5**, **BullMQ**, **Prisma**, **PostgreSQL**, and **Redis**.

Perfect as a SaaS starter, internal tool, or infrastructure boilerplate.

---

## ✨ Features

| Category | What you get |
|---|---|
| **Endpoint Monitoring** | HTTP/HTTPS ping with configurable intervals (60 s+), auth support (API key, Basic, Bearer) |
| **Priority Queues** | Three BullMQ lanes (critical / standard / bulk) — large users never starve small ones |
| **Dead Letter Queue** | Terminal failures auto-forwarded to `ping-dlq` for inspection & replay |
| **Circuit Breaker** | Cockatiel-based breaker — 3 consecutive failures opens for 5 min, prevents cascade |
| **Rate Limiting** | BullMQ limiter caps pings/sec, Express rate-limits on API + auth routes |
| **Real-time** | Socket.IO with Redis adapter — live status pushed to connected dashboards |
| **Alerting** | Threshold-based alerts → digest batching → email (SMTP) and webhook channels |
| **Idempotent Writes** | `ON CONFLICT DO NOTHING` on metrics, Serializable TX on alert creation |
| **Observability** | Pino structured logs, Prometheus metrics (`/metrics` on API + every worker), per-worker `/health` |
| **Security** | Helmet, CORS, AES-256-GCM credential encryption, SSRF protection, JWT with refresh-token rotation |
| **Docker Ready** | Multi-stage Dockerfile + `docker-compose.yml` — one command to run everything |

---

## 🏗️ Architecture

```
                          ┌─────────────┐
                          │  Express 5  │
                          │  API Server │──── Socket.IO (real-time)
                          │  :4000      │
                          └──────┬──────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
      ┌──────────────┐  ┌──────────────┐   ┌──────────────┐
      │ ping-critical │  │ ping-standard│   │  ping-bulk   │
      └──────┬───────┘  └──────┬───────┘   └──────┬───────┘
             └──────────────┬──┘──────────────────┘
                            ▼
                    ┌──────────────┐
                    │ Ping Worker  │──── Circuit Breaker
                    │ :4101        │──── Rate Limiter
                    └──────┬───────┘
                     ┌─────┴──────┐
                     ▼            ▼
             ┌────────────┐ ┌────────────┐
             │ metricWrite│ │  recovery  │
             └─────┬──────┘ └─────┬──────┘
                   ▼              ▼
           ┌────────────┐ ┌────────────┐  ┌────────────┐
           │ dbWrite    │ │ Alert      │  │ Digest     │
           │ Worker     │ │ Worker     │  │ Worker     │
           │ :4102      │ │ :4103      │  │ :4104      │
           └────────────┘ └────────────┘  └────────────┘

    ★ Terminal failures from any queue → ping-dlq (Dead Letter Queue)
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22
- **PostgreSQL** ≥ 15
- **Redis** ≥ 7

### Option A — Docker (recommended)

```bash
git clone <repo-url> monihel && cd monihel

# Create your env file
cp .env.example .env
# Edit .env — at minimum set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY

# Start everything
docker compose up --build -d

# Apply database migrations
docker compose exec api npx prisma migrate deploy

# (Optional) Seed demo data
docker compose exec api npx ts-node scripts/seed.ts

# Verify
curl http://localhost:4000/health
# → {"success":true,"status":"ok"}
```

### Option B — Local

```bash
git clone <repo-url> monihel && cd monihel
npm install

cp .env.example .env
# Edit .env with your Postgres + Redis connection details

# Generate Prisma client + run migrations
npm run db:generate
npm run db:migrate

# Terminal 1 — API server
npm run dev

# Terminal 2–5 — Workers (or use PM2, see below)
npm run dev:worker:ping
npm run dev:worker:db
npm run dev:worker:alert
npm run dev:worker:digest
```

### Option C — PM2 (production on a VPS)

```bash
npm run build
pm2 start ecosystem.config.js
pm2 logs
```

---

## 📁 Project Structure

```
monihel/
├── api/src/
│   ├── app.ts              # Express app (middleware, routes)
│   ├── index.ts            # HTTP server, startup, graceful shutdown
│   ├── config/env.ts       # Validated environment variables
│   ├── lib/
│   │   ├── logger.ts       # Pino structured logger
│   │   ├── metrics.ts      # Prometheus counters & histograms
│   │   ├── prisma.ts       # Prisma client
│   │   ├── redis.ts        # Redis clients (cache + queue)
│   │   └── workerHealth.ts # Worker health/metrics HTTP server
│   ├── middleware/          # Auth JWT guard, error handler
│   ├── queues/pingQueue.ts  # Queue definitions, priority lanes, DLQ
│   ├── routes/              # Express route handlers
│   ├── services/            # Business logic (auth, endpoints)
│   ├── utils/               # Encryption, SSRF check, validation
│   └── websocket/           # Socket.IO gateway
├── workers/
│   ├── ping/               # Ping worker (3 lanes, circuit breaker)
│   ├── dbWrite/            # Metric batch-insert worker
│   ├── alert/              # Recovery email worker
│   └── digest/             # Alert digest scheduler
├── prisma/
│   └── schema.prisma       # Database schema
├── scripts/
│   └── seed.ts             # Demo data seed script
├── docker-compose.yml       # One-command local infra
├── Dockerfile               # Multi-stage production build
├── ecosystem.config.js      # PM2 process manager config
└── .env.example             # All env vars documented
```

---

## 🔌 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | — | Create account |
| `POST` | `/api/auth/login` | — | Get JWT tokens |
| `POST` | `/api/auth/refresh` | — | Rotate refresh token |
| `POST` | `/api/auth/logout` | ✓ | Revoke token family |
| `GET` | `/api/endpoints` | ✓ | List all endpoints |
| `POST` | `/api/endpoints` | ✓ | Create monitored endpoint |
| `GET` | `/api/endpoints/:id` | ✓ | Get endpoint details |
| `PUT` | `/api/endpoints/:id` | ✓ | Update endpoint config |
| `DELETE` | `/api/endpoints/:id` | ✓ | Remove endpoint |
| `PATCH` | `/api/endpoints/:id/pause` | ✓ | Pause monitoring |
| `PATCH` | `/api/endpoints/:id/resume` | ✓ | Resume monitoring |
| `GET` | `/api/endpoints/:id/metrics` | ✓ | Historical metrics |
| `GET` | `/api/alerts` | ✓ | List alerts |
| `GET` | `/health` | — | Liveness probe |
| `GET` | `/metrics` | — | Prometheus scrape endpoint |

---

## 📊 Observability

### Prometheus Metrics

Every process exposes `/metrics` in Prometheus exposition format:

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | method, route, status |
| `http_request_duration_seconds` | Histogram | method, route, status |
| `jobs_processed_total` | Counter | queue, status |
| `job_duration_seconds` | Histogram | queue |
| `pings_total` | Counter | result (UP/DOWN/TIMEOUT) |
| `ping_response_time_ms` | Histogram | result |
| `alerts_total` | Counter | type |
| `circuit_breaker_events_total` | Counter | event |

### Structured Logging

All logs are JSON (pino) with service tags, request IDs, and automatic redaction of secrets.

---

## ⚙️ Environment Variables

See [`.env.example`](.env.example) for the full list with documentation.

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_ACCESS_SECRET` — ≥32 char secret
- `JWT_REFRESH_SECRET` — ≥32 char secret
- `ENCRYPTION_KEY` — 64 hex chars (`openssl rand -hex 32`)

---

## 🛡️ Security

- **Helmet** — secure HTTP headers
- **CORS** — configurable origin whitelist
- **Rate Limiting** — 300 req/15min global, 20 req/15min auth
- **AES-256-GCM** — endpoint credential encryption at rest
- **SSRF Protection** — async DNS resolution blocks private/internal targets
- **JWT Rotation** — refresh token family tracking with automatic revocation on reuse

---

## 📄 License

See [LICENSE](LICENSE) file.
