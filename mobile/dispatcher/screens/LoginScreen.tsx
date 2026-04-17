import { useState, useEffect } from 'react'
import {
  Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, Alert,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '../lib/supabase'

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] })
      }
      setChecking(false)
    })
  }, [])

  async function signIn() {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      Alert.alert('Sign in failed', error.message)
    } else if (data.session) {
      await SecureStore.setItemAsync('session', JSON.stringify(data.session))
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] })
    }
    setLoading(false)
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
      <Text style={s.sub}>Dispatch Console</Text>

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
      <TouchableOpacity style={s.btn} onPress={signIn} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>Sign In</Text>
        }
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 32, fontWeight: '700', color: '#1D9E75', marginBottom: 4 },
  sub: { fontSize: 16, color: '#6B7280', marginBottom: 48 },
  input: { width: '100%', backgroundColor: '#1A1D21', color: '#fff', borderRadius: 10, padding: 16, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2D3035' },
  btn: { width: '100%', backgroundColor: '#1D9E75', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
