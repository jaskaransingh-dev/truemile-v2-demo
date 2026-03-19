-- CreateTable
CREATE TABLE "DispatchRun" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadsInput" JSONB NOT NULL,
    "driverSnapshot" JSONB NOT NULL,
    "engineOutput" JSONB NOT NULL,
    "topRecommendationId" TEXT,

    CONSTRAINT "DispatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchDecision" (
    "id" TEXT NOT NULL,
    "dispatchRunId" TEXT NOT NULL,
    "selectedLoadId" TEXT NOT NULL,
    "matchedEngine" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'API',
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchRun_carrierId_idx" ON "DispatchRun"("carrierId");

-- CreateIndex
CREATE INDEX "DispatchRun_driverId_idx" ON "DispatchRun"("driverId");

-- CreateIndex
CREATE INDEX "DispatchRun_createdAt_idx" ON "DispatchRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchDecision_dispatchRunId_key" ON "DispatchDecision"("dispatchRunId");

-- AddForeignKey
ALTER TABLE "DispatchDecision" ADD CONSTRAINT "DispatchDecision_dispatchRunId_fkey" FOREIGN KEY ("dispatchRunId") REFERENCES "DispatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
