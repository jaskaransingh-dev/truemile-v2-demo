import { useState, useEffect } from 'react'
import {
  Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert, View,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '../lib/supabase'
import { normalizePhone } from '../lib/phone'
import { setRole, getRole, type Role } from '../lib/role'

type Mode = 'phone' | 'email'
type EmailView = 'signin' | 'signup'
type PhoneStep = 'input' | 'otp'

export default function LoginScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>('phone')
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input')
  const [emailView, setEmailView] = useState<EmailView>('signin')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailInfo, setEmailInfo] = useState<string | null>(null)

  // Restore session on mount — read role from SecureStore, fall back to inferring
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        let role: Role | null = await getRole()
        if (!role) {
          // Back-compat: infer from session if SecureStore is empty
          if (session.user.phone) role = 'driver'
          else if (session.user.email) role = 'dispatcher'
        }
        if (role === 'driver') {
          const normalized = normalizePhone(session.user.phone)
          navigation.reset({ index: 0, routes: [{ name: 'DriverRoot', params: { phone: normalized } }] })
        } else if (role === 'dispatcher') {
          navigation.reset({ index: 0, routes: [{ name: 'DispatcherRoot' }] })
        }
      }
      setChecking(false)
    })()
  }, [])

  // --- Phone OTP flow ---
  async function sendOTP() {
    setLoading(true)
    const formatted = '+1' + phone.replace(/\D/g, '')
    const { error } = await supabase.auth.signInWithOtp({ phone: formatted })
    if (error) Alert.alert('Error', error.message)
    else setPhoneStep('otp')
    setLoading(false)
  }

  async function verifyOTP() {
    setLoading(true)
    const formatted = '+1' + phone.replace(/\D/g, '')
    const { data, error } = await supabase.auth.verifyOtp({
      phone: formatted, token: otp, type: 'sms',
    })
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      await SecureStore.setItemAsync('session', JSON.stringify(data.session))
      await setRole('driver')
      const normalized = normalizePhone(formatted)
      navigation.reset({ index: 0, routes: [{ name: 'DriverRoot', params: { phone: normalized } }] })
    }
    setLoading(false)
  }

  // --- Email/password flow ---
  async function signInEmail() {
    setEmailError(null)
    setEmailInfo(null)
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setEmailError(error.message)
    } else if (data.session) {
      await SecureStore.setItemAsync('session', JSON.stringify(data.session))
      await setRole('dispatcher')
      navigation.reset({ index: 0, routes: [{ name: 'DispatcherRoot' }] })
    }
    setLoading(false)
  }

  async function signUpEmail() {
    setEmailError(null)
    setEmailInfo(null)
    if (password.length < 8) {
      setEmailError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setEmailError('Passwords do not match')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setEmailError(error.message)
    } else if (data.session) {
      // Email confirmation is disabled — we got a session back, go straight to dispatcher
      await SecureStore.setItemAsync('session', JSON.stringify(data.session))
      await setRole('dispatcher')
      navigation.reset({ index: 0, routes: [{ name: 'DispatcherRoot' }] })
    } else {
      // Email confirmation is enabled — user needs to verify
      setEmailInfo('Account created — check your email to confirm, then sign in.')
      setEmailView('signin')
      setConfirmPassword('')
    }
    setLoading(false)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setPhoneStep('input')
    setEmailView('signin')
    setOtp('')
    setEmailError(null)
    setEmailInfo(null)
  }

  if (checking) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#1D9E75" size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      <Text style={s.logo}>TrueMile</Text>
      <Text style={s.sub}>
        {mode === 'phone' ? 'Driver App' : 'Dispatch Console'}
      </Text>

      {/* Mode switcher */}
      <View style={s.modeRow}>
        <TouchableOpacity
          style={[s.modeBtn, mode === 'phone' && s.modeBtnActive]}
          onPress={() => switchMode('phone')}
        >
          <Text style={[s.modeText, mode === 'phone' && s.modeTextActive]}>Driver</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modeBtn, mode === 'email' && s.modeBtnActive]}
          onPress={() => switchMode('email')}
        >
          <Text style={[s.modeText, mode === 'email' && s.modeTextActive]}>Dispatcher</Text>
        </TouchableOpacity>
      </View>

      {/* Phone OTP */}
      {mode === 'phone' && phoneStep === 'input' && (
        <>
          <TextInput
            style={s.input}
            placeholder="Phone number"
            placeholderTextColor="#6B7280"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <TouchableOpacity style={s.btn} onPress={sendOTP} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send Code</Text>}
          </TouchableOpacity>
        </>
      )}

      {mode === 'phone' && phoneStep === 'otp' && (
        <>
          <TextInput
            style={s.input}
            placeholder="6-digit code"
            placeholderTextColor="#6B7280"
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
            maxLength={6}
          />
          <TouchableOpacity style={s.btn} onPress={verifyOTP} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPhoneStep('input')}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Email/password — Sign In */}
      {mode === 'email' && emailView === 'signin' && (
        <>
          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor="#6B7280"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor="#6B7280"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {emailError ? <Text style={s.error}>{emailError}</Text> : null}
          {emailInfo ? <Text style={s.info}>{emailInfo}</Text> : null}
          <TouchableOpacity style={s.btn} onPress={signInEmail} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign In</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setEmailView('signup'); setEmailError(null); setEmailInfo(null) }}
          >
            <Text style={s.link}>Create Account</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Email/password — Sign Up */}
      {mode === 'email' && emailView === 'signup' && (
        <>
          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor="#6B7280"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={s.input}
            placeholder="Password (8+ characters)"
            placeholderTextColor="#6B7280"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={s.input}
            placeholder="Confirm password"
            placeholderTextColor="#6B7280"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          {emailError ? <Text style={s.error}>{emailError}</Text> : null}
          <TouchableOpacity style={s.btn} onPress={signUpEmail} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Create Account</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setEmailView('signin'); setEmailError(null); setConfirmPassword('') }}
          >
            <Text style={s.link}>← Back to Sign In</Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 32, fontWeight: '700', color: '#1D9E75', marginBottom: 4 },
  sub: { fontSize: 16, color: '#6B7280', marginBottom: 32 },

  modeRow: { flexDirection: 'row', width: '100%', marginBottom: 20, backgroundColor: '#1A1D21', borderRadius: 10, padding: 4, borderWidth: 1, borderColor: '#2D3035' },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  modeBtnActive: { backgroundColor: '#1D9E75' },
  modeText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  modeTextActive: { color: '#FFF' },

  input: { width: '100%', backgroundColor: '#1A1D21', color: '#fff', borderRadius: 10, padding: 16, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2D3035' },
  btn: { width: '100%', backgroundColor: '#1D9E75', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  back: { color: '#6B7280', marginTop: 16, fontSize: 14 },
  link: { color: '#1D9E75', marginTop: 16, fontSize: 14, fontWeight: '500' },
  error: { color: '#F87171', fontSize: 13, alignSelf: 'flex-start', marginBottom: 8 },
  info: { color: '#4ADE80', fontSize: 13, alignSelf: 'flex-start', marginBottom: 8 },
})
