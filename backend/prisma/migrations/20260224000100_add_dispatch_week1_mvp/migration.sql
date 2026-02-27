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

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "currentStatus" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "Driver" ADD COLUMN "trailerType" "TrailerType";

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
CREATE UNIQUE INDEX "DATIntegrationKey_keyHash_key" ON "DATIntegrationKey"("keyHash");
CREATE INDEX "DATIntegrationKey_carrierId_isActive_idx" ON "DATIntegrationKey"("carrierId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DATIngestBatch_carrierId_ingestId_key" ON "DATIngestBatch"("carrierId", "ingestId");
CREATE INDEX "DATIngestBatch_carrierId_createdAt_idx" ON "DATIngestBatch"("carrierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DATLoadSnapshot_carrierId_hash_key" ON "DATLoadSnapshot"("carrierId", "hash");
CREATE INDEX "DATLoadSnapshot_carrierId_trailerType_snapshotTimestamp_idx" ON "DATLoadSnapshot"("carrierId", "trailerType", "snapshotTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "LoadRecommendation_carrierId_driverId_datLoadSnapshotId_key" ON "LoadRecommendation"("carrierId", "driverId", "datLoadSnapshotId");
CREATE INDEX "LoadRecommendation_carrierId_status_idx" ON "LoadRecommendation"("carrierId", "status");

-- CreateIndex
CREATE INDEX "OutreachAttempt_recommendationId_idx" ON "OutreachAttempt"("recommendationId");
CREATE INDEX "OutreachAttempt_gmailMessageId_idx" ON "OutreachAttempt"("gmailMessageId");
CREATE INDEX "OutreachAttempt_gmailThreadId_idx" ON "OutreachAttempt"("gmailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerReply_gmailMessageId_key" ON "BrokerReply"("gmailMessageId");
CREATE INDEX "BrokerReply_outreachAttemptId_idx" ON "BrokerReply"("outreachAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_tokenHash_key" ON "ApprovalRequest"("tokenHash");
CREATE INDEX "ApprovalRequest_dispatcherEmail_status_idx" ON "ApprovalRequest"("dispatcherEmail", "status");

-- AddForeignKey
ALTER TABLE "DATIntegrationKey" ADD CONSTRAINT "DATIntegrationKey_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DATIngestBatch" ADD CONSTRAINT "DATIngestBatch_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DATLoadSnapshot" ADD CONSTRAINT "DATLoadSnapshot_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DATLoadSnapshot" ADD CONSTRAINT "DATLoadSnapshot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DATIngestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadRecommendation" ADD CONSTRAINT "LoadRecommendation_datLoadSnapshotId_fkey" FOREIGN KEY ("datLoadSnapshotId") REFERENCES "DATLoadSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachAttempt" ADD CONSTRAINT "OutreachAttempt_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "LoadRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerReply" ADD CONSTRAINT "BrokerReply_outreachAttemptId_fkey" FOREIGN KEY ("outreachAttemptId") REFERENCES "OutreachAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "LoadRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
