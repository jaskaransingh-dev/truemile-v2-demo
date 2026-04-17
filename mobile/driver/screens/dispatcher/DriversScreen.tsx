import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl,
  StyleSheet, SafeAreaView, Linking, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '../../lib/supabase'
import { fetchDrivers, updateDriver, createDriver, updateCycleEnd, type DispatcherDriver } from '../../lib/dispatcher-api'
import { statusLabel, statusColor } from '../../lib/dispatcher-status'
import { clearRole } from '../../lib/role'

const GREEN = '#1D9E75'
const RED = '#EF4444'
const MUTED = '#6B7280'

const TODAY = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function formatEmpty(d: DispatcherDriver): string {
  if (!d.emptyLocation && !d.emptyTime) return 'No active load'
  if (d.emptyTime) {
    const dt = new Date(d.emptyTime)
    const when = dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
      + ' · ' + dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `${d.emptyLocation || '—'} · ${when}`
  }
  return d.emptyLocation || '—'
}

function cycleHomeText(d: DispatcherDriver): { text: string; color: string } {
  if (!d.cycle) return { text: 'No home date set', color: MUTED }
  const endDate = new Date(d.cycle.endDate)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const endDay = new Date(endDate)
  endDay.setHours(0, 0, 0, 0)
  const diffMs = endDay.getTime() - now.getTime()
  const daysRemaining = Math.ceil(diffMs / 86_400_000)

  const dateStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (daysRemaining < 0) return { text: `Home by ${dateStr} · OVERDUE`, color: RED }
  if (daysRemaining <= 2) return { text: `Home by ${dateStr}`, color: RED }
  return { text: `Home by ${dateStr}`, color: '#E5E7EB' }
}

export default function DriversScreen({ navigation }: any) {
  const [drivers, setDrivers] = useState<DispatcherDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit name state
  const [editNameDriver, setEditNameDriver] = useState<DispatcherDriver | null>(null)
  const [editNameValue, setEditNameValue] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Add driver state
  const [addDriverOpen, setAddDriverOpen] = useState(false)

  // Cycle date picker state
  const [cyclePickerDriver, setCyclePickerDriver] = useState<DispatcherDriver | null>(null)
  const [cyclePickerDate, setCyclePickerDate] = useState(new Date())

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await fetchDrivers()
      setDrivers(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load drivers')
    }
  }, [])

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

  async function handleLogout() {
    await supabase.auth.signOut()
    await SecureStore.deleteItemAsync('session')
    await clearRole()
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  async function saveDriverName() {
    if (!editNameDriver || !editNameValue.trim()) return
    setSavingName(true)
    try {
      await updateDriver(editNameDriver.id, { name: editNameValue.trim() })
      setEditNameDriver(null)
      load()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
    setSavingName(false)
  }

  async function saveCycleEnd() {
    if (!cyclePickerDriver) return
    try {
      await updateCycleEnd(cyclePickerDriver.id, cyclePickerDate.toISOString())
      setCyclePickerDriver(null)
      load()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  function openDAT(location: string) {
    Linking.openURL(`https://one.dat.com/search-loads?origin=${encodeURIComponent(location)}`)
  }

  function renderDriver({ item }: { item: DispatcherDriver }) {
    const home = cycleHomeText(item)

    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => navigation.navigate('DriverDetail', { driverId: item.id })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              onLongPress={() => { setEditNameDriver(item); setEditNameValue(item.name) }}
            >
              <Text style={s.driverName}>{item.name}</Text>
            </TouchableOpacity>
            {item.truckNumber ? <Text style={s.driverMeta}>Truck #{item.truckNumber}</Text> : null}
          </View>
          <View style={[s.badge, { backgroundColor: statusColor(item.status) + '22', borderColor: statusColor(item.status) }]}>
            <Text style={[s.badgeText, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
          </View>
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Current</Text>
          <Text style={[s.metaValue, !item.currentLocation && s.metaMuted]}>
            {item.currentLocation || 'Location unknown'}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Empty</Text>
          <Text style={[s.metaValue, !item.emptyLocation && s.metaMuted]}>{formatEmpty(item)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Home</Text>
          <TouchableOpacity
            onPress={() => {
              if (item.cycle) {
                setCyclePickerDriver(item)
                setCyclePickerDate(new Date(item.cycle.endDate))
              } else {
                navigation.navigate('DriverDetail', { driverId: item.id })
              }
            }}
          >
            <Text style={[s.metaValue, { color: home.color, textAlign: 'right' }]}>{home.text}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.btnRow}>
          <TouchableOpacity
            style={[s.actionBtn, { borderColor: GREEN, opacity: item.currentLocation ? 1 : 0.4 }]}
            onPress={(e) => { e.stopPropagation(); if (item.currentLocation) openDAT(item.currentLocation) }}
            disabled={!item.currentLocation}
          >
            <Text style={[s.actionBtnText, { color: GREEN }]}>Find Load</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { borderColor: '#6B7280' }]}
            onPress={(e) => { e.stopPropagation(); navigation.navigate('DispatcherChat', { driver: item }) }}
          >
            <Text style={[s.actionBtnText, { color: '#9CA3AF' }]}>Chat</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={s.container}>
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
        <ActivityIndicator color={GREEN} size="large" style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={s.emptyState}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : drivers.length === 0 ? (
        <View style={s.emptyState}><Text style={s.emptyText}>No drivers available</Text></View>
      ) : (
        <FlatList
          data={drivers}
          keyExtractor={(item) => item.id}
          renderItem={renderDriver}
          contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
          ListFooterComponent={
            <TouchableOpacity style={s.addDriverBtn} onPress={() => setAddDriverOpen(true)}>
              <Text style={s.addDriverText}>+ Add Driver</Text>
            </TouchableOpacity>
          }
        />
      )}

      {/* Edit Name Modal */}
      <Modal visible={!!editNameDriver} transparent animationType="fade" onRequestClose={() => setEditNameDriver(null)}>
        <KeyboardAvoidingView style={modal.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={modal.sheet}>
            <Text style={modal.title}>Edit Driver Name</Text>
            <TextInput
              style={modal.input}
              value={editNameValue}
              onChangeText={setEditNameValue}
              autoFocus
              placeholder="Driver name"
              placeholderTextColor={MUTED}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity style={modal.btnCancel} onPress={() => setEditNameDriver(null)}>
                <Text style={modal.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={modal.btnSave} onPress={saveDriverName} disabled={savingName}>
                {savingName ? <ActivityIndicator color="#FFF" /> : <Text style={modal.btnSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add Driver Modal */}
      <AddDriverModal
        visible={addDriverOpen}
        onClose={() => setAddDriverOpen(false)}
        onSaved={() => { setAddDriverOpen(false); load() }}
      />

      {/* Cycle End Date Picker */}
      {cyclePickerDriver && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCyclePickerDriver(null)}>
          <View style={modal.backdrop}>
            <View style={modal.sheet}>
              <Text style={modal.title}>Set Home Date — {cyclePickerDriver.name}</Text>
              <DateTimePicker
                value={cyclePickerDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => { if (d) setCyclePickerDate(d) }}
                themeVariant="dark"
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <TouchableOpacity style={modal.btnCancel} onPress={() => setCyclePickerDriver(null)}>
                  <Text style={modal.btnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={modal.btnSave} onPress={saveCycleEnd}>
                  <Text style={modal.btnSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Add Driver Modal
// ---------------------------------------------------------------------------

function AddDriverModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [trailerType, setTrailerType] = useState('REEFER')
  const [trailerNumber, setTrailerNumber] = useState('')
  const [homeBase, setHomeBase] = useState('')
  const [targetRPM, setTargetRPM] = useState('1.86')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setName(''); setPhone(''); setTruckNumber(''); setTrailerType('REEFER')
      setTrailerNumber(''); setHomeBase(''); setTargetRPM('1.86')
    }
  }, [visible])

  async function save() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Required', 'Name and phone number are required')
      return
    }
    setSaving(true)
    try {
      await createDriver({
        name: name.trim(),
        phoneNumber: phone.trim(),
        truckNumber: truckNumber || undefined,
        trailerNumber: trailerNumber || undefined,
        trailerType: trailerType || undefined,
        homeBase: homeBase || undefined,
        targetRPM: parseFloat(targetRPM) || 1.86,
      })
      onSaved()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
    setSaving(false)
  }

  const TRAILER_OPTIONS = ['REEFER', 'DRY_VAN'] as const

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={modal.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={modal.sheet}>
          <Text style={modal.title}>Add Driver</Text>

          <Text style={modal.fieldLabel}>Full Name *</Text>
          <TextInput style={modal.input} value={name} onChangeText={setName} placeholder="e.g. Max Dhanani" placeholderTextColor={MUTED} autoFocus />

          <Text style={modal.fieldLabel}>Phone Number *</Text>
          <TextInput style={modal.input} value={phone} onChangeText={setPhone} placeholder="469-555-1234" placeholderTextColor={MUTED} keyboardType="phone-pad" />

          <Text style={modal.fieldLabel}>Truck #</Text>
          <TextInput style={modal.input} value={truckNumber} onChangeText={setTruckNumber} placeholder="e.g. 106" placeholderTextColor={MUTED} />

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
          <TextInput style={modal.input} value={trailerNumber} onChangeText={setTrailerNumber} placeholder="e.g. 170570" placeholderTextColor={MUTED} />

          <Text style={modal.fieldLabel}>Home Base</Text>
          <TextInput style={modal.input} value={homeBase} onChangeText={setHomeBase} placeholder="Dallas, TX" placeholderTextColor={MUTED} />

          <Text style={modal.fieldLabel}>Target RPM ($)</Text>
          <TextInput style={modal.input} value={targetRPM} onChangeText={setTargetRPM} placeholder="1.86" placeholderTextColor={MUTED} keyboardType="numeric" />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity style={modal.btnCancel} onPress={onClose}>
              <Text style={modal.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modal.btnSave} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={modal.btnSaveText}>Add Driver</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  logo: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  logoAccent: { color: GREEN },
  sub: { fontSize: 12, color: MUTED, marginTop: 2 },
  date: { fontSize: 12, color: MUTED },
  logoutBtn: { borderWidth: 1, borderColor: '#2D3035', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 10 },
  logoutText: { fontSize: 11, color: '#9CA3AF' },

  statsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  statCard: { flex: 1, backgroundColor: '#111419', borderWidth: 1, borderColor: '#1E2128', borderRadius: 8, padding: 12 },
  statLabel: { fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '700', color: '#FFF' },

  row: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginBottom: 10 },
  driverName: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  driverMeta: { fontSize: 11, color: MUTED, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  metaLabel: { fontSize: 12, color: MUTED },
  metaValue: { fontSize: 12, color: '#E5E7EB', fontWeight: '500', flex: 1, textAlign: 'right' },
  metaMuted: { color: MUTED, fontStyle: 'italic' },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 8, alignItems: 'center' },
  actionBtnText: { fontSize: 12, fontWeight: '600' },

  addDriverBtn: { borderWidth: 1, borderColor: GREEN, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  addDriverText: { color: GREEN, fontSize: 14, fontWeight: '600' },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: MUTED, fontSize: 14 },
  errorText: { color: '#F87171', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retryText: { color: GREEN, fontSize: 14, fontWeight: '600' },
})

const modal = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A1D21', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, borderTopWidth: 1, borderColor: '#2D3035' },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  fieldLabel: { color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#111214', borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 12, color: '#FFF', fontSize: 14 },
  toggleBtn: { flex: 1, borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 12, alignItems: 'center' as const, backgroundColor: '#111214' },
  toggleBtnActive: { borderColor: GREEN, backgroundColor: '#0F2A1A' },
  toggleBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' as const },
  toggleBtnTextActive: { color: '#FFF' },
  btnCancel: { flex: 1, borderWidth: 1, borderColor: MUTED, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnCancelText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
  btnSave: { flex: 1, backgroundColor: GREEN, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnSaveText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
})
