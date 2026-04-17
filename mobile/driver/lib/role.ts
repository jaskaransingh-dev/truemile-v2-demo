import * as SecureStore from 'expo-secure-store'

export type Role = 'driver' | 'dispatcher'

const ROLE_KEY = 'userRole'

export async function setRole(role: Role): Promise<void> {
  await SecureStore.setItemAsync(ROLE_KEY, role)
}

export async function getRole(): Promise<Role | null> {
  const v = await SecureStore.getItemAsync(ROLE_KEY)
  return v === 'driver' || v === 'dispatcher' ? v : null
}

export async function clearRole(): Promise<void> {
  await SecureStore.deleteItemAsync(ROLE_KEY)
}
