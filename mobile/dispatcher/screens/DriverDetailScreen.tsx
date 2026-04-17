import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Linking } from 'react-native'
import { statusLabel, statusColor } from '../lib/status'
import type { DispatcherDriver } from '../lib/api'

export default function DriverDetailScreen({ navigation, route }: any) {
  const d = route.params.driver as DispatcherDriver

  function openDAT() {
    Linking.openURL(`https://one.dat.com/search-loads?origin=${encodeURIComponent(d.currentLocation || '')}`)
  }

  function callDriver() {
    if (d.phoneNumber) Linking.openURL(`tel:${d.phoneNumber}`)
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>{d.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.label}>Status</Text>
            <View style={[s.badge, { backgroundColor: statusColor(d.status) + '22', borderColor: statusColor(d.status) }]}>
              <Text style={[s.badgeText, { color: statusColor(d.status) }]}>{statusLabel(d.status)}</Text>
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Driver ID</Text>
            <Text style={s.value}>{d.driverId || '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Trailer Type</Text>
            <Text style={s.value}>{d.trailerType || '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Phone</Text>
            <Text style={s.value}>{d.phoneNumber || '—'}</Text>
          </View>
        </View>

        <Text style={s.sectionLabel}>Location</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.label}>Current</Text>
            <Text style={s.value}>{d.currentLocation || '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Empty Location</Text>
            <Text style={s.value}>{d.emptyLocation || '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Empty Time</Text>
            <Text style={s.value}>{d.emptyTime || '—'}</Text>
          </View>
          {d.currentLat != null && d.currentLon != null ? (
            <View style={s.row}>
              <Text style={s.label}>Coordinates</Text>
              <Text style={s.value}>{d.currentLat.toFixed(3)}, {d.currentLon.toFixed(3)}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={s.btnGreen} onPress={openDAT}>
          <Text style={s.btnText}>Find Next Load</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnOutline} onPress={() => navigation.navigate('Chat', { driver: d })}>
          <Text style={s.btnOutlineText}>Chat with {d.name}</Text>
        </TouchableOpacity>
        {d.phoneNumber ? (
          <TouchableOpacity style={s.btnOutline} onPress={callDriver}>
            <Text style={s.btnOutlineText}>Call Driver</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  sectionLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { color: '#6B7280', fontSize: 13 },
  value: { color: '#E5E7EB', fontSize: 13, fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  btnGreen: { backgroundColor: '#1D9E75', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  btnOutline: { borderWidth: 1, borderColor: '#6B7280', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnOutlineText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
})
