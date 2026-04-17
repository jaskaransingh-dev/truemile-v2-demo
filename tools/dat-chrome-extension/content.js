/**
 * TrueMile DAT Ranker — content script
 * Runs on: https://one.dat.com/search-loads*
 *
 * 1. Injects a sidebar into the DAT page.
 * 2. On "Rank Loads" click: scrapes visible load rows from the DAT search results table.
 * 3. Sends candidate loads to /api/dev/dispatch/rank-loads-v2.
 * 4. Renders ranked + rejected results in the sidebar.
 * 5. Highlights top 2 rows directly in the DAT table.
 */

(function () {
  'use strict';

  // Avoid double-injection on SPA navigations
  if (document.getElementById('truemile-sidebar')) return;

  // ---------------------------------------------------------------------------
  // Auto-fill DAT origin from URL query param (?origin=Atlanta%2C+GA)
  // ---------------------------------------------------------------------------

  (function autoFillOrigin() {
    const params = new URLSearchParams(window.location.search);
    const rawOrigin = params.get('origin');
    if (!rawOrigin) return;

    const origin = decodeURIComponent(rawOrigin).replace(/\+/g, ' ');
    console.log('[TM-autofill] origin from URL:', origin);

    var nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    function findInput() {
      return document.querySelector('input.mat-autocomplete-trigger')
          || document.querySelector('input[data-test*="origin"]')
          || document.querySelector('input[placeholder*="Origin"]')
          || document.querySelector('input[aria-label*="Origin"]');
    }

    function applyValue(input, label) {
      if (nativeSetter) {
        nativeSetter.call(input, origin);
      } else {
        input.value = origin;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[TM-autofill]', label, '— value set to:', input.value);
    }

    // Step 0: wait for input to appear in DOM
    var attempt = 0;
    var maxAttempts = 10;
    var pollId = setInterval(function () {
      attempt++;
      var input = findInput();
      if (!input) {
        if (attempt >= maxAttempts) {
          console.log('[TM-autofill] origin input not found after', maxAttempts, 'attempts');
          clearInterval(pollId);
        }
        return;
      }
      clearInterval(pollId);

      // Step 1: first set
      applyValue(input, 'pass 1');

      // Step 2: re-apply after 1500ms (Angular may reinit the form)
      setTimeout(function () {
        var el = findInput();
        if (el) applyValue(el, 'pass 2');

        // Step 3: final set after another 1000ms with full event sequence
        setTimeout(function () {
          var el2 = findInput();
          if (!el2) return;
          el2.dispatchEvent(new Event('focus', { bubbles: true }));
          applyValue(el2, 'pass 3');
          el2.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          el2.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

          // Step 4: blur to lock in the value
          setTimeout(function () {
            document.body.click();
            var el3 = findInput();
            if (el3) el3.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log('[TM-autofill] complete — final value:', el3 ? el3.value : '(no input)');
          }, 500);
        }, 1000);
      }, 1500);
    }, 300);
  })();

  // ---------------------------------------------------------------------------
  // Module-level settings cache — loaded once on inject
  // ---------------------------------------------------------------------------

  // Track the currently open DAT detail panel row
  let currentlyOpenRow = null;

  // Walk up from el to find the nearest ancestor with class containing 'row-cells'
  function getClickableRow(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.className && typeof node.className === 'string' &&
          node.className.includes('row-cells')) {
        return node;
      }
      node = node.parentElement;
    }
    return el; // fallback to original
  }

  /**
   * Poll for a matching dat-route row in the virtualized DAT list.
   * Matches by origin city, dest city, and rate (all case-insensitive, rate ±$1).
   * Retries every 200ms up to 10 times. Returns the matched row element or null.
   */
  /**
   * Search currently visible dat-route elements for a match by origin, dest, and rate.
   * Returns the matching element or null if not found in the current DOM.
   */
  function findRowInDOM(originCity, destCity, rate) {
    const routes = document.querySelectorAll('dat-route');
    for (const route of routes) {
      const originCell = route.querySelector('[data-test="load-origin-cell"]');
      const rowOrigin  = originCell?.querySelector('.truncate')?.textContent?.trim() || '';
      const destCell   = route.querySelector('[data-test="load-destination-cell"]');
      const rowDest    = destCell?.querySelector('.truncate')?.textContent?.trim() || '';
      const hasOrigin  = !originCity || rowOrigin.toLowerCase().includes(originCity.toLowerCase());
      const hasDest    = !destCity || rowDest.toLowerCase().includes(destCity.toLowerCase());
      let hasRate = !rate;
      if (rate) {
        const rowCells = route.parentElement?.parentElement;
        if (rowCells) {
          const rateEl = rowCells.querySelector('.offer, [class*="rate"]');
          if (rateEl) {
            hasRate = Math.abs(parseDollars(rateEl.textContent || '') - rate) <= 1;
          }
        }
      }
      if (hasOrigin && hasDest && hasRate) return route;
    }
    return null;
  }

  /**
   * Find a dat-route row by scrolling through the virtualized DAT list.
   * 1. Check current DOM
   * 2. Reset to top, wait, check again
   * 3. Scroll down in increments, checking after each step
   * Returns the matched element or null.
   */
  async function scrollAndFindRow(originCity, destCity, rate) {
    console.log(`[TM-scroll-find] searching: origin="${originCity}" dest="${destCity}" rate=${rate}`);

    // Step 1: check current DOM
    let match = findRowInDOM(originCity, destCity, rate);
    if (match) {
      console.log('[TM-scroll-find] found in current DOM');
      return match;
    }

    const viewport = document.querySelector('cdk-virtual-scroll-viewport');
    if (!viewport) {
      console.log('[TM-scroll-find] no viewport found');
      return null;
    }

    // Step 2: reset to top
    viewport.scrollTop = 0;
    await new Promise(r => setTimeout(r, 800));
    match = findRowInDOM(originCity, destCity, rate);
    if (match) {
      console.log('[TM-scroll-find] found after reset to top');
      return match;
    }

    // Step 3: scroll down in increments
    const step = viewport.clientHeight * 2;
    const maxIncrements = 15;
    for (let i = 0; i < maxIncrements; i++) {
      viewport.scrollTop += step;
      await new Promise(r => setTimeout(r, 600));
      match = findRowInDOM(originCity, destCity, rate);
      if (match) {
        console.log(`[TM-scroll-find] found at scroll increment ${i + 1}`);
        return match;
      }
      // Stop if we've hit the bottom
      if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 50) {
        console.log('[TM-scroll-find] reached bottom of list');
        break;
      }
    }

    console.log('[TM-scroll-find] row not found after full scroll');
    return null;
  }

  let cachedSettings = {
    backendUrl:        'http://localhost:3000',
    homeCity:          'Dallas',
    homeState:         'TX',
    avoidStates:       '',
    minRPM:            '1.62',
    targetRPM:         '1.86',
    variableCPM:       '1.606',
    factoringRate:     '0.018',
    avgDailyMiles:     '650',
    cycleDays:         '11',
    homeDays:          '2',
    completedCycles:   '0',
    cycleStartDate:    new Date().toISOString().substring(0, 10),
    rejectDropTrailer: true,
    rejectTeamLoads:   true,
  };

  // Load from storage on init — non-blocking
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(Object.keys(cachedSettings), (stored) => {
      cachedSettings = { ...cachedSettings, ...stored };
    });
  }

  // ---------------------------------------------------------------------------
  // Emailed load tracking — persisted dedup keys of loads already emailed
  // ---------------------------------------------------------------------------

  let emailedLoadKeys = new Set();

  function emailedDedupKey(destCity, rate, brokerName) {
    return `${(destCity || '').trim().toLowerCase()}_${rate}_${(brokerName || '').trim().toLowerCase()}`;
  }

  function persistEmailedKeys() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ emailedLoadIds: [...emailedLoadKeys] });
    }
  }

  // Load emailed keys from storage on init
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['emailedLoadIds'], (data) => {
      if (Array.isArray(data.emailedLoadIds)) {
        emailedLoadKeys = new Set(data.emailedLoadIds);
        console.log(`[TM] loaded ${emailedLoadKeys.size} emailed load keys from storage`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Sidebar DOM
  // ---------------------------------------------------------------------------

  const sidebar = document.createElement('div');
  sidebar.id = 'truemile-sidebar';
  sidebar.innerHTML = `
    <div id="truemile-sidebar-header">
      <h3>TrueMile Ranker</h3>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="truemile-clear-emailed" style="background:none;border:1px solid #334155;border-radius:4px;color:#94a3b8;font-size:10px;cursor:pointer;padding:2px 6px;line-height:1;" title="Clear emailed load history">Clear emailed</button>
        <button id="truemile-rank-btn">Rank Loads</button>
        <button id="truemile-toggle-btn" style="background:none;border:1px solid #334155;border-radius:4px;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px 7px;line-height:1;">\u2013</button>
      </div>
    </div>
    <div id="truemile-sidebar-body">
      <div class="tm-status" id="tm-status">Load the DAT search results, then click Rank Loads.</div>
      <div id="tm-results"></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // Push DAT page content left so the sidebar doesn't cover it
  document.body.style.marginRight = '320px';

  const rankBtn    = document.getElementById('truemile-rank-btn');
  const statusEl   = document.getElementById('tm-status');
  const resultsEl  = document.getElementById('tm-results');
  const toggleBtn  = document.getElementById('truemile-toggle-btn');

  // Minimize/expand toggle — collapses sidebar to a 40px top bar
  let sidebarMinimized = false;
  function setSidebarMinimized(minimized) {
    sidebarMinimized = minimized;
    if (minimized) {
      sidebar.style.width = '180px';
      sidebar.style.height = '40px';
      sidebar.style.overflow = 'hidden';
      rankBtn.style.display = 'none';
      document.body.style.marginRight = '180px';
      toggleBtn.textContent = '\uFF0B';
    } else {
      sidebar.style.width = '320px';
      sidebar.style.height = '100vh';
      sidebar.style.overflow = 'auto';
      rankBtn.style.display = '';
      document.body.style.marginRight = '320px';
      toggleBtn.textContent = '\u2013';
    }
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ sidebarMinimized: minimized });
    }
  }
  toggleBtn.addEventListener('click', () => {
    setSidebarMinimized(!sidebarMinimized);
  });

  // "Clear emailed" button — resets emailed load tracking
  const clearEmailedBtn = document.getElementById('truemile-clear-emailed');
  clearEmailedBtn.addEventListener('click', () => {
    emailedLoadKeys.clear();
    persistEmailedKeys();
    clearEmailedBtn.textContent = 'Cleared!';
    setTimeout(() => { clearEmailedBtn.textContent = 'Clear emailed'; }, 1500);
    console.log('[TM] emailed load keys cleared');
  });
  // Restore minimized state from storage on load
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['sidebarMinimized'], (data) => {
      if (data.sidebarMinimized) setSidebarMinimized(true);
    });
  }

  rankBtn.addEventListener('click', runRanker);

  // ---------------------------------------------------------------------------
  // Scrape DAT load rows
  // ---------------------------------------------------------------------------

  /**
   * Returns an array of raw row objects scraped from the visible DAT results table.
   * DAT uses various Angular/custom-element table structures — this targets the most
   * common patterns as of 2026. Adjust selectors if DAT updates their DOM.
   *
   * Each returned object has the shape:
   * {
   *   rowEl: Element,      // the <tr> or row container
   *   id: string,          // synthetic ID (index-based if no data-id found)
   *   originCity: string,
   *   originState: string,
   *   destCity: string,
   *   destState: string,
   *   trailerType: string, // e.g. 'DRY_VAN', 'REEFER', 'FLATBED', 'FLEX'
   *   rate: number,        // total payout
   *   miles: number,       // loaded miles
   *   deadheadMiles: number,
   *   pickupDate: string,  // ISO date YYYY-MM-DD (or today if not found)
   * }
   */
  function scrapeRows() {
    // DAT one.dat.com search results render each route inside a <dat-route> custom element.
    // dat-route lives inside .cell-route → .row-cells. Sibling cells (.offer, .cell-company-small)
    // live in the same .row-cells grandparent div.
    const rows = Array.from(document.querySelectorAll('dat-route'));

    if (rows.length === 0) {
      const empty = [];
      empty.domWarning = true;
      return empty;
    }

    const today = new Date().toISOString().substring(0, 10);
    const results = [];

    rows.forEach((row, idx) => {
      try {
        // Helpers: inner queries within dat-route; outer queries within the row-cells grandparent.
        const inner = (sel) => {
          const el = row.querySelector(sel);
          return el ? el.textContent.trim() : '';
        };
        const rowCells = row.parentElement && row.parentElement.parentElement;
        const outer = (sel) => {
          if (!rowCells) return '';
          const el = rowCells.querySelector(sel);
          return el ? el.textContent.trim() : '';
        };

        // Origin / Destination — read city and state separately from confirmed selectors
        const originCell  = row.querySelector('[data-test="load-origin-cell"]');
        const originCity  = originCell?.querySelector('.city-state-container:first-child .truncate')?.textContent?.trim()
                         || originCell?.querySelector('.truncate')?.textContent?.trim() || '';
        const originState = originCell?.querySelector('.city-state-container:first-child .state')?.textContent?.trim()
                         || originCell?.querySelector('.state')?.textContent?.trim() || '';

        const destCell  = row.querySelector('[data-test="load-destination-cell"]');
        const destCity  = destCell?.querySelector('.truncate')?.textContent?.trim() || '';
        const destState = destCell?.querySelector('.state')?.textContent?.trim() || '';

        if (!originCity || !destCity) return; // skip unparseable rows

        // Rate — in sibling .offer cell in the row-cells grandparent
        const rateText = outer('.offer') || outer('[class*="rate"]') || '';
        const rate     = parseDollars(rateText);
        if (rate <= 0) return; // skip rows without a rate

        // Miles — inside dat-route
        const milesText = inner('[data-test="load-trip-cell"]') || '';
        const miles     = parseFloat(milesText.replace(/[^0-9.]/g, '')) || 500;

        // Deadhead — strip parentheses e.g. '(32)' → 32
        const dhEl     = row.querySelector('[data-test="load-dho-cell"] .deadhead');
        const dhText   = dhEl ? dhEl.textContent.trim() : '';
        const deadhead = parseFloat(dhText.replace(/[^0-9.]/g, '')) || 0;

        // Trailer type — inside dat-route
        // DAT equipment codes: R=Reefer, RM=Reefer+team, VR=Van or Reefer, V=Van, F=Flatbed
        const equipRaw = (inner('[data-test="equipment-type"]') || inner('[data-test*="equip"]') || '').trim();
        const equipMap = {
          'R':  'REEFER',
          'RM': 'REEFER',
          'VR': 'FLEX',
          'V':  'DRY_VAN',
          'VM': 'DRY_VAN',
          'F':  'FLATBED',
        };
        const trailerType = equipMap[equipRaw.toUpperCase()] || 'FLEX';

        // Pickup date — inside dat-route; use today as fallback; no fake delivery datetimes
        const pickupText = inner('[data-test="pickup-date"]') || inner('[data-test*="pickup"]') || '';
        const pickupDate = parseDate(pickupText) || today;

        // Broker / company name — in sibling company cell in row-cells grandparent
        const companyCell = rowCells?.querySelector('[class*="cell-company-small"]')
                         || rowCells?.querySelector('[class*="company"]');
        const companyText = companyCell?.textContent?.trim() || '';
        const companyParts = companyText.split('|').map(s => s.trim());
        const brokerName = companyParts[companyParts.length - 1] || '';

        // Broker email — extract from contact column mailto link or text at scrape time
        let brokerEmail = '';
        if (rowCells) {
          const mailtoEl = rowCells.querySelector('a[href^="mailto:"]');
          if (mailtoEl) {
            brokerEmail = mailtoEl.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
          }
          if (!brokerEmail) {
            brokerEmail = extractEmail(companyText) || '';
          }
        }

        // Capacity / load type — check for "Partial" in the row (table-visible, no panel needed)
        const capacityText = (inner('[data-test*="capacity"]') || inner('[data-test*="load-type"]')
                           || outer('[class*="capacity"]') || '').toLowerCase();
        const loadTypeText = (inner('[data-test*="load"]') || '').toLowerCase();
        let exclusionCode = null;
        if (capacityText.includes('partial') || loadTypeText.includes('partial')) {
          exclusionCode = 'PARTIAL';
        }

        // Team load detection — RM equipment code or "team"/"w/team" in equipment text
        const isTeamLoad = equipRaw.toUpperCase() === 'RM'
          || /\bteam\b/i.test(equipRaw)
          || /w\/\s*team/i.test(equipRaw)
          || /with\s+team/i.test(equipRaw);
        if (!exclusionCode && isTeamLoad && cachedSettings.rejectTeamLoads !== false) {
          exclusionCode = 'TEAM_LOAD';
        }

        // Full row text scan — catches reload, multidrop, drop trailer in commodity/comments/any field
        if (!exclusionCode) {
          const fullRowText = (rowCells || row).textContent.toLowerCase();
          if (idx < 5) console.log(`[ROW-TEXT] row ${idx}:`, JSON.stringify(fullRowText.substring(0, 200)));
          if (/\bre-?load(ing)?\b/i.test(fullRowText)) {
            exclusionCode = 'RELOAD';
          } else if (
            /multi[.\s-]?drop/i.test(fullRowText) ||
            /multi[.\s-]?stop/i.test(fullRowText) ||
            /multiple\s+stops/i.test(fullRowText) ||
            /\b([5-9]|\d{2,})\s*stops?\b/i.test(fullRowText) ||
            /\b([5-9]|\d{2,})\s*drops?\b/i.test(fullRowText) ||
            /\b(five|six|seven|eight|nine|ten)\s*(stops?|drops?)\b/i.test(fullRowText)
          ) {
            exclusionCode = 'MULTIDROP';
          } else if (/drop\s*trailer/i.test(fullRowText) && cachedSettings.rejectDropTrailer !== false) {
            exclusionCode = 'DROP_TRAILER';
          }
        }

        // Commodity miles mismatch — "poultry 1639 miles" with DAT showing 286 mi = reload/multi-leg
        if (!exclusionCode && miles > 0) {
          const fullRowText = (rowCells || row).textContent;
          const cmMatch = fullRowText.match(/(\d{3,5})\s*miles?/i);
          if (cmMatch) {
            const commodityMiles = parseInt(cmMatch[1], 10);
            if (commodityMiles > miles * 1.5) {
              console.log(`[COMMODITY-MILES] row ${idx}: commodity=${commodityMiles} vs DAT=${miles} — reload detected`);
              exclusionCode = 'RELOAD';
            }
          }
        }

        // Row ID — prefer data attribute on dat-route or its parent cell
        const id = row.dataset.id || row.dataset.loadId
          || (row.parentElement && (row.parentElement.dataset.id || row.parentElement.dataset.loadId))
          || `load-${idx}`;

        console.log('[scrape] row:', idx, {
          origin: `${originCity}, ${originState}`,
          destination: `${destCity}, ${destState}`,
          rate,
          miles,
          email: brokerEmail,
          brokerName,
          exclusionCode,
          rawRowText: row.textContent.trim().substring(0, 200),
        });

        results.push({
          rowEl:         rowCells || row,  // highlight the full row-cells div, not just dat-route
          id,
          originCity,
          originState,
          destCity,
          destState,
          trailerType,
          rate,
          miles,
          deadheadMiles: deadhead,
          pickupDate,
          brokerName,
          brokerEmail,
          exclusionCode,
          ...(equipRaw.toUpperCase() === 'RM' ? { description: 'team load' } : {}),
        });
      } catch (e) {
        // Skip malformed rows silently
      }
    });

    // Deduplicate — same dest+rate+company = same load posted from different origins
    // Prefer the entry that has a valid broker email extracted
    const dedupMap = new Map();
    for (const r of results) {
      const key = `${r.destCity.trim().toLowerCase()}_${r.rate}_${r.brokerName.trim().toLowerCase()}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, r);
      } else if (!existing.brokerEmail && r.brokerEmail) {
        dedupMap.set(key, r);
      }
    }
    const deduped = [...dedupMap.values()];
    return deduped;
  }

  // ---------------------------------------------------------------------------
  // Parse helpers
  // ---------------------------------------------------------------------------

  function parseDollars(str) {
    const match = str.replace(/,/g, '').match(/\$?([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  function parseDate(str) {
    // Handles MM/DD, MM/DD/YY, MM/DD/YYYY, "Mar 15", etc.
    if (!str) return null;
    const now = new Date();
    const mdMatch = str.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (mdMatch) {
      const m   = parseInt(mdMatch[1], 10);
      const d   = parseInt(mdMatch[2], 10);
      let year  = mdMatch[3] ? parseInt(mdMatch[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }


  /**
   * Format an ISO date string (YYYY-MM-DD) or short date to display format like "Apr 7".
   * Returns null if unparseable.
   */
  function formatPickupDateShort(dateStr) {
    if (!dateStr || dateStr === 'TBD') return null;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Try ISO format YYYY-MM-DD
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const m = parseInt(isoMatch[2], 10) - 1;
      const d = parseInt(isoMatch[3], 10);
      return `${months[m]} ${d}`;
    }
    // Try MM/DD or MM/DD/YYYY
    const mdMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})/);
    if (mdMatch) {
      const m = parseInt(mdMatch[1], 10) - 1;
      const d = parseInt(mdMatch[2], 10);
      if (m >= 0 && m < 12) return `${months[m]} ${d}`;
    }
    // Try "Apr 7" already in short format
    const shortMatch = dateStr.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/i);
    if (shortMatch) return dateStr.trim();
    return null;
  }

  // ---------------------------------------------------------------------------
  // Email helpers
  // ---------------------------------------------------------------------------

  const EMAIL_SIGNATURE = `\n\nThanks,\n\nPaul Dhaliwal\nPresident @ Royal Carriers Inc\nPhone: 469-847-3017\nCell: 469-323-4675\n9 years in the business providing on-time deliveries!\n2201 Bryn Mawr Dr.\nProsper Tx 75078`;

  async function sendBrokerEmail(to, subject, body) {
    const s = cachedSettings;
    const res = await fetch(`${s.backendUrl}/api/dev/test-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    });
    return res.json();
  }

  function extractEmail(text) {
    const match = text && text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Main ranking flow
  // ---------------------------------------------------------------------------

  /**
   * Scrolls through the DAT virtual-scroll viewport, scraping rows at each step.
   * DAT recycles DOM nodes during virtual scroll, so we must capture data at each
   * position. Returns a deduped array of scraped row objects (no DOM references —
   * those are stale after scroll).
   */
  async function scrollAndCollect() {
    const viewport = document.querySelector('cdk-virtual-scroll-viewport');
    if (!viewport) return [];

    setStatus('Collecting loads...', '');

    const waitMs = 2000;
    const maxScrolls = 40;
    const targetLoads = 100;

    // Scroll to top first
    viewport.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));

    const scrollStep = Math.ceil(viewport.scrollHeight / 6);
    let lastScrollHeight = viewport.scrollHeight;
    let stallCount = 0;

    // Accumulate scraped rows across scroll positions, deduped by origin+dest+rate+company
    const collected = new Map();

    function scrapeVisible() {
      const rows = Array.from(document.querySelectorAll('dat-route'));
      const today = new Date().toISOString().substring(0, 10);
      for (const row of rows) {
        try {
          const inner = (sel) => {
            const el = row.querySelector(sel);
            return el ? el.textContent.trim() : '';
          };
          const rowCells = row.parentElement && row.parentElement.parentElement;
          const outer = (sel) => {
            if (!rowCells) return '';
            const el = rowCells.querySelector(sel);
            return el ? el.textContent.trim() : '';
          };

          const originCell  = row.querySelector('[data-test="load-origin-cell"]');
          const originCity  = originCell?.querySelector('.city-state-container:first-child .truncate')?.textContent?.trim()
                           || originCell?.querySelector('.truncate')?.textContent?.trim() || '';
          const originState = originCell?.querySelector('.city-state-container:first-child .state')?.textContent?.trim()
                           || originCell?.querySelector('.state')?.textContent?.trim() || '';
          const destCell  = row.querySelector('[data-test="load-destination-cell"]');
          const destCity  = destCell?.querySelector('.truncate')?.textContent?.trim() || '';
          const destState = destCell?.querySelector('.state')?.textContent?.trim() || '';
          if (!originCity || !destCity) continue;

          const rateText = outer('.offer') || outer('[class*="rate"]') || '';
          const rate     = parseDollars(rateText);
          if (rate <= 0) continue;

          const milesText = inner('[data-test="load-trip-cell"]') || '';
          const miles     = parseFloat(milesText.replace(/[^0-9.]/g, '')) || 500;

          const dhEl     = row.querySelector('[data-test="load-dho-cell"] .deadhead');
          const dhText   = dhEl ? dhEl.textContent.trim() : '';
          const deadhead = parseFloat(dhText.replace(/[^0-9.]/g, '')) || 0;

          const equipRaw = (inner('[data-test="equipment-type"]') || inner('[data-test*="equip"]') || '').trim();
          const equipMap = { 'R':'REEFER', 'RM':'REEFER', 'VR':'FLEX', 'V':'DRY_VAN', 'VM':'DRY_VAN', 'F':'FLATBED' };
          const trailerType = equipMap[equipRaw.toUpperCase()] || 'FLEX';

          const pickupText = inner('[data-test="pickup-date"]') || inner('[data-test*="pickup"]') || '';
          const pickupDate = parseDate(pickupText) || today;

          const companyCell = rowCells?.querySelector('[class*="cell-company-small"]')
                           || rowCells?.querySelector('[class*="company"]');
          const companyText = companyCell?.textContent?.trim() || '';
          const companyParts = companyText.split('|').map(s => s.trim());
          const brokerName = companyParts[companyParts.length - 1] || '';

          let brokerEmail = '';
          if (rowCells) {
            const mailtoEl = rowCells.querySelector('a[href^="mailto:"]');
            if (mailtoEl) {
              brokerEmail = mailtoEl.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
            }
            if (!brokerEmail) {
              brokerEmail = extractEmail(companyText) || '';
            }
          }

          const capacityText = (inner('[data-test*="capacity"]') || inner('[data-test*="load-type"]')
                             || outer('[class*="capacity"]') || '').toLowerCase();
          const loadTypeText = (inner('[data-test*="load"]') || '').toLowerCase();
          let exclusionCode = null;
          if (capacityText.includes('partial') || loadTypeText.includes('partial')) {
            exclusionCode = 'PARTIAL';
          }
          const isTeamLoad = equipRaw.toUpperCase() === 'RM'
            || /\bteam\b/i.test(equipRaw) || /w\/\s*team/i.test(equipRaw) || /with\s+team/i.test(equipRaw);
          if (!exclusionCode && isTeamLoad && cachedSettings.rejectTeamLoads !== false) {
            exclusionCode = 'TEAM_LOAD';
          }

          // Full row text scan — catches reload, multidrop, drop trailer in commodity/comments/any field
          if (!exclusionCode) {
            const fullRowText = (rowCells || row).textContent.toLowerCase();
            if (/\bre-?load(ing)?\b/i.test(fullRowText)) {
              exclusionCode = 'RELOAD';
            } else if (
              /multi[.\s-]?drop/i.test(fullRowText) ||
              /multi[.\s-]?stop/i.test(fullRowText) ||
              /multiple\s+stops/i.test(fullRowText) ||
              /\b([5-9]|\d{2,})\s*stops?\b/i.test(fullRowText) ||
              /\b([5-9]|\d{2,})\s*drops?\b/i.test(fullRowText) ||
              /\b(five|six|seven|eight|nine|ten)\s*(stops?|drops?)\b/i.test(fullRowText)
            ) {
              exclusionCode = 'MULTIDROP';
            } else if (/drop\s*trailer/i.test(fullRowText) && cachedSettings.rejectDropTrailer !== false) {
              exclusionCode = 'DROP_TRAILER';
            }
          }

          // Commodity miles mismatch — e.g. "poultry 1639 miles" with DAT showing 286 mi = reload
          if (!exclusionCode && miles > 0) {
            const cmText = (rowCells || row).textContent;
            const cmMatch = cmText.match(/(\d{3,5})\s*miles?/i);
            if (cmMatch) {
              const commodityMiles = parseInt(cmMatch[1], 10);
              if (commodityMiles > miles * 1.5) {
                console.log(`[COMMODITY-MILES] commodity=${commodityMiles} vs DAT=${miles} — reload detected`);
                exclusionCode = 'RELOAD';
              }
            }
          }

          const id = row.dataset.id || row.dataset.loadId
            || (row.parentElement && (row.parentElement.dataset.id || row.parentElement.dataset.loadId))
            || `load-${originCity}-${destCity}-${rate}`;

          // Dedup key: origin+dest+rate+company (for scroll-phase collection)
          const collectKey = `${originCity.toLowerCase()}_${destCity.toLowerCase()}_${rate}_${brokerName.toLowerCase()}`;
          const existing = collected.get(collectKey);
          if (!existing || (!existing.brokerEmail && brokerEmail)) {
            collected.set(collectKey, {
              id, originCity, originState, destCity, destState, trailerType,
              rate, miles, deadheadMiles: deadhead, pickupDate,
              brokerName, brokerEmail, exclusionCode,
              ...(equipRaw.toUpperCase() === 'RM' ? { description: 'team load' } : {}),
            });
          }
        } catch (e) { /* skip malformed */ }
      }
    }

    // Scrape rows at initial position (top of list)
    scrapeVisible();

    for (let i = 0; i < maxScrolls; i++) {
      viewport.scrollTop += scrollStep;
      await new Promise(r => setTimeout(r, waitMs));

      scrapeVisible();

      const sh = viewport.scrollHeight;
      const st = viewport.scrollTop;
      const ch = viewport.clientHeight;
      console.log(`[scroll] step ${i}: scrollTop=${st} scrollHeight=${sh} collected=${collected.size}`);
      setStatus(`Collecting loads... ${collected.size} found`, '');

      // Stop once we have enough unique loads
      if (collected.size >= targetLoads) {
        console.log(`[scroll] reached ${collected.size} unique loads, stopping`);
        break;
      }

      // Stop if we've hit the bottom
      if (st + ch >= sh - 50) {
        console.log('[scroll] hit bottom of scroll area');
        break;
      }

      // Stop if scrollHeight stalls (list fully loaded, no more content)
      if (sh === lastScrollHeight) {
        stallCount++;
        if (stallCount >= 3) {
          console.log(`[scroll] scrollHeight stalled at ${sh} for ${stallCount} steps, stopping`);
          break;
        }
      } else {
        stallCount = 0;
        lastScrollHeight = sh;
      }
    }

    // Scroll back to top
    viewport.scrollTop = 0;
    await new Promise(r => setTimeout(r, 300));

    console.log(`[scroll] collected ${collected.size} unique loads total`);
    return [...collected.values()];
  }

  // ---------------------------------------------------------------------------
  // Detect equipment type from DAT search bar (source of truth for trailerType)
  // ---------------------------------------------------------------------------

  function detectTrailerTypeFromDAT() {
    // Try multiple selectors — DAT uses Angular Material components
    const selectors = [
      '[data-test*="equipment"] .mat-select-value-text',
      '[data-test*="equipment"] .mat-mdc-select-value-text',
      '[data-test*="equipment"] .mat-select-min-line',
      '[data-test*="equipment"] .mat-mdc-select-min-line',
      '[data-test*="equipment-type"]',
      '[data-test*="equipmentType"]',
      '[aria-label*="Equipment"]',
      'mat-select[formcontrolname*="equip"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const txt = (el.textContent || el.innerText || '').trim();
          if (txt.length > 0 && txt.length < 100) {
            const mapped = mapDATEquipText(txt);
            if (mapped) {
              console.log(`[detect-equip] selector "${sel}" → "${txt}" → ${mapped}`);
              return mapped;
            }
          }
        }
      } catch (e) { /* skip */ }
    }
    // Fallback: scan page for equipment filter text
    try {
      const pageText = document.body.innerText || '';
      const m = pageText.match(/(Vans?\s*\(Standard\)\s*\/?\s*Reefers?|Reefers?|Vans?\s*\(Standard\)|Flatbed(?:\/Steps)?)/i);
      if (m) {
        const mapped = mapDATEquipText(m[0]);
        if (mapped) {
          console.log(`[detect-equip] page text "${m[0]}" → ${mapped}`);
          return mapped;
        }
      }
    } catch (e) { /* silent */ }
    console.log('[detect-equip] not found, defaulting to DRY_VAN');
    return 'DRY_VAN';
  }

  function mapDATEquipText(text) {
    const t = (text || '').trim().toLowerCase();
    if (t.includes('van') && t.includes('reefer')) return 'FLEX';
    if (t.includes('reefer'))  return 'REEFER';
    if (t.includes('van'))     return 'DRY_VAN';
    if (t.includes('flatbed')) return 'FLATBED';
    return null;
  }

  async function runRanker() {
    rankBtn.disabled = true;
    setStatus('Collecting loads...', '');
    clearHighlights();

    const collectedRows = await scrollAndCollect();

    // Use scroll-collected rows (captured across all scroll positions).
    // Fall back to a single scrape if scrollAndCollect returned empty (no viewport found).
    const rawRows = collectedRows && collectedRows.length > 0 ? collectedRows : scrapeRows();
    // Apply dest+rate+company dedup — collapse same-broker, same-rate,
    // same-destination postings from different origins; prefer entry with broker email.
    const dedupMap2 = new Map();
    for (const r of rawRows) {
      const key = `${(r.destCity||'').trim().toLowerCase()}_${r.rate}_${(r.brokerName||'').trim().toLowerCase()}`;
      const existing = dedupMap2.get(key);
      if (!existing) {
        dedupMap2.set(key, r);
      } else if (!existing.brokerEmail && r.brokerEmail) {
        dedupMap2.set(key, r);
      }
    }
    const rows = [...dedupMap2.values()];
    if (rows.length === 0) {
      setStatus('No load rows found. Make sure DAT search results are visible.', 'error');
      rankBtn.disabled = false;
      return;
    }

    setStatus(`Found ${rows.length} rows. Reading settings…`, '');

    // Re-read settings fresh from storage before every rank request
    // so popup changes take effect without page reload
    await new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(Object.keys(cachedSettings), (stored) => {
          cachedSettings = { ...cachedSettings, ...stored };
          resolve();
        });
      } else {
        resolve();
      }
    });

    const s = cachedSettings;

    // trailerType: read directly from the DAT search bar (source of truth)
    const validTrailerTypes = ['REEFER', 'DRY_VAN', 'FLATBED'];
    const driverTrailerType = detectTrailerTypeFromDAT();
    console.log('[ranker] trailerType from DAT bar:', driverTrailerType);

    // Filter out partial / team / drop-trailer loads before sending to engine
    const excludedMessages = {
      PARTIAL: 'Partial load — excluded',
      TEAM_LOAD: 'Team load — excluded',
      DROP_TRAILER: 'Drop trailer — excluded',
      RELOAD: 'Reload — excluded',
      MULTIDROP: 'Multi-drop load — excluded',
    };
    const clientRejected = [];
    const eligibleRows = rows.filter((r) => {
      if (r.exclusionCode) {
        clientRejected.push({
          id:               r.id,
          externalId:       r.id,
          origin:           { city: r.originCity, state: r.originState },
          destination:      { city: r.destCity,   state: r.destState },
          trailerType:      r.trailerType,
          violationCode:    r.exclusionCode,
          violationMessage: excludedMessages[r.exclusionCode] || r.exclusionCode,
        });
        return false;
      }
      return true;
    });
    if (clientRejected.length > 0) {
      console.log(`[ranker] excluded ${clientRejected.length} loads: ${clientRejected.map(r => r.violationCode).join(', ')}`);
    }

    // Filter out previously emailed loads
    const nonEmailedRows = eligibleRows.filter((r) => {
      const key = emailedDedupKey(r.destCity, r.rate, r.brokerName);
      return !emailedLoadKeys.has(key);
    });

    const candidateLoads = nonEmailedRows.map((r) => ({
      id:            r.id,
      externalId:    r.id,
      origin:        { city: r.originCity, state: r.originState },
      destination:   { city: r.destCity,   state: r.destState   },
      trailerType:   validTrailerTypes.includes(r.trailerType) ? r.trailerType : driverTrailerType,
      rate:          r.rate,
      miles:         r.miles,
      deadheadMiles: r.deadheadMiles,
      pickupDate:    r.pickupDate,
    }));

    const body = {
      driverId: 'dat-extension-driver',
      candidateLoads,
      driver: {
        id:              'dat-extension-driver',
        homeLocation:    { city: s.homeCity, state: s.homeState },
        currentLocation: { city: s.homeCity, state: s.homeState },
        trailerType:     driverTrailerType,
        avoidStates:     parseList(s.avoidStates),
        avgDailyMiles:   parseNum(s.avgDailyMiles, 650),
        minEffectiveRPM: parseNum(s.minRPM,        1.62),
        targetRPM:       parseNum(s.targetRPM,     1.86),
        variableCPM:     parseNum(s.variableCPM,   1.606),
        factoringRate:   parseNum(s.factoringRate, 0.018),
        cycleDays:       parseNum(s.cycleDays,     11),
        homeDays:        parseNum(s.homeDays,      2),
      },
      cycleStartDate:  s.cycleStartDate,
      completedCycles: parseNum(s.completedCycles, 0),
    };

    console.log('[COLLECT] sending to engine:', candidateLoads.length);
    setStatus(`Sending ${candidateLoads.length} loads to engine…`, '');
    console.log(`[MCI-query] equipment_type being sent: ${body.driver.trailerType}`);

    let result;
    try {
      const res = await fetch(`${s.backendUrl}/api/dev/dispatch/rank-loads-v2`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.substring(0, 200)}`);
      }
      result = await res.json();
    } catch (err) {
      setStatus(`Engine error: ${err.message}`, 'error');
      rankBtn.disabled = false;
      return;
    }

    const allRanked = result.rankedLoads   || [];
    const ranked    = allRanked.slice(0, 20); // Show top 20
    const rejected  = [...(result.rejectedLoads || []), ...clientRejected];

    setStatus(`Showing top ${ranked.length} of ${allRanked.length} ranked, ${rejected.length} rejected.`, 'ok');
    renderResults(ranked, rejected, rows);
    highlightRows(ranked, rows);

    rankBtn.disabled = false;
  }

  // ---------------------------------------------------------------------------
  // Render sidebar results
  // ---------------------------------------------------------------------------

  function renderResults(ranked, rejected, rows) {
    resultsEl.innerHTML = '';

    if (ranked.length === 0 && rejected.length === 0) {
      resultsEl.innerHTML = '<div class="tm-status">No results returned.</div>';
      return;
    }

    // Build lookup map: load ID → scraped row (with DOM reference)
    const rowByLoadId = new Map();
    rows.forEach(r => rowByLoadId.set(r.id, r));

    // Ranked loads
    for (const load of ranked) {
      const card = document.createElement('div');
      card.className = `tm-load-card${load.rank === 1 ? ' rank-1' : load.rank === 2 ? ' rank-2' : ''}`;

      const mciIcon = load.destinationMCI >= 10 ? ' \u2713' : load.destinationMCI <= -10 ? ' \u26A0\uFE0F' : '';
      const mciLine = load.mciProxyCity
        ? `MCI: ${load.destinationMCI} (${load.capacityLabel}) via ${load.mciProxyCity}, ${load.mciProxyState || ''}${mciIcon}`
        : `MCI: ${load.destinationMCI} (${load.capacityLabel})${mciIcon}`;

      card.innerHTML = `
        <div class="tm-card-top">
          <span class="tm-rank-badge">#${load.rank}</span>
        </div>
        <div class="tm-route" style="font-size:14px">${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}</div>
        <div class="tm-metrics" style="font-size:13px">
          <div class="tm-metric">Rate: <span>$${load.rate.toLocaleString()}</span></div>
          <div class="tm-metric">Miles: <span>${load.miles.toLocaleString()} &bull; ${load.estimatedDays} day run</span></div>
          <div class="tm-metric">RPM: <span>$${load.effectiveRPM.toFixed(2)}</span></div>
          <div class="tm-metric">Net: <span>$${Math.round(load.netProfit).toLocaleString()}</span></div>
          <div class="tm-metric">Rev/Day: <span>$${Math.round(load.revenuePerDay).toLocaleString()}</span></div>
        </div>
        <div class="tm-proxy-note" style="font-size:12px">${mciLine}</div>
        ${load.urgentCall ? '<div class="tm-urgent">Call now</div>' : ''}
      `;
      // Quick Profit Calculator toggle
      const calcToggle = document.createElement('button');
      calcToggle.textContent = '\uD83D\uDCCA Calc';
      calcToggle.style.cssText = 'background:none;border:1px solid #334155;border-radius:4px;color:#94a3b8;font-size:10px;cursor:pointer;padding:2px 8px;margin-top:4px;';
      const calcBlock = document.createElement('div');
      calcBlock.style.cssText = 'display:none;margin-top:6px;padding:6px 8px;background:#161b27;border:1px solid #1e2433;border-radius:4px;font-size:11px;color:#94a3b8;font-family:monospace;line-height:1.6;';
      const cpm = parseNum(cachedSettings.variableCPM, 1.606);
      const fRate = parseNum(cachedSettings.factoringRate, 0.018);
      const varCost = load.miles * cpm;
      const factFee = load.rate * fRate;
      const totalCost = varCost + factFee;
      const netProfit = load.rate - totalCost;
      const revDay = load.rate / (load.estimatedDays || 1);
      const netRPM = load.miles > 0 ? netProfit / load.miles : 0;
      calcBlock.innerHTML = `
        <div>Rate:         <span style="color:#e2e8f0">$${load.rate.toLocaleString()}</span></div>
        <div>Miles:        <span style="color:#e2e8f0">${load.miles.toLocaleString()}</span></div>
        <div>Est. Days:    <span style="color:#e2e8f0">${load.estimatedDays}</span></div>
        <div>Variable:     <span style="color:#e2e8f0">$${Math.round(varCost).toLocaleString()}</span> <span style="color:#64748b">(${load.miles} \u00D7 $${cpm.toFixed(3)})</span></div>
        <div>Factoring:    <span style="color:#e2e8f0">$${Math.round(factFee).toLocaleString()}</span></div>
        <div style="border-top:1px solid #334155;margin:4px 0;"></div>
        <div>Net Profit:   <span style="color:#4ade80;font-weight:600">$${Math.round(netProfit).toLocaleString()}</span></div>
        <div>Rev/Day:      <span style="color:#60a5fa;font-weight:600">$${Math.round(revDay).toLocaleString()}</span></div>
        <div>Net RPM:      <span style="color:#e2e8f0">$${netRPM.toFixed(2)}</span></div>
      `;
      calcToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        calcBlock.style.display = calcBlock.style.display === 'none' ? 'block' : 'none';
      });
      card.appendChild(calcToggle);
      card.appendChild(calcBlock);

      // Store load data on card at render time — including broker email captured during scrape
      card.dataset.originCity  = load.origin?.city || '';
      card.dataset.destCity    = load.destination?.city || '';
      card.dataset.originState = load.origin?.state || '';
      card.dataset.destState   = load.destination?.state || '';
      card.dataset.rate        = String(load.rate || 0);
      card.dataset.pickupDate  = load.pickupDate || '';
      const scrapedRow = rowByLoadId.get(load.id);
      card.dataset.brokerEmail   = scrapedRow?.brokerEmail || '';
      card.dataset.emailDedupKey = emailedDedupKey(load.destination?.city, load.rate, scrapedRow?.brokerName || '');

      // Email Now button
      const emailBtn = document.createElement('button');
      emailBtn.className = 'tm-email-btn';
      emailBtn.textContent = '\u2709 Email Now';
      emailBtn.style.cssText = `
        width:100%; margin-top:8px; padding:7px; background:rgba(121,162,255,0.15);
        border:1px solid rgba(121,162,255,0.4); border-radius:8px; color:#79a2ff;
        font-size:11px; font-weight:700; cursor:pointer;
      `;
      emailBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
        const origin     = ascii(`${card.dataset.originCity}, ${card.dataset.originState}`);
        const dest       = ascii(`${card.dataset.destCity}, ${card.dataset.destState}`);
        const pickupDate = ascii(card.dataset.pickupDate || 'TBD');

        // ── Use broker email captured at scrape time (stored on card) ──
        const email = card.dataset.brokerEmail || null;
        console.log(`[TM-email] using stored email: ${email}`);

        if (!email) {
          emailBtn.textContent = 'No email found for this load';
          emailBtn.style.color = '#f87171';
          setTimeout(() => { emailBtn.textContent = '\u2709 Email Now'; emailBtn.style.color = '#79a2ff'; }, 3000);
          return;
        }

        // ── Optionally enrich from open panel (REF ID, comments) if available ──
        let refId = null;
        let requestedReference = null;
        const panelSelectors = [
          '.tablet-details-container.ng-star-inserted',
          '[class*="tablet-details"]',
        ];
        let panel = null;
        for (const sel of panelSelectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.length > 50) { panel = el; break; }
        }
        if (panel) {
          // Comments extraction
          const panelEls = Array.from(panel.querySelectorAll('*'));
          for (const el of panelEls) {
            if (el.children.length === 0 && el.textContent.trim().toUpperCase() === 'COMMENTS') {
              const nextSib = el.nextElementSibling;
              if (nextSib) {
                const commentsText = nextSib.textContent.trim();
                const inclusionPatterns = [/include\s+([\w#\s\d]+)\s+in/i, /reference\s+([\w#\d]+)/i, /mention\s+([\w#\d]+)/i];
                for (const pat of inclusionPatterns) {
                  const m = commentsText.match(pat);
                  if (m) { requestedReference = m[1].trim().split(/[.,!]/)[0].trim().substring(0, 20); break; }
                }
              }
              break;
            }
          }
          // REF ID extraction
          const labels = Array.from(panel.querySelectorAll('.equipment-label .data-label, div.equipment-label div.data-label'));
          const values = Array.from(panel.querySelectorAll('.equipment-data .data-item, div.equipment-data div.data-item'));
          for (let i = 0; i < labels.length; i++) {
            if (labels[i].textContent.trim() === 'Reference ID') {
              if (values[i]) {
                const val = values[i].textContent.trim();
                const isDate = /^\d{4}-\d{2}-\d{2}$/.test(val) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(val);
                if (val && val !== '\u2013' && val !== '-' && val !== '\u2014' && val.length > 1 && !isDate) {
                  refId = val;
                }
              }
              break;
            }
          }
        }

        // ── Build subject/body ──
        const refAppend = requestedReference
          ? `\nPlease include ${ascii(requestedReference)} in your response.`
          : '';

        // Format pickup date for display (e.g. "Apr 7")
        const pickupShort = formatPickupDateShort(card.dataset.pickupDate) || pickupDate;
        const pickupClause = (pickupShort && pickupShort !== 'TBD') ? ` on ${pickupShort}` : '';

        let subject, body;
        if (refId) {
          const cleanRef = ascii(refId);
          subject = `REF:${cleanRef} - Load details?`;
          body = `Hi - what are the load details for ${origin} to ${dest}${pickupClause}? ${cleanRef} MC:048737${refAppend}${EMAIL_SIGNATURE}`;
        } else {
          subject = `${origin} to ${dest} - Load details?`;
          body = `Hi - what are the load details for ${origin} to ${dest}${pickupClause}? MC:048737${refAppend}${EMAIL_SIGNATURE}`;
        }

        // ── Send ──
        emailBtn.disabled = true;
        emailBtn.textContent = 'Sending...';
        console.log(`[TM-email] to=${email} subject="${subject}"`);
        try {
          const result = await sendBrokerEmail(email, subject, body);
          if (result.success) {
            emailBtn.textContent = '\u2713 Sent!';
            emailBtn.style.color = '#4ade80';
            emailBtn.style.borderColor = 'rgba(74,222,128,0.4)';
            // Track emailed load and remove card from sidebar
            const dedupKey = card.dataset.emailDedupKey;
            if (dedupKey) {
              emailedLoadKeys.add(dedupKey);
              persistEmailedKeys();
              console.log(`[TM-email] tracked emailed key: ${dedupKey}`);
            }
            setTimeout(() => { card.remove(); }, 1000);
          } else {
            emailBtn.textContent = '\u2717 Failed';
            emailBtn.style.color = '#f87171';
          }
        } catch (err) {
          emailBtn.textContent = '\u2717 Error';
          emailBtn.style.color = '#f87171';
        }
      });
      card.appendChild(emailBtn);

      card.style.cursor = 'pointer';
      card.addEventListener('click', async () => {
        console.log(`[TM-click] Card clicked: ${load.origin?.city} → ${load.destination?.city} rate=$${load.rate}`);
        // Scroll through virtualized list to find the matching row
        const route = await scrollAndFindRow(
          load.origin?.city, load.destination?.city, load.rate
        );
        if (!route) {
          const msg = card.querySelector('.tm-card-notfound');
          if (!msg) {
            const notice = document.createElement('div');
            notice.className = 'tm-card-notfound';
            notice.style.cssText = 'color:#f87171;font-size:10px;margin-top:4px;';
            notice.textContent = 'Row not found \u2014 load may have expired';
            card.appendChild(notice);
            setTimeout(() => notice.remove(), 3000);
          }
          return;
        }
        const targetRow = getClickableRow(route);
        console.log(`[TM-click] targetRow tag=${targetRow.tagName} class="${targetRow.className}" id="${targetRow.id}"`);
        console.log(`[TM-click] route tag=${route.tagName} parent=${route.parentElement?.tagName} grandparent=${route.parentElement?.parentElement?.tagName}`);
        if (currentlyOpenRow && currentlyOpenRow !== targetRow) {
          console.log('[TM-click] closing previously open row');
          currentlyOpenRow.click();
          await new Promise(r => setTimeout(r, 150));
        }
        currentlyOpenRow = targetRow;
        route.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log('[TM-click] scrolled into view, will click in 300ms');
        // Try multiple event types — Angular may not respond to synthetic click
        setTimeout(() => {
          console.log('[TM-click] firing click + mousedown + pointerdown on targetRow');
          targetRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          targetRow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          targetRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          targetRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          targetRow.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        }, 300);
        const original = route.style.outline;
        route.style.outline = '3px solid #facc15';
        route.style.borderRadius = '4px';
        setTimeout(() => { route.style.outline = original; }, 1500);

      });
      resultsEl.appendChild(card);
    }

    // Rejected loads
    if (rejected.length > 0) {
      const header = document.createElement('div');
      header.className = 'tm-rejected-header';
      header.textContent = `Rejected (${rejected.length})`;
      resultsEl.appendChild(header);

      for (const load of rejected) {
        const card = document.createElement('div');
        card.className = 'tm-rejected-card';
        card.innerHTML = `
          <div class="tm-rejected-route">${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}</div>
          <div class="tm-violation">${load.violationCode}: ${load.violationMessage}</div>
        `;
        card.style.cursor = 'pointer';
        card.addEventListener('click', async () => {
          const route = await scrollAndFindRow(
            load.origin?.city, load.destination?.city, load.rate
          );
          if (!route) {
            const msg = card.querySelector('.tm-card-notfound');
            if (!msg) {
              const notice = document.createElement('div');
              notice.className = 'tm-card-notfound';
              notice.style.cssText = 'color:#f87171;font-size:10px;margin-top:4px;';
              notice.textContent = 'Row not found \u2014 load may have expired';
              card.appendChild(notice);
              setTimeout(() => notice.remove(), 3000);
            }
            return;
          }
          const targetRow = getClickableRow(route);
          if (currentlyOpenRow && currentlyOpenRow !== targetRow) {
            currentlyOpenRow.click();
            await new Promise(r => setTimeout(r, 150));
          }
          currentlyOpenRow = targetRow;
          route.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { targetRow.click(); }, 300);
          const original = route.style.outline;
          route.style.outline = '3px solid #facc15';
          route.style.borderRadius = '4px';
          setTimeout(() => { route.style.outline = original; }, 1500);
        });
        resultsEl.appendChild(card);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Row highlighting in DAT table
  // ---------------------------------------------------------------------------

  function highlightRows(ranked, rows) {
    // Build a map from load.id → rank (only rank 1 and 2)
    const rankMap = new Map();
    for (const load of ranked) {
      if (load.rank <= 2) rankMap.set(load.id, load.rank);
    }

    for (const row of rows) {
      if (!row.rowEl) continue; // scroll-collected rows have no DOM reference
      const rank = rankMap.get(row.id);
      if (rank === 1) row.rowEl.classList.add('tm-row-highlight-1');
      else if (rank === 2) row.rowEl.classList.add('tm-row-highlight-2');
    }
  }

  function clearHighlights() {
    document.querySelectorAll('.tm-row-highlight-1, .tm-row-highlight-2').forEach((el) => {
      el.classList.remove('tm-row-highlight-1', 'tm-row-highlight-2');
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className   = `tm-status ${cls || ''}`.trim();
  }

  function parseNum(val, fallback) {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }

  function parseList(val) {
    if (!val) return [];
    return val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Floating "Email This Load" button — injected into any open detail panel
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // "Email This Load" button — polled injection into DAT detail panel
  // ---------------------------------------------------------------------------

  setInterval(() => {
    const panel = document.querySelector('.details-block.ng-star-inserted');
    const btn = document.getElementById('tm-email-btn');

    if (panel && !btn) {
      // Create horizontal button row
      const btnRow = document.createElement('div');
      btnRow.id = 'tm-panel-btn-row';
      btnRow.style.cssText = 'display:flex;gap:8px;margin:8px 16px;';

      const button = document.createElement('button');
      button.id = 'tm-email-btn';
      button.textContent = '\u2709 Email';
      button.style.cssText = 'flex:1;padding:8px;background:#1a56db;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btnRow.appendChild(button);

      const routeBtn = document.createElement('button');
      routeBtn.id = 'tm-route-btn';
      routeBtn.textContent = '\uD83D\uDDFA Route';
      routeBtn.style.cssText = 'flex:1;padding:8px;background:#0f4c81;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btnRow.appendChild(routeBtn);

      const calcBtn = document.createElement('button');
      calcBtn.id = 'tm-calc-btn';
      calcBtn.textContent = '\uD83D\uDCCA Calc';
      calcBtn.style.cssText = 'flex:1;padding:8px;background:#1e3a5f;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btnRow.appendChild(calcBtn);

      panel.appendChild(btnRow);

      function resetBtn() {
        button.textContent = '\u2709 Email';
        button.style.background = '#1a56db';
        button.style.color = 'white';
        button.disabled = false;
      }

      button.addEventListener('click', async () => {
        const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();

        // Extract email from mailto anchors scoped to active panel
        const activePanel = document.querySelector('dat-load-details')
                         || document.querySelector('[class*="load-details"]')
                         || document.querySelector('.details-block.ng-star-inserted')?.closest('[class*="detail"]');
        const searchRoot = activePanel || document;
        let email = null;
        const mailtoLinks = searchRoot.querySelectorAll('a[href^="mailto:"]');
        for (const link of mailtoLinks) {
          if (link.closest('#truemile-sidebar')) continue;
          email = link.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
          if (email) break;
        }
        if (!email) {
          const allLinks = searchRoot.querySelectorAll('a');
          for (const link of allLinks) {
            if (link.closest('#truemile-sidebar')) continue;
            const text = link.textContent.trim();
            if (text.includes('@') && text.includes('.') && !text.includes(' ')) { email = text; break; }
          }
        }
        // Fallback: scan COMMENTS section text for email
        if (!email) {
          const allEls = document.querySelectorAll('*');
          for (const el of allEls) {
            if (el.closest('#truemile-sidebar')) continue;
            if (el.children.length === 0 && el.textContent.trim().toUpperCase() === 'COMMENTS') {
              const commentsText = el.parentElement?.textContent || '';
              const match = commentsText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,6}/gi);
              if (match) { email = match[0]; console.log('[TM-panel-email] found in COMMENTS:', email); }
              break;
            }
          }
        }
        console.log('[TM-panel-email] final selected:', email);

        if (!email) {
          button.textContent = 'No email found';
          button.style.background = '#7f1d1d';
          setTimeout(resetBtn, 3000);
          return;
        }

        // Origin/dest from route header
        const cityEls = document.querySelectorAll('.route-city-details');
        const panelOrigin = ascii(cityEls[0]?.textContent?.trim() || cityEls[0]?.innerText?.trim() || '').replace(/\s*\(\d+\)\s*/g, '').trim();
        const panelDest   = ascii(cityEls[1]?.textContent?.trim() || cityEls[1]?.innerText?.trim() || '').replace(/\s*\(\d+\)\s*/g, '').trim();

        // Get content panel for REF ID extraction
        const contentPanel = document.querySelector('.tablet-details-container.ng-star-inserted')
                          || document.querySelector('[class*="tablet-details"]')
                          || document.querySelector('.details-block.ng-star-inserted');

        // REF ID from equipment columns
        let refId = null;
        if (contentPanel) {
          const labels = Array.from(contentPanel.querySelectorAll('.equipment-label .data-label, div.equipment-label div.data-label'));
          const values = Array.from(contentPanel.querySelectorAll('.equipment-data .data-item, div.equipment-data div.data-item'));
          for (let i = 0; i < labels.length; i++) {
            if (labels[i].textContent.trim() === 'Reference ID') {
              if (values[i]) {
                const val = values[i].textContent.trim();
                const isDate = /^\d{4}-\d{2}-\d{2}$/.test(val) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(val);
                if (val && val !== '\u2013' && val !== '-' && val !== '\u2014' && val.length > 1 && !isDate) {
                  refId = val;
                }
              }
              break;
            }
          }
        }

        // Extract pickup date from panel Trip section (date shown under origin city)
        let panelPickupDate = null;
        try {
          // Look for date elements near the origin in the route/trip section
          const dateEls = contentPanel ? contentPanel.querySelectorAll('.route-date, [data-test*="pickup"] .date, [data-test*="date"]') : [];
          for (const el of dateEls) {
            const txt = el.textContent.trim();
            if (txt && /[A-Za-z]{3}\s+\d/.test(txt)) { panelPickupDate = txt; break; }
          }
          // Fallback: scan for date-like text near origin city details
          if (!panelPickupDate) {
            const routeContainer = contentPanel?.querySelector('.route-city-details')?.closest('.route-container, .trip-details, [class*="route"]');
            if (routeContainer) {
              const allText = routeContainer.innerText || '';
              const dateMatch = allText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);
              if (dateMatch) panelPickupDate = dateMatch[0];
            }
          }
          // Last fallback: look for any date-formatted text in panel before the miles/equipment section
          if (!panelPickupDate && contentPanel) {
            const panelAllText = contentPanel.innerText || '';
            const dateMatch = panelAllText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);
            if (dateMatch) panelPickupDate = dateMatch[0];
          }
        } catch (e) { /* silent */ }

        const panelPickupClause = panelPickupDate ? ` on ${ascii(panelPickupDate)}` : '';

        let subject, body;
        if (refId) {
          const cleanRef = ascii(refId);
          subject = `REF:${cleanRef} - Load details?`;
          body = `Hi - what are the load details for ${panelOrigin} to ${panelDest}${panelPickupClause}? ${cleanRef} MC:048737${EMAIL_SIGNATURE}`;
        } else {
          subject = `${panelOrigin} to ${panelDest} - Load details?`;
          body = `Hi - what are the load details for ${panelOrigin} to ${panelDest}${panelPickupClause}? MC:048737${EMAIL_SIGNATURE}`;
        }

        button.disabled = true;
        button.textContent = 'Sending...';
        console.log(`[TM-panel-email] to=${email} subject="${subject}"`);
        try {
          const result = await sendBrokerEmail(email, subject, body);
          if (result.success) {
            button.textContent = '\u2713 Sent!';
            button.style.background = '#15803d';
          } else {
            button.textContent = '\u2717 Failed';
            button.style.background = '#7f1d1d';
          }
        } catch (err) {
          button.textContent = '\u2717 Error';
          button.style.background = '#7f1d1d';
        }
        setTimeout(resetBtn, 3000);
      });
      // Check Route click handler
      routeBtn.addEventListener('click', () => {
        const cityEls = document.querySelectorAll('.route-city-details');
        const pickupCity = (cityEls[0]?.textContent?.trim() || '').replace(/\s*\(\d+\)\s*/g, '').trim();
        const destCity   = (cityEls[1]?.textContent?.trim() || '').replace(/\s*\(\d+\)\s*/g, '').trim();
        const originInput = document.querySelector('input.mat-autocomplete-trigger');
        const currentLocation = originInput?.value?.trim() || `${cachedSettings.homeCity}, ${cachedSettings.homeState}`;
        const origin  = encodeURIComponent(currentLocation);
        const pickup  = encodeURIComponent(pickupCity);
        const dest    = encodeURIComponent(destCity);
        const url     = `https://www.google.com/maps/dir/${origin}/${pickup}/${dest}/`;
        console.log(`[TM-route] opening: ${url}`);
        window.open(url, '_blank');
      });

      // Quick Calc — calc block appended after the button row
      const calcBlock = document.createElement('div');
      calcBlock.id = 'tm-calc-block';
      calcBlock.style.cssText = 'display:none;margin:0 16px 16px 16px;padding:8px 10px;background:#161b27;border:1px solid #1e2433;border-radius:4px;font-size:12px;color:#94a3b8;font-family:monospace;line-height:1.7;';
      panel.appendChild(calcBlock);

      calcBtn.addEventListener('click', () => {
        if (calcBlock.style.display !== 'none') {
          calcBlock.style.display = 'none';
          return;
        }

        // Rate — find leaf element with "$" in rate-details-container
        const rateText = Array.from(document.querySelectorAll('.rate-details-container *'))
          .find(el => el.children.length === 0 && el.textContent.includes('$') &&
                parseFloat(el.textContent.replace(/[^0-9.]/g, '')) > 100)?.textContent || '';
        const rate = parseDollars(rateText);

        // Miles — find "X,XXX mi" text in details-block
        const milesText = Array.from(document.querySelectorAll('.details-block *'))
          .find(el => el.children.length === 0 && /^\d[\d,]+ mi$/.test(el.textContent.trim()))?.textContent || '';
        const miles = parseFloat(milesText.replace(/[^0-9]/g, '')) || 0;

        // Deadhead miles from panel — "(XX)" format
        const dhText = Array.from(document.querySelectorAll('.details-block *'))
          .find(el => el.children.length === 0 && /^\(\d+\)$/.test(el.textContent.trim()))?.textContent || '(0)';
        const deadhead = parseFloat(dhText.replace(/[^0-9]/g, '')) || 0;
        const totalMiles = miles + deadhead;

        const cpm = parseFloat(cachedSettings.variableCPM) || 1.606;
        const fRate = parseFloat(cachedSettings.factoringRate) || 0.018;
        const varCost = totalMiles * cpm;
        const factFee = rate * fRate;
        const netProfit = rate - varCost - factFee;
        const profitColor = netProfit >= 0 ? '#4ade80' : '#f87171';

        const utilization = totalMiles > 0 ? Math.round((miles / totalMiles) * 100) : 100;
        const utilColor = utilization >= 85 ? '#4ade80' : utilization >= 70 ? '#facc15' : '#f87171';

        calcBlock.innerHTML = `
          <div>Rate:          <span style="color:#e2e8f0">$${rate.toLocaleString()}</span></div>
          <div>Miles:         <span style="color:#e2e8f0">${miles.toLocaleString()} loaded + ${deadhead} deadhead = ${totalMiles.toLocaleString()} total</span></div>
          <div>Utilization:   <span style="color:${utilColor};font-weight:600">${utilization}%</span></div>
          <div>Est. Run:      <span style="color:#e2e8f0">${miles < 600 ? 1 : miles < 1270 ? 2 : miles < 1800 ? 3 : miles < 2400 ? 4 : 5} day run</span></div>
          <div>Variable Cost: <span style="color:#e2e8f0">$${Math.round(varCost).toLocaleString()}</span> <span style="color:#64748b">(${totalMiles} \u00D7 $${cpm.toFixed(3)})</span></div>
          <div>Factoring:     <span style="color:#e2e8f0">$${Math.round(factFee).toLocaleString()}</span></div>
          <div style="border-top:1px solid #334155;margin:4px 0;"></div>
          <div>Net Profit:    <span style="color:${profitColor};font-weight:600">$${Math.round(netProfit).toLocaleString()}</span></div>
        `;
        calcBlock.style.display = 'block';
        console.log(`[TM-calc] rate=$${rate} miles=${miles} dh=${deadhead} total=${totalMiles} varCost=$${Math.round(varCost)} fact=$${Math.round(factFee)} net=$${Math.round(netProfit)}`);
      });
    } else if (!panel && btn) {
      const btnRow = document.getElementById('tm-panel-btn-row');
      if (btnRow) btnRow.remove();
      const calcBlock = document.getElementById('tm-calc-block');
      if (calcBlock) calcBlock.remove();
    }
  }, 500);
})();
