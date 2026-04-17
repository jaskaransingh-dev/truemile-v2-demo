import { supabase } from './supabase'

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchCycle {
  id: string
  startDate: string
  endDate: string
  totalDays?: number
  daysRemaining?: number
}

export interface LoadStop {
  type: 'PICKUP' | 'DROP'
  city: string
  state: string
  address?: string | null
  appointment?: string | null
  sequence: number
}

export interface DispatcherDriver {
  id: string
  name: string
  driverId: number | null
  phoneNumber: string | null
  truckNumber: string | null
  trailerNumber: string | null
  homeBase: string | null
  trailerType: string | null
  targetRPM: number
  status: string | null
  currentLocation: string | null
  currentLat: number | null
  currentLon: number | null
  emptyLocation: string | null
  emptyTime: string | null
  cycle: DispatchCycle | null
}

export interface DispatchLoad {
  id: string
  driverId: string
  loadNumber: string | null
  status: string
  pickupCity: string | null
  pickupState: string | null
  pickupLat: number | null
  pickupLon: number | null
  pickupTime: string | null
  dropoffCity: string | null
  dropoffState: string | null
  dropoffLat: number | null
  dropoffLon: number | null
  deliveryTime: string | null
  rate: number | null
  loadedMiles: number | null
  loadedMilesSource: 'RATECON' | 'CALCULATED' | null
  deadheadMiles: number | null
  deadheadMilesSource: 'RATECON' | 'CALCULATED' | null
  stopCount: number | null
  stops: LoadStop[] | null
  brokerName: string | null
  brokerAgentName: string | null
  brokerEmail: string | null
  brokerPhone: string | null
  brokerMC: string | null
  rateConPath: string | null
  rateConUploadedAt: string | null
  bolPath: string | null
  bolUploadedAt: string | null
  podPath: string | null
  podUploadedAt: string | null
  driver?: { id: string; name: string }
}

export interface LoadDocuments {
  rateCon: { path: string; uploadedAt: string } | null
  bol:     { path: string; uploadedAt: string } | null
  pod:     { path: string; uploadedAt: string } | null
}

// ---------------------------------------------------------------------------
// Shared fetch helper with Supabase JWT
// ---------------------------------------------------------------------------

async function authFetch(path: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Request timed out — check server connection')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} failed: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function fetchDrivers(): Promise<DispatcherDriver[]> {
  const data = await jsonFetch<{ drivers: DispatcherDriver[] }>('/api/dispatcher/drivers')
  return data.drivers || []
}

export async function updateDriver(
  id: string,
  patch: { name?: string; truckNumber?: string; trailerNumber?: string; homeBase?: string; targetRPM?: number; trailerType?: string },
): Promise<DispatcherDriver> {
  const data = await jsonFetch<{ driver: DispatcherDriver }>(
    `/api/dispatcher/drivers/${id}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )
  return data.driver
}

export async function fetchDriver(id: string): Promise<DispatcherDriver> {
  const data = await jsonFetch<{ driver: DispatcherDriver }>(`/api/dispatcher/drivers/${id}`)
  return data.driver
}

export async function createDriver(body: {
  name: string
  phoneNumber: string
  truckNumber?: string
  trailerNumber?: string
  trailerType?: string
  homeBase?: string
  targetRPM?: number
}): Promise<DispatcherDriver> {
  const data = await jsonFetch<{ driver: DispatcherDriver }>(
    '/api/dispatcher/drivers',
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data.driver
}

export async function updateCycleEnd(driverId: string, endDate: string): Promise<DispatchCycle> {
  const data = await jsonFetch<{ cycle: DispatchCycle }>(
    `/api/dispatcher/drivers/${driverId}/cycle-end`,
    { method: 'PATCH', body: JSON.stringify({ endDate }) },
  )
  return data.cycle
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export async function putCycle(
  driverId: string,
  body: { startDate: string; endDate: string },
): Promise<DispatchCycle> {
  const data = await jsonFetch<{ cycle: DispatchCycle }>(
    `/api/drivers/${driverId}/cycle`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  return data.cycle
}

export async function startNewCycle(
  driverId: string,
  body: { daysOut?: number; daysHome?: number } = {},
): Promise<DispatchCycle> {
  const data = await jsonFetch<{ cycle: DispatchCycle }>(
    `/api/drivers/${driverId}/cycle/start-new`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data.cycle
}

export async function fetchCycles(driverId: string): Promise<DispatchCycle[]> {
  const data = await jsonFetch<{ cycles: DispatchCycle[] }>(`/api/drivers/${driverId}/cycles`)
  return data.cycles || []
}

// ---------------------------------------------------------------------------
// Loads
// ---------------------------------------------------------------------------

export async function fetchDriverLoads(driverId: string, month?: string): Promise<DispatchLoad[]> {
  const q = month ? `?month=${month}` : ''
  const data = await jsonFetch<{ loads: DispatchLoad[] }>(`/api/drivers/${driverId}/loads${q}`)
  return data.loads || []
}

export async function fetchAllLoads(driverId?: string): Promise<DispatchLoad[]> {
  const q = driverId ? `?driverId=${driverId}` : ''
  const data = await jsonFetch<{ loads: DispatchLoad[] }>(`/api/loads${q}`)
  return data.loads || []
}

export async function fetchLoad(id: string): Promise<DispatchLoad> {
  const data = await jsonFetch<{ load: DispatchLoad }>(`/api/loads/${id}`)
  return data.load
}

export async function updateLoad(id: string, patch: Partial<DispatchLoad>): Promise<DispatchLoad> {
  const data = await jsonFetch<{ load: DispatchLoad }>(
    `/api/loads/${id}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )
  return data.load
}

export async function createLoad(body: Partial<DispatchLoad> & { driverId: string }): Promise<DispatchLoad> {
  const data = await jsonFetch<{ load: DispatchLoad }>(
    `/api/loads`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data.load
}

export async function fetchLoadDocuments(loadId: string): Promise<LoadDocuments> {
  return await jsonFetch<LoadDocuments>(`/api/loads/${loadId}/documents`)
}

export async function deleteLoad(loadId: string): Promise<void> {
  await jsonFetch(`/api/loads/${loadId}`, { method: 'DELETE' })
}

export async function deleteCycle(driverId: string, cycleId: string): Promise<void> {
  await jsonFetch(`/api/drivers/${driverId}/cycles/${cycleId}`, { method: 'DELETE' })
}

export function rateConFileUrl(loadId: string): string {
  return `${API_BASE}/api/loads/${loadId}/documents/ratecon/file`
}

export async function calculateLoadMiles(loadId: string): Promise<DispatchLoad> {
  const data = await jsonFetch<{ load: DispatchLoad }>(
    `/api/loads/${loadId}/miles/calculate`,
    { method: 'POST' },
  )
  return data.load
}

/**
 * Upload a rate con PDF/image for a load as a dispatcher.
 * Separate from the driver-side /api/documents/upload used for BOL/POD.
 */
export async function uploadRateCon(loadId: string, uri: string, mimeType = 'image/jpeg'): Promise<void> {
  const formData = new FormData()
  formData.append('file', { uri, name: `ratecon-${loadId}.jpg`, type: mimeType } as any)
  const res = await authFetch(
    `/api/loads/${loadId}/documents/ratecon`,
    { method: 'POST', body: formData as any },
  )
  if (!res.ok) throw new Error(`Rate con upload failed: ${res.status}`)
}

// ---------------------------------------------------------------------------
// Rate con parser (reuses existing profit-engine Vision pipeline)
// ---------------------------------------------------------------------------

export interface ParsedRateCon {
  loadNumber?: string
  pickupCity?: string
  pickupState?: string
  dropoffCity?: string
  dropoffState?: string
  rate?: number
  loadedMiles?: number
  pickupTime?: string     // ISO
  deliveryTime?: string   // ISO
  stopCount?: number
  stops?: LoadStop[]
  brokerName?: string
  brokerAgentName?: string
  brokerEmail?: string
  brokerPhone?: string
  brokerMC?: string
}

/**
 * POST the raw rate con to the backend for Vision-based parsing.
 * The server parses it and returns structured fields. We then call createLoad().
 */
export async function parseRateCon(uri: string): Promise<ParsedRateCon> {
  const formData = new FormData()
  formData.append('file', { uri, name: `ratecon-${Date.now()}`, type: 'application/pdf' } as any)
  const res = await authFetch(
    `/api/loads/parse-ratecon`,
    { method: 'POST', body: formData as any },
    60000, // 60s timeout for Vision OCR
  )
  if (!res.ok) throw new Error(`Rate con parse failed: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Expense Category types
// ---------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string
  carrierId: string
  name: string
  type: 'FIXED' | 'VARIABLE' | 'DRIVER_PAY'
  scope: 'FLEET' | 'PER_DRIVER'
  defaultAmount: number | null
  active: boolean
  sortOrder: number
}

export interface FleetExpense {
  id: string
  categoryId: string
  category: { id: string; name: string; type: string; scope: string }
  driverId: string | null
  driver: { id: string; name: string } | null
  month: string
  amount: number
  notes: string | null
  source: string
}

export interface FleetKpis {
  revenue: number
  factoringFee: number
  factoringRate: number
  netRevenue: number
  fixedExpenses: number
  variableExpenses: number
  driverPay: number
  fuelExpenses: number
  totalExpenses: number
  netProfit: number
  profitMargin: number
  avgRPM: number
  totalMiles: number
  loadedMiles: number
  deadheadMiles: number
  utilization: number
  fuelPercent: number
  cpm: number
  totalLoads: number
  drivers: Array<{
    driverId: string
    name: string
    targetRPM: number
    revenue: number
    loads: number
    avgRPM: number
    loadedMiles: number
    netProfit: number
    profitMargin: number
  }>
}

export interface DriverKpis {
  revenue: number
  avgRPM: number
  loadedMiles: number
  deadheadMiles: number
  totalMiles: number
  utilization: number
  fuelPercent: number
  cpm: number
  netProfit: number
  profitMargin: number
  loadCount: number
}

export interface FleetSettings {
  id: string
  carrierId: string
  factoringRate: number
}

export interface ParsedExpenseItem {
  date: string
  description: string
  amount: number
  cardMember: string | null
  categoryId: string | null
  driverId: string | null
}

// ---------------------------------------------------------------------------
// Expense Categories
// ---------------------------------------------------------------------------

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  const data = await jsonFetch<{ categories: ExpenseCategory[] }>('/api/fleet/expense-categories')
  return data.categories || []
}

export async function createExpenseCategory(body: {
  name: string; type: string; scope: string; defaultAmount?: number; sortOrder?: number
}): Promise<ExpenseCategory> {
  const data = await jsonFetch<{ category: ExpenseCategory }>(
    '/api/fleet/expense-categories',
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data.category
}

export async function updateExpenseCategory(
  id: string,
  patch: Partial<ExpenseCategory>,
): Promise<ExpenseCategory> {
  const data = await jsonFetch<{ category: ExpenseCategory }>(
    `/api/fleet/expense-categories/${id}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )
  return data.category
}

export async function deleteExpenseCategory(id: string): Promise<void> {
  await jsonFetch(`/api/fleet/expense-categories/${id}`, { method: 'DELETE' })
}

export async function seedExpenseCategories(): Promise<{ message: string; count: number }> {
  return jsonFetch('/api/fleet/expense-categories/seed', { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Fleet KPIs
// ---------------------------------------------------------------------------

export async function fetchFleetKpis(month?: string): Promise<FleetKpis> {
  const q = month ? `?month=${month}` : ''
  return jsonFetch<FleetKpis>(`/api/fleet/kpis${q}`)
}

// ---------------------------------------------------------------------------
// Driver KPIs
// ---------------------------------------------------------------------------

export async function fetchDriverKpis(driverId: string, month?: string): Promise<DriverKpis> {
  const q = month ? `?month=${month}` : ''
  return jsonFetch<DriverKpis>(`/api/fleet/drivers/${driverId}/kpis${q}`)
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function fetchFleetExpenses(month?: string): Promise<FleetExpense[]> {
  const q = month ? `?month=${month}` : ''
  const data = await jsonFetch<{ expenses: FleetExpense[] }>(`/api/fleet/expenses${q}`)
  return data.expenses || []
}

export async function fetchDriverExpenses(driverId: string, month?: string): Promise<FleetExpense[]> {
  const q = month ? `?month=${month}&driverId=${driverId}` : `?driverId=${driverId}`
  const data = await jsonFetch<{ expenses: FleetExpense[] }>(`/api/fleet/expenses${q}`)
  return data.expenses || []
}

export async function createExpense(body: {
  categoryId: string; driverId?: string; month?: string; amount: number; notes?: string
}): Promise<FleetExpense> {
  const data = await jsonFetch<{ expense: FleetExpense }>(
    '/api/fleet/expenses',
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data.expense
}

export async function bulkCreateExpenses(
  expenses: Array<{ categoryId: string; driverId?: string; month: string; amount: number; notes?: string; source?: string }>,
): Promise<{ created: number }> {
  return jsonFetch('/api/fleet/expenses/bulk-create', {
    method: 'POST',
    body: JSON.stringify({ expenses }),
  })
}

export async function updateExpense(id: string, patch: Partial<FleetExpense>): Promise<FleetExpense> {
  const data = await jsonFetch<{ expense: FleetExpense }>(
    `/api/fleet/expenses/${id}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )
  return data.expense
}

export async function deleteExpense(id: string): Promise<void> {
  await jsonFetch(`/api/fleet/expenses/${id}`, { method: 'DELETE' })
}

export async function uploadExpenseFile(uri: string, filename: string): Promise<{
  items: ParsedExpenseItem[]
  categories: Array<{ id: string; name: string; type: string }>
  drivers: Array<{ id: string; name: string }>
}> {
  const formData = new FormData()
  const ext = filename.toLowerCase().endsWith('.xlsx') ? 'xlsx' : filename.toLowerCase().endsWith('.csv') ? 'csv' : 'pdf'
  const mime = ext === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : ext === 'csv' ? 'text/csv' : 'application/pdf'
  formData.append('file', { uri, name: filename, type: mime } as any)
  const res = await authFetch(
    '/api/fleet/expenses/upload',
    { method: 'POST', body: formData as any },
    30000,
  )
  if (!res.ok) throw new Error(`Expense upload failed: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Fleet Settings
// ---------------------------------------------------------------------------

export async function fetchFleetSettings(): Promise<FleetSettings> {
  const data = await jsonFetch<{ settings: FleetSettings }>('/api/fleet/settings')
  return data.settings
}

export async function updateFleetSettings(patch: { factoringRate: number }): Promise<FleetSettings> {
  const data = await jsonFetch<{ settings: FleetSettings }>(
    '/api/fleet/settings',
    { method: 'PUT', body: JSON.stringify(patch) },
  )
  return data.settings
}
