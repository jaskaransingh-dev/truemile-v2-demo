// Status → color + label mappings matching the web Dispatch Console
export const STATUS_MAP: Record<string, { label: string; color: string; pinColor: string }> = {
  EMPTYING_NOW:      { label: 'Emptying Now',       color: '#FAC775', pinColor: 'orange' },
  CHECKED_IN:        { label: 'Checked-In',         color: '#4ADE80', pinColor: 'green' },
  EN_ROUTE:          { label: 'On-Time En Route',   color: '#60A5FA', pinColor: 'blue' },
  BEHIND_SCHEDULE:   { label: 'Behind Schedule',    color: '#F87171', pinColor: 'red' },
  LOADED:            { label: 'Loaded',             color: '#1D9E75', pinColor: 'green' },
  EMPTY:             { label: 'Empty',              color: '#60A5FA', pinColor: 'blue' },
  AT_SHIPPER:        { label: 'At Shipper',         color: '#FAC775', pinColor: 'orange' },
  AT_RECEIVER:       { label: 'At Receiver',        color: '#F97316', pinColor: 'orange' },
  DELAYED:           { label: 'Delayed',            color: '#F87171', pinColor: 'red' },
  OFF_DUTY:          { label: 'Off Duty',           color: '#6B7280', pinColor: 'gray' },
  ACTIVE:            { label: 'Active',             color: '#1D9E75', pinColor: 'green' },
}

export function statusLabel(s?: string) { return s ? (STATUS_MAP[s]?.label || s) : 'Unknown' }
export function statusColor(s?: string) { return s ? (STATUS_MAP[s]?.color || '#6B7280') : '#6B7280' }
export function statusPinColor(s?: string) { return s ? (STATUS_MAP[s]?.pinColor || 'gray') : 'gray' }
