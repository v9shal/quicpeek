import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Fall back to a dummy URL at build time so `prisma generate` succeeds
    // without real env vars (e.g. during Docker image build on Railway).
    url: process.env.DATABASE_URL ?? "postgresql://build:build@localhost:5432/build",
  },
});
