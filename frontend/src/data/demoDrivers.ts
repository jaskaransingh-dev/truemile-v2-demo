// ---------------------------------------------------------------------------
// Shared seed data for DispatchDemo pages
// ---------------------------------------------------------------------------

export interface Load {
  loadId: string;
  pickup: string;
  pickupTime: string;
  deadhead: number;
  dropoff: string;
  dropoffTime: string;
  rate: number;
  miles: number;
  rpm: number;
}

export interface CalendarDay {
  date: number;       // day of month
  month: string;      // 'Mar' | 'Apr'
  type: 'loaded' | 'empty' | 'home' | 'booked';
  label?: string;     // tooltip / legend text
}

export interface CycleData {
  cycleStarted: string;
  homeCity: string;
  homeByDate: string;
  cycleDays: number;
  revenue: number;
  netProfit: number;
  avgRPM: number;
  milesDriven: number;
  utilization: number;
  fuelPct: number;
  cpm: number;
  loads: Load[];
  calendar: CalendarDay[];
  selectedMonth: string;
}

export type StatusColor = 'amber' | 'green' | 'blue' | 'red' | 'teal';

export interface Driver {
  name: string;
  id: number;
  equipmentType: string;
  currentLocation: string;
  emptyLocation: string;
  emptyTime: string;
  emptyTimeSortKey: number;
  status: string;
  statusColor: StatusColor;
  cycle?: CycleData;
}

export const BADGE_STYLES: Record<StatusColor, { bg: string; text: string }> = {
  amber: { bg: '#854F0B', text: '#FAC775' },
  green: { bg: '#1D4D2E', text: '#4ADE80' },
  blue:  { bg: '#1E3A5F', text: '#60A5FA' },
  red:   { bg: '#4A1515', text: '#F87171' },
  teal:  { bg: '#0F6E56', text: '#4ADE80' },
};

// Rate con result stored in localStorage for cross-page demo state
export const RATE_CON_KEY = 'truemile_demo_ratecon';

export interface RateConResult {
  driverName: string;
  driverId: number;
  loadId: string;
  pickup: string;
  pickupTime: string;
  delivery: string;
  deliveryTime: string;
  rate: number;
  miles: number;
}

export const DEMO_RATE_CON: RateConResult = {
  driverName: 'Max',
  driverId: 106,
  loadId: '124124-APR',
  pickup: 'Atlanta, GA',
  pickupTime: 'Apr 8, 2026 · 11:30 AM',
  delivery: 'Indianapolis, IN',
  deliveryTime: 'Apr 9, 2026 · 7:00 AM',
  rate: 1800,
  miles: 534,
};

// ---------------------------------------------------------------------------
// Max — Driver 106 — March 2026 cycle
// ---------------------------------------------------------------------------

const MAX_CYCLE: CycleData = {
  cycleStarted: 'Mar 19, 2026',
  homeCity: 'Dallas, TX',
  homeByDate: 'Mar 30, 2026',
  cycleDays: 11,
  revenue: 42650,
  netProfit: 18720,
  avgRPM: 3.20,
  milesDriven: 13337,
  utilization: 93,
  fuelPct: 27,
  cpm: 1.80,
  selectedMonth: 'Mar 2026',
  loads: [
    { loadId: '124124',  pickup: 'Charleston, SC',  pickupTime: '9:00 AM · Mar 23',  deadhead: 35, dropoff: 'Kansas City, KS', dropoffTime: '5:00 AM · Mar 25',  rate: 3500, miles: 1106, rpm: 3.07 },
    { loadId: '4634562', pickup: 'Olathe, KS',      pickupTime: '9:00 AM · Mar 25',  deadhead: 22, dropoff: 'Appleton, WI',    dropoffTime: '5:00 AM · Mar 26',  rate: 2100, miles: 597,  rpm: 3.39 },
    { loadId: '45434',   pickup: 'Green Bay, WI',   pickupTime: '9:00 AM · Mar 26',  deadhead: 30, dropoff: 'Cleveland, OH',   dropoffTime: '11:00 AM · Mar 27', rate: 2200, miles: 551,  rpm: 3.79 },
    { loadId: '234214',  pickup: 'Cleveland, OH',   pickupTime: '3:00 PM · Mar 27',  deadhead: 25, dropoff: 'Dallas, TX',      dropoffTime: '10:00 AM · Mar 30', rate: 3900, miles: 1182, rpm: 3.23 },
  ],
  calendar: [
    // Mar 19-22: cycle start / deadhead to first pickup
    { date: 19, month: 'Mar', type: 'home',   label: 'Cycle start — Dallas' },
    { date: 20, month: 'Mar', type: 'empty',  label: 'Deadhead to Charleston' },
    { date: 21, month: 'Mar', type: 'empty',  label: 'Deadhead to Charleston' },
    { date: 22, month: 'Mar', type: 'empty',  label: 'Deadhead to Charleston' },
    // Mar 23-25: Load 124124 Charleston → KC
    { date: 23, month: 'Mar', type: 'loaded', label: 'Charleston → KC' },
    { date: 24, month: 'Mar', type: 'loaded', label: 'Charleston → KC' },
    { date: 25, month: 'Mar', type: 'loaded', label: 'Arrive KC / Load Olathe → Appleton' },
    // Mar 26: Load 4634562 + Load 45434
    { date: 26, month: 'Mar', type: 'loaded', label: 'Green Bay → Cleveland' },
    // Mar 27-30: Load 234214 Cleveland → Dallas
    { date: 27, month: 'Mar', type: 'loaded', label: 'Cleveland → Dallas' },
    { date: 28, month: 'Mar', type: 'loaded', label: 'Cleveland → Dallas' },
    { date: 29, month: 'Mar', type: 'loaded', label: 'Cleveland → Dallas' },
    { date: 30, month: 'Mar', type: 'home',   label: 'Home — Dallas' },
    { date: 31, month: 'Mar', type: 'home',   label: 'Home' },
    // Apr
    { date: 1,  month: 'Apr', type: 'loaded', label: 'New cycle' },
  ],
};

// ---------------------------------------------------------------------------
// All drivers
// ---------------------------------------------------------------------------

const DRIVERS_UNSORTED: Driver[] = [
  { name: 'Max',  id: 106, equipmentType: 'REEFER',  currentLocation: 'Atlanta, GA',     emptyLocation: 'Atlanta, GA',     emptyTime: 'Apr 8 · 8:00 AM',  emptyTimeSortKey: 1, status: 'Emptying Now',                     statusColor: 'amber', cycle: MAX_CYCLE },
  { name: 'John', id: 109, equipmentType: 'DRY VAN', currentLocation: 'Kansas City, KS', emptyLocation: 'Kansas City, KS', emptyTime: 'Apr 8 · 9:00 AM',  emptyTimeSortKey: 2, status: 'Checked-In to Receiver',           statusColor: 'green' },
  { name: 'Paul', id: 107, equipmentType: 'REEFER',  currentLocation: 'Minneapolis, MN', emptyLocation: 'Chicago, IL',     emptyTime: 'Apr 9 · 7:00 AM',  emptyTimeSortKey: 3, status: 'On-Time En Route',                 statusColor: 'blue' },
  { name: 'Mike', id: 108, equipmentType: 'REEFER',  currentLocation: 'Birmingham, AL',  emptyLocation: 'Dallas, TX',      emptyTime: 'Apr 10 · 9:00 AM', emptyTimeSortKey: 4, status: 'Behind Schedule \u00b7 1 hr',      statusColor: 'red' },
];

export const DRIVERS = DRIVERS_UNSORTED.sort((a, b) => a.emptyTimeSortKey - b.emptyTimeSortKey);

export const DEMO_STATS = [
  { label: 'Active Drivers',     value: '4' },
  { label: 'Loads Needed Today', value: '2' },
];

export function getDriverByName(name: string): Driver | undefined {
  return DRIVERS.find(d => d.name.toLowerCase() === name.toLowerCase());
}
