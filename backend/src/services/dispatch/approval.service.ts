import crypto from 'crypto';
import { ApprovalStatus, RecommendationStatus } from '@prisma/client';
import { prisma } from '../db';
import { sha256 } from './hash';
import { GmailRuntimeService } from './gmail-runtime.service';

const DISPATCHER_EMAIL = process.env.DISPATCHER_EMAIL || 'royalcarrier3@gmail.com';

function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000';
}

function buildActionUrl(token: string, action: 'approve' | 'reject'): string {
  const url = new URL('/api/dispatch/approvals/act', baseUrl());
  url.searchParams.set('token', token);
  url.searchParams.set('action', action);
  return url.toString();
}

export async function createApprovalRequestIfNeeded(recommendationId: string): Promise<void> {
  const existing = await prisma.approvalRequest.findFirst({
    where: { recommendationId, status: 'PENDING' },
  });
  if (existing) return;

  const recommendation = await prisma.loadRecommendation.findUnique({
    where: { id: recommendationId },
    include: { datLoadSnapshot: true, driver: true },
  });
  if (!recommendation) return;

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const tokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const load = recommendation.datLoadSnapshot;
  const message = `Broker replied for ${load.origin} -> ${load.destination} (${load.miles} mi @ $${load.rate}). Driver: ${recommendation.driver.name}.`;

  await prisma.approvalRequest.create({
    data: {
      recommendationId,
      dispatcherEmail: DISPATCHER_EMAIL,
      status: 'PENDING',
      message,
      tokenHash,
      tokenExpiresAt,
    },
  });

  const approveUrl = buildActionUrl(token, 'approve');
  const rejectUrl = buildActionUrl(token, 'reject');
  const subject = 'Dispatch Approval Required';
  const body = [
    message,
    '',
    `Approve: ${approveUrl}`,
    `Reject: ${rejectUrl}`,
    '',
    'This link expires in 30 minutes.',
  ].join('\n');

  await GmailRuntimeService.sendEmail({
    to: DISPATCHER_EMAIL,
    subject,
    body,
  });
}

export async function applyApprovalActionByToken(
  token: string,
  action: 'approve' | 'reject'
): Promise<'success' | 'already_processed' | 'expired' | 'invalid'> {
  const tokenHash = sha256(token);
  const approval = await prisma.approvalRequest.findUnique({
    where: { tokenHash },
    include: { recommendation: true },
  });

  if (!approval) return 'invalid';
  if (approval.status !== ApprovalStatus.PENDING) return 'already_processed';
  if (approval.tokenExpiresAt.getTime() < Date.now()) return 'expired';

  if (action === 'approve') {
    await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      prisma.loadRecommendation.update({
        where: { id: approval.recommendationId },
        data: { status: RecommendationStatus.DISPATCHER_APPROVED },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      }),
      prisma.loadRecommendation.update({
        where: { id: approval.recommendationId },
        data: { status: RecommendationStatus.DISPATCHER_REJECTED },
      }),
    ]);
  }

  return 'success';
}
