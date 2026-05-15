# Monihel — Sellability Spec

> Goal: get this product into a state where it can be listed and sold on **Acquire.com** for a meaningful price (target: $5k–$50k+ MRR-multiple).

---

## 1. What Monihel Currently Is

A backend-only **HTTP endpoint uptime monitoring system** with:

- **Express API** (auth, endpoints, alerts routes)
- **BullMQ workers** for: ping execution, batched metric writes (Postgres COPY-style insert), recovery emails, and a 5-minute polling digest worker
- **Prisma + Postgres** schema (User, RefreshToken, Endpoint, Alert, AlertDigest, NotificationChannel)
- **Redis** for: caching endpoint config, consecutive-failure counters, pub/sub fan-out, and Socket.IO adapter
- **WebSocket gateway** (Socket.IO) pushing live ping results to the dashboard via Redis pub/sub
- **Security**: JWT access + refresh token rotation with family revocation, AES-256-CBC encryption of stored auth secrets, SSRF blocklist on user-supplied URLs, helmet, CORS, bcrypt
- **Ops**: graceful shutdown, repeatable BullMQ jobs recreated on startup, batched metric writes (10s flush, 1000-row cap)

The **architectural quality is above-average for an indie project**. The problem is everything *around* the code.

---

## 2. Critical Drawbacks (Blockers for Sale)

### 2.1 No Frontend → No Product
There is no dashboard. Acquire.com buyers want to demo a working SaaS in 60 seconds. A backend tarball is **unsellable** at any meaningful price.

### 2.2 No Revenue / No Users
Acquire.com listings are valued on **MRR × multiple (typically 3x–5x annual)**. Zero MRR = no floor price. A pre-revenue listing tops out around $1k–$5k regardless of code quality.

### 2.3 No Billing System
There is no Stripe integration, no plan tiers, no per-user quotas. Without this you cannot collect money even if a user signs up.

### 2.4 Single-Region Probing (Critical Technical Flaw)
All pings originate from one server. Every competitor (UptimeRobot, Better Stack, Checkly, Pingdom) uses **distributed probes across 3–10+ regions** with quorum-based "is it really down?" logic. This is table stakes; without it, buyers will discount the product heavily.

### 2.5 Crypto Weakness — AES-256-CBC Without HMAC
[encryption.ts](api/src/utils/encryption.ts#L1-L23) uses AES-CBC with no authentication tag. A buyer doing diligence will flag this. **Must be AES-256-GCM.**

### 2.6 SSRF Protection Is Naive
[ssrf.ts](api/src/utils/ssrf.ts#L1-L21) only regex-matches the hostname string. It does **not** resolve the hostname to an IP before request, so DNS rebinding and AWS metadata IPs (169.254.169.254 — actually caught, but link-local IPv6, cloud metadata via DNS, and redirects via `maxRedirects: 0` is OK but no IP re-check) are still partially exposed. Needs proper DNS resolution + IP-range check on every request.

### 2.7 Rate Limiting Is Commented Out
In [app.ts](api/src/app.ts#L24-L38) both `globalLimiter` and `authLimiter` are disabled. This is a security/cost incident waiting to happen and **will fail diligence**.

### 2.8 Hardcoded / Placeholder Values
- [app.ts](api/src/app.ts#L19) hardcodes `"https://frontend.com"` as the prod CORS origin
- [index.ts](api/src/index.ts#L40) hardcodes port `4000` instead of using `env.PORT`
- Email "from" defaults to `alerts@monihel.dev` which isn't owned/verified
- SMTP defaults to `smtp.ethereal.email` (a test-only relay)

### 2.9 Notification Coverage Is Thin
Schema supports `EMAIL` and `WEBHOOK` but only email is implemented. **No Slack, Discord, PagerDuty, SMS, Telegram, MS Teams.** Buyers compare feature checklists; missing Slack alone disqualifies you.

### 2.10 No Time-Series Metrics Storage
[dbWrite/index.ts](workers/dbWrite/index.ts#L31-L51) writes to an `endpoint_metrics` table but the **Prisma schema does not declare it**. Either it's missing or it lives outside Prisma migrations — both are red flags. No TimescaleDB / partitioning means this table will become unqueryable at scale.

### 2.11 No Public Status Pages
Every uptime monitoring competitor offers public status pages (`status.yourcompany.com`). This is the #1 feature that drives word-of-mouth signups. Absent here.

### 2.12 No Incident History / Postmortem View
Alerts are stored but there's no incident timeline UI, no MTTR metrics, no annotation/comment system on incidents.

### 2.13 Empty Files Indicating Incomplete Scope
- [routes/metrics.ts](api/src/routes/metrics.ts) — empty placeholder
- [workers/ping/alertingService.ts](workers/ping/alertingService.ts) — empty
- [README.md](README.md) — one-line stub

A buyer cloning the repo and seeing empty files will assume technical debt is hidden everywhere else.

### 2.14 No Tests
[test/](test/) contains only k6/breakpoint files. **Zero unit/integration tests** for the auth flow, endpoint service, or workers. Buyers ask for test coverage numbers.

### 2.15 No Documentation
No architecture diagram, no API docs (no OpenAPI/Swagger), no runbook, no setup guide beyond `npm scripts`. Acquire.com listings require a "Tech Stack & Onboarding" doc — without it the deal stalls.

### 2.16 No CI/CD, No Docker, No Deploy Story
There's no `Dockerfile`, no `docker-compose.yml`, no `.github/workflows`. The buyer has to figure out deployment themselves. This shaves 30–50% off offers.

### 2.17 Worker Race Condition Risk
[workers/ping/index.ts](workers/ping/index.ts#L17-L43) — the `fails:${endpointId}` Redis INCR is not gated by a check on "was this ping for the current attempt window?". If two workers process pings for the same endpoint near-simultaneously (BullMQ retries, repeat-job overlap), you can double-count failures.

### 2.18 No Multi-Tenancy / Team Support
Schema is single-user. Buyers value B2B-ready schemas; no `Organization` / `Team` / `Member` / `Role` model means a buyer must redesign the schema before they can sell to companies.

### 2.19 No GDPR / Data Export / Account Deletion
For any EU user, you need a "delete my account & export my data" flow. Currently absent.

### 2.20 Branding & Domain Confusion
The repo is `quicpeek` but the product is `monihel`. Pick one. A buyer doesn't want to untangle this.

---

## 3. Feature Roadmap to Make This Sellable

Ordered by **ROI on sale price**, not technical interest.

### Phase 1 — Make It Demoable (2–3 weeks)
The single biggest multiplier on sale price.

1. **Next.js dashboard** (App Router + Tailwind + shadcn/ui)
   - Login / register / forgot password
   - Endpoints list with live status dots (Socket.IO)
   - Add/edit/delete endpoint modal with auth-type picker
   - Endpoint detail page with response-time chart (Recharts/Tremor)
   - Alerts/incidents page with filtering
   - Settings page (notification channels, account, change password)
2. **Marketing landing page** (hero, pricing, features, FAQ, CTA) — even a one-pager
3. **Fix all hardcoded values + re-enable rate limiting**
4. **Add the missing `endpoint_metrics` Prisma model** + a migration
5. **Dockerfile + docker-compose.yml** with Postgres + Redis + all 4 workers

### Phase 2 — Hit Competitive Parity (2–3 weeks)
Without these, buyers will say "it's missing X."

6. **Slack + Discord + Generic Webhook + Telegram** notification channels (channel-type per `NotificationChannel.type` enum)
7. **Public status pages** — subdomain or path-based, customizable, with subscriber email signups
8. **SSL certificate monitoring** — warn 30/14/7 days before expiry (huge perceived value, ~50 lines of code using `tls.connect`)
9. **Domain expiry monitoring** — WHOIS-based, weekly check
10. **Keyword/content checks** — assert response body contains/does-not-contain string
11. **Multi-step / API flow checks** — chain 2–5 requests with assertions (this is what Checkly charges premium for)
12. **Maintenance windows** — schedule mute periods so on-call doesn't get paged during deploys

### Phase 3 — Monetization (1 week)
13. **Stripe billing** with 3 plans:
    - **Free**: 5 monitors, 5-min interval, email only
    - **Pro $19/mo**: 50 monitors, 1-min interval, all channels, status page, SSL/domain checks
    - **Business $79/mo**: 500 monitors, 30-sec interval, multi-step checks, 10 team members, SLA reports
14. **Plan-limit enforcement** (count monitors, gate features)
15. **Usage-based add-ons** (extra monitors, SMS credits)

### Phase 4 — B2B / Acquisition Polish (2–3 weeks)
16. **Organizations + Teams + Roles** (Owner/Admin/Member/ReadOnly) — schema migration + invitation flow
17. **API keys + REST API** (already have an internal API; expose it with proper docs + OpenAPI spec)
18. **Audit log** of who-did-what (creates trust for B2B buyers)
19. **SSO (Google + GitHub OAuth)** — minimum bar; SAML is bonus
20. **Multi-region probing** — at least 2 regions via cheap VPS workers (Hetzner US + EU = $10/mo combined). Implement quorum: 2/3 must agree it's DOWN before alerting.
21. **Fix encryption to AES-256-GCM**, fix SSRF with IP resolution, fix worker race condition

### Phase 5 — Sales-Ready Assets (1 week)
22. **OpenAPI / Swagger docs** at `/api/docs`
23. **README with**: architecture diagram, setup steps, env var table, deploy guide, "how to run locally in 5 min"
24. **Tests** — Jest/Vitest for auth + endpointService + ping worker. Aim for 60%+ coverage on critical paths.
25. **CI** — GitHub Actions running tests + Docker build on PR
26. **Customer testimonials** — even 2–3 quotes from real users move the price 20–30%
27. **Analytics** — Plausible/PostHog so buyers see traffic and engagement numbers
28. **Status page for Monihel itself** (eat your own dog food, also marketing)

---

## 4. What Buyers Actually Pay For (Acquire.com Reality)

Listing valuation typically follows this stack-rank:

| Factor | Weight | Current State |
|---|---|---|
| MRR (× 3–5 multiple) | 50% | $0 |
| Trailing 12-mo growth rate | 15% | N/A |
| Code quality + docs | 10% | Above-average code, **zero docs** |
| Tech stack hireability | 5% | ✅ TS/Node/Postgres/Redis is ideal |
| Customer count + churn | 10% | $0 |
| Brand / domain / SEO | 5% | None |
| Defensibility (moat) | 5% | None — commodity market |

**Honest valuation today**: $500–$3,000 as a "code asset" sale.
**After Phase 1+3 (dashboard + 10 paying users at $19)**: $8k–$15k.
**After all phases + $1k MRR**: $30k–$60k.
**After $3k–$5k MRR with low churn**: $100k–$250k.

---

## 5. Minimum Viable Path to Listing (8–10 Weeks)

If you only have 2 months, do this and skip the rest:

1. Phase 1 (dashboard + Docker) — **non-negotiable**
2. Slack notifications (#6)
3. Public status pages (#7)
4. SSL monitoring (#8)
5. Stripe + Pro plan only (#13, simplified)
6. Fix rate-limiting, encryption, hardcoded values (#2.5, #2.7, #2.8)
7. Get **10 free users + 3 paying users** via Hacker News "Show HN" + Indie Hackers + r/selfhosted + Product Hunt
8. Write the README + record a 3-min Loom demo
9. List on Acquire.com with the Loom embedded

---

## 6. Differentiation Angle (Optional but Recommended)

Generic uptime monitoring is a red ocean. Pick **one** of these to stand out:

- **Self-hostable + cloud hybrid** — competitors are cloud-only or self-host-only. Offer both with one codebase. Appeals to privacy-conscious buyers (EU, healthcare, fintech).
- **Developer-first DX** — `monihel.yml` config-as-code, Terraform provider, CLI. Steal Checkly's positioning at a lower price.
- **AI incident summaries** — when an alert fires, run a small LLM over recent metrics + status codes to generate a one-line "likely cause" hint. Cheap to build, high marketing value.
- **HTTP/3 + QUIC monitoring** — given the repo name, lean in. No competitor advertises this. Niche but acquirer-bait for Cloudflare/Fastly.

Pick **one**. Don't pick all four.

---

## 7. Final Verdict

The code is good enough to be the **foundation** of a sellable product. It is **not** yet a product. The single biggest dollar-per-hour activity right now is building the Next.js dashboard and getting the first paying user. Everything else is secondary.

**Stop adding backend features. Build the frontend.**
