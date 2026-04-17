import { useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
  TextInput, ActivityIndicator, Alert, Platform,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { FileText, Paperclip, Camera, ImageIcon } from 'lucide-react-native'
import {
  parseRateCon, createLoad, uploadRateCon,
  type ParsedRateCon, type DispatchLoad, type LoadStop,
} from '../../lib/dispatcher-api'
import { formatLoadDate, formatDateTimeObj, toNaiveISO } from '../../lib/format'

type Phase = 'pick' | 'parsing' | 'review' | 'saving'

export default function RateConUploadScreen({ navigation, route }: any) {
  const driverId = route.params.driverId as string

  const [phase, setPhase] = useState<Phase>('pick')
  const [fileUri, setFileUri] = useState<string | null>(null)
  const [fileType, setFileType] = useState<string>('image/jpeg')
  const [parsed, setParsed] = useState<ParsedRateCon>({})

  // Editable fields (populated from parse, user can edit)
  const [loadNumber, setLoadNumber] = useState('')
  const [pickupCity, setPickupCity] = useState('')
  const [pickupState, setPickupState] = useState('')
  const [dropoffCity, setDropoffCity] = useState('')
  const [dropoffState, setDropoffState] = useState('')
  const [rate, setRate] = useState('')
  const [loadedMiles, setLoadedMiles] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [brokerName, setBrokerName] = useState('')
  const [brokerAgentName, setBrokerAgentName] = useState('')
  const [stops, setStops] = useState<LoadStop[]>([])
  const [showPickupPicker, setShowPickupPicker] = useState(false)
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false)
  const [pickupDateObj, setPickupDateObj] = useState(new Date())
  const [deliveryDateObj, setDeliveryDateObj] = useState(new Date())

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
    if (!res.canceled && res.assets[0]) {
      setFileUri(res.assets[0].uri)
      setFileType(res.assets[0].mimeType || 'image/jpeg')
      startParse(res.assets[0].uri, res.assets[0].mimeType || 'image/jpeg')
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required')
      return
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
    if (!res.canceled && res.assets[0]) {
      setFileUri(res.assets[0].uri)
      setFileType('image/jpeg')
      startParse(res.assets[0].uri, 'image/jpeg')
    }
  }

  async function pickPdf() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
    if (!res.canceled && res.assets[0]) {
      setFileUri(res.assets[0].uri)
      setFileType('application/pdf')
      startParse(res.assets[0].uri, 'application/pdf')
    }
  }

  async function startParse(uri: string, mime: string) {
    setPhase('parsing')
    try {
      const data = await parseRateCon(uri)
      setParsed(data)
      setLoadNumber(data.loadNumber || '')
      setPickupCity(data.pickupCity || '')
      setPickupState(data.pickupState || '')
      setDropoffCity(data.dropoffCity || '')
      setDropoffState(data.dropoffState || '')
      setRate(data.rate != null ? String(data.rate) : '')
      setLoadedMiles(data.loadedMiles != null ? String(data.loadedMiles) : '')
      setPickupTime(data.pickupTime || '')
      setDeliveryTime(data.deliveryTime || '')
      if (data.pickupTime) try { setPickupDateObj(new Date(data.pickupTime)) } catch { /* keep default */ }
      if (data.deliveryTime) try { setDeliveryDateObj(new Date(data.deliveryTime)) } catch { /* keep default */ }
      setBrokerName(data.brokerName || '')
      setBrokerAgentName(data.brokerAgentName || '')
      setStops(data.stops || [])
      setPhase('review')
    } catch (err: any) {
      Alert.alert('Parse failed', err.message || 'Could not parse rate con')
      setPhase('pick')
    }
  }

  async function confirm() {
    setPhase('saving')
    try {
      // Create the load
      const load: DispatchLoad = await createLoad({
        driverId,
        loadNumber: loadNumber || undefined,
        pickupCity: pickupCity || undefined,
        pickupState: pickupState || undefined,
        dropoffCity: dropoffCity || undefined,
        dropoffState: dropoffState || undefined,
        rate: rate ? parseFloat(rate) : undefined,
        loadedMiles: loadedMiles ? parseFloat(loadedMiles) : undefined,
        loadedMilesSource: loadedMiles ? 'RATECON' : undefined,
        pickupTime: pickupTime || undefined,
        deliveryTime: deliveryTime || undefined,
        stopCount: stops.length || undefined,
        stops: stops.length > 0 ? stops : undefined,
        brokerName: brokerName || undefined,
        brokerAgentName: brokerAgentName || undefined,
        brokerEmail: parsed.brokerEmail || undefined,
        brokerPhone: parsed.brokerPhone || undefined,
        brokerMC: parsed.brokerMC || undefined,
      })

      // Attach the uploaded rate con file
      if (fileUri) {
        try { await uploadRateCon(load.id, fileUri, fileType) } catch { /* non-blocking */ }
      }

      navigation.replace('LoadDetail', { loadId: load.id })
    } catch (err: any) {
      Alert.alert('Save failed', err.message || 'Could not save load')
      setPhase('review')
    }
  }

  // --- Render phases ---

  if (phase === 'pick') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Add Load</Text>
        </View>

        <View style={s.pickArea}>
          <FileText size={48} color="#6B7280" style={{ marginBottom: 16 }} />
          <Text style={s.pickTitle}>Upload rate confirmation</Text>
          <Text style={s.pickSub}>PDF or photo — we'll parse the details</Text>

          <TouchableOpacity style={s.pickBtn} onPress={pickPdf}>
            <Paperclip size={20} color="#FFF" />
            <Text style={s.pickBtnText}>Choose PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.pickBtn} onPress={takePhoto}>
            <Camera size={20} color="#FFF" />
            <Text style={s.pickBtnText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.pickBtn} onPress={pickImage}>
            <ImageIcon size={20} color="#9CA3AF" />
            <Text style={[s.pickBtnText, { color: '#9CA3AF' }]}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (phase === 'parsing' || phase === 'saving') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.parsingArea}>
          <ActivityIndicator color="#1D9E75" size="large" />
          <Text style={s.parsingText}>
            {phase === 'parsing' ? 'Parsing rate con...' : 'Saving load...'}
          </Text>
          <Text style={s.parsingSub}>
            {phase === 'parsing' ? 'Extracting fields with AI' : 'Calculating miles + deadhead'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // phase === 'review'
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setPhase('pick')}>
          <Text style={s.back}>← Retry</Text>
        </TouchableOpacity>
        <Text style={s.title}>Review Load Details</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.reviewNote}>Confirm or edit the parsed fields before saving.</Text>

        <Text style={s.fieldLabel}>Load Number</Text>
        <TextInput style={s.input} value={loadNumber} onChangeText={setLoadNumber} placeholder="e.g. 124124" placeholderTextColor="#6B7280" />

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Text style={s.fieldLabel}>Pickup City</Text>
            <TextInput style={s.input} value={pickupCity} onChangeText={setPickupCity} placeholder="City" placeholderTextColor="#6B7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>ST</Text>
            <TextInput style={s.input} value={pickupState} onChangeText={setPickupState} placeholder="TX" placeholderTextColor="#6B7280" maxLength={2} autoCapitalize="characters" />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Text style={s.fieldLabel}>Dropoff City</Text>
            <TextInput style={s.input} value={dropoffCity} onChangeText={setDropoffCity} placeholder="City" placeholderTextColor="#6B7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>ST</Text>
            <TextInput style={s.input} value={dropoffState} onChangeText={setDropoffState} placeholder="GA" placeholderTextColor="#6B7280" maxLength={2} autoCapitalize="characters" />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>Rate ($)</Text>
            <TextInput style={s.input} value={rate} onChangeText={setRate} placeholder="2500" placeholderTextColor="#6B7280" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>Miles</Text>
            <TextInput style={s.input} value={loadedMiles} onChangeText={setLoadedMiles} placeholder="auto" placeholderTextColor="#6B7280" keyboardType="numeric" />
          </View>
        </View>

        <Text style={s.fieldLabel}>Pickup Time</Text>
        <TouchableOpacity style={s.dateBtn} onPress={() => setShowPickupPicker(true)}>
          <Text style={s.dateBtnText}>{pickupTime ? formatLoadDate(pickupTime) : 'Set pickup time'}</Text>
        </TouchableOpacity>
        {showPickupPicker && (
          <DateTimePicker
            value={pickupDateObj}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, d) => {
              setShowPickupPicker(Platform.OS === 'ios')
              if (d) { setPickupDateObj(d); setPickupTime(toNaiveISO(d)) }
            }}
            themeVariant="dark"
          />
        )}

        <Text style={s.fieldLabel}>Delivery Time</Text>
        <TouchableOpacity style={s.dateBtn} onPress={() => setShowDeliveryPicker(true)}>
          <Text style={s.dateBtnText}>{deliveryTime ? formatLoadDate(deliveryTime) : 'Set delivery time'}</Text>
        </TouchableOpacity>
        {showDeliveryPicker && (
          <DateTimePicker
            value={deliveryDateObj}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, d) => {
              setShowDeliveryPicker(Platform.OS === 'ios')
              if (d) { setDeliveryDateObj(d); setDeliveryTime(toNaiveISO(d)) }
            }}
            themeVariant="dark"
          />
        )}

        <Text style={s.fieldLabel}>Broker Company</Text>
        <TextInput style={s.input} value={brokerName} onChangeText={setBrokerName} placeholder="Company name" placeholderTextColor="#6B7280" />

        <Text style={s.fieldLabel}>Broker Agent</Text>
        <TextInput style={s.input} value={brokerAgentName} onChangeText={setBrokerAgentName} placeholder="Agent name" placeholderTextColor="#6B7280" />

        {/* Stops */}
        {stops.length > 0 && (
          <>
            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Stops ({stops.length})</Text>
            {stops.map((stop, idx) => (
              <View key={idx} style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035',
                borderRadius: 8, padding: 10, marginBottom: 6,
              }}>
                <View style={{ width: 50 }}>
                  <Text style={{ color: stop.type === 'PICKUP' ? '#4ADE80' : '#60A5FA', fontSize: 10, fontWeight: '700' }}>
                    {stop.sequence}. {stop.type}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[s.input, { marginBottom: 0, paddingVertical: 6 }]}
                    value={`${stop.city || ''}, ${stop.state || ''}`}
                    onChangeText={(text) => {
                      const [city = '', state = ''] = text.split(',').map(s => s.trim())
                      const updated = [...stops]
                      updated[idx] = { ...stop, city, state }
                      setStops(updated)
                    }}
                    placeholder="City, ST"
                    placeholderTextColor="#6B7280"
                  />
                </View>
                <Text style={{ color: '#6B7280', fontSize: 10 }}>
                  {stop.appointment ? formatLoadDate(stop.appointment) : '—'}
                </Text>
              </View>
            ))}
          </>
        )}

        {!loadedMiles ? (
          <Text style={s.milesHint}>Leave miles empty and we'll auto-calculate from pickup → dropoff.</Text>
        ) : null}

        <TouchableOpacity style={s.saveBtn} onPress={confirm}>
          <Text style={s.saveBtnText}>Confirm & Save Load</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  pickArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  icon: { fontSize: 48, marginBottom: 16 },
  pickTitle: { color: '#FFF', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  pickSub: { color: '#6B7280', fontSize: 13, marginBottom: 32 },
  pickBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#1D9E75', borderRadius: 12, padding: 16, marginBottom: 10,
  },
  pickBtnIcon: { fontSize: 20 },
  pickBtnText: { color: '#FFF', fontSize: 15, fontWeight: '500' },

  parsingArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  parsingText: { color: '#FFF', fontSize: 16, fontWeight: '600', marginTop: 20 },
  parsingSub: { color: '#6B7280', fontSize: 13, marginTop: 6 },

  reviewNote: { color: '#9CA3AF', fontSize: 12, marginBottom: 12, fontStyle: 'italic' },
  fieldLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 12, color: '#FFF', fontSize: 14 },
  dateBtn: { backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 8, padding: 14, alignItems: 'center' as const },
  dateBtnText: { color: '#FFF', fontSize: 14, fontWeight: '500' as const },
  milesHint: { color: '#60A5FA', fontSize: 12, marginTop: 10, fontStyle: 'italic' as const },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 20 },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
})
