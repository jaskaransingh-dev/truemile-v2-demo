/**
 * Normalize a phone number to the backend-expected format: digits only with
 * leading country code "1".
 *
 * Examples:
 *   "4698473017"       → "14698473017"
 *   "+1 469-847-3017"  → "14698473017"
 *   "14698473017"      → "14698473017"
 *   ""                 → ""
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('1') ? digits : '1' + digits
}
