import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl,
  StyleSheet, SafeAreaView, Linking, ActivityIndicator,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { fetchDrivers, type DispatcherDriver } from '../lib/api'
import { statusLabel, statusColor } from '../lib/status'
const TODAY = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function DriversScreen({ navigation }: any) {
  const [drivers, setDrivers] = useState<DispatcherDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await fetchDrivers()
      setDrivers(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load drivers')
    }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  function openDAT(location: string) {
    const url = `https://one.dat.com/search-loads?origin=${encodeURIComponent(location)}`
    Linking.openURL(url)
  }

  function renderDriver({ item }: { item: DispatcherDriver }) {
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => navigation.navigate('DriverDetail', { driver: item })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.driverName}>{item.name}</Text>
          <View style={[s.badge, { backgroundColor: statusColor(item.status) + '22', borderColor: statusColor(item.status) }]}>
            <Text style={[s.badgeText, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
          </View>
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Location</Text>
          <Text style={s.metaValue}>{item.currentLocation || '—'}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Empty</Text>
          <Text style={s.metaValue}>{item.emptyTime || '—'}</Text>
        </View>

        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.actionBtn, { borderColor: '#1D9E75' }]}
            onPress={(e) => { e.stopPropagation(); openDAT(item.currentLocation || '') }}
          >
            <Text style={[s.actionBtnText, { color: '#1D9E75' }]}>Find Load</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { borderColor: '#6B7280' }]}
            onPress={(e) => { e.stopPropagation(); navigation.navigate('Chat', { driver: item }) }}
          >
            <Text style={[s.actionBtnText, { color: '#9CA3AF' }]}>Chat</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.logo}>True<Text style={s.logoAccent}>Mile</Text></Text>
          <Text style={s.sub}>Dispatch</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={s.date}>{TODAY}</Text>
          <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
            <Text style={s.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Active Drivers</Text>
          <Text style={s.statValue}>{drivers.length}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Loads Needed</Text>
          <Text style={s.statValue}>
            {drivers.filter(d => d.status === 'EMPTYING_NOW' || d.status === 'EMPTY').length}
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#1D9E75" size="large" style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={s.emptyState}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : drivers.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No drivers available</Text>
        </View>
      ) : (
        <FlatList
          data={drivers}
          keyExtractor={(item) => item.id}
          renderItem={renderDriver}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1D9E75" />
          }
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128',
  },
  logo: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  logoAccent: { color: '#1D9E75' },
  sub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  date: { fontSize: 12, color: '#6B7280' },
  logoutBtn: { borderWidth: 1, borderColor: '#2D3035', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 10 },
  logoutText: { fontSize: 11, color: '#9CA3AF' },

  statsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  statCard: { flex: 1, backgroundColor: '#111419', borderWidth: 1, borderColor: '#1E2128', borderRadius: 8, padding: 12 },
  statLabel: { fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '700', color: '#FFF' },

  row: {
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginBottom: 10,
  },
  driverName: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  metaLabel: { fontSize: 12, color: '#6B7280' },
  metaValue: { fontSize: 12, color: '#E5E7EB', fontWeight: '500' },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 8, alignItems: 'center' },
  actionBtnText: { fontSize: 12, fontWeight: '600' },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#6B7280', fontSize: 14 },
  errorText: { color: '#F87171', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retryText: { color: '#1D9E75', fontSize: 14, fontWeight: '600' },
})
