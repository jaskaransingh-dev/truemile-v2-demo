import { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps'
import { fetchDrivers, type DispatcherDriver } from '../../lib/dispatcher-api'
import { supabase } from '../../lib/supabase'
import { statusLabel, statusColor, statusPinColor } from '../../lib/dispatcher-status'
// Roughly center on the US
const INITIAL_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 50,
}

export default function MapScreen({ navigation }: any) {
  const [drivers, setDrivers] = useState<DispatcherDriver[]>([])
  const [loading, setLoading] = useState(true)
  const mapRef = useRef<MapView>(null)

  async function load() {
    try {
      const data = await fetchDrivers()
      setDrivers(data)
    } catch (err) {
      console.error('[MapScreen] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Auto-refresh every 60s
    const interval = setInterval(load, 60_000)

    // Supabase Realtime subscription for live location updates
    const channel = supabase.channel('driver-locations')
      .on('broadcast', { event: 'location-update' }, (payload) => {
        const update = payload.payload as { driverId: string; lat: number; lon: number; location: string }
        setDrivers((prev) =>
          prev.map((d) => d.id === update.driverId
            ? { ...d, currentLat: update.lat, currentLon: update.lon, currentLocation: update.location }
            : d
          )
        )
      })
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [])

  const pinnedDrivers = drivers.filter(d => d.currentLat != null && d.currentLon != null)

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={s.map}
        initialRegion={INITIAL_REGION}
        mapType="mutedStandard"
      >
        {pinnedDrivers.map((d) => (
          <Marker
            key={d.id}
            coordinate={{ latitude: d.currentLat!, longitude: d.currentLon! }}
            pinColor={statusPinColor(d.status)}
            title={d.name}
            description={statusLabel(d.status)}
          >
            <Callout tooltip onPress={() => navigation.navigate('DispatcherChat', { driver: d })}>
              <View style={s.callout}>
                <Text style={s.calloutName}>{d.name}</Text>
                <Text style={[s.calloutStatus, { color: statusColor(d.status) }]}>
                  {statusLabel(d.status)}
                </Text>
                {d.currentLocation ? (
                  <Text style={s.calloutLocation}>{d.currentLocation}</Text>
                ) : null}
                <View style={s.chatBtn}>
                  <Text style={s.chatBtnText}>Chat</Text>
                </View>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator color="#1D9E75" />
        </View>
      )}

      {/* Count badge */}
      <View style={s.countBadge}>
        <Text style={s.countText}>
          {pinnedDrivers.length} / {drivers.length} drivers on map
        </Text>
        <TouchableOpacity onPress={load}>
          <Text style={s.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  map: { flex: 1 },

  callout: {
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 8,
    padding: 12, minWidth: 180,
  },
  calloutName: { color: '#FFF', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  calloutStatus: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  calloutLocation: { color: '#9CA3AF', fontSize: 12, marginBottom: 8 },
  chatBtn: { backgroundColor: '#1D9E75', borderRadius: 6, padding: 8, alignItems: 'center' },
  chatBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },

  loadingOverlay: {
    position: 'absolute', top: 16, alignSelf: 'center',
    backgroundColor: '#1A1D21', borderRadius: 20, padding: 8,
  },

  countBadge: {
    position: 'absolute', top: 50, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1A1D21CC', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#2D3035',
  },
  countText: { color: '#E5E7EB', fontSize: 12, fontWeight: '500' },
  refreshText: { color: '#1D9E75', fontSize: 18 },
})
