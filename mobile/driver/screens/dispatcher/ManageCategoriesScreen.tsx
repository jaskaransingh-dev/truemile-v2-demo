import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, Switch, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native'
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react-native'
import {
  fetchExpenseCategories, createExpenseCategory, updateExpenseCategory, deleteExpenseCategory,
  type ExpenseCategory,
} from '../../lib/dispatcher-api'

const GREEN = '#1D9E75'
const RED = '#EF4444'
const BG = '#0D0F12'
const CARD = '#161920'
const BORDER = '#1E2128'
const MUTED = '#6B7280'
const WHITE = '#F3F4F6'

export default function ManageCategoriesScreen({ navigation }: any) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [addingType, setAddingType] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newScope, setNewScope] = useState('PER_DRIVER')
  const [newAmount, setNewAmount] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await fetchExpenseCategories()
      setCategories(data)
    } catch (err: any) {
      console.warn('Failed to load categories:', err.message)
    }
  }, [])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  async function handleToggleActive(cat: ExpenseCategory) {
    try {
      await updateExpenseCategory(cat.id, { active: !cat.active } as any)
      setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, active: !c.active } : c))
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  async function handleDelete(cat: ExpenseCategory) {
    Alert.alert('Delete Category', `Delete "${cat.name}"? All associated expenses will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteExpenseCategory(cat.id)
            setCategories((prev) => prev.filter((c) => c.id !== cat.id))
          } catch (err: any) {
            Alert.alert('Error', err.message)
          }
        },
      },
    ])
  }

  async function handleAdd() {
    if (!newName.trim() || !addingType) return
    try {
      const cat = await createExpenseCategory({
        name: newName.trim(),
        type: addingType,
        scope: newScope,
        defaultAmount: newAmount ? parseFloat(newAmount) : undefined,
      })
      setCategories((prev) => [...prev, cat])
      setAddingType(null)
      setNewName('')
      setNewScope('PER_DRIVER')
      setNewAmount('')
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  async function handleMove(cat: ExpenseCategory, direction: 'up' | 'down') {
    const sametype = categories.filter((c) => c.type === cat.type).sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = sametype.findIndex((c) => c.id === cat.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sametype.length) return

    const other = sametype[swapIdx]
    try {
      await Promise.all([
        updateExpenseCategory(cat.id, { sortOrder: other.sortOrder } as any),
        updateExpenseCategory(other.id, { sortOrder: cat.sortOrder } as any),
      ])
      setCategories((prev) => prev.map((c) => {
        if (c.id === cat.id) return { ...c, sortOrder: other.sortOrder }
        if (c.id === other.id) return { ...c, sortOrder: cat.sortOrder }
        return c
      }))
    } catch (err: any) {
      Alert.alert('Error', err.message)
    }
  }

  const grouped: Record<string, ExpenseCategory[]> = { FIXED: [], VARIABLE: [], DRIVER_PAY: [] }
  for (const c of categories) {
    if (grouped[c.type]) grouped[c.type].push(c)
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.sortOrder - b.sortOrder)
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
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <ArrowLeft size={20} color={WHITE} />
        </TouchableOpacity>
        <Text style={s.title}>Manage Categories</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {(['FIXED', 'VARIABLE', 'DRIVER_PAY'] as const).map((type) => {
          const label = type === 'DRIVER_PAY' ? 'Driver Pay' : type.charAt(0) + type.slice(1).toLowerCase()
          const items = grouped[type]
          return (
            <View key={type} style={s.section}>
              <Text style={s.sectionTitle}>{label}</Text>
              {items.map((cat, idx) => (
                <View key={cat.id} style={s.catRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.catName, !cat.active && { opacity: 0.4 }]}>{cat.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                      <Text style={s.catBadge}>{cat.scope === 'FLEET' ? 'Fleet' : 'Per Driver'}</Text>
                      {cat.defaultAmount != null && <Text style={s.catDefault}>${cat.defaultAmount}</Text>}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TouchableOpacity onPress={() => handleMove(cat, 'up')} disabled={idx === 0}>
                      <ChevronUp size={16} color={idx === 0 ? BORDER : MUTED} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMove(cat, 'down')} disabled={idx === items.length - 1}>
                      <ChevronDown size={16} color={idx === items.length - 1 ? BORDER : MUTED} />
                    </TouchableOpacity>
                    <Switch
                      value={cat.active}
                      onValueChange={() => handleToggleActive(cat)}
                      trackColor={{ false: BORDER, true: GREEN + '66' }}
                      thumbColor={cat.active ? GREEN : MUTED}
                    />
                    <TouchableOpacity onPress={() => handleDelete(cat)}>
                      <Trash2 size={16} color={RED} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {/* Add new category inline */}
              {addingType === type ? (
                <View style={s.addForm}>
                  <TextInput
                    style={s.input}
                    placeholder="Category name"
                    placeholderTextColor={MUTED}
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      style={[s.scopeBtn, newScope === 'PER_DRIVER' && s.scopeBtnActive]}
                      onPress={() => setNewScope('PER_DRIVER')}
                    >
                      <Text style={[s.scopeBtnText, newScope === 'PER_DRIVER' && s.scopeBtnTextActive]}>Per Driver</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.scopeBtn, newScope === 'FLEET' && s.scopeBtnActive]}
                      onPress={() => setNewScope('FLEET')}
                    >
                      <Text style={[s.scopeBtnText, newScope === 'FLEET' && s.scopeBtnTextActive]}>Fleet</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      placeholder="Default $"
                      placeholderTextColor={MUTED}
                      keyboardType="decimal-pad"
                      value={newAmount}
                      onChangeText={setNewAmount}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity style={s.saveBtn} onPress={handleAdd}>
                      <Text style={s.saveBtnText}>Add</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setAddingType(null)}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={s.addCatBtn} onPress={() => { setAddingType(type); setNewScope(type === 'DRIVER_PAY' ? 'PER_DRIVER' : 'PER_DRIVER') }}>
                  <Plus size={14} color={GREEN} />
                  <Text style={s.addCatText}>Add Category</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 12 },
  backBtn: { padding: 4 },
  title: { color: WHITE, fontSize: 20, fontWeight: '700' },
  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionTitle: { color: WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  catRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: BORDER },
  catName: { color: WHITE, fontSize: 14, fontWeight: '600' },
  catBadge: { color: MUTED, fontSize: 10, fontWeight: '600', backgroundColor: BORDER, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  catDefault: { color: MUTED, fontSize: 10, fontWeight: '600' },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  addCatText: { color: GREEN, fontSize: 13, fontWeight: '600' },
  addForm: { backgroundColor: CARD, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: GREEN + '44' },
  input: { color: WHITE, backgroundColor: BG, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, borderWidth: 1, borderColor: BORDER },
  scopeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  scopeBtnActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  scopeBtnText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  scopeBtnTextActive: { color: GREEN },
  saveBtn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cancelText: { color: RED, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
})
