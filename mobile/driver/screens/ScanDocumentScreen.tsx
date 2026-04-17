import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert, ScrollView, Animated, Easing,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as SecureStore from 'expo-secure-store'
import { FileText, Camera, ImageIcon } from 'lucide-react-native'
import { normalizePhone } from '../lib/phone'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL

type DocType = 'POD' | 'BOL' | 'RATECON'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

/**
 * Resize to max 1800px on longest side and compress as JPEG quality 0.85.
 * expo-image-manipulator doesn't support grayscale/contrast natively, so the
 * "scan look" is achieved via UX treatment (white frame + corners + animation).
 */
async function processDocumentScan(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1800 } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      }
    )
    return result.uri
  } catch (err) {
    console.warn('[Scan] processing failed, using original:', err)
    return uri
  }
}

export default function ScanDocumentScreen({ navigation }: Props) {
  const [rawUri, setRawUri] = useState<string | null>(null)
  const [processedUri, setProcessedUri] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [docType, setDocType] = useState<DocType | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)

  const scanProgress = useRef(new Animated.Value(0)).current

  // Run scan animation when a raw image is captured
  useEffect(() => {
    if (rawUri && !processedUri) {
      setScanning(true)
      scanProgress.setValue(0)
      Animated.timing(scanProgress, {
        toValue: 1,
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }).start()

      // Process the image in parallel with the animation
      processDocumentScan(rawUri).then((uri) => {
        // Wait at least 1s total for the animation to finish before revealing
        setTimeout(() => {
          setProcessedUri(uri)
          setScanning(false)
        }, 1000)
      })
    }
  }, [rawUri])

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to scan documents')
      return
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    })
    if (!res.canceled && res.assets[0]) {
      setRawUri(res.assets[0].uri)
      setProcessedUri(null)
      setResult(null)
    }
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    })
    if (!res.canceled && res.assets[0]) {
      setRawUri(res.assets[0].uri)
      setProcessedUri(null)
      setResult(null)
    }
  }

  async function handleUpload() {
    const uploadUri = processedUri || rawUri
    if (!uploadUri || !docType) return
    setUploading(true)
    setResult(null)

    try {
      const phone = normalizePhone(await SecureStore.getItemAsync('driverPhone'))
      const formData = new FormData()
      formData.append('file', {
        uri: uploadUri,
        name: `scan-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any)
      formData.append('driverPhone', phone)
      formData.append('docType', docType)

      const res = await fetch(`${API_BASE}/api/documents/upload`, {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        setResult('success')
      } else {
        setResult('error')
      }
    } catch {
      setResult('error')
    }
    setUploading(false)
  }

  function reset() {
    setRawUri(null)
    setProcessedUri(null)
    setDocType(null)
    setResult(null)
  }

  // Initial state — show capture buttons
  if (!rawUri) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Scan Document</Text>
        </View>

        <View style={s.captureArea}>
          <FileText size={48} color="#6B7280" style={{ marginBottom: 16 }} />
          <Text style={s.captureTitle}>Capture or select a document</Text>
          <Text style={s.captureSub}>Rate con, BOL, proof of delivery, or receipt</Text>

          <TouchableOpacity style={s.captureBtn} onPress={takePhoto}>
            <Camera size={20} color="#FFF" />
            <Text style={s.captureBtnText}>Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.captureBtn, { borderColor: '#6B7280' }]} onPress={pickFromLibrary}>
            <ImageIcon size={20} color="#9CA3AF" />
            <Text style={[s.captureBtnText, { color: '#9CA3AF' }]}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // Scanning animation in progress
  if (scanning || !processedUri) {
    const barWidth = scanProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    })
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={reset}>
            <Text style={s.back}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>Scanning...</Text>
        </View>

        <View style={s.scanArea}>
          <View style={s.scanFrame}>
            <Image source={{ uri: rawUri }} style={s.scanImage} resizeMode="contain" />
            {/* Corner markers */}
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </View>

          <View style={s.scanStatus}>
            <Text style={s.scanLabel}>Processing document</Text>
            <View style={s.progressTrack}>
              <Animated.View style={[s.progressFill, { width: barWidth }]} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // Scan complete — show polished preview + type selection + upload
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={reset}>
          <Text style={s.back}>← Retake</Text>
        </TouchableOpacity>
        <Text style={s.title}>Scanned Document</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* White-bordered frame with shadow + corner markers */}
        <View style={s.docFrame}>
          <Image source={{ uri: processedUri }} style={s.preview} resizeMode="contain" />
          <View style={[s.corner, s.cornerTL]} />
          <View style={[s.corner, s.cornerTR]} />
          <View style={[s.corner, s.cornerBL]} />
          <View style={[s.corner, s.cornerBR]} />
        </View>

        <Text style={s.sectionLabel}>Document Type</Text>
        {([
          { key: 'POD' as DocType, label: 'POD — Proof of Delivery' },
          { key: 'BOL' as DocType, label: 'BOL — Bill of Lading' },
          { key: 'RATECON' as DocType, label: 'Rate Confirmation' },
        ]).map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[s.typeBtn, docType === opt.key && s.typeBtnSelected]}
            onPress={() => setDocType(opt.key)}
          >
            <Text style={[s.typeBtnText, docType === opt.key && { color: '#FFF' }]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}

        {result === 'success' ? (
          <View style={s.resultBox}>
            <Text style={s.successText}>✓ Sent to dispatch</Text>
            <TouchableOpacity style={s.doneBtn} onPress={() => navigation.goBack()}>
              <Text style={s.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : result === 'error' ? (
          <View style={s.resultBox}>
            <Text style={s.errorText}>Upload failed, try again</Text>
            <TouchableOpacity style={s.uploadBtn} onPress={handleUpload}>
              <Text style={s.uploadBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.uploadBtn, (!docType) && { opacity: 0.4 }]}
            onPress={handleUpload}
            disabled={!docType || uploading}
          >
            {uploading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.uploadBtnText}>Upload</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const CORNER_SIZE = 20
const CORNER_COLOR = '#1D9E75'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  captureArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  captureIcon: { fontSize: 48, marginBottom: 16 },
  captureTitle: { color: '#FFF', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  captureSub: { color: '#6B7280', fontSize: 13, marginBottom: 32 },
  captureBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#1D9E75', borderRadius: 12, padding: 18, marginBottom: 12,
  },
  captureBtnIcon: { fontSize: 20 },
  captureBtnText: { color: '#FFF', fontSize: 16, fontWeight: '500' },

  // Scanning state
  scanArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanFrame: {
    width: '100%', height: 380,
    backgroundColor: '#FFFFFF', padding: 12, borderRadius: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16,
    elevation: 12,
    position: 'relative',
  },
  scanImage: { width: '100%', height: '100%' },
  scanStatus: { marginTop: 28, width: '100%', alignItems: 'center' },
  scanLabel: { color: '#1D9E75', fontSize: 13, fontWeight: '600', marginBottom: 10, letterSpacing: 1 },
  progressTrack: { width: '100%', height: 3, backgroundColor: '#1A1D21', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#1D9E75' },

  // Preview with white frame + shadow
  docFrame: {
    backgroundColor: '#FFFFFF', padding: 12, borderRadius: 4, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 8,
    position: 'relative',
  },
  preview: { width: '100%', height: 320 },

  // Corner markers
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: CORNER_COLOR },
  cornerTL: { top: 4, left: 4, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 4, right: 4, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 4, left: 4, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 4, right: 4, borderBottomWidth: 3, borderRightWidth: 3 },

  sectionLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  typeBtn: {
    backgroundColor: '#1A1D21', borderWidth: 1, borderColor: '#2D3035', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  typeBtnSelected: { borderColor: '#1D9E75', backgroundColor: '#0F2A1A' },
  typeBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },

  uploadBtn: {
    width: '100%', backgroundColor: '#1D9E75', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 16,
  },
  uploadBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },

  resultBox: { alignItems: 'center', marginTop: 24 },
  successText: { color: '#4ADE80', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  errorText: { color: '#F87171', fontSize: 16, fontWeight: '500', marginBottom: 16 },
  doneBtn: { backgroundColor: '#1A1D21', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 40, borderWidth: 1, borderColor: '#2D3035' },
  doneBtnText: { color: '#FFF', fontSize: 16, fontWeight: '500' },
})
