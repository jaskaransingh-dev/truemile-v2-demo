const SELECTORS = {
  row: 'div[id^="table-row-"].row-container',
  route: ':scope .row-cells .cell-route',
  rate: ':scope .row-cells .cell-rate',
  brokerName: ':scope .row-cells .cell-company-small',
  brokerDetails: ':scope .table-row-detail.expanded-detail-row dat-load-details dat-contacts',
};
const RETRY_DELAYS_MS = [5000, 15000, 60000];

function text(el) {
  return (el?.innerText || '').trim();
}

function parseMoney(value) {
  const n = Number((value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parsePhone(value) {
  const match = value.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : '';
}

function parseEmail(value) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function parseRouteText(routeText) {
  const compact = routeText.replace(/\s+/g, ' ').trim();
  const arrowMatch = compact.match(/(.+?)\s*(?:->|→|to)\s*(.+)/i);
  const milesMatch = compact.match(/(\d{2,5})\s*mi/i);
  const trailerMatch = compact.match(/\b(dry\s*van|reefer|flatbed)\b/i);
  const pickupMatch = compact.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);
  const deliveryMatch = compact.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b.*\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);

  return {
    origin: arrowMatch ? arrowMatch[1].trim() : '',
    destination: arrowMatch ? arrowMatch[2].replace(/\d+\s*mi.*/i, '').trim() : '',
    miles: milesMatch ? Number(milesMatch[1]) : 0,
    pickupDate: pickupMatch ? pickupMatch[1] : new Date().toISOString().slice(0, 10),
    deliveryDate: deliveryMatch ? deliveryMatch[2] : new Date().toISOString().slice(0, 10),
    trailerType: trailerMatch ? trailerMatch[1].toUpperCase().replace(/\s+/g, '_') : 'DRY_VAN',
  };
}

function scoreLoad(load) {
  const rpm = load.miles > 0 ? load.rate / load.miles : 0;
  return rpm * 100 + load.miles * 0.02;
}

function shouldRetry(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function sendIngestBatch({ apiUrl, extensionKey, payload }) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/api/integrations/dat/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Key': extensionKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED_EXTENSION_KEY');
      }

      if (!response.ok && shouldRetry(response.status) && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`INGEST_FAILED_${response.status}:${text}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message === 'UNAUTHORIZED_EXTENSION_KEY'
      ) {
        throw error;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  throw lastError || new Error('INGEST_RETRY_EXHAUSTED');
}

function scrapeCollapsedRows() {
  const rows = [...document.querySelectorAll(SELECTORS.row)];
  return rows.map((row) => {
    const routeText = text(row.querySelector(SELECTORS.route));
    const rateText = text(row.querySelector(SELECTORS.rate));
    const brokerName = text(row.querySelector(SELECTORS.brokerName));
    const route = parseRouteText(routeText);
    const load = {
      origin: route.origin,
      destination: route.destination,
      pickupDate: route.pickupDate,
      deliveryDate: route.deliveryDate,
      miles: route.miles,
      rate: parseMoney(rateText),
      brokerName: brokerName || null,
      brokerEmail: null,
      brokerPhone: null,
      trailerType: route.trailerType,
      postedAt: new Date().toISOString(),
    };
    return { row, load, score: scoreLoad(load) };
  });
}

async function expandAndExtractContacts(row) {
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 350));

  const detailsText = text(row.querySelector(SELECTORS.brokerDetails));
  return {
    brokerEmail: parseEmail(detailsText) || null,
    brokerPhone: parsePhone(detailsText) || null,
  };
}

async function runDispatchIngest({ apiUrl, extensionKey }) {
  const scraped = scrapeCollapsedRows()
    .filter((x) => x.load.origin && x.load.destination && x.load.miles > 0 && x.load.rate > 0)
    .sort((a, b) => b.score - a.score);

  if (!scraped.length) {
    throw new Error('No parseable load rows found.');
  }

  const top = scraped.slice(0, 10);
  const best = top[0];
  const contacts = await expandAndExtractContacts(best.row);
  best.load.brokerEmail = contacts.brokerEmail;
  best.load.brokerPhone = contacts.brokerPhone;

  const payload = {
    ingestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    loads: top.map((x) => x.load),
  };

  const result = await sendIngestBatch({
    apiUrl,
    extensionKey,
    payload,
  });

  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'RUN_DISPATCH_INGEST') return false;

  runDispatchIngest(message.payload)
    .then((metrics) => sendResponse({ ok: true, metrics }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Run failed' }));

  return true;
});
