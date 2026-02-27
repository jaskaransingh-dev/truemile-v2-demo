import { ReplyClassification } from '@prisma/client';

const ACCEPTED_PATTERNS = [
  /\b(book it|good to go|confirmed|yes\b|approved|take it)\b/i,
];
const COUNTER_PATTERNS = [
  /\b(counter|can you do|how about|would you do)\b/i,
  /\$\s?\d{3,}/,
];
const REJECTED_PATTERNS = [
  /\b(no\b|unavailable|covered|already booked|not available)\b/i,
];

export function classifyReply(body: string): ReplyClassification {
  const text = body.toLowerCase();

  if (ACCEPTED_PATTERNS.some((p) => p.test(text))) return 'ACCEPTED';
  if (COUNTER_PATTERNS.some((p) => p.test(text))) return 'COUNTER';
  if (REJECTED_PATTERNS.some((p) => p.test(text))) return 'REJECTED';
  return 'OTHER';
}
