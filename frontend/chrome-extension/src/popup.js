const statusEl = document.getElementById('status');
const apiUrlEl = document.getElementById('apiUrl');
const extensionKeyEl = document.getElementById('extensionKey');
const saveBtn = document.getElementById('saveBtn');
const runBtn = document.getElementById('runBtn');

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b91c1c' : '#065f46';
}

function setBadge(text, color) {
  chrome.runtime.sendMessage({ type: 'SET_BADGE', text, color });
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(['apiUrl', 'extensionKey']);
  apiUrlEl.value = settings.apiUrl || 'http://localhost:3000';
  extensionKeyEl.value = settings.extensionKey || '';
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiUrl: apiUrlEl.value.trim(),
    extensionKey: extensionKeyEl.value.trim(),
  });
  setStatus('Settings saved.');
}

async function getActiveDatTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url || !tab.url.startsWith('https://one.dat.com/')) {
    return null;
  }
  return tab;
}

async function runIngest() {
  const apiUrl = apiUrlEl.value.trim();
  const extensionKey = extensionKeyEl.value.trim();
  if (!apiUrl || !extensionKey) {
    setStatus('API URL and extension key are required.', true);
    return;
  }

  const tab = await getActiveDatTab();
  if (!tab) {
    setStatus('Open DAT One search page in active tab first.', true);
    return;
  }

  setBadge('RUN', '#2563eb');
  setStatus('Scraping DAT board and sending top scored loads...');

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'RUN_DISPATCH_INGEST',
    payload: { apiUrl, extensionKey },
  });

  if (!response?.ok) {
    setBadge('ERR', '#b91c1c');
    setStatus(response?.error || 'Ingest failed.', true);
    return;
  }

  setBadge('OK', '#16a34a');
  setStatus(
    `Ingested.\nreceived=${response.metrics.received} inserted=${response.metrics.inserted} duplicates=${response.metrics.duplicates} invalid=${response.metrics.invalid}`
  );
}

saveBtn.addEventListener('click', saveSettings);
runBtn.addEventListener('click', runIngest);
loadSettings();
