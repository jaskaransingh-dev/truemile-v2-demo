import { Text } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'

import LoginScreen from './screens/LoginScreen'
import DriversScreen from './screens/DriversScreen'
import MapScreen from './screens/MapScreen'
import LoadsScreen from './screens/LoadsScreen'
import DriverDetailScreen from './screens/DriverDetailScreen'
import ChatScreen from './screens/ChatScreen'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

// Simple emoji-based tab icons (no icon library needed)
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D0F12',
          borderTopColor: '#1E2128',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#1D9E75',
        tabBarInactiveTintColor: '#6B7280',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Drivers"
        component={DriversScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} /> }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📍" focused={focused} /> }}
      />
      <Tab.Screen
        name="Loads"
        component={LoadsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🚛" focused={focused} /> }}
      />
    </Tab.Navigator>
  )
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="DriverDetail" component={DriverDetailScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
