import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Alert, Linking, TextInput,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import {
  fetchLoad, calculateLoadMiles, uploadRateCon, deleteLoad, rateConFileUrl, updateLoad,
  API_BASE, type DispatchLoad, type LoadStop,
} from '../../lib/dispatcher-api'
import { formatLoadDate } from '../../lib/format'
import * as WebBrowser from 'expo-web-browser'

function milesDisplay(miles: number | null, source: string | null): string {
  if (miles == null) return '—'
  const label = source === 'CALCULATED' ? ' (calculated)' : ''
  return `${miles}${label}`
}

function rpm(load: DispatchLoad): number | null {
  if (!load.rate || !load.loadedMiles || load.loadedMiles <= 0) return null
  return Math.round((load.rate / load.loadedMiles) * 100) / 100
}

const STATUS_OPTIONS = ['BOOKED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']
const STATUS_COLORS: Record<string, string> = {
  BOOKED: '#60A5FA', IN_TRANSIT: '#FAC775', DELIVERED: '#4ADE80', CANCELLED: '#F87171',
}

export default function LoadDetailScreen({ navigation, route }: any) {
  const loadId = route.params.loadId as string
  const [load, setLoadState] = useState<DispatchLoad | null>(null)
  const [loading, setLoading] = useState(true)
  const [calcLoading, setCalcLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLoad(loadId)
      setLoadState(data)
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to fetch load')
    } finally {
      setLoading(false)
    }
  }, [loadId])

  useEffect(() => { refresh() }, [refresh])

  async function handleCalcMiles() {
    setCalcLoading(true)
    try {
      const updated = await calculateLoadMiles(loadId)
      setLoadState(updated)
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to calculate miles')
    }
    setCalcLoading(false)
  }

  async function handleUploadRateCon() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    })
    if (res.canceled || !res.assets[0]) return

    setUploadLoading(true)
    try {
      await uploadRateCon(loadId, res.assets[0].uri, res.assets[0].mimeType || 'image/jpeg')
      await refresh()
    } catch (err: any) {
      Alert.alert('Upload failed', err.message || 'Could not upload rate con')
    }
    setUploadLoading(false)
  }

  if (loading || !load) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#1D9E75" size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    )
  }

  const r = rpm(load)
  const statusCol = STATUS_COLORS[load.status] || '#6B7280'
  const origin = load.pickupCity && load.pickupState ? `${load.pickupCity}, ${load.pickupState}` : '—'
  const dest = load.dropoffCity && load.dropoffState ? `${load.dropoffCity}, ${load.dropoffState}` : '—'

  // Route header times: prefer stops data (source of truth) over top-level fields
  const sortedStops = load.stops && Array.isArray(load.stops)
    ? [...(load.stops as LoadStop[])].sort((a, b) => a.sequence - b.sequence)
    : []
  const firstStop = sortedStops[0]
  const lastStop = sortedStops.length > 1 ? sortedStops[sortedStops.length - 1] : null
  const pickupTimeDisplay = firstStop?.appointment || load.pickupTime
  const deliveryTimeDisplay = lastStop?.appointment || load.deliveryTime

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Load #{load.loadNumber || load.id.substring(0, 8)}</Text>
        {load.stopCount && load.stopCount > 1 ? (
          <View style={[s.statusBadge, { backgroundColor: '#FAC77522', borderColor: '#FAC775' }]}>
            <Text style={[s.statusText, { color: '#FAC775' }]}>{load.stopCount} stops</Text>
          </View>
        ) : null}
        <View style={[s.statusBadge, { backgroundColor: statusCol + '22', borderColor: statusCol }]}>
          <Text style={[s.statusText, { color: statusCol }]}>{load.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Route */}
        <View style={s.card}>
          <Text style={s.sectionHeader}>Route</Text>
          <View style={s.route}>
            <View style={s.routeEnd}>
              <Text style={s.routeCity}>{origin}</Text>
              <Text style={s.routeTime}>{formatLoadDate(pickupTimeDisplay)}</Text>
              <Text style={s.routeLabel}>Pickup</Text>
            </View>
            <Text style={s.routeArrow}>→</Text>
            <View style={s.routeEnd}>
              <Text style={s.routeCity}>{dest}</Text>
              <Text style={s.routeTime}>{formatLoadDate(deliveryTimeDisplay)}</Text>
              <Text style={s.routeLabel}>Delivery</Text>
            </View>
          </View>
        </View>

        {/* Stops */}
        {load.stops && Array.isArray(load.stops) && load.stops.length > 0 && (
          <View style={s.card}>
            <Text style={s.sectionHeader}>Stops ({load.stops.length})</Text>
            {(load.stops as LoadStop[]).map((stop, idx) => (
              <View key={idx} style={[s.kvRow, { borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: '#1E2128', paddingTop: idx > 0 ? 8 : 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: stop.type === 'PICKUP' ? '#4ADE80' : '#60A5FA', fontSize: 10, fontWeight: '700' }}>
                    {stop.sequence}. {stop.type}
                  </Text>
                  <Text style={s.kvValue}>{stop.city}, {stop.state}</Text>
                  {stop.address ? <Text style={{ color: '#6B7280', fontSize: 11 }}>{stop.address}</Text> : null}
                </View>
                <Text style={{ color: '#9CA3AF', fontSize: 11 }}>
                  {stop.appointment ? formatLoadDate(stop.appointment) : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Financials — tap value to edit inline */}
        <FinancialsCard load={load} onUpdate={async (patch) => {
          try {
            const updated = await updateLoad(load.id, patch)
            setLoadState(updated)
          } catch (err: any) { Alert.alert('Error', err.message) }
        }} />

        {((load.loadedMilesSource !== 'RATECON' && load.loadedMiles == null) || load.deadheadMiles == null) ? (
          <TouchableOpacity style={[s.actionBtn, { marginBottom: 12 }]} onPress={handleCalcMiles} disabled={calcLoading}>
            {calcLoading
              ? <ActivityIndicator color="#1D9E75" />
              : <Text style={s.actionBtnText}>Calculate missing miles</Text>}
          </TouchableOpacity>
        ) : null}

        {/* Broker */}
        {(load.brokerName || load.brokerAgentName || load.brokerEmail || load.brokerPhone) && (
          <View style={s.card}>
            <Text style={s.sectionHeader}>Broker</Text>
            <View style={s.kvRow}>
              <Text style={s.kvLabel}>Company</Text>
              <Text style={s.kvValue}>{load.brokerName || '—'}</Text>
            </View>
            {load.brokerAgentName ? (
              <View style={s.kvRow}>
                <Text style={s.kvLabel}>Agent</Text>
                <Text style={s.kvValue}>{load.brokerAgentName}</Text>
              </View>
            ) : null}
            {load.brokerEmail ? (
              <TouchableOpacity style={s.kvRow} onPress={() => Linking.openURL(`mailto:${load.brokerEmail}`)}>
                <Text style={s.kvLabel}>Email</Text>
                <Text style={[s.kvValue, s.kvLink]}>{load.brokerEmail}</Text>
              </TouchableOpacity>
            ) : null}
            {load.brokerPhone ? (
              <TouchableOpacity style={s.kvRow} onPress={() => Linking.openURL(`tel:${load.brokerPhone}`)}>
                <Text style={s.kvLabel}>Phone</Text>
                <Text style={[s.kvValue, s.kvLink]}>{load.brokerPhone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Documents */}
        <View style={s.card}>
          <Text style={s.sectionHeader}>Documents</Text>

          {/* Rate Con — dispatcher uploads */}
          <View style={s.docRow}>
            <TouchableOpacity
              style={{ flex: 1 }}
              disabled={!load.rateConPath}
              onPress={() => { if (load.rateConPath) WebBrowser.openBrowserAsync(rateConFileUrl(load.id)) }}
            >
              <Text style={s.docLabel}>Rate Confirmation</Text>
              <Text style={[s.docStatus, load.rateConPath && { textDecorationLine: 'underline' }]}>
                {load.rateConUploadedAt
                  ? `Uploaded ${new Date(load.rateConUploadedAt).toLocaleDateString()} — tap to view`
                  : 'Not uploaded'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.docBtn} onPress={handleUploadRateCon} disabled={uploadLoading}>
              {uploadLoading
                ? <ActivityIndicator color="#1D9E75" />
                : <Text style={s.docBtnText}>{load.rateConPath ? 'Replace' : 'Upload'}</Text>}
            </TouchableOpacity>
          </View>

          {/* BOL — driver uploads */}
          <View style={s.docRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.docLabel}>Bill of Lading</Text>
              <Text style={[s.docStatus, !load.bolPath && s.docStatusMuted]}>
                {load.bolUploadedAt
                  ? `Uploaded ${new Date(load.bolUploadedAt).toLocaleDateString()}`
                  : 'Waiting on driver'}
              </Text>
            </View>
          </View>

          {/* POD — driver uploads */}
          <View style={s.docRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.docLabel}>Proof of Delivery</Text>
              <Text style={[s.docStatus, !load.podPath && s.docStatusMuted]}>
                {load.podUploadedAt
                  ? `Uploaded ${new Date(load.podUploadedAt).toLocaleDateString()}`
                  : 'Waiting on driver'}
              </Text>
            </View>
          </View>
        </View>

        {/* Delete load */}
        <TouchableOpacity
          style={{ marginTop: 24, marginBottom: 16, alignItems: 'center' }}
          onPress={() => {
            Alert.alert('Delete this load?', `Load #${load.loadNumber || load.id.substring(0, 8)}`, [
              { text: 'Cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => {
                try { await deleteLoad(load.id); navigation.goBack() } catch (err: any) { Alert.alert('Error', err.message) }
              }},
            ])
          }}
        >
          <Text style={{ color: '#F87171', fontSize: 14 }}>Delete Load</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Editable financials card
// ---------------------------------------------------------------------------

function FinancialsCard({ load, onUpdate }: {
  load: DispatchLoad;
  onUpdate: (patch: Partial<DispatchLoad>) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null) // 'rate' | 'loadedMiles' | 'deadheadMiles'
  const [editValue, setEditValue] = useState('')

  function startEdit(field: string, current: number | null) {
    setEditing(field)
    setEditValue(current != null ? String(current) : '')
  }

  async function commitEdit() {
    if (!editing) return
    const val = parseFloat(editValue)
    const patch: any = {}
    if (editing === 'rate') patch.rate = isNaN(val) ? null : val
    else if (editing === 'loadedMiles') { patch.loadedMiles = isNaN(val) ? null : val; patch.loadedMilesSource = 'RATECON' }
    else if (editing === 'deadheadMiles') { patch.deadheadMiles = isNaN(val) ? null : val; patch.deadheadMilesSource = 'RATECON' }
    setEditing(null)
    await onUpdate(patch)
  }

  const rateVal = load.rate
  const milesVal = load.loadedMiles
  const dhVal = load.deadheadMiles
  const computedRPM = rateVal && milesVal && milesVal > 0 ? Math.round((rateVal / milesVal) * 100) / 100 : null

  function renderField(label: string, field: string, value: number | null, prefix = '', suffix = '') {
    if (editing === field) {
      return (
        <View style={s.kvRow}>
          <Text style={s.kvLabel}>{label}</Text>
          <TextInput
            style={[s.kvValue, { borderBottomWidth: 1, borderBottomColor: '#1D9E75', minWidth: 80, textAlign: 'right' as const, padding: 0 }]}
            value={editValue}
            onChangeText={setEditValue}
            keyboardType="numeric"
            autoFocus
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            returnKeyType="done"
          />
        </View>
      )
    }
    return (
      <TouchableOpacity style={s.kvRow} onPress={() => startEdit(field, value)}>
        <Text style={s.kvLabel}>{label}</Text>
        <Text style={s.kvValue}>{value != null ? `${prefix}${value.toLocaleString()}${suffix}` : '—'}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={s.card}>
      <Text style={s.sectionHeader}>Financials</Text>
      {renderField('Rate', 'rate', rateVal, '$')}
      {renderField('Loaded Miles', 'loadedMiles', milesVal)}
      {renderField('Deadhead', 'deadheadMiles', dhVal)}
      <View style={s.kvRow}>
        <Text style={s.kvLabel}>RPM</Text>
        <Text style={[s.kvValue, { color: computedRPM != null ? '#4ADE80' : '#6B7280' }]}>
          {computedRPM != null ? `$${computedRPM.toFixed(2)}/mi` : '—'}
        </Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '600', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '700' },

  card: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginBottom: 12 },
  sectionHeader: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },

  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeEnd: { flex: 1 },
  routeCity: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  routeTime: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  routeLabel: { color: '#6B7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  routeArrow: { color: '#1D9E75', fontSize: 20, fontWeight: '700' },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvLabel: { color: '#6B7280', fontSize: 13 },
  kvValue: { color: '#E5E7EB', fontSize: 13, fontWeight: '500' },
  kvLink: { color: '#60A5FA' },

  actionBtn: { borderWidth: 1, borderColor: '#1D9E75', borderRadius: 6, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  actionBtnText: { color: '#1D9E75', fontSize: 13, fontWeight: '600' },

  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1E2128' },
  docLabel: { color: '#E5E7EB', fontSize: 14, fontWeight: '500' },
  docStatus: { color: '#4ADE80', fontSize: 11, marginTop: 2 },
  docStatusMuted: { color: '#6B7280', fontStyle: 'italic' },
  docBtn: { borderWidth: 1, borderColor: '#1D9E75', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  docBtnText: { color: '#1D9E75', fontSize: 12, fontWeight: '600' },
})
