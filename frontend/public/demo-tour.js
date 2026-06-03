/* ============================================================================
 * demo-tour.js — Auto-running guided tour of the TrueMile v2 demo.
 * Triggered by ?tour=1 in the URL or clicking the "Take a tour" button.
 * Walks through every feature with live API calls + ratecon upload.
 * ========================================================================== */
(function () {
  'use strict';

  var API = '%%VITE_BASE_BE_URL%%';

  /* ── tooltip engine ───────────────────────────────────────────────────── */

  function injectTourStyles() {
    if (document.getElementById('tm-tour-styles')) return;
    var s = document.createElement('style');
    s.id = 'tm-tour-styles';
    s.textContent = [
      /* Tour overlay backdrop */
      '.tm-tour-mask{position:fixed;inset:0;pointer-events:none;z-index:8000;}',
      /* Spotlight cutout — animated ring around target */
      '.tm-tour-spotlight{position:fixed;border-radius:8px;box-shadow:0 0 0 9999px rgba(14,17,21,.62);pointer-events:none;z-index:8001;transition:all .35s cubic-bezier(.4,0,.2,1);}',
      /* Step card */
      '.tm-tour-card{position:fixed;z-index:8002;background:#fff;border-radius:14px;box-shadow:0 24px 60px -12px rgba(14,17,21,.28),0 4px 16px rgba(14,17,21,.1);width:340px;padding:22px 22px 16px;animation:fadeIn .22s ease;}',
      '.tm-tour-card .tc-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--teal);margin-bottom:8px;}',
      '.tm-tour-card .tc-title{font-size:15px;font-weight:700;color:var(--ink);margin-bottom:7px;line-height:1.3;}',
      '.tm-tour-card .tc-body{font-size:13px;color:var(--ink-3);line-height:1.55;margin-bottom:14px;}',
      '.tm-tour-card .tc-body strong{color:var(--ink);font-weight:600;}',
      '.tm-tour-card .tc-body code{font-family:"JetBrains Mono",monospace;font-size:11px;background:var(--surface-alt);padding:1px 5px;border-radius:4px;color:var(--teal-deep);}',
      /* Progress dots */
      '.tm-tour-dots{display:flex;gap:5px;align-items:center;margin-bottom:14px;}',
      '.tm-tour-dot{width:6px;height:6px;border-radius:50%;background:var(--line);transition:all .2s;}',
      '.tm-tour-dot.active{background:var(--teal);width:18px;border-radius:3px;}',
      '.tm-tour-dot.done{background:var(--teal-soft);}',
      /* Footer actions */
      '.tm-tour-footer{display:flex;align-items:center;gap:8px;}',
      '.tm-tour-btn{border:0;border-radius:8px;padding:8px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;}',
      '.tm-tour-btn.primary{background:var(--ink);color:#fff;flex:1;}',
      '.tm-tour-btn.primary:hover{background:#1e2730;}',
      '.tm-tour-btn.ghost{background:transparent;color:var(--ink-3);padding:8px 10px;}',
      '.tm-tour-btn.ghost:hover{color:var(--ink);}',
      '.tm-tour-skip{font-size:11px;color:var(--ink-4);cursor:pointer;margin-left:auto;}',
      '.tm-tour-skip:hover{color:var(--ink-3);}',
      /* Live status badge in card */
      '.tc-live{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--teal-deep);background:var(--teal-soft);padding:3px 9px;border-radius:100px;margin-bottom:8px;}',
      '.tc-live-dot{width:5px;height:5px;border-radius:50%;background:var(--teal);animation:pulseDot 1.4s infinite;}',
      /* Launch button */
      '.tm-tour-launch{position:fixed;bottom:28px;right:28px;z-index:7999;background:var(--ink);color:#fff;border:none;border-radius:100px;padding:11px 20px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 18px rgba(14,17,21,.22);display:flex;align-items:center;gap:8px;transition:all .18s;}',
      '.tm-tour-launch:hover{background:var(--teal);transform:translateY(-1px);}',
      '.tm-tour-launch .tl-dot{width:7px;height:7px;border-radius:50%;background:#fff;opacity:.7;animation:pulseDot 1.4s infinite;}',
      /* API result preview in card */
      '.tc-api-result{background:var(--surface-alt);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);line-height:1.5;margin-bottom:12px;max-height:120px;overflow:auto;}',
      '.tc-api-result .key{color:var(--teal-deep);}',
      '.tc-api-result .val{color:var(--ink);}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ── spotlight helper ─────────────────────────────────────────────────── */

  function spotlight(el, padding) {
    padding = padding || 6;
    var sp = document.getElementById('tm-tour-spotlight');
    if (!sp) { sp = document.createElement('div'); sp.id = 'tm-tour-spotlight'; document.body.appendChild(sp); }
    if (!el) { sp.style.opacity = '0'; return; }
    var r = el.getBoundingClientRect();
    sp.style.cssText = 'position:fixed;z-index:8001;pointer-events:none;border-radius:10px;' +
      'left:' + (r.left - padding) + 'px;top:' + (r.top - padding) + 'px;' +
      'width:' + (r.width + padding * 2) + 'px;height:' + (r.height + padding * 2) + 'px;' +
      'box-shadow:0 0 0 9999px rgba(14,17,21,.62);transition:all .35s cubic-bezier(.4,0,.2,1);opacity:1;';
  }

  function clearSpotlight() {
    var sp = document.getElementById('tm-tour-spotlight');
    if (sp) { sp.style.opacity = '0'; setTimeout(function () { if (sp.parentNode) sp.remove(); }, 400); }
  }

  /* ── card placement ───────────────────────────────────────────────────── */

  function placeCard(card, el, position) {
    document.body.appendChild(card);
    if (!el) { card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%,-50%)'; return; }
    var r = el.getBoundingClientRect();
    var cw = 340, gap = 14;
    var pos = position || 'right';
    if (pos === 'right' && r.right + cw + gap < window.innerWidth) {
      card.style.left = (r.right + gap) + 'px';
      card.style.top = Math.min(r.top, window.innerHeight - 320) + 'px';
    } else if (pos === 'left' || r.right + cw + gap >= window.innerWidth) {
      card.style.left = Math.max(8, r.left - cw - gap) + 'px';
      card.style.top = Math.min(r.top, window.innerHeight - 320) + 'px';
    } else if (pos === 'bottom') {
      card.style.left = Math.min(r.left, window.innerWidth - cw - 8) + 'px';
      card.style.top = (r.bottom + gap) + 'px';
    } else {
      card.style.left = Math.min(r.left, window.innerWidth - cw - 8) + 'px';
      card.style.top = Math.max(8, r.top - 320 - gap) + 'px';
    }
  }

  /* ── card builder ─────────────────────────────────────────────────────── */

  function buildCard(opts) {
    // opts: { tag, title, body, step, total, live, apiResult, onNext, onPrev, onSkip }
    var c = document.createElement('div');
    c.className = 'tm-tour-card';
    var dots = '';
    for (var i = 0; i < opts.total; i++) {
      dots += '<div class="tm-tour-dot' + (i < opts.step - 1 ? ' done' : i === opts.step - 1 ? ' active' : '') + '"></div>';
    }
    var liveTag = opts.live ? '<div class="tc-live"><div class="tc-live-dot"></div>Live · API verified</div>' : '';
    var apiBlock = opts.apiResult ? '<div class="tc-api-result">' + opts.apiResult + '</div>' : '';
    c.innerHTML =
      '<div class="tc-tag">' + opts.tag + '</div>' +
      liveTag +
      '<div class="tc-title">' + opts.title + '</div>' +
      '<div class="tc-body">' + opts.body + '</div>' +
      apiBlock +
      '<div class="tm-tour-dots">' + dots + '</div>' +
      '<div class="tm-tour-footer">' +
        (opts.step > 1 ? '<button class="tm-tour-btn ghost" id="tc-prev">← Back</button>' : '') +
        '<button class="tm-tour-btn primary" id="tc-next">' + (opts.step === opts.total ? 'Done' : 'Next →') + '</button>' +
        '<span class="tm-tour-skip" id="tc-skip">Skip tour</span>' +
      '</div>';
    c.querySelector('#tc-next').addEventListener('click', opts.onNext);
    if (c.querySelector('#tc-prev')) c.querySelector('#tc-prev').addEventListener('click', opts.onPrev);
    c.querySelector('#tc-skip').addEventListener('click', opts.onSkip);
    return c;
  }

  /* ── get iframe doc ───────────────────────────────────────────────────── */

  function iDoc() {
    var f = document.querySelector('iframe');
    return f ? (f.contentDocument || f.contentWindow.document) : null;
  }

  function iEl(selector) {
    var d = iDoc();
    return d ? d.querySelector(selector) : null;
  }

  function iClick(selector) {
    var el = iEl(selector);
    if (el) el.click();
  }

  /* ── live API calls for tour ──────────────────────────────────────────── */

  function fmtApiResult(obj, keys) {
    var lines = '';
    keys.forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null) {
        lines += '<div><span class="key">' + k + '</span>: <span class="val">' + obj[k] + '</span></div>';
      }
    });
    return lines;
  }

  /* ── steps ───────────────────────────────────────────────────────────── */

  var STEPS = [
    /* 0 */ {
      tag: 'Step 1 of 9 · Welcome',
      title: 'Royal Carriers — Live dispatch demo',
      body: 'This is the Golden Mile demo wired to <strong>real data</strong>. 121 rate confirmations from Max, Monu, and Paul are loaded. The tour shows every working feature in ~2 minutes.',
      target: null, position: 'center',
      action: null,
    },
    /* 1 */ {
      tag: 'Step 2 of 9 · Plan scene',
      title: 'Schedule built from rate sheets',
      body: 'Every <strong>teal day</strong> is a booked load from a real rate confirmation PDF. <strong>Red hatched days</strong> = no load booked. The calendar updates instantly when you upload a new rate sheet.',
      target: '.tm-cal', position: 'right',
      action: function () { iClick('.scene-btn[data-scene="1"]'); },
    },
    /* 2 */ {
      tag: 'Step 3 of 9 · Click a load day',
      title: 'Broker contact pulled from rate sheet',
      body: 'Click any teal day → see the broker\'s <strong>real email and phone</strong> from that rate confirmation. The email is pre-drafted with the load number, lane, and rate. "Open in Mail" works now.',
      target: '.tm-day.load', position: 'bottom',
      action: function () {
        var cell = iEl('.tm-day.load');
        if (cell) { setTimeout(function () { cell.click(); }, 300); }
      },
    },
    /* 3 */ {
      tag: 'Step 4 of 9 · Agent scenarios',
      title: 'Tell the agent what changed',
      body: 'Type <code>"Max\'s truck broke down"</code> or click <strong>"Max truck down"</strong> chip → the TRUCK DOWN flag appears on Max\'s calendar row instantly. Try "Paul home Saturday" next.',
      target: '.wp-chat-suggestions', position: 'left',
      action: function () {
        // Close modal if open
        var m = iEl('#tm-modal'); if (m) m.remove();
        // Scroll agent panel into view
        var wp = iEl('.wp-chat'); if (wp) wp.scrollIntoView({ behavior: 'smooth' });
      },
    },
    /* 4 */ {
      tag: 'Step 5 of 9 · Urgent tab',
      title: 'Drivers running empty are flagged',
      body: 'The banner above the calendar auto-detects drivers with <strong>3+ empty days</strong> after their last booked load and calls them out by name. Click the red days to jump to Find & Fill.',
      target: '.tm-urgent', position: 'right',
      action: null,
    },
    /* 5 */ {
      tag: 'Step 6 of 9 · View live data sources',
      title: 'All 121 rate sheets — searchable',
      body: 'Click <strong>"View live data sources"</strong> → Rate Confirmations tab. Every parsed load is here: lane, pickup/drop date, rate, RPM, broker. Drag a new PDF onto the drop zone to add more.',
      target: '#ds-trigger', position: 'bottom',
      action: function () {
        var m = iEl('#tm-modal'); if (m) m.remove();
        setTimeout(function () { iClick('#ds-trigger'); }, 200);
        setTimeout(function () {
          var tab = iEl('[data-source="ratecons"]');
          if (tab) tab.click();
        }, 700);
      },
    },
    /* 6 */ {
      tag: 'Step 7 of 9 · Ratecon upload (live)',
      title: 'Upload any broker PDF → parsed by AI',
      body: 'Drag a rate confirmation onto the drop zone. Claude AI reads it and extracts the load number, lane, dates, rate, miles, and broker contact from <strong>any broker format</strong>.',
      target: '#rc-upload-zone', position: 'left',
      action: function () {
        var tab = iEl('[data-source="ratecons"]');
        if (tab) tab.click();
      },
      live: true,
      apiResult: null, // filled dynamically
    },
    /* 7 */ {
      tag: 'Step 8 of 9 · Analytics',
      title: '$304K revenue · live from real loads',
      body: 'Revenue by month, by driver, avg RPM, loaded miles. Monu leads with $186K (52 loads · $3.51 RPM). Paul has the highest RPM at $4.14. All computed from the 121 real loads.',
      target: '.tm-an-kpis', position: 'right',
      action: function () {
        var m = iEl('.ds-overlay'); if (m) m.classList.remove('active');
        setTimeout(function () { iClick('.scene-btn[data-scene="3"]'); }, 200);
      },
    },
    /* 8 */ {
      tag: 'Step 9 of 9 · Done',
      title: 'Ready to dispatch',
      body: 'That\'s the full demo. Share the link with your team:<br><br><strong>https://truemile-demo.vercel.app</strong><br><br>Upload more rate sheets to see June fill in. Email send and DAT board go live when Danish\'s endpoints ship.',
      target: null, position: 'center',
      action: null,
    },
  ];

  /* ── live API preview for step 6 (ratecon) ───────────────────────────── */

  function loadRateconPreview(cardBody) {
    fetch(API + '/api/loads?page_size=1')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var l = d[0];
        if (!l || !cardBody) return;
        var preview = document.getElementById('tc-ratecon-preview');
        if (preview) {
          preview.innerHTML = fmtApiResult(l, ['load_number', 'driver_name', 'pickup_city', 'pickup_state', 'dropoff_city', 'dropoff_state', 'rate', 'rpm', 'broker_name', 'broker_email']);
        }
      }).catch(function () {});
  }

  /* ── tour runner ─────────────────────────────────────────────────────── */

  var current = 0;
  var cardEl = null;

  function removeCard() {
    if (cardEl && cardEl.parentNode) cardEl.remove();
    cardEl = null;
  }

  function showStep(n) {
    removeCard();
    clearSpotlight();
    if (n < 0 || n >= STEPS.length) { endTour(); return; }
    current = n;
    var step = STEPS[n];

    // Run action (scene switch, click, etc.)
    if (step.action) step.action();

    // Find target element
    var targetEl = null;
    if (step.target) {
      setTimeout(function () {
        targetEl = iEl(step.target) || document.querySelector(step.target);
        if (targetEl) spotlight(targetEl);
      }, step.action ? 500 : 100);
    }

    // Build card
    var apiBlock = '';
    if (step.apiResult) apiBlock = '<div class="tc-api-result" id="tc-ratecon-preview">Loading live data…</div>';

    var card = buildCard({
      tag: step.tag,
      title: step.title,
      body: step.body + (apiBlock ? '' : ''),
      step: n + 1,
      total: STEPS.length,
      live: step.live,
      apiResult: step.apiResult !== undefined ? (step.apiResult || '<div id="tc-ratecon-preview">Loading…</div>') : null,
      onNext: function () { showStep(n + 1); },
      onPrev: function () { showStep(n - 1); },
      onSkip: endTour,
    });

    setTimeout(function () {
      targetEl = step.target ? (iEl(step.target) || document.querySelector(step.target)) : null;
      placeCard(card, targetEl, step.position);
      if (n === 6) loadRateconPreview(card);
    }, step.action ? 550 : 50);

    cardEl = card;
  }

  function endTour() {
    removeCard();
    clearSpotlight();
    localStorage.setItem('tm-tour-done', '1');
    // Remove ?tour param from URL
    var url = new URL(window.location.href);
    url.searchParams.delete('tour');
    history.replaceState({}, '', url.toString());
  }

  /* ── launch button ───────────────────────────────────────────────────── */

  function addLaunchButton() {
    if (document.getElementById('tm-tour-launch')) return;
    var btn = document.createElement('button');
    btn.id = 'tm-tour-launch';
    btn.className = 'tm-tour-launch';
    btn.innerHTML = '<div class="tl-dot"></div> Take a tour';
    btn.addEventListener('click', startTour);
    document.body.appendChild(btn);
  }

  function startTour() {
    injectTourStyles();
    current = 0;
    showStep(0);
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function boot() {
    injectTourStyles();
    addLaunchButton();
    // Auto-start if ?tour=1 in URL
    var params = new URLSearchParams(window.location.search);
    if (params.get('tour') === '1') {
      setTimeout(startTour, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  } else {
    setTimeout(boot, 400);
  }
})();
