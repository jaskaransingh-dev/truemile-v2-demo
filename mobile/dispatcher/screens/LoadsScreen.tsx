import { View, Text, StyleSheet, SafeAreaView } from 'react-native'

export default function LoadsScreen() {
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.logo}>True<Text style={s.logoAccent}>Mile</Text></Text>
        <Text style={s.sub}>Loads</Text>
      </View>
      <View style={s.body}>
        <Text style={s.icon}>🚛</Text>
        <Text style={s.title}>Coming soon</Text>
        <Text style={s.desc}>Active loads, rates, and delivery status will appear here.</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0F12' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E2128' },
  logo: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  logoAccent: { color: '#1D9E75' },
  sub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { color: '#FFF', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  desc: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
})
