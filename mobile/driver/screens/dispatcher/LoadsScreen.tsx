import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl,
  StyleSheet, SafeAreaView, ActivityIndicator, ScrollView,
} from 'react-native'
import {
  fetchAllLoads, fetchDrivers,
  type DispatchLoad, type DispatcherDriver,
} from '../../lib/dispatcher-api'
import { formatLoadDate } from '../../lib/format'

const TARGET_RPM_DEFAULT = 1.86

function fmtDate(iso?: string | null): string {
  return formatLoadDate(iso)
}

function rpmOf(load: DispatchLoad): number | null {
  if (!load.rate || !load.loadedMiles || load.loadedMiles <= 0) return null
  return Math.round((load.rate / load.loadedMiles) * 100) / 100
}

export default function LoadsScreen({ navigation }: any) {
  const [loads, setLoads] = useState<DispatchLoad[]>([])
  const [drivers, setDrivers] = useState<DispatcherDriver[]>([])
  const [filterDriverId, setFilterDriverId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ls, ds] = await Promise.all([
        fetchAllLoads(filterDriverId || undefined),
        fetchDrivers(),
      ])
      setLoads(ls)
      setDrivers(ds)
    } catch (err) {
      console.error('[LoadsScreen] fetch error:', err)
    }
  }, [filterDriverId])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  useEffect(() => {
    const unsub = navigation.addListener('focus', load)
    return unsub
  }, [navigation, load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const targetRPMByDriver = useMemo(() => {
    const map: Record<string, number> = {}
    drivers.forEach(d => { map[d.id] = d.targetRPM ?? TARGET_RPM_DEFAULT })
    return map
  }, [drivers])

  function renderLoad({ item }: { item: DispatchLoad }) {
    const r = rpmOf(item)
    const target = targetRPMByDriver[item.driverId] || TARGET_RPM_DEFAULT
    const rpmColor = r == null ? '#6B7280' : r >= target ? '#4ADE80' : '#F87171'

    return (
      <TouchableOpacity style={s.row} onPress={() => navigation.navigate('LoadDetail', { loadId: item.id })}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.driverName}>{item.driver?.name || '—'}</Text>
          <Text style={[s.rpm, { color: rpmColor }]}>{r != null ? `$${r.toFixed(2)}` : '—'}</Text>
        </View>
        <Text style={s.loadNum}>#{item.loadNumber || item.id.substring(0, 8)}</Text>
        <Text style={s.route}>
          {item.pickupCity && item.pickupState ? `${item.pickupCity}, ${item.pickupState}` : '—'}
          {' → '}
          {item.dropoffCity && item.dropoffState ? `${item.dropoffCity}, ${item.dropoffState}` : '—'}
        </Text>
        <View style={s.meta}>
          <Text style={s.metaItem}>{fmtDate(item.pickupTime)}</Text>
          <Text style={s.metaItem}>Rate ${item.rate?.toLocaleString() || '—'}</Text>
          <Text style={s.metaItem}>{item.loadedMiles ?? '—'}mi</Text>
          <Text style={s.metaItem}>DH {item.deadheadMiles ?? '—'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.logo}>True<Text style={s.logoAccent}>Mile</Text></Text>
        <Text style={s.sub}>Loads</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
        <TouchableOpacity
          style={[s.chip, !filterDriverId && s.chipActive]}
          onPress={() => setFilterDriverId(null)}
        >
          <Text style={[s.chipText, !filterDriverId && s.chipTextActive]}>All drivers</Text>
        </TouchableOpacity>
        {drivers.map(d => (
          <TouchableOpacity
            key={d.id}
            style={[s.chip, filterDriverId === d.id && s.chipActive]}
            onPress={() => setFilterDriverId(d.id)}
          >
            <Text style={[s.chipText, filterDriverId === d.id && s.chipTextActive]}>{d.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color="#1D9E75" size="large" style={{ marginTop: 40 }} />
      ) : loads.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No loads yet</Text>
        </View>
      ) : (
        <FlatList
          data={loads}
          keyExtractor={(item) => item.id}
          renderItem={renderLoad}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1D9E75" />}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  logo: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  logoAccent: { color: '#1D9E75' },
  sub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  filterRow: { maxHeight: 44, marginTop: 12, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: '#2D3035', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  chipText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#FFF' },

  row: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 12, marginBottom: 8 },
  driverName: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  rpm: { fontSize: 14, fontWeight: '700' },
  loadNum: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  route: { color: '#E5E7EB', fontSize: 13, marginTop: 6 },
  meta: { flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  metaItem: { color: '#6B7280', fontSize: 11 },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#6B7280', fontSize: 14 },
})
