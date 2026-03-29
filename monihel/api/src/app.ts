// Express API server entry point
import "./config/env"; // Validate env vars at startup
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import authRouter from "./routes/auth";
import endpointsRouter from "./routes/endpoints";

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: env.isProd
      ? "https://frontend.com"
      : [ "http://localhost:5173"],
    credentials: true, 
  })
);

// const globalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { success: false, error: "Too many requests, please try again later" },
// });
// app.use(globalLimiter);
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 20,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { success: false, error: "Too many auth attempts, please try again later" },
// });


app.use(express.json({ limit: "10kb" })); 
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.get("/", (_req, res) => {
  res.json({ success: true, message: "Monihel API is running!" });
});

app.use("/api/auth", authRouter);
app.use("/api/endpoints", endpointsRouter);


app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});


app.use(errorHandler);


// app.listen(env.PORT, () => {
//   console.log(`[server] Listening on port ${env.PORT} (${env.NODE_ENV})`);
// });

export default app;