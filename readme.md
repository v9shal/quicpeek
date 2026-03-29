monihel/
├── api/                          # Express API server
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── endpoints.ts
│   │   │   ├── metrics.ts
│   │   │   └── alerts.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── errorHandler.ts
│   │   ├── websocket/
│   │   │   └── gateway.ts
│   │   └── services/
│   │       └── endpointService.ts
│   └── Dockerfile
│
├── workers/
│   ├── ping/
│   │   ├── index.ts              # Ping worker
│   │   ├── pingService.ts        # HTTP request with auth injection
│   │   └── alertingService.ts    # Consecutive fail logic
│   ├── digest/
│   │   ├── index.ts              # Digest worker
│   │   └── digestService.ts      # Batch email logic
│   └── alert/
│       ├── index.ts              # Alert worker
│       └── emailService.ts       # Recovery email sending
│
├── prisma/
│   └── schema.prisma
│
├── docker-compose.yml
├── docker-compose.prod.yml
└── README.md


1. Validate JWT middleware
2. Validate request body
   - url is http/https only
   - block private IPs (SSRF)
   - checkIntervalSec is a number
   - alertThreshold is a number
   - authType is valid enum value
3. Encrypt authValue if present
4. Prisma INSERT endpoint
5. On success:
   a. redis.zadd(user:endpoints:{userId}, createdAt, endpointId)
   b. redis.set(endpoint:config:{id}, JSON, TTL 300)
   c. bullmq repeating job with correct interval
6. Return 201


Creating endpoint
1. Validate JWT middleware
2. Validate request body
   - url is http/https only
   - block private IPs (SSRF)
   - checkIntervalSec is a number
   - alertThreshold is a number
   - authType is valid enum value
3. Encrypt authValue if present
4. Prisma INSERT endpoint
5. On success:
   a. redis.zadd(user:endpoints:{userId}, createdAt, endpointId)
   b. redis.set(endpoint:config:{id}, JSON, TTL 300)
   c. bullmq repeating job with correct interval
6. Return 201
POST /api/endpoints
GET  /api/endpoints        (paginated, from Redis)
GET  /api/endpoints/:id    (single endpoint)
PUT  /api/endpoints/:id    (update + cache invalidation)
DELETE /api/endpoints/:id  (delete + full Redis cleanup)
PATCH /api/endpoints/:id/pause
PATCH /api/endpoints/:id/resume