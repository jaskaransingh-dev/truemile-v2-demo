import { RecommendationStatus, TrailerType } from '@prisma/client';
import { prisma } from '../db';
import { GmailRuntimeService } from './gmail-runtime.service';

function normalizeDateString(value: string): Date {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function scoreLoad(load: { rate: number; miles: number; pickupDate: string }): number {
  const rpm = load.miles > 0 ? load.rate / load.miles : 0;
  const pickup = normalizeDateString(load.pickupDate).getTime();
  const hoursUntilPickup = Math.max(0, (pickup - Date.now()) / (1000 * 60 * 60));
  const urgency = hoursUntilPickup <= 24 ? 20 : hoursUntilPickup <= 48 ? 10 : 0;
  return rpm * 100 + load.miles * 0.02 + urgency;
}

function trailerFallback(type: TrailerType | null): TrailerType {
  return type ?? TrailerType.DRY_VAN;
}

export async function runDispatchForDriver(input: {
  fleetId: string;
  driverId: string;
}): Promise<{ recommendationId: string; outreachStatus: RecommendationStatus; reason?: string }> {
  const driver = await prisma.driver.findFirst({
    where: { id: input.driverId, fleetId: input.fleetId },
  });

  if (!driver) {
    throw new Error('Driver not found for authenticated fleet');
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const loads = await prisma.dATLoadSnapshot.findMany({
    where: {
      carrierId: input.fleetId,
      trailerType: trailerFallback(driver.trailerType),
      snapshotTimestamp: { gte: twoHoursAgo },
    },
    orderBy: { snapshotTimestamp: 'desc' },
    take: 50,
  });

  if (!loads.length) {
    throw new Error('No recent DAT loads available for this driver');
  }

  const ranked = loads
    .map((load) => ({ load, score: scoreLoad(load) }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];

  const recommendation = await prisma.loadRecommendation.upsert({
    where: {
      carrierId_driverId_datLoadSnapshotId: {
        carrierId: input.fleetId,
        driverId: driver.id,
        datLoadSnapshotId: selected.load.id,
      },
    },
    create: {
      carrierId: input.fleetId,
      driverId: driver.id,
      datLoadSnapshotId: selected.load.id,
      constraintScore: selected.score,
      status: RecommendationStatus.SELECTED,
    },
    update: {
      constraintScore: selected.score,
    },
  });

  if (!selected.load.brokerEmail) {
    await prisma.loadRecommendation.update({
      where: { id: recommendation.id },
      data: { status: RecommendationStatus.FAILED },
    });
    return {
      recommendationId: recommendation.id,
      outreachStatus: RecommendationStatus.FAILED,
      reason: 'Missing broker email',
    };
  }

  const subject = `Load Interest: ${selected.load.origin} -> ${selected.load.destination}`;
  const body = [
    `Hello ${selected.load.brokerName || 'Broker'},`,
    '',
    `We are interested in your posted load ${selected.load.origin} to ${selected.load.destination}.`,
    `Please confirm availability and booking details.`,
    '',
    'Thanks,',
    'Royal Carriers Dispatch',
  ].join('\n');

  try {
    const sent = await GmailRuntimeService.sendEmail({
      to: selected.load.brokerEmail,
      subject,
      body,
    });

    await prisma.$transaction([
      prisma.outreachAttempt.create({
        data: {
          recommendationId: recommendation.id,
          method: 'EMAIL',
          status: 'SENT',
          toEmail: selected.load.brokerEmail,
          subject,
          messageBody: body,
          gmailMessageId: sent.messageId,
          gmailThreadId: sent.threadId,
          sentAt: new Date(),
        },
      }),
      prisma.loadRecommendation.update({
        where: { id: recommendation.id },
        data: { status: RecommendationStatus.OUTREACH_SENT },
      }),
    ]);

    return {
      recommendationId: recommendation.id,
      outreachStatus: RecommendationStatus.OUTREACH_SENT,
    };
  } catch (error) {
    await prisma.loadRecommendation.update({
      where: { id: recommendation.id },
      data: { status: RecommendationStatus.FAILED },
    });

    return {
      recommendationId: recommendation.id,
      outreachStatus: RecommendationStatus.FAILED,
      reason: error instanceof Error ? error.message : 'Email send failed',
    };
  }
}
