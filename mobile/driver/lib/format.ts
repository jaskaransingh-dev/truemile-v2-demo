const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Parse a datetime string WITHOUT timezone conversion.
 * Handles both "2026-04-03T11:00:00" (naive) and "2026-04-03T11:00:00Z" (UTC).
 * For naive strings (no Z / no offset), treats digits as-is — no UTC conversion.
 */
function parseNaive(iso: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  // Match YYYY-MM-DD or YYYY-MM-DDTHH:MM(:SS)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return null
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10) - 1,
    day: parseInt(m[3], 10),
    hour: m[4] != null ? parseInt(m[4], 10) : 0,
    minute: m[5] != null ? parseInt(m[5], 10) : 0,
  }
}

function fmt12h(hour: number, minute: number): string {
  const h = hour % 12 || 12
  const ampm = hour < 12 ? 'AM' : 'PM'
  const mm = String(minute).padStart(2, '0')
  return `${h}:${mm} ${ampm}`
}

/**
 * Format a datetime string to "Apr 3, 2026 · 11:00 AM"
 * Uses naive parsing — no timezone conversion.
 */
export function formatLoadDate(iso?: string | null): string {
  if (!iso) return '—'
  const p = parseNaive(iso)
  if (!p) return iso
  return `${MONTHS[p.month]} ${p.day}, ${p.year} · ${fmt12h(p.hour, p.minute)}`
}

/**
 * Format a date string to "Apr 3, 2026" (no time).
 */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const p = parseNaive(iso)
  if (!p) return iso
  return `${MONTHS[p.month]} ${p.day}, ${p.year}`
}

/**
 * Format a Date object for display (used by date pickers).
 */
export function formatDateObj(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function formatDateTimeObj(d: Date): string {
  return `${formatDateObj(d)} · ${fmt12h(d.getHours(), d.getMinutes())}`
}

/**
 * Convert a Date to a naive ISO string (no Z suffix).
 * Used when saving dates that should not be timezone-converted.
 */
export function toNaiveISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}
