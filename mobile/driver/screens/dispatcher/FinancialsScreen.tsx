import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, RefreshControl,
  StyleSheet, SafeAreaView, ActivityIndicator, ScrollView, Alert, TextInput,
} from 'react-native'
import { Settings, Upload, Plus, ChevronDown, ChevronRight } from 'lucide-react-native'
import {
  fetchFleetKpis, fetchFleetExpenses, fetchFleetSettings, updateFleetSettings,
  seedExpenseCategories,
  type FleetKpis, type FleetExpense, type FleetSettings,
} from '../../lib/dispatcher-api'

const GREEN = '#1D9E75'
const RED = '#EF4444'
const BG = '#0D0F12'
const CARD = '#161920'
const BORDER = '#1E2128'
const MUTED = '#6B7280'
const WHITE = '#F3F4F6'

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return '$' + n.toLocaleString()
}

function monthLabel(m: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, mo] = m.split('-')
  return months[parseInt(mo) - 1] || mo
}

// Returns months oldest → newest (Jan, Feb, Mar, Apr)
function getMonthOptions(): { label: string; value: string }[] {
  const now = new Date()
  const year = now.getFullYear()
  const currentMonth = now.getMonth()
  const options: { label: string; value: string }[] = []
  for (let m = 0; m <= currentMonth; m++) {
    const val = `${year}-${String(m + 1).padStart(2, '0')}`
    options.push({ label: monthLabel(val), value: val })
  }
  return options
}

export default function FinancialsScreen({ navigation }: any) {
  const [kpis, setKpis] = useState<FleetKpis | null>(null)
  const [expenses, setExpenses] = useState<FleetExpense[]>([])
  const [settings, setSettings] = useState<FleetSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined) // undefined = current month
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ FIXED: false, VARIABLE: false, DRIVER_PAY: false })
  const [editingFactoring, setEditingFactoring] = useState(false)
  const [factoringInput, setFactoringInput] = useState('')

  const monthOptions = getMonthOptions()
  // Default to current month (last item since list is oldest→newest)
  const currentMonthValue = selectedMonth || monthOptions[monthOptions.length - 1]?.value

  const load = useCallback(async () => {
    try {
      const [k, e, s] = await Promise.all([
        fetchFleetKpis(currentMonthValue),
        fetchFleetExpenses(currentMonthValue),
        fetchFleetSettings(),
      ])
      setKpis(k)
      setExpenses(e)
      setSettings(s)

      // Auto-seed categories if none exist
      if (e.length === 0 && k.totalLoads === 0) {
        try { await seedExpenseCategories() } catch {}
      }
    } catch (err: any) {
      console.warn('Failed to load financials:', err.message)
    }
  }, [currentMonthValue])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { load() })
    return unsub
  }, [navigation, load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function toggleGroup(type: string) {
    setExpandedGroups((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  async function saveFactoringRate() {
    const rate = parseFloat(factoringInput)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      Alert.alert('Invalid rate', 'Enter a percentage between 0 and 100')
      return
    }
    try {
      const s = await updateFleetSettings({ factoringRate: rate / 100 })
      setSettings(s)
      setEditingFactoring(false)
      load()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  // Group expenses by category type
  const grouped: Record<string, { total: number; items: FleetExpense[] }> = { FIXED: { total: 0, items: [] }, VARIABLE: { total: 0, items: [] }, DRIVER_PAY: { total: 0, items: [] } }
  for (const e of expenses) {
    const t = e.category.type
    if (grouped[t]) {
      grouped[t].items.push(e)
      grouped[t].total += e.amount
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Financials</Text>
            <TouchableOpacity
              onPress={() => {
                if (editingFactoring) return
                setFactoringInput(((settings?.factoringRate ?? 0.022) * 100).toFixed(1))
                setEditingFactoring(true)
              }}
            >
              {editingFactoring ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.factoringLabel}>Factoring:</Text>
                  <TextInput
                    style={s.factoringInput}
                    value={factoringInput}
                    onChangeText={setFactoringInput}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                  <Text style={s.factoringLabel}>%</Text>
                  <TouchableOpacity onPress={saveFactoringRate}>
                    <Text style={[s.factoringLabel, { color: GREEN }]}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditingFactoring(false)}>
                    <Text style={[s.factoringLabel, { color: RED }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={s.factoringLabel}>Factoring: {((settings?.factoringRate ?? 0.022) * 100).toFixed(1)}%</Text>
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('ManageCategories')} style={s.gearBtn}>
            <Settings size={20} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Month pills — YTD then oldest to newest */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.monthRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <TouchableOpacity
            style={[s.monthPill, !selectedMonth && s.monthPillActive]}
            onPress={() => setSelectedMonth(undefined)}
          >
            <Text style={[s.monthPillText, !selectedMonth && s.monthPillTextActive]}>YTD</Text>
          </TouchableOpacity>
          {monthOptions.map((mo) => (
            <TouchableOpacity
              key={mo.value}
              style={[s.monthPill, selectedMonth === mo.value && s.monthPillActive]}
              onPress={() => setSelectedMonth(mo.value)}
            >
              <Text style={[s.monthPillText, selectedMonth === mo.value && s.monthPillTextActive]}>{mo.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* KPI Cards — 6 cards, 2 columns × 3 rows */}
        {kpis && (
          <View style={s.kpiGrid}>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Revenue</Text>
              <Text style={s.kpiValue}>{fmtMoney(kpis.revenue)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Avg RPM</Text>
              <Text style={s.kpiValue}>${kpis.avgRPM.toFixed(2)}</Text>
            </View>

            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Miles Driven</Text>
              <Text style={s.kpiValue}>{kpis.totalMiles.toLocaleString()}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Utilization</Text>
              <Text style={s.kpiValue}>{kpis.utilization}%</Text>
            </View>

            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Fuel %</Text>
              <Text style={s.kpiValue}>{kpis.fuelPercent}%</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>CPM</Text>
              <Text style={s.kpiValue}>${kpis.cpm.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Driver Breakdown */}
        {kpis && kpis.drivers.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Driver Breakdown</Text>
            {kpis.drivers.map((d) => (
              <TouchableOpacity
                key={d.driverId}
                style={s.driverRow}
                onPress={() => navigation.navigate('DriverFinancials', { driverId: d.driverId, driverName: d.name })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.driverName}>{d.name}</Text>
                  <Text style={s.driverMeta}>{d.loads} loads  ·  {d.loadedMiles.toLocaleString()} mi</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.driverRevenue}>{fmtMoney(d.revenue)}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={[s.driverRPM, { color: d.avgRPM >= d.targetRPM ? GREEN : RED }]}>${d.avgRPM.toFixed(2)}/mi</Text>
                    <Text style={[s.driverMargin, { color: d.profitMargin >= 0 ? GREEN : RED }]}>{d.profitMargin.toFixed(0)}%</Text>
                  </View>
                </View>
                <ChevronRight size={16} color={MUTED} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Fleet Expense Summary */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>
            Expenses · {fmtMoney((kpis?.totalExpenses ?? 0))}
          </Text>

          {(['FIXED', 'VARIABLE', 'DRIVER_PAY'] as const).map((type) => {
            const group = grouped[type]
            const label = type === 'DRIVER_PAY' ? 'Driver Pay' : type.charAt(0) + type.slice(1).toLowerCase()
            const isOpen = expandedGroups[type]
            return (
              <View key={type}>
                <TouchableOpacity style={s.groupHeader} onPress={() => toggleGroup(type)}>
                  {isOpen ? <ChevronDown size={16} color={MUTED} /> : <ChevronRight size={16} color={MUTED} />}
                  <Text style={s.groupLabel}>{label}</Text>
                  <Text style={s.groupTotal}>{fmtMoney(group.total)}</Text>
                </TouchableOpacity>
                {isOpen && group.items.map((e) => (
                  <View key={e.id} style={s.expenseRow}>
                    <Text style={s.expenseName}>{e.category.name}</Text>
                    <Text style={s.expenseAmount}>${e.amount.toLocaleString()}</Text>
                  </View>
                ))}
                {isOpen && (
                  <TouchableOpacity
                    style={s.addExpenseBtn}
                    onPress={() => navigation.navigate('AddExpense', { type, month: currentMonthValue })}
                  >
                    <Plus size={14} color={GREEN} />
                    <Text style={s.addExpenseText}>Add Expense</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
        </View>

        {/* Upload Buttons */}
        <View style={s.uploadRow}>
          <TouchableOpacity
            style={s.uploadBtn}
            onPress={() => navigation.navigate('ExpenseUpload', { type: 'cc' })}
          >
            <Upload size={16} color={GREEN} />
            <Text style={s.uploadText}>Upload CC Statement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.uploadBtn}
            onPress={() => navigation.navigate('ExpenseUpload', { type: 'fuel' })}
          >
            <Upload size={16} color={GREEN} />
            <Text style={s.uploadText}>Upload Fuel Statement</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { color: WHITE, fontSize: 22, fontWeight: '700' },
  factoringLabel: { color: MUTED, fontSize: 12, marginTop: 2 },
  factoringInput: { color: WHITE, backgroundColor: CARD, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, width: 50, borderWidth: 1, borderColor: BORDER },
  gearBtn: { padding: 8 },
  monthRow: { marginBottom: 12 },
  monthPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: CARD, marginRight: 8, borderWidth: 1, borderColor: BORDER },
  monthPillActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  monthPillText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  monthPillTextActive: { color: GREEN },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  kpiCard: { backgroundColor: CARD, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BORDER, width: '47%' as any },
  kpiLabel: { color: MUTED, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  kpiValue: { color: WHITE, fontSize: 18, fontWeight: '700' },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { color: WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  driverRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  driverName: { color: WHITE, fontSize: 14, fontWeight: '600' },
  driverMeta: { color: MUTED, fontSize: 11, marginTop: 2 },
  driverRevenue: { color: WHITE, fontSize: 14, fontWeight: '700' },
  driverRPM: { fontSize: 12, fontWeight: '600' },
  driverMargin: { fontSize: 12, fontWeight: '600' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 6 },
  groupLabel: { color: WHITE, fontSize: 14, fontWeight: '600', flex: 1 },
  groupTotal: { color: MUTED, fontSize: 13, fontWeight: '600' },
  expenseRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: BORDER },
  expenseName: { color: WHITE, fontSize: 13 },
  expenseAmount: { color: WHITE, fontSize: 13, fontWeight: '600' },
  addExpenseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 22 },
  addExpenseText: { color: GREEN, fontSize: 13, fontWeight: '600' },
  uploadRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  uploadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: CARD, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BORDER },
  uploadText: { color: GREEN, fontSize: 12, fontWeight: '600' },
})
