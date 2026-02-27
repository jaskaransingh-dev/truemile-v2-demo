import { TrailerType } from '@prisma/client';
import { prisma } from '../db';
import { canonicalizeLoadForHash, sha256 } from './hash';

export interface DATLoadPayload {
  origin: unknown;
  destination: unknown;
  pickupDate: unknown;
  deliveryDate: unknown;
  miles: unknown;
  rate: unknown;
  brokerName?: unknown;
  brokerEmail?: unknown;
  brokerPhone?: unknown;
  trailerType: unknown;
}

export interface DATIngestPayload {
  ingestId: unknown;
  timestamp: unknown;
  extensionVersion?: unknown;
  loads: unknown;
}

interface NormalizedLoad {
  origin: string;
  destination: string;
  pickupDate: string;
  deliveryDate: string;
  miles: number;
  rate: number;
  brokerName: string | null;
  brokerEmail: string | null;
  brokerPhone: string | null;
  trailerType: TrailerType;
  hash: string;
}

export interface IngestMetrics {
  received: number;
  inserted: number;
  duplicates: number;
  invalid: number;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMiles(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  return 0;
}

function parseRate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function parseTrailerType(value: unknown): TrailerType | null {
  const raw = cleanString(value).toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'DRY_VAN' || raw === 'REEFER' || raw === 'FLATBED') {
    return raw as TrailerType;
  }
  return null;
}

function normalizeLoad(input: DATLoadPayload): NormalizedLoad | null {
  const origin = cleanString(input.origin);
  const destination = cleanString(input.destination);
  const pickupDate = cleanString(input.pickupDate);
  const deliveryDate = cleanString(input.deliveryDate);
  const miles = parseMiles(input.miles);
  const rate = parseRate(input.rate);
  const trailerType = parseTrailerType(input.trailerType);

  if (!origin || !destination || !pickupDate || !deliveryDate || !miles || !rate || !trailerType) {
    return null;
  }

  const canonical = canonicalizeLoadForHash({ origin, destination, pickupDate, miles, rate });

  return {
    origin,
    destination,
    pickupDate,
    deliveryDate,
    miles,
    rate,
    brokerName: cleanString(input.brokerName) || null,
    brokerEmail: cleanString(input.brokerEmail) || null,
    brokerPhone: cleanString(input.brokerPhone) || null,
    trailerType,
    hash: sha256(canonical),
  };
}

export async function resolveCarrierIdFromExtensionKey(rawKey: string): Promise<string | null> {
  const keyHash = sha256(rawKey);

  const keyRecord = await prisma.dATIntegrationKey.findFirst({
    where: { keyHash, isActive: true },
  });

  if (!keyRecord) return null;

  await prisma.dATIntegrationKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() },
  });

  return keyRecord.carrierId;
}

export async function ingestDATSnapshot(
  carrierId: string,
  payload: DATIngestPayload
): Promise<IngestMetrics> {
  const ingestId = cleanString(payload.ingestId);
  const extensionVersion = cleanString(payload.extensionVersion) || 'unknown';
  const snapshotTimestamp = cleanString(payload.timestamp)
    ? new Date(cleanString(payload.timestamp))
    : new Date();
  const rawLoads = Array.isArray(payload.loads) ? payload.loads : [];

  if (!ingestId) {
    throw new Error('ingestId is required');
  }

  const normalized = rawLoads
    .map((l) => normalizeLoad(l as DATLoadPayload))
    .filter((l): l is NormalizedLoad => l !== null);

  const received = rawLoads.length;
  const invalid = received - normalized.length;

  const existingBatch = await prisma.dATIngestBatch.findUnique({
    where: { carrierId_ingestId: { carrierId, ingestId } },
  });

  if (existingBatch) {
    return {
      received: existingBatch.receivedCount,
      inserted: existingBatch.insertedCount,
      duplicates: existingBatch.duplicateCount,
      invalid: existingBatch.errorCount,
    };
  }

  const rows = normalized.map((l) => ({
    carrierId,
    origin: l.origin,
    destination: l.destination,
    pickupDate: l.pickupDate,
    deliveryDate: l.deliveryDate,
    miles: l.miles,
    rate: l.rate,
    brokerName: l.brokerName,
    brokerEmail: l.brokerEmail,
    brokerPhone: l.brokerPhone,
    trailerType: l.trailerType,
    hash: l.hash,
    snapshotTimestamp,
  }));

  const batch = await prisma.dATIngestBatch.create({
    data: {
      carrierId,
      ingestId,
      extensionVersion,
      receivedCount: received,
      insertedCount: 0,
      duplicateCount: 0,
      errorCount: invalid,
      snapshotTimestamp,
    },
  });

  const inserted = rows.length
    ? (
        await prisma.dATLoadSnapshot.createMany({
          data: rows.map((r) => ({ ...r, batchId: batch.id })),
          skipDuplicates: true,
        })
      ).count
    : 0;

  const duplicates = Math.max(0, rows.length - inserted);

  await prisma.dATIngestBatch.update({
    where: { id: batch.id },
    data: {
      insertedCount: inserted,
      duplicateCount: duplicates,
      errorCount: invalid,
    },
  });

  return {
    received,
    inserted,
    duplicates,
    invalid,
  };
}
