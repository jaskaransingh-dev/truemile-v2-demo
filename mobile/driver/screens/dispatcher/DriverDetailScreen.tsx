import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, Modal, Alert, Platform, TextInput, KeyboardAvoidingView,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Calendar } from 'lucide-react-native'
import { statusLabel, statusColor } from '../../lib/dispatcher-status'
import { formatLoadDate } from '../../lib/format'
import {
  fetchDriver, fetchDriverLoads, updateDriver, updateCycleEnd, startNewCycle,
  type DispatcherDriver, type DispatchLoad,
} from '../../lib/dispatcher-api'

function fmtDateTime(iso?: string | null): string {
  return formatLoadDate(iso)
}

function rpm(load: DispatchLoad): number | null {
  if (!load.rate || !load.loadedMiles || load.loadedMiles <= 0) return null
  return Math.round((load.rate / load.loadedMiles) * 100) / 100
}

// Month pills: YTD first, then Jan → current month (oldest to newest)
function getMonthOptions(): { label: string; value: string }[] {
  const now = new Date()
  const year = now.getFullYear()
  const currentMonth = now.getMonth()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const options: { label: string; value: string }[] = []
  for (let m = 0; m <= currentMonth; m++) {
    const val = `${year}-${String(m + 1).padStart(2, '0')}`
    options.push({ label: months[m], value: val })
  }
  return options // oldest first (Jan → current)
}

export default function DriverDetailScreen({ navigation, route }: any) {
  const driverId = route.params.driverId as string

  const [driver, setDriver] = useState<DispatcherDriver | null>(null)
  const [loads, setLoads] = useState<DispatchLoad[]>([])
  const [loading, setLoading] = useState(true)

  const [editDriverOpen, setEditDriverOpen] = useState(false)
  const [loadMonth, setLoadMonth] = useState<string | undefined>(undefined) // undefined = current month

  // Home date picker
  const [showHomePicker, setShowHomePicker] = useState(false)
  const [homePickerDate, setHomePickerDate] = useState(new Date())

  const monthOptions = getMonthOptions()
  const currentMonthValue = loadMonth || monthOptions[monthOptions.length - 1]?.value

  const refresh = useCallback(async () => {
    try {
      const monthParam = loadMonth === undefined ? monthOptions[monthOptions.length - 1]?.value : loadMonth
      const [d, ls] = await Promise.all([
        fetchDriver(driverId),
        fetchDriverLoads(driverId, monthParam === 'YTD' ? undefined : monthParam),
      ])
      setDriver(d)
      setLoads(ls)
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load driver')
    } finally {
      setLoading(false)
    }
  }, [driverId, loadMonth])

  useEffect(() => {
    refresh()
    const unsub = navigation.addListener('focus', refresh)
    return unsub
  }, [refresh, navigation])

  if (loading || !driver) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#1D9E75" size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    )
  }

  const target = driver.targetRPM
  const active = driver.cycle

  // Home date display
  const homeDateStr = active
    ? new Date(active.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  async function saveHomeDate() {
    setShowHomePicker(false)
    try {
      if (active) {
        await updateCycleEnd(driverId, homePickerDate.toISOString())
      } else {
        const daysOut = Math.max(1, Math.ceil((homePickerDate.getTime() - Date.now()) / 86_400_000))
        await startNewCycle(driverId, { daysOut })
      }
      refresh()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  function handleHomeDateChange(_: any, date?: Date) {
    if (Platform.OS !== 'ios') {
      // Android: picker auto-dismisses, save immediately
      setShowHomePicker(false)
      if (date) {
        setHomePickerDate(date)
        // Save after state update via a microtask
        setTimeout(async () => {
          try {
            if (active) {
              await updateCycleEnd(driverId, date.toISOString())
            } else {
              const daysOut = Math.max(1, Math.ceil((date.getTime() - Date.now()) / 86_400_000))
              await startNewCycle(driverId, { daysOut })
            }
            refresh()
          } catch (err: any) {
            Alert.alert('Error', err.message)
          }
        }, 0)
      }
    } else {
      // iOS inline: just update the preview date, user must tap Save
      if (date) setHomePickerDate(date)
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>{driver.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Identity — tap to edit */}
        <TouchableOpacity style={s.card} onPress={() => setEditDriverOpen(true)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Driver Details</Text>
            <Text style={{ color: '#1D9E75', fontSize: 12, fontWeight: '500' }}>Edit</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Truck</Text>
            <Text style={s.value}>{driver.truckNumber ? `#${driver.truckNumber}` : '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Trailer</Text>
            <Text style={s.value}>
              {driver.trailerType || '—'}
              {driver.trailerNumber ? ` · #${driver.trailerNumber}` : ''}
            </Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Home Base</Text>
            <Text style={s.value}>{driver.homeBase || '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Status</Text>
            <View style={[s.badge, { backgroundColor: statusColor(driver.status) + '22', borderColor: statusColor(driver.status) }]}>
              <Text style={[s.badgeText, { color: statusColor(driver.status) }]}>{statusLabel(driver.status)}</Text>
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Target RPM</Text>
            <Text style={s.value}>${target.toFixed(2)}</Text>
          </View>
        </TouchableOpacity>

        {/* Financials link */}
        <TouchableOpacity
          style={s.financialsBtn}
          onPress={() => navigation.navigate('DriverFinancials', { driverId, driverName: driver.name })}
        >
          <Text style={s.financialsBtnText}>Financials</Text>
        </TouchableOpacity>

        {/* Home by date — replaces old cycle section */}
        <View style={s.homeRow}>
          <Text style={s.homeLabel}>Home by</Text>
          <TouchableOpacity
            style={s.homeDateBtn}
            onPress={() => {
              setHomePickerDate(active ? new Date(active.endDate) : new Date(Date.now() + 17 * 86_400_000))
              setShowHomePicker(true)
            }}
          >
            <Text style={s.homeDateText}>{homeDateStr || 'Set date'}</Text>
            <Calendar size={16} color="#1D9E75" />
          </TouchableOpacity>
        </View>

        {showHomePicker && Platform.OS !== 'ios' && (
          <DateTimePicker
            value={homePickerDate}
            mode="date"
            display="default"
            onChange={handleHomeDateChange}
            themeVariant="dark"
          />
        )}

        {showHomePicker && Platform.OS === 'ios' && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setShowHomePicker(false)}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}
              activeOpacity={1}
              onPress={() => setShowHomePicker(false)}
            >
              <TouchableOpacity activeOpacity={1} style={{ backgroundColor: '#1A1D21', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, borderTopWidth: 1, borderColor: '#2D3035' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <TouchableOpacity onPress={() => setShowHomePicker(false)}>
                    <Text style={{ color: '#6B7280', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveHomeDate}>
                    <Text style={{ color: '#1D9E75', fontSize: 15, fontWeight: '700' }}>Save</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={homePickerDate}
                  mode="date"
                  display="inline"
                  onChange={handleHomeDateChange}
                  themeVariant="dark"
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        )}

        {/* Loads */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          <Text style={s.sectionLabel}>Load History</Text>
          <TouchableOpacity
            style={s.addLoadBtn}
            onPress={() => navigation.navigate('RateConUpload', { driverId })}
          >
            <Text style={s.addLoadText}>+ Add Load</Text>
          </TouchableOpacity>
        </View>

        {/* Month filter pills — YTD then oldest to newest */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <TouchableOpacity
            style={[s.monthPill, loadMonth === 'YTD' && s.monthPillActive]}
            onPress={() => setLoadMonth('YTD')}
          >
            <Text style={[s.monthPillText, loadMonth === 'YTD' && s.monthPillTextActive]}>YTD</Text>
          </TouchableOpacity>
          {monthOptions.map((mo) => (
            <TouchableOpacity
              key={mo.value}
              style={[s.monthPill, currentMonthValue === mo.value && loadMonth !== 'YTD' && s.monthPillActive]}
              onPress={() => setLoadMonth(mo.value)}
            >
              <Text style={[s.monthPillText, currentMonthValue === mo.value && loadMonth !== 'YTD' && s.monthPillTextActive]}>{mo.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loads.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>No loads yet</Text>
            <Text style={s.emptySub}>Upload a rate con to get started</Text>
          </View>
        ) : (
          loads.map((ld) => {
            const r = rpm(ld)
            const rpmColor = r == null ? '#6B7280' : r >= target ? '#4ADE80' : '#F87171'
            return (
              <TouchableOpacity
                key={ld.id}
                style={s.loadCard}
                onPress={() => navigation.navigate('LoadDetail', { loadId: ld.id })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={s.loadNum}>#{ld.loadNumber || ld.id.substring(0, 8)}</Text>
                  <Text style={[s.loadRpm, { color: rpmColor }]}>
                    {r != null ? `$${r.toFixed(2)}/mi` : '—'}
                  </Text>
                </View>
                <Text style={s.loadRoute}>
                  {ld.pickupCity && ld.pickupState ? `${ld.pickupCity}, ${ld.pickupState}` : '—'}
                  {' → '}
                  {ld.dropoffCity && ld.dropoffState ? `${ld.dropoffCity}, ${ld.dropoffState}` : '—'}
                </Text>
                <View style={s.loadMeta}>
                  <Text style={s.loadMetaItem}>{fmtDateTime(ld.pickupTime)} pick</Text>
                  <Text style={s.loadMetaItem}>{fmtDateTime(ld.deliveryTime)} drop</Text>
                </View>
                <View style={s.loadMeta}>
                  <Text style={s.loadMetaItem}>Rate: ${ld.rate?.toLocaleString() || '—'}</Text>
                  <Text style={s.loadMetaItem}>Miles: {ld.loadedMiles ?? '—'}</Text>
                  <Text style={s.loadMetaItem}>DH: {ld.deadheadMiles ?? '—'}</Text>
                </View>
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>

      <EditDriverModal
        visible={editDriverOpen}
        onClose={() => setEditDriverOpen(false)}
        driver={driver}
        driverId={driverId}
        onSaved={() => { setEditDriverOpen(false); refresh() }}
      />
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Edit driver modal — now includes Full Name as first field
// ---------------------------------------------------------------------------

function EditDriverModal({ visible, onClose, driver, driverId, onSaved }: {
  visible: boolean; onClose: () => void; driver: DispatcherDriver; driverId: string; onSaved: () => void;
}) {
  const [name, setName] = useState(driver.name || '')
  const [truckNumber, setTruckNumber] = useState(driver.truckNumber || '')
  const [trailerType, setTrailerType] = useState(driver.trailerType || '')
  const [trailerNumber, setTrailerNumber] = useState(driver.trailerNumber || '')
  const [homeBase, setHomeBase] = useState(driver.homeBase || '')
  const [targetRPM, setTargetRPM] = useState(String(driver.targetRPM ?? 1.86))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setName(driver.name || '')
      setTruckNumber(driver.truckNumber || '')
      setTrailerType(driver.trailerType || '')
      setTrailerNumber(driver.trailerNumber || '')
      setHomeBase(driver.homeBase || '')
      setTargetRPM(String(driver.targetRPM ?? 1.86))
    }
  }, [visible, driver])

  async function save() {
    setSaving(true)
    try {
      await updateDriver(driverId, {
        name: name.trim() || undefined,
        truckNumber: truckNumber || undefined,
        trailerType: trailerType || undefined,
        trailerNumber: trailerNumber || undefined,
        homeBase: homeBase || undefined,
        targetRPM: parseFloat(targetRPM) || 1.86,
      })
      onSaved()
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save')
    }
    setSaving(false)
  }

  const TRAILER_OPTIONS = ['REEFER', 'DRY_VAN'] as const

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={modal.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={modal.sheet}>
          <Text style={modal.title}>Edit Driver</Text>
          <Text style={modal.fieldLabel}>Full Name</Text>
          <TextInput style={modal.input} value={name} onChangeText={setName} placeholder="Driver name" placeholderTextColor="#6B7280" />
          <Text style={modal.fieldLabel}>Truck #</Text>
          <TextInput style={modal.input} value={truckNumber} onChangeText={setTruckNumber} placeholder="e.g. 106" placeholderTextColor="#6B7280" />
          <Text style={modal.fieldLabel}>Trailer Type</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TRAILER_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[modal.toggleBtn, trailerType === opt && modal.toggleBtnActive]}
                onPress={() => setTrailerType(opt)}
              >
                <Text style={[modal.toggleBtnText, trailerType === opt && modal.toggleBtnTextActive]}>{opt.replace('_', ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={modal.fieldLabel}>Trailer #</Text>
          <TextInput style={modal.input} value={trailerNumber} onChangeText={setTrailerNumber} placeholder="e.g. 170570" placeholderTextColor="#6B7280" />
          <Text style={modal.fieldLabel}>Home Base</Text>
          <TextInput style={modal.input} value={homeBase} onChangeText={setHomeBase} placeholder="Dallas, TX" placeholderTextColor="#6B7280" />
          <Text style={modal.fieldLabel}>Target RPM ($)</Text>
          <TextInput style={modal.input} value={targetRPM} onChangeText={setTargetRPM} placeholder="1.86" placeholderTextColor="#6B7280" keyboardType="numeric" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity style={modal.btnCancel} onPress={onClose}>
              <Text style={modal.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modal.btnSave} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={modal.btnSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  financialsBtn: { backgroundColor: '#1D9E7522', borderWidth: 1, borderColor: '#1D9E75', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 16 },
  financialsBtnText: { color: '#1D9E75', fontSize: 13, fontWeight: '600' },

  sectionLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { color: '#6B7280', fontSize: 13 },
  value: { color: '#E5E7EB', fontSize: 13, fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  homeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginTop: 16 },
  homeLabel: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  homeDateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeDateText: { color: '#E5E7EB', fontSize: 15, fontWeight: '600' },

  addLoadBtn: { borderWidth: 1, borderColor: '#1D9E75', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  addLoadText: { color: '#1D9E75', fontSize: 12, fontWeight: '600' },

  emptyCard: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 24, alignItems: 'center' },
  emptyText: { color: '#9CA3AF', fontSize: 14, fontWeight: '600' },
  emptySub: { color: '#6B7280', fontSize: 12, marginTop: 4 },

  monthPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#161920', marginRight: 8, borderWidth: 1, borderColor: '#1E2128' },
  monthPillActive: { backgroundColor: '#1D9E7522', borderColor: '#1D9E75' },
  monthPillText: { color: '#6B7280', fontSize: 13, fontWeight: '600' },
  monthPillTextActive: { color: '#1D9E75' },

  loadCard: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 12, marginBottom: 8 },
  loadNum: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  loadRpm: { fontSize: 14, fontWeight: '700' },
  loadRoute: { color: '#E5E7EB', fontSize: 13, marginTop: 4 },
  loadMeta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  loadMetaItem: { color: '#6B7280', fontSize: 11 },
})

const modal = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A1D21', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, borderTopWidth: 1, borderColor: '#2D3035' },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  fieldLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#111214', borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 12, color: '#FFF', fontSize: 14 },
  toggleBtn: { flex: 1, borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 12, alignItems: 'center' as const, backgroundColor: '#111214' },
  toggleBtnActive: { borderColor: '#1D9E75', backgroundColor: '#0F2A1A' },
  toggleBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' as const },
  toggleBtnTextActive: { color: '#FFF' },
  btnCancel: { flex: 1, borderWidth: 1, borderColor: '#6B7280', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnCancelText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
  btnSave: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnSaveText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
})
