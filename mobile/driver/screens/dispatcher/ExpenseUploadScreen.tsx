import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { ArrowLeft, Upload, Check, AlertTriangle } from 'lucide-react-native'
import {
  uploadExpenseFile, bulkCreateExpenses,
  type ParsedExpenseItem,
} from '../../lib/dispatcher-api'

const GREEN = '#1D9E75'
const RED = '#EF4444'
const YELLOW = '#F59E0B'
const BG = '#0D0F12'
const CARD = '#161920'
const BORDER = '#1E2128'
const MUTED = '#6B7280'
const WHITE = '#F3F4F6'

type UploadPhase = 'pick' | 'parsing' | 'review' | 'saving' | 'done'

interface ReviewItem extends ParsedExpenseItem {
  _idx: number
}

export default function ExpenseUploadScreen({ route, navigation }: any) {
  const { type: uploadType } = route.params || {} // 'cc' | 'fuel'

  const [phase, setPhase] = useState<UploadPhase>('pick')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([])
  const [savedCount, setSavedCount] = useState(0)

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/pdf',
          'image/*',
        ],
        copyToCacheDirectory: true,
      })

      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      setPhase('parsing')

      const data = await uploadExpenseFile(asset.uri, asset.name || 'file')
      setCategories(data.categories || [])
      setDrivers(data.drivers || [])
      setItems((data.items || []).map((item, i) => ({ ...item, _idx: i })))
      setPhase('review')
    } catch (err: any) {
      Alert.alert('Upload Error', err.message)
      setPhase('pick')
    }
  }

  async function handleConfirm() {
    const month = new Date().toISOString().slice(0, 7)
    const valid = items.filter((item) => item.categoryId && item.amount > 0)
    if (valid.length === 0) {
      Alert.alert('No valid items', 'Assign categories to at least one item')
      return
    }

    setPhase('saving')
    try {
      const result = await bulkCreateExpenses(
        valid.map((item) => ({
          categoryId: item.categoryId!,
          driverId: item.driverId || undefined,
          month,
          amount: item.amount,
          notes: item.description,
          source: uploadType === 'fuel' ? 'FUEL_UPLOAD' : 'CC_UPLOAD',
        })),
      )
      setSavedCount(result.created)
      setPhase('done')
    } catch (err: any) {
      Alert.alert('Save Error', err.message)
      setPhase('review')
    }
  }

  function updateItem(idx: number, field: 'categoryId' | 'driverId', value: string | null) {
    setItems((prev) => prev.map((item) => item._idx === idx ? { ...item, [field]: value } : item))
  }

  // Pick phase
  if (phase === 'pick') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <ArrowLeft size={20} color={WHITE} />
          </TouchableOpacity>
          <Text style={s.title}>Upload {uploadType === 'fuel' ? 'Fuel' : 'CC'} Statement</Text>
        </View>
        <View style={s.pickContainer}>
          <TouchableOpacity style={s.pickBtn} onPress={pickAndUpload}>
            <Upload size={32} color={GREEN} />
            <Text style={s.pickText}>Select File</Text>
            <Text style={s.pickSubtext}>CSV, XLSX, or PDF</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // Parsing phase
  if (phase === 'parsing') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <ArrowLeft size={20} color={WHITE} />
          </TouchableOpacity>
          <Text style={s.title}>Parsing...</Text>
        </View>
        <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} />
        <Text style={s.parsingText}>Analyzing your statement...</Text>
      </SafeAreaView>
    )
  }

  // Done phase
  if (phase === 'done') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <ArrowLeft size={20} color={WHITE} />
          </TouchableOpacity>
          <Text style={s.title}>Done</Text>
        </View>
        <View style={s.pickContainer}>
          <Check size={48} color={GREEN} />
          <Text style={s.doneText}>{savedCount} expenses saved</Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={s.doneBtnText}>Back to Financials</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // Saving phase
  if (phase === 'saving') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>Saving...</Text>
        </View>
        <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} />
      </SafeAreaView>
    )
  }

  // Review phase
  const unmatchedCount = items.filter((i) => !i.categoryId).length

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <ArrowLeft size={20} color={WHITE} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Review ({items.length} items)</Text>
          {unmatchedCount > 0 && (
            <Text style={s.unmatchedText}>{unmatchedCount} unmatched — assign categories</Text>
          )}
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item._idx)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        renderItem={({ item }) => {
          const isUnmatched = !item.categoryId
          return (
            <View style={[s.reviewRow, isUnmatched && s.reviewRowUnmatched]}>
              <View style={{ flex: 1 }}>
                <Text style={s.reviewDesc} numberOfLines={1}>{item.description}</Text>
                <Text style={s.reviewMeta}>{item.date} {item.cardMember ? `· ${item.cardMember}` : ''}</Text>
              </View>
              <Text style={s.reviewAmount}>${item.amount.toFixed(2)}</Text>
              {isUnmatched && <AlertTriangle size={14} color={YELLOW} style={{ marginLeft: 4 }} />}
            </View>
          )
        }}
      />

      <View style={s.confirmBar}>
        <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm}>
          <Text style={s.confirmBtnText}>Confirm & Save ({items.filter((i) => i.categoryId).length} items)</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 12 },
  backBtn: { padding: 4 },
  title: { color: WHITE, fontSize: 20, fontWeight: '700' },
  pickContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  pickBtn: { alignItems: 'center', backgroundColor: CARD, borderRadius: 16, padding: 32, borderWidth: 2, borderColor: GREEN + '44', borderStyle: 'dashed' as any },
  pickText: { color: WHITE, fontSize: 16, fontWeight: '700', marginTop: 12 },
  pickSubtext: { color: MUTED, fontSize: 12, marginTop: 4 },
  parsingText: { color: MUTED, fontSize: 14, textAlign: 'center', marginTop: 16 },
  unmatchedText: { color: YELLOW, fontSize: 11, marginTop: 2 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 8, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: BORDER },
  reviewRowUnmatched: { borderColor: YELLOW + '66' },
  reviewDesc: { color: WHITE, fontSize: 13, fontWeight: '600' },
  reviewMeta: { color: MUTED, fontSize: 11, marginTop: 2 },
  reviewAmount: { color: WHITE, fontSize: 14, fontWeight: '700', marginLeft: 8 },
  confirmBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  confirmBtn: { backgroundColor: GREEN, borderRadius: 8, padding: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  doneText: { color: WHITE, fontSize: 18, fontWeight: '700', marginTop: 16 },
  doneBtn: { backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12, marginTop: 16 },
  doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
