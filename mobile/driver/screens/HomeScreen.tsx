import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { Camera, MessageSquare, CheckCircle } from 'lucide-react-native'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { LOCATION_TASK_NAME } from '../tasks/locationTask'
import { normalizePhone } from '../lib/phone'
import { clearRole } from '../lib/role'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
)

type Props = {
  navigation: NativeStackNavigationProp<any>
  route: { params?: { phone?: string } }
}

async function startLocationTracking(phone: string) {
  const { status: foreground } = await Location.requestForegroundPermissionsAsync()
  if (foreground !== 'granted') {
    console.log('[Location] foreground permission denied')
    return
  }

  const { status: background } = await Location.requestBackgroundPermissionsAsync()
  if (background !== 'granted') {
    console.log('[Location] background permission denied')
    return
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)
  if (!isRegistered) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15 * 60 * 1000, // 15 minutes
      distanceInterval: 0,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'TrueMile',
        notificationBody: 'Tracking your location for dispatch',
        notificationColor: '#1D9E75'
      }
    })
    console.log('[Location] background tracking started')
  }

  await SecureStore.setItemAsync('driverPhone', normalizePhone(phone))
}

export default function HomeScreen({ navigation, route }: Props) {
  const phone = normalizePhone(route.params?.phone)
  const [locationStatus, setLocationStatus] = useState('Not yet updated')
  const [driverStatus, setDriverStatus] = useState('ACTIVE')

  // Load saved status on mount / focus
  useEffect(() => {
    SecureStore.getItemAsync('driverStatus').then((s) => {
      if (s) setDriverStatus(s)
    })
  }, [])

  // Reload status when screen is focused (returning from UpdateStatus)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      SecureStore.getItemAsync('driverStatus').then((s) => {
        if (s) setDriverStatus(s)
      })
    })
    return unsubscribe
  }, [navigation])

  useEffect(() => {
    if (phone) {
      startLocationTracking(phone).then(() => {
        setLocationStatus('Tracking active')
      }).catch((err) => {
        console.error('[Location] setup error:', err)
        setLocationStatus('Permission denied')
      })
    }
  }, [phone])

  async function handleLogout() {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
        console.log('[Location] background tracking stopped')
      }
    } catch (err) {
      console.error('[Location] stop error:', err)
    }
    await supabase.auth.signOut()
    await SecureStore.deleteItemAsync('session')
    await SecureStore.deleteItemAsync('driverPhone')
    await SecureStore.deleteItemAsync('driverStatus')
    await clearRole()
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.logo}>TrueMile</Text>
          <Text style={s.sub}>Driver App</Text>
        </View>
        {phone ? <Text style={s.phone}>{phone}</Text> : null}
      </View>

      {/* Status card */}
      <View style={s.statusCard}>
        <View style={s.statusRow}>
          <Text style={s.statusLabel}>Current Status</Text>
          <View style={s.statusBadge}>
            <View style={[s.statusDot, { backgroundColor: statusColor(driverStatus) }]} />
            <Text style={[s.statusText, { color: statusColor(driverStatus) }]}>{statusLabel(driverStatus)}</Text>
          </View>
        </View>
        <View style={s.statusRow}>
          <Text style={s.statusLabel}>Location Tracking</Text>
          <Text style={s.statusValue}>{locationStatus}</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={s.actions}>
        <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('ScanDocument')}>
          <Camera size={24} color="#1D9E75" />
          <View>
            <Text style={s.actionTitle}>Scan Document</Text>
            <Text style={s.actionSub}>Rate con, BOL, or receipt</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Chat', { phone })}>
          <MessageSquare size={24} color="#1D9E75" />
          <View>
            <Text style={s.actionTitle}>Chat with Dispatch</Text>
            <Text style={s.actionSub}>Message your dispatcher</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('UpdateStatus', { phone, currentStatus: driverStatus })}>
          <CheckCircle size={24} color="#1D9E75" />
          <View>
            <Text style={s.actionTitle}>Update Status</Text>
            <Text style={s.actionSub}>Loading, en route, delivered</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ACTIVE:      { label: 'Active',       color: '#1D9E75' },
  LOADED:      { label: 'Loaded',       color: '#1D9E75' },
  EMPTY:       { label: 'Empty',        color: '#60A5FA' },
  AT_SHIPPER:  { label: 'At Shipper',   color: '#FAC775' },
  AT_RECEIVER: { label: 'At Receiver',  color: '#F97316' },
  DELAYED:     { label: 'Delayed',      color: '#F87171' },
  OFF_DUTY:    { label: 'Off Duty',     color: '#6B7280' },
}
function statusLabel(s: string) { return STATUS_MAP[s]?.label || s }
function statusColor(s: string) { return STATUS_MAP[s]?.color || '#6B7280' }

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: '700', color: '#1D9E75' },
  sub: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  phone: { fontSize: 13, color: '#6B7280', marginTop: 6 },

  statusCard: { backgroundColor: '#1A1D21', borderRadius: 12, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#2D3035' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  statusLabel: { fontSize: 13, color: '#6B7280' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1D9E75' },
  statusText: { fontSize: 13, color: '#4ADE80', fontWeight: '600' },
  statusValue: { fontSize: 13, color: '#9CA3AF' },

  actions: { gap: 12, flex: 1 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#1A1D21', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#1D9E75',
  },
  actionIcon: { fontSize: 28 },
  actionTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  actionSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  logoutBtn: { alignItems: 'center', paddingVertical: 16 },
  logoutText: { fontSize: 14, color: '#6B7280' },
})
