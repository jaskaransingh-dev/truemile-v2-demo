const FIELDS = [
  'backendUrl', 'homeCity', 'homeState', 'avoidStates',
  'minRPM', 'targetRPM', 'variableCPM', 'factoringRate',
  'avgDailyMiles', 'cycleDays', 'homeDays', 'completedCycles', 'cycleStartDate',
];

const TOGGLE_FIELDS = ['rejectDropTrailer', 'rejectTeamLoads'];

const CALC_FIELDS = [
  'calcTruckPayment', 'calcTrailerPayment', 'calcInsurance', 'calcRepairs',
  'calcOtherFixed', 'calcDriverPay', 'calcFuelCost', 'calcOtherVariable',
  'calcAvgMilesMonth',
];

const ALL_KEYS = [...FIELDS, ...CALC_FIELDS, ...TOGGLE_FIELDS];

function num(id) {
  return parseFloat(document.getElementById(id)?.value) || 0;
}

function showBreakdown() {
  const fixed = num('calcTruckPayment') + num('calcTrailerPayment') + num('calcInsurance')
              + num('calcRepairs') + num('calcOtherFixed');
  const variable = num('calcDriverPay') + num('calcFuelCost') + num('calcOtherVariable');
  const milesMonth = num('calcAvgMilesMonth') || 10000;
  const fixedCPM = fixed / milesMonth;
  const allIn = fixedCPM + variable;
  if (fixed > 0 || variable > 0) {
    document.getElementById('cpmBreakdown').textContent =
      `Fixed: $${fixedCPM.toFixed(3)} + Variable: $${variable.toFixed(3)} = $${allIn.toFixed(3)}/mi`;
  }
  return allIn;
}

// ---------------------------------------------------------------------------
// Save a single key to chrome.storage.local immediately
// ---------------------------------------------------------------------------
function saveField(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    console.log(`[popup] auto-saved ${key}:`, value);
  });
}

function saveAllFields() {
  const values = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (!el) continue;
    values[key] = el.value.trim();
  }
  for (const key of TOGGLE_FIELDS) {
    const el = document.getElementById(key);
    if (el) values[key] = el.checked;
  }
  for (const key of CALC_FIELDS) {
    const el = document.getElementById(key);
    if (el) values[key] = el.value.trim();
  }
  chrome.storage.local.set(values, () => {
    console.log('[popup] all fields saved:', Object.keys(values).join(', '));
    const status = document.getElementById('status');
    status.textContent = 'Saved.';
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
}

// ---------------------------------------------------------------------------
// Load saved values on popup open
// ---------------------------------------------------------------------------
chrome.storage.local.get(ALL_KEYS, (data) => {
  console.log('[popup] storage loaded, keys found:', Object.keys(data).filter(k => data[k] != null).length);

  // Text/number inputs
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el && data[key] != null) el.value = data[key];
  }

  // Calculator inputs
  for (const key of CALC_FIELDS) {
    const el = document.getElementById(key);
    if (el && data[key] != null) el.value = data[key];
  }

  // Toggle checkboxes (default true if not set)
  for (const key of TOGGLE_FIELDS) {
    const el = document.getElementById(key);
    if (el) el.checked = data[key] !== false;
  }

  // Default cycleStartDate to today if empty
  const dateEl = document.getElementById('cycleStartDate');
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().substring(0, 10);
  }

  showBreakdown();

});

// ---------------------------------------------------------------------------
// Auto-save on every input change — no Save button click required
// ---------------------------------------------------------------------------

// Text/number inputs — save on change (fires after blur with a new value)
for (const key of [...FIELDS, ...CALC_FIELDS]) {
  const el = document.getElementById(key);
  if (!el) continue;
  el.addEventListener('change', () => {
    saveField(key, el.value.trim());
    if (CALC_FIELDS.includes(key)) showBreakdown();
  });
}

// Toggle checkboxes — save on change
for (const key of TOGGLE_FIELDS) {
  const el = document.getElementById(key);
  if (!el) continue;
  el.addEventListener('change', () => {
    saveField(key, el.checked);
  });
}

// ---------------------------------------------------------------------------
// Save All button — still available as a manual "save everything" action
// ---------------------------------------------------------------------------
document.getElementById('save').addEventListener('click', saveAllFields);

// ---------------------------------------------------------------------------
// Calculator UI
// ---------------------------------------------------------------------------

// Toggle calculator visibility
document.getElementById('calcToggle').addEventListener('click', () => {
  const section = document.getElementById('calcSection');
  const toggle = document.getElementById('calcToggle');
  section.classList.toggle('open');
  toggle.innerHTML = section.classList.contains('open')
    ? 'Calculate from cost structure &#9650;'
    : 'Calculate from cost structure &#9660;';
});

// Calculate CPM and auto-populate
document.getElementById('calcBtn').addEventListener('click', () => {
  const allIn = showBreakdown();
  if (allIn > 0) {
    const cpmEl = document.getElementById('variableCPM');
    cpmEl.value = allIn.toFixed(3);
    saveField('variableCPM', cpmEl.value);
  }
});

// Clear calculator
document.getElementById('calcClear').addEventListener('click', () => {
  for (const key of CALC_FIELDS) {
    const el = document.getElementById(key);
    if (el) el.value = '';
  }
  document.getElementById('cpmBreakdown').textContent = '';
  document.getElementById('calcSection').classList.remove('open');
  document.getElementById('calcToggle').innerHTML = 'Calculate from cost structure &#9660;';
  // Clear from storage too
  const clearObj = {};
  for (const key of CALC_FIELDS) clearObj[key] = '';
  chrome.storage.local.set(clearObj);
});
