import { useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { normalizePhone } from '../lib/phone'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL

const STATUS_OPTIONS = [
  { key: 'LOADED',      color: '#1D9E75', label: 'Loaded',       desc: 'Picked up freight, en route to delivery' },
  { key: 'EMPTY',       color: '#60A5FA', label: 'Empty',        desc: 'Delivered, looking for next load' },
  { key: 'AT_SHIPPER',  color: '#FAC775', label: 'At Shipper',   desc: 'Checked-in at pickup location' },
  { key: 'AT_RECEIVER', color: '#F97316', label: 'At Receiver',  desc: 'Checked-in at delivery location' },
  { key: 'DELAYED',     color: '#F87171', label: 'Delayed',      desc: 'Will be late to appointment' },
  { key: 'OFF_DUTY',    color: '#6B7280', label: 'Off Duty',     desc: 'Not available' },
]

type Props = {
  navigation: NativeStackNavigationProp<any>
  route: { params?: { phone?: string; currentStatus?: string } }
}

export default function UpdateStatusScreen({ navigation, route }: Props) {
  const phone = normalizePhone(route.params?.phone)
  const [selected, setSelected] = useState(route.params?.currentStatus || 'ACTIVE')
  const [updating, setUpdating] = useState(false)

  async function handleSelect(status: string) {
    setSelected(status)
    setUpdating(true)

    try {
      const res = await fetch(`${API_BASE}/api/drivers/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, status }),
      })

      if (res.ok) {
        // Save locally for HomeScreen to read
        await SecureStore.setItemAsync('driverStatus', status)
        Alert.alert('Status updated ✓')
        setTimeout(() => navigation.goBack(), 1500)
      } else {
        Alert.alert('Error', 'Failed to update status')
      }
    } catch {
      Alert.alert('Error', 'Could not reach server')
    }
    setUpdating(false)
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Update Status</Text>
      </View>

      <View style={s.list}>
        {STATUS_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[s.card, selected === opt.key && s.cardSelected]}
            onPress={() => handleSelect(opt.key)}
            disabled={updating}
          >
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: opt.color }} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>{opt.label}</Text>
              <Text style={s.cardDesc}>{opt.desc}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  list: { gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 12, padding: 16,
  },
  cardSelected: { borderColor: '#1D9E75', backgroundColor: '#0F2A1A' },
  cardIcon: { fontSize: 24 },
  cardLabel: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  cardDesc: { color: '#6B7280', fontSize: 12, marginTop: 2 },
})
