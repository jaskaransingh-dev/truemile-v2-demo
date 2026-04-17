/**
 * dispatch.logger.ts
 *
 * Fire-and-forget persistence layer for shadow mode logging.
 * Never throws — logging failures are caught and console.error'd only.
 * The stateless ranking path is never blocked or slowed by this.
 *
 * Usage in dispatch.routes.ts (after returning 200):
 *   logDispatchRun(carrierId, body, result).catch(() => {});
 *
 * Usage to record actual decision (new POST endpoint):
 *   recordDispatchDecision(runId, selectedLoadId, topRecommendationId)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// ---------------------------------------------------------------------------
// Log a dispatch run
// ---------------------------------------------------------------------------

export async function logDispatchRun(
  carrierId: string,
  driverId: string,
  loadsInput: unknown,
  driverSnapshot: unknown,
  engineOutput: unknown,
  topRecommendationId: string | null,
): Promise<string | null> {
  try {
    const run = await prisma.dispatchRun.create({
      data: {
        carrierId,
        driverId,
        loadsInput:          loadsInput          as any,
        driverSnapshot:      driverSnapshot      as any,
        engineOutput:        engineOutput        as any,
        topRecommendationId: topRecommendationId ?? undefined,
      },
    });
    return run.id;
  } catch (err) {
    console.error('[dispatch.logger] Failed to log dispatch run:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Record actual dispatcher decision
// ---------------------------------------------------------------------------

export async function recordDispatchDecision(
  dispatchRunId: string,
  selectedLoadId: string,
  topRecommendationId: string | null,
  source: 'API' | 'MANUAL' = 'API',
): Promise<'ok' | 'duplicate' | 'error'> {
  try {
    await prisma.dispatchDecision.create({
      data: {
        dispatchRunId,
        selectedLoadId,
        matchedEngine: selectedLoadId === topRecommendationId,
        source,
      },
    });
    return 'ok';
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return 'duplicate';
    }
    console.error('[dispatch.logger] Failed to record decision:', err);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Fetch run by ID (used by the decision endpoint to validate the run exists
// and retrieve topRecommendationId without re-accepting it from the client)
// ---------------------------------------------------------------------------

export async function getDispatchRun(runId: string, carrierId: string) {
  try {
    return await prisma.dispatchRun.findFirst({
      where: { id: runId, carrierId },
      select: { id: true, topRecommendationId: true, driverId: true },
    });
  } catch (err) {
    console.error('[dispatch.logger] Failed to fetch run:', err);
    return null;
  }
}
