import crypto from 'crypto';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalizeLoadForHash(input: {
  origin: string;
  destination: string;
  pickupDate: string;
  miles: number;
  rate: number;
}): string {
  const origin = input.origin.trim().toUpperCase();
  const destination = input.destination.trim().toUpperCase();
  const pickupDate = input.pickupDate.trim();
  const miles = String(Math.max(0, Math.trunc(input.miles)));
  const rate = Number(input.rate).toFixed(2);

  return `${origin}|${destination}|${pickupDate}|${miles}|${rate}`;
}
