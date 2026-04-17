export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000'

export interface DispatcherDriver {
  id: string
  name: string
  driverId: number | null
  phoneNumber: string | null
  trailerType: string | null
  status: string
  currentLocation: string
  currentLat: number | null
  currentLon: number | null
  emptyTime: string
  emptyLocation: string
}

export async function fetchDrivers(): Promise<DispatcherDriver[]> {
  const res = await fetch(`${API_BASE}/api/dispatcher/drivers`)
  if (!res.ok) throw new Error(`Failed to fetch drivers: ${res.status}`)
  const data = await res.json()
  return data.drivers || []
}
