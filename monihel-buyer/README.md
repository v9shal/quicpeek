# Monihel — Self-Hosted Uptime Monitor

Thank you for purchasing Monihel! Here's how to get running in 5 minutes.

## Prerequisites
- Docker + Docker Compose installed
- An SMTP provider (Resend free tier recommended — 3000 emails/month free)

## Quick Start

**1. Copy the example env file:**
```bash
cp .env.example .env
```

**2. Edit `.env` and fill in:**
- `LICENSE_KEY` — from this purchase email
- `POSTGRES_PASSWORD` — any strong password
- `REDIS_PASSWORD` — any strong password
- `JWT_ACCESS_SECRET` — run `openssl rand -base64 48`
- `JWT_REFRESH_SECRET` — run `openssl rand -base64 48`
- `ENCRYPTION_KEY` — run `openssl rand -hex 32`
- SMTP settings (see below)

**3. Start everything:**
```bash
docker compose up -d
```

**4. Run database migrations (first time only):**
```bash
docker compose exec api npm run db:migrate
```

**5. Access your API:**
```
http://localhost:4000/health
```

---

## SMTP Setup (Free)

1. Go to [resend.com](https://resend.com) → Sign up free
2. Create an API key
3. In `.env`:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=587
   SMTP_USER=resend
   SMTP_PASS=re_your_api_key
   SMTP_FROM=alerts@yourdomain.com
   ```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/endpoints` | List monitored endpoints |
| POST | `/api/endpoints` | Add endpoint to monitor |
| GET | `/api/alerts` | View alerts |

Full API docs: see Postman collection in the repo.

---

## Updating

```bash
docker compose pull
docker compose up -d
```

---

## License

This software is licensed to a single deployment per license key.
To migrate to a new server, deactivate your key first:

```bash
curl -X POST http://localhost:4000/v1/licenses/deactivate \
  -H 'Content-Type: application/json' \
  -d '{"key":"MNHL-XXXX-XXXX-XXXX","instanceId":"your-instance-id"}'
```

---

Need help? Reply to your purchase email.
