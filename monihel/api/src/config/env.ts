import dotenv from "dotenv";
import path from "path";

// Load .env from project root (monihel/)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid integer for env var ${name}: ${raw}`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

export const env = {
  NODE_ENV,
  isProd,
  PORT: int("PORT", 4000),

  // Database
  DATABASE_URL: process.env.DATABASE_URL!,

  // Redis — same instance, separate logical DBs by default.
  // For production, point CACHE_REDIS_HOST/PORT to a different instance.
  REDIS_HOST: process.env.REDIS_HOST || "127.0.0.1",
  REDIS_PORT: int("REDIS_PORT", 6379),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  QUEUE_REDIS_DB: int("QUEUE_REDIS_DB", 0),
  CACHE_REDIS_HOST: process.env.CACHE_REDIS_HOST || process.env.REDIS_HOST || "127.0.0.1",
  CACHE_REDIS_PORT: int("CACHE_REDIS_PORT", int("REDIS_PORT", 6379)),
  CACHE_REDIS_DB: int("CACHE_REDIS_DB", 1),

  // Logging
  LOG_LEVEL: (process.env.LOG_LEVEL || "info") as
    | "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent",

  // Worker health/metrics ports (each worker exposes its own)
  PING_WORKER_PORT: int("PING_WORKER_PORT", 4101),
  DBWRITE_WORKER_PORT: int("DBWRITE_WORKER_PORT", 4102),
  ALERT_WORKER_PORT: int("ALERT_WORKER_PORT", 4103),
  DIGEST_WORKER_PORT: int("DIGEST_WORKER_PORT", 4104),

  // Worker tuning
  PING_WORKER_CONCURRENCY: int("PING_WORKER_CONCURRENCY", 20),
  PING_WORKER_RATE_MAX: int("PING_WORKER_RATE_MAX", 200),     // jobs
  PING_WORKER_RATE_DURATION_MS: int("PING_WORKER_RATE_DURATION_MS", 1000), // per 1s

  // JWT
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || "15m",
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || "7d",

  // Bcrypt
  BCRYPT_SALT_ROUNDS: int("BCRYPT_SALT_ROUNDS", 12),

  // Encryption (32 bytes / 64 hex chars)
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,

  // Frontend / CORS
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",

  // SMTP
  SMTP_HOST: process.env.SMTP_HOST || "smtp.ethereal.email",
  SMTP_PORT: int("SMTP_PORT", 587),
  SMTP_SECURE: bool("SMTP_SECURE", false),
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM: process.env.SMTP_FROM || "alerts@monihel.local",

  // Gumroad webhook verification
  GUMROAD_SELLER_ID: process.env.GUMROAD_SELLER_ID || "",
} as const;

// Validate required vars at startup
const required = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "ENCRYPTION_KEY",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// JWT secrets should be reasonably long
if (env.JWT_ACCESS_SECRET.length < 32) {
  throw new Error("JWT_ACCESS_SECRET must be at least 32 characters");
}
if (env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error("JWT_REFRESH_SECRET must be at least 32 characters");
}

// ENCRYPTION_KEY must be 64 hex chars (32 bytes) for AES-256
if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY)) {
  throw new Error(
    "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32"
  );
}
