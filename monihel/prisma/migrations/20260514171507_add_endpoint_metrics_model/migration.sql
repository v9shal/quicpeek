-- CreateEnum
CREATE TYPE "MetricStatus" AS ENUM ('UP', 'DOWN', 'TIMEOUT');

-- AlterTable
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'RESOLVED';

-- CreateTable
CREATE TABLE "endpoint_metrics" (
    "endpoint_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" "MetricStatus" NOT NULL,
    "response_time_ms" INTEGER NOT NULL,
    "status_code" INTEGER,

    CONSTRAINT "endpoint_metrics_pkey" PRIMARY KEY ("endpoint_id","timestamp")
);

-- CreateIndex
CREATE INDEX "endpoint_metrics_endpoint_id_timestamp_idx" ON "endpoint_metrics"("endpoint_id", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "endpoint_metrics" ADD CONSTRAINT "endpoint_metrics_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
