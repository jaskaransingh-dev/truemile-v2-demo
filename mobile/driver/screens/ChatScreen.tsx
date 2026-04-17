import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform
} from 'react-native'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '../lib/phone'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
)

interface Message {
  id: string
  senderType: 'DRIVER' | 'DISPATCHER'
  senderName: string
  text: string
  createdAt: string
}

type Props = {
  navigation: NativeStackNavigationProp<any>
  route: { params?: { phone?: string } }
}

export default function ChatScreen({ navigation, route }: Props) {
  const phone = normalizePhone(route.params?.phone)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  // Fetch messages on mount
  useEffect(() => {
    fetchMessages()
    // Subscribe to Realtime channel
    const channel = supabase.channel(`chat-${phone}`)
      .on('broadcast', { event: 'new-message' }, (payload) => {
        const msg = payload.payload as Message
        setMessages((prev) => [...prev, msg])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [phone])

  async function fetchMessages() {
    try {
      const res = await fetch(`${API_BASE}/api/drivers/messages?phone=${encodeURIComponent(phone)}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch (err) {
      console.error('[Chat] fetch error:', err)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput('')
    setSending(true)

    // Optimistic append
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      senderType: 'DRIVER',
      senderName: 'Driver',
      text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempMsg])

    try {
      await fetch(`${API_BASE}/api/drivers/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, text, senderType: 'DRIVER', senderName: 'Driver' }),
      })
    } catch (err) {
      console.error('[Chat] send error:', err)
    }
    setSending(false)
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  function renderMessage({ item }: { item: Message }) {
    const isDriver = item.senderType === 'DRIVER'
    return (
      <View style={[s.msgRow, isDriver ? s.msgRowRight : s.msgRowLeft]}>
        <View style={[s.bubble, isDriver ? s.bubbleDriver : s.bubbleDispatch]}>
          <Text style={s.bubbleSender}>{item.senderName}</Text>
          <Text style={s.bubbleText}>{item.text}</Text>
          <Text style={s.bubbleTime}>{formatTime(item.createdAt)}</Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Chat with Dispatch</Text>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={s.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {/* Input bar */}
        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            placeholder="Message dispatch..."
            placeholderTextColor="#6B7280"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity style={s.sendBtn} onPress={handleSend} disabled={sending}>
            <Text style={s.sendBtnText}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  back: { color: '#6B7280', fontSize: 14 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600' },

  messageList: { padding: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 12 },
  msgRowRight: { alignItems: 'flex-end' },
  msgRowLeft: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 12 },
  bubbleDriver: { backgroundColor: '#1D4D2E', borderBottomRightRadius: 2 },
  bubbleDispatch: { backgroundColor: '#1A1D21', borderBottomLeftRadius: 2 },
  bubbleSender: { fontSize: 10, color: '#6B7280', marginBottom: 4 },
  bubbleText: { fontSize: 14, color: '#E5E7EB', lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: '#6B7280', marginTop: 4, textAlign: 'right' },

  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#1E2128' },
  input: { flex: 1, backgroundColor: '#111214', borderRadius: 10, padding: 12, color: '#FFF', fontSize: 14 },
  sendBtn: { backgroundColor: '#1D9E75', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
})
