import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl,
  StyleSheet, SafeAreaView, ActivityIndicator, ScrollView,
} from 'react-native'
import { ArrowLeft, ChevronDown, ChevronRight, Plus } from 'lucide-react-native'
import {
  fetchDriverKpis, fetchDriverLoads, fetchDriverExpenses,
  type DriverKpis, type DispatchLoad, type FleetExpense,
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

function getMonthOptions(): { label: string; value: string }[] {
  const now = new Date()
  const year = now.getFullYear()
  const currentMonth = now.getMonth()
  const options: { label: string; value: string }[] = []
  for (let m = 0; m <= currentMonth; m++) {
    const val = `${year}-${String(m + 1).padStart(2, '0')}`
    options.push({ label: monthLabel(val), value: val })
  }
  return options.reverse()
}

function rpmOf(load: DispatchLoad): number | null {
  if (!load.rate || !load.loadedMiles) return null
  return load.rate / load.loadedMiles
}

export default function DriverFinancialsScreen({ route, navigation }: any) {
  const { driverId, driverName } = route.params
  const [kpis, setKpis] = useState<DriverKpis | null>(null)
  const [loads, setLoads] = useState<DispatchLoad[]>([])
  const [expenses, setExpenses] = useState<FleetExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ FIXED: false, VARIABLE: false, DRIVER_PAY: false })

  const monthOptions = getMonthOptions()
  const currentMonthValue = selectedMonth || monthOptions[0]?.value

  const load = useCallback(async () => {
    try {
      const [k, l, e] = await Promise.all([
        fetchDriverKpis(driverId, currentMonthValue),
        fetchDriverLoads(driverId),
        fetchDriverExpenses(driverId, currentMonthValue),
      ])
      setKpis(k)
      setLoads(l)
      setExpenses(e)
    } catch (err: any) {
      console.warn('Failed to load driver financials:', err.message)
    }
  }, [driverId, currentMonthValue])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function toggleGroup(type: string) {
    setExpandedGroups((prev) => ({ ...prev, [type]: !prev[type] }))
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <ArrowLeft size={20} color={WHITE} />
          </TouchableOpacity>
          <Text style={s.title}>{driverName}</Text>
        </View>

        {/* Month pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.monthRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <TouchableOpacity
            style={[s.monthPill, !selectedMonth && s.monthPillActive]}
            onPress={() => setSelectedMonth(undefined)}
          >
            <Text style={[s.monthPillText, !selectedMonth && s.monthPillTextActive]}>YTD</Text>
          </TouchableOpacity>
          {monthOptions.map((m) => (
            <TouchableOpacity
              key={m.value}
              style={[s.monthPill, selectedMonth === m.value && s.monthPillActive]}
              onPress={() => setSelectedMonth(m.value)}
            >
              <Text style={[s.monthPillText, selectedMonth === m.value && s.monthPillTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* KPI Cards */}
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
              <Text style={s.kpiLabel}>Miles</Text>
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
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Net Profit</Text>
              <Text style={[s.kpiValue, { color: kpis.netProfit >= 0 ? GREEN : RED }]}>{fmtMoney(kpis.netProfit)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>Margin</Text>
              <Text style={[s.kpiValue, { color: kpis.profitMargin >= 0 ? GREEN : RED }]}>{kpis.profitMargin}%</Text>
            </View>
          </View>
        )}

        {/* Load History */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Load History ({loads.length})</Text>
          {loads.map((ld) => {
            const rpm = rpmOf(ld)
            return (
              <TouchableOpacity
                key={ld.id}
                style={s.loadRow}
                onPress={() => navigation.navigate('LoadDetail', { loadId: ld.id })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.loadRoute}>
                    {ld.pickupCity}, {ld.pickupState} → {ld.dropoffCity}, {ld.dropoffState}
                  </Text>
                  <Text style={s.loadMeta}>
                    {ld.loadNumber || '—'}  ·  {ld.loadedMiles ? Math.round(ld.loadedMiles) + ' mi' : '—'}
                    {ld.deadheadMiles ? `  ·  ${Math.round(ld.deadheadMiles)} DH` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.loadRate}>${ld.rate?.toLocaleString() || '—'}</Text>
                  {rpm !== null && <Text style={[s.loadRPM, { color: rpm >= 1.86 ? GREEN : RED }]}>${rpm.toFixed(2)}/mi</Text>}
                </View>
              </TouchableOpacity>
            )
          })}
          {loads.length === 0 && <Text style={s.emptyText}>No loads for this period</Text>}
        </View>

        {/* Driver Expenses */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Expenses</Text>
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
                    onPress={() => navigation.navigate('AddExpense', { type, month: currentMonthValue, driverId })}
                  >
                    <Plus size={14} color={GREEN} />
                    <Text style={s.addExpenseText}>Add Expense</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 12 },
  backBtn: { padding: 4 },
  title: { color: WHITE, fontSize: 20, fontWeight: '700' },
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
  loadRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  loadRoute: { color: WHITE, fontSize: 13, fontWeight: '600' },
  loadMeta: { color: MUTED, fontSize: 11, marginTop: 2 },
  loadRate: { color: WHITE, fontSize: 14, fontWeight: '700' },
  loadRPM: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  emptyText: { color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 6 },
  groupLabel: { color: WHITE, fontSize: 14, fontWeight: '600', flex: 1 },
  groupTotal: { color: MUTED, fontSize: 13, fontWeight: '600' },
  expenseRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: BORDER },
  expenseName: { color: WHITE, fontSize: 13 },
  expenseAmount: { color: WHITE, fontSize: 13, fontWeight: '600' },
  addExpenseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 22 },
  addExpenseText: { color: GREEN, fontSize: 13, fontWeight: '600' },
})
