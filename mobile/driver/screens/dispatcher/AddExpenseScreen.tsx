import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { ArrowLeft } from 'lucide-react-native'
import {
  fetchExpenseCategories, fetchDrivers, createExpense,
  type ExpenseCategory, type DispatcherDriver,
} from '../../lib/dispatcher-api'

const GREEN = '#1D9E75'
const RED = '#EF4444'
const BG = '#0D0F12'
const CARD = '#161920'
const BORDER = '#1E2128'
const MUTED = '#6B7280'
const WHITE = '#F3F4F6'

export default function AddExpenseScreen({ route, navigation }: any) {
  const { type: defaultType, month: defaultMonth, driverId: defaultDriverId } = route.params || {}

  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [drivers, setDrivers] = useState<DispatcherDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(defaultDriverId || null)
  const [month, setMonth] = useState(defaultMonth || new Date().toISOString().slice(0, 7))
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    Promise.all([fetchExpenseCategories(), fetchDrivers()])
      .then(([cats, drvs]) => {
        const activeCats = cats.filter((c) => c.active)
        setCategories(activeCats)
        setDrivers(drvs)
        // Pre-select first category of the given type
        if (defaultType) {
          const first = activeCats.find((c) => c.type === defaultType)
          if (first) setSelectedCategoryId(first.id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId)
  const showDriverPicker = selectedCategory?.scope === 'PER_DRIVER'

  async function handleSave() {
    if (!selectedCategoryId || !amount) {
      Alert.alert('Required', 'Select a category and enter an amount')
      return
    }
    setSaving(true)
    try {
      await createExpense({
        categoryId: selectedCategoryId,
        driverId: showDriverPicker ? (selectedDriverId || undefined) : undefined,
        month,
        amount: parseFloat(amount),
        notes: notes || undefined,
      })
      navigation.goBack()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} />
      </SafeAreaView>
    )
  }

  // Group categories by type
  const grouped: Record<string, ExpenseCategory[]> = {}
  for (const c of categories) {
    if (!grouped[c.type]) grouped[c.type] = []
    grouped[c.type].push(c)
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <ArrowLeft size={20} color={WHITE} />
          </TouchableOpacity>
          <Text style={s.title}>Add Expense</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16 }}>
          {/* Category selector */}
          <Text style={s.label}>Category</Text>
          {Object.entries(grouped).map(([type, cats]) => {
            const label = type === 'DRIVER_PAY' ? 'Driver Pay' : type.charAt(0) + type.slice(1).toLowerCase()
            return (
              <View key={type} style={{ marginBottom: 8 }}>
                <Text style={s.groupLabel}>{label}</Text>
                <View style={s.chipRow}>
                  {cats.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.chip, selectedCategoryId === c.id && s.chipActive]}
                      onPress={() => setSelectedCategoryId(c.id)}
                    >
                      <Text style={[s.chipText, selectedCategoryId === c.id && s.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )
          })}

          {/* Driver selector */}
          {showDriverPicker && (
            <>
              <Text style={[s.label, { marginTop: 12 }]}>Driver</Text>
              <View style={s.chipRow}>
                {drivers.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[s.chip, selectedDriverId === d.id && s.chipActive]}
                    onPress={() => setSelectedDriverId(d.id)}
                  >
                    <Text style={[s.chipText, selectedDriverId === d.id && s.chipTextActive]}>{d.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Month */}
          <Text style={[s.label, { marginTop: 16 }]}>Month</Text>
          <TextInput
            style={s.input}
            value={month}
            onChangeText={setMonth}
            placeholder="2026-03"
            placeholderTextColor={MUTED}
          />

          {/* Amount */}
          <Text style={[s.label, { marginTop: 16 }]}>Amount</Text>
          <TextInput
            style={s.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={MUTED}
            keyboardType="decimal-pad"
          />

          {/* Notes */}
          <Text style={[s.label, { marginTop: 16 }]}>Notes (optional)</Text>
          <TextInput
            style={[s.input, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={MUTED}
            multiline
          />

          {/* Save button */}
          <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Expense</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 12 },
  backBtn: { padding: 4 },
  title: { color: WHITE, fontSize: 20, fontWeight: '700' },
  label: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  groupLabel: { color: WHITE, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  chipActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  chipText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: GREEN },
  input: { color: WHITE, backgroundColor: CARD, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: BORDER },
  saveBtn: { backgroundColor: GREEN, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
