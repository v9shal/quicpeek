// Express API server entry point
import "./config/env"; // Validate env vars at startup
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { nanoid } from "nanoid";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import {
  registry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from "./lib/metrics";
import { errorHandler } from "./middleware/errorHandler";
import authRouter from "./routes/auth";
import endpointsRouter from "./routes/endpoints";
import alertsRouter from "./routes/alerts";

const app = express();

// Required when running behind a reverse proxy so rate-limit + secure cookies
// see the real client IP. Set conservatively to 1 hop; tune if your topology differs.
app.set("trust proxy", 1);

// ─── Request ID + structured request logging ─────────────────────────────────
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = (req.headers["x-request-id"] as string | undefined) || nanoid(12);
      res.setHeader("x-request-id", existing);
      return existing;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

// ─── HTTP metrics ────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    const route = (req.route?.path as string | undefined) ?? req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
});

app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many auth attempts, please try again later" },
});

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(globalLimiter);

app.get("/", (_req, res) => {
  res.json({ success: true, message: "Monihel API is running!" });
});

app.get("/health", (_req, res) => {
  res.json({ success: true, status: "ok" });
});

// Prometheus scrape endpoint.
app.get("/metrics", async (_req, res, next) => {
  try {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/endpoints", endpointsRouter);
app.use("/api/alerts", alertsRouter);


app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});


app.use(errorHandler);

export default app;

