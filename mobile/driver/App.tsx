import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Users, MapPin, DollarSign } from 'lucide-react-native'

// Shared
import LoginScreen from './screens/LoginScreen'

// Driver screens
import HomeScreen from './screens/HomeScreen'
import ScanDocumentScreen from './screens/ScanDocumentScreen'
import ChatScreen from './screens/ChatScreen'
import UpdateStatusScreen from './screens/UpdateStatusScreen'

// Dispatcher screens
import DriversScreen from './screens/dispatcher/DriversScreen'
import MapScreen from './screens/dispatcher/MapScreen'
import FinancialsScreen from './screens/dispatcher/FinancialsScreen'
import DriverDetailScreen from './screens/dispatcher/DriverDetailScreen'
import DispatcherChatScreen from './screens/dispatcher/DispatcherChatScreen'
import LoadDetailScreen from './screens/dispatcher/LoadDetailScreen'
import RateConUploadScreen from './screens/dispatcher/RateConUploadScreen'
import DriverFinancialsScreen from './screens/dispatcher/DriverFinancialsScreen'
import ManageCategoriesScreen from './screens/dispatcher/ManageCategoriesScreen'
import AddExpenseScreen from './screens/dispatcher/AddExpenseScreen'
import ExpenseUploadScreen from './screens/dispatcher/ExpenseUploadScreen'

import './tasks/locationTask' // Must be imported at top level before app renders

const RootStack = createNativeStackNavigator()
const DriverStack = createNativeStackNavigator()
const DispatcherStack = createNativeStackNavigator()
const DispatcherTabs = createBottomTabNavigator()

// ---------------------------------------------------------------------------
// Driver navigator (phone OTP users)
// ---------------------------------------------------------------------------

function DriverRoot({ route }: any) {
  const phone = route?.params?.phone || ''
  return (
    <DriverStack.Navigator screenOptions={{ headerShown: false }}>
      <DriverStack.Screen name="Home" component={HomeScreen} initialParams={{ phone }} />
      <DriverStack.Screen name="ScanDocument" component={ScanDocumentScreen} />
      <DriverStack.Screen name="Chat" component={ChatScreen} />
      <DriverStack.Screen name="UpdateStatus" component={UpdateStatusScreen} />
    </DriverStack.Navigator>
  )
}

// ---------------------------------------------------------------------------
// Dispatcher navigator (email/password users)
// Bottom tabs nested inside a stack for DriverDetail + DispatcherChat modals
// ---------------------------------------------------------------------------

function DispatcherTabsNav() {
  return (
    <DispatcherTabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0D0F12', borderTopColor: '#1E2128', borderTopWidth: 1 },
        tabBarActiveTintColor: '#1D9E75',
        tabBarInactiveTintColor: '#6B7280',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <DispatcherTabs.Screen
        name="Drivers"
        component={DriversScreen}
        options={{ tabBarIcon: ({ focused }) => <Users size={20} color={focused ? '#1D9E75' : '#6B7280'} /> }}
      />
      <DispatcherTabs.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarIcon: ({ focused }) => <MapPin size={20} color={focused ? '#1D9E75' : '#6B7280'} /> }}
      />
      <DispatcherTabs.Screen
        name="Financials"
        component={FinancialsScreen}
        options={{ tabBarIcon: ({ focused }) => <DollarSign size={20} color={focused ? '#1D9E75' : '#6B7280'} /> }}
      />
    </DispatcherTabs.Navigator>
  )
}

function DispatcherRoot() {
  return (
    <DispatcherStack.Navigator screenOptions={{ headerShown: false }}>
      <DispatcherStack.Screen name="Tabs" component={DispatcherTabsNav} />
      <DispatcherStack.Screen name="DriverDetail" component={DriverDetailScreen} />
      <DispatcherStack.Screen name="DispatcherChat" component={DispatcherChatScreen} />
      <DispatcherStack.Screen name="LoadDetail" component={LoadDetailScreen} />
      <DispatcherStack.Screen name="RateConUpload" component={RateConUploadScreen} />
      <DispatcherStack.Screen name="DriverFinancials" component={DriverFinancialsScreen} />
      <DispatcherStack.Screen name="ManageCategories" component={ManageCategoriesScreen} />
      <DispatcherStack.Screen name="AddExpense" component={AddExpenseScreen} />
      <DispatcherStack.Screen name="ExpenseUpload" component={ExpenseUploadScreen} />
    </DispatcherStack.Navigator>
  )
}

// ---------------------------------------------------------------------------
// Root — decides driver vs dispatcher based on auth type
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Login" component={LoginScreen} />
        <RootStack.Screen name="DriverRoot" component={DriverRoot} />
        <RootStack.Screen name="DispatcherRoot" component={DispatcherRoot} />
      </RootStack.Navigator>
    </NavigationContainer>
  )
}
