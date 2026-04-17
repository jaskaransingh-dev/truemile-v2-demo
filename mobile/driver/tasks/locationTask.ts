import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as SecureStore from 'expo-secure-store'
import { normalizePhone } from '../lib/phone'

export const LOCATION_TASK_NAME = 'background-location-task'
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[LocationTask] error:', error)
    return
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] }
    const location = locations[0]
    if (!location) return

    const { latitude, longitude } = location.coords

    try {
      const driverPhone = normalizePhone(await SecureStore.getItemAsync('driverPhone'))
      if (!driverPhone) return

      const response = await fetch(`${API_BASE}/api/drivers/location`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: driverPhone,
          lat: latitude,
          lon: longitude,
          timestamp: new Date().toISOString()
        })
      })

      console.log('[LocationTask] ping sent:', latitude.toFixed(4), longitude.toFixed(4), response.status)
    } catch (err) {
      console.error('[LocationTask] failed to send:', err)
    }
  }
})
