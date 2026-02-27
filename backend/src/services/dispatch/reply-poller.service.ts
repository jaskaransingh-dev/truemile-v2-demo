import {
  RecommendationStatus,
  ReplyClassification,
} from '@prisma/client';
import { prisma } from '../db';
import { GmailRuntimeService } from './gmail-runtime.service';
import { classifyReply } from './reply-classifier';
import { createApprovalRequestIfNeeded } from './approval.service';

function decodeGmailBody(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf-8');
}

function getHeader(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function extractBody(message: any): string {
  const payload = message?.payload;
  if (!payload) return '';

  if (payload.body?.data) {
    return decodeGmailBody(payload.body.data);
  }

  const parts = payload.parts || [];
  const textPlain = parts.find((p: any) => p.mimeType === 'text/plain' && p.body?.data);
  if (textPlain) return decodeGmailBody(textPlain.body.data);

  const textHtml = parts.find((p: any) => p.mimeType === 'text/html' && p.body?.data);
  if (textHtml) return decodeGmailBody(textHtml.body.data);

  return '';
}

function mapClassificationToStatus(
  classification: ReplyClassification
): RecommendationStatus {
  switch (classification) {
    case 'ACCEPTED':
      return RecommendationStatus.BROKER_ACCEPTED;
    case 'COUNTER':
      return RecommendationStatus.BROKER_COUNTERED;
    case 'REJECTED':
      return RecommendationStatus.BROKER_REJECTED;
    default:
      return RecommendationStatus.OUTREACH_SENT;
  }
}

export class DispatchReplyPoller {
  static async pollBrokerReplies(): Promise<void> {
    const attempts = await prisma.outreachAttempt.findMany({
      where: {
        status: 'SENT',
        method: 'EMAIL',
        gmailThreadId: { not: null },
      },
      include: {
        recommendation: true,
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    const sender = (await GmailRuntimeService.getSenderEmail()).toLowerCase();

    for (const attempt of attempts) {
      if (!attempt.gmailThreadId) continue;

      let messages: any[] = [];
      try {
        const thread = await GmailRuntimeService.getThread(attempt.gmailThreadId);
        messages = thread.messages || [];
      } catch (error) {
        console.error(`Failed reading Gmail thread ${attempt.gmailThreadId}:`, error);
        continue;
      }

      for (const msg of messages) {
        if (!msg.id || msg.id === attempt.gmailMessageId) continue;

        const exists = await prisma.brokerReply.findUnique({
          where: { gmailMessageId: msg.id },
        });
        if (exists) continue;

        const from = getHeader(msg.payload?.headers as any, 'From').toLowerCase();
        if (from.includes(sender)) continue;

        const rawBody = extractBody(msg) || msg.snippet || '';
        const classification = classifyReply(rawBody);

        await prisma.$transaction(async (tx) => {
          await tx.brokerReply.create({
            data: {
              outreachAttemptId: attempt.id,
              classification,
              rawBody,
              receivedAt: new Date(),
              gmailMessageId: msg.id,
            },
          });

          await tx.outreachAttempt.update({
            where: { id: attempt.id },
            data: { status: 'REPLIED', repliedAt: new Date() },
          });

          const nextStatus = mapClassificationToStatus(classification);
          await tx.loadRecommendation.update({
            where: { id: attempt.recommendationId },
            data: { status: nextStatus },
          });
        });

        if (classification === 'ACCEPTED' || classification === 'COUNTER') {
          await createApprovalRequestIfNeeded(attempt.recommendationId);
        }
      }
    }
  }
}
