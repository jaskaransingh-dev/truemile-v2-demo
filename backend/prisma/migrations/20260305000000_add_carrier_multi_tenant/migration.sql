-- CreateEnum
CREATE TYPE "TrailerType" AS ENUM ('DRY_VAN', 'REEFER', 'FLATBED');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('AVAILABLE', 'LOADED', 'HOME', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('SELECTED', 'OUTREACH_SENT', 'BROKER_ACCEPTED', 'BROKER_COUNTERED', 'BROKER_REJECTED', 'DISPATCHER_APPROVED', 'DISPATCHER_REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutreachMethod" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('PENDING', 'SENT', 'REPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('ACCEPTED', 'COUNTER', 'REJECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "public"."idx_drivers_company";

-- DropIndex
DROP INDEX "public"."idx_expenses_company";

-- DropIndex
DROP INDEX "public"."idx_loads_company";

-- AlterTable
ALTER TABLE "BrokerStats" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "ComplianceData" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "carrierId" TEXT,
ADD COLUMN     "currentStatus" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "trailerType" "TrailerType";

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "Fleet" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "FleetLoad" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "Trailer" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "broker_conversations" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "brokers" DROP COLUMN "company_id";

-- AlterTable
ALTER TABLE "dispatch_plans" ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "drivers" DROP COLUMN "company_id",
ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "company_id",
ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "lane_recommendations" ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "load_candidates" ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "loads" DROP COLUMN "company_id",
ADD COLUMN     "carrier_id" TEXT;

-- AlterTable
ALTER TABLE "outreach_drafts" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "outreach_emails" ADD COLUMN     "carrier_id" TEXT;

-- DropTable
DROP TABLE "public"."companies";

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mcNumber" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DATIntegrationKey" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DATIntegrationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DATIngestBatch" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "ingestId" TEXT NOT NULL,
    "extensionVersion" TEXT NOT NULL,
    "receivedCount" INTEGER NOT NULL,
    "insertedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "snapshotTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DATIngestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DATLoadSnapshot" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "pickupDate" TEXT NOT NULL,
    "deliveryDate" TEXT NOT NULL,
    "miles" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "brokerName" TEXT,
    "brokerEmail" TEXT,
    "brokerPhone" TEXT,
    "trailerType" "TrailerType" NOT NULL,
    "hash" TEXT NOT NULL,
    "snapshotTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DATLoadSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadRecommendation" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "datLoadSnapshotId" TEXT NOT NULL,
    "constraintScore" DOUBLE PRECISION NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'SELECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoadRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachAttempt" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "method" "OutreachMethod" NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'PENDING',
    "toEmail" TEXT,
    "subject" TEXT,
    "messageBody" TEXT,
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerReply" (
    "id" TEXT NOT NULL,
    "outreachAttemptId" TEXT NOT NULL,
    "classification" "ReplyClassification" NOT NULL,
    "rawBody" TEXT NOT NULL,
    "extractedTerms" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gmailMessageId" TEXT,

    CONSTRAINT "BrokerReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "dispatcherEmail" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_mcNumber_key" ON "Carrier"("mcNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DATIntegrationKey_keyHash_key" ON "DATIntegrationKey"("keyHash");

-- CreateIndex
CREATE INDEX "DATIntegrationKey_carrierId_isActive_idx" ON "DATIntegrationKey"("carrierId", "isActive");

-- CreateIndex
CREATE INDEX "DATIngestBatch_carrierId_createdAt_idx" ON "DATIngestBatch"("carrierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DATIngestBatch_carrierId_ingestId_key" ON "DATIngestBatch"("carrierId", "ingestId");

-- CreateIndex
CREATE INDEX "DATLoadSnapshot_carrierId_trailerType_snapshotTimestamp_idx" ON "DATLoadSnapshot"("carrierId", "trailerType", "snapshotTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DATLoadSnapshot_carrierId_hash_key" ON "DATLoadSnapshot"("carrierId", "hash");

-- CreateIndex
CREATE INDEX "LoadRecommendation_carrierId_status_idx" ON "LoadRecommendation"("carrierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoadRecommendation_carrierId_driverId_datLoadSnapshotId_key" ON "LoadRecommendation"("carrierId", "driverId", "datLoadSnapshotId");

-- CreateIndex
CREATE INDEX "OutreachAttempt_recommendationId_idx" ON "OutreachAttempt"("recommendationId");

-- CreateIndex
CREATE INDEX "OutreachAttempt_gmailMessageId_idx" ON "OutreachAttempt"("gmailMessageId");

-- CreateIndex
CREATE INDEX "OutreachAttempt_gmailThreadId_idx" ON "OutreachAttempt"("gmailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerReply_gmailMessageId_key" ON "BrokerReply"("gmailMessageId");

-- CreateIndex
CREATE INDEX "BrokerReply_outreachAttemptId_idx" ON "BrokerReply"("outreachAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_tokenHash_key" ON "ApprovalRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ApprovalRequest_dispatcherEmail_status_idx" ON "ApprovalRequest"("dispatcherEmail", "status");

-- CreateIndex
CREATE INDEX "BrokerStats_carrierId_idx" ON "BrokerStats"("carrierId");

-- CreateIndex
CREATE INDEX "ComplianceData_carrierId_idx" ON "ComplianceData"("carrierId");

-- CreateIndex
CREATE INDEX "Driver_carrierId_idx" ON "Driver"("carrierId");

-- CreateIndex
CREATE INDEX "Expense_carrierId_idx" ON "Expense"("carrierId");

-- CreateIndex
CREATE INDEX "Fleet_carrierId_idx" ON "Fleet"("carrierId");

-- CreateIndex
CREATE INDEX "FleetLoad_carrierId_idx" ON "FleetLoad"("carrierId");

-- CreateIndex
CREATE INDEX "Trailer_carrierId_idx" ON "Trailer"("carrierId");

-- CreateIndex
CREATE INDEX "Truck_carrierId_idx" ON "Truck"("carrierId");

-- CreateIndex
CREATE INDEX "broker_conversations_carrierId_idx" ON "broker_conversations"("carrierId");

-- CreateIndex
CREATE INDEX "dispatch_plans_carrier_id_idx" ON "dispatch_plans"("carrier_id");

-- CreateIndex
CREATE INDEX "drivers_carrier_id_idx" ON "drivers"("carrier_id");

-- CreateIndex
CREATE INDEX "expenses_carrier_id_idx" ON "expenses"("carrier_id");

-- CreateIndex
CREATE INDEX "lane_recommendations_carrier_id_idx" ON "lane_recommendations"("carrier_id");

-- CreateIndex
CREATE INDEX "load_candidates_carrier_id_idx" ON "load_candidates"("carrier_id");

-- CreateIndex
CREATE INDEX "loads_carrier_id_idx" ON "loads"("carrier_id");

-- CreateIndex
CREATE INDEX "outreach_drafts_carrierId_idx" ON "outreach_drafts"("carrierId");

-- CreateIndex
CREATE INDEX "outreach_emails_carrier_id_idx" ON "outreach_emails"("carrier_id");

-- AddForeignKey
ALTER TABLE "BrokerStats" ADD CONSTRAINT "BrokerStats_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_conversations" ADD CONSTRAINT "broker_conversations_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetLoad" ADD CONSTRAINT "FleetLoad_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceData" ADD CONSTRAINT "ComplianceData_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_plans" ADD CONSTRAINT "dispatch_plans_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lane_recommendations" ADD CONSTRAINT "lane_recommendations_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_candidates" ADD CONSTRAINT "load_candidates_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DATIntegrationKey" ADD CONSTRAINT "DATIntegrationKey_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DATIngestBatch" ADD CONSTRAINT "DATIngestBatch_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DATLoadSnapshot" ADD CONSTRAINT "DATLoadSnapshot_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DATLoadSnapshot" ADD CONSTRAINT "DATLoadSnapshot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DATIngestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_datLoadSnapshotId_fkey" FOREIGN KEY ("datLoadSnapshotId") REFERENCES "DATLoadSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachAttempt" ADD CONSTRAINT "OutreachAttempt_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "LoadRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerReply" ADD CONSTRAINT "BrokerReply_outreachAttemptId_fkey" FOREIGN KEY ("outreachAttemptId") REFERENCES "OutreachAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "LoadRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

