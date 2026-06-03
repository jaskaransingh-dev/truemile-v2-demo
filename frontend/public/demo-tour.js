/* ============================================================================
 * demo-tour.js — Fully interactive guided tour for the TrueMile V2 demo.
 * The tour DRIVES the screen — it clicks buttons, types in inputs, navigates
 * between scenes, and shows live API responses. No clicking required from the user.
 *
 * Triggered by: ?tour=1 in URL, or clicking the "Take a tour" button (bottom-right).
 * ============================================================================ */
(function () {
  'use strict';

  var API = '%%VITE_BASE_BE_URL%%';
  var TOUR_DONE_KEY = 'tm-tour-done';

  /* ── helpers ─────────────────────────────────────────────────────────── */

  function id(sel) { return document.getElementById(sel); }

  // Get element inside the iframe
  function iEl(sel) {
    var f = document.querySelector('iframe');
    if (!f) return null;
    var d = f.contentDocument || f.contentWindow.document;
    return d ? d.querySelector(sel) : null;
  }
  function iEls(sel) {
    var f = document.querySelector('iframe');
    if (!f) return [];
    var d = f.contentDocument || f.contentWindow.document;
    return d ? Array.prototype.slice.call(d.querySelectorAll(sel)) : [];
  }
  function iWin() {
    var f = document.querySelector('iframe');
    return f ? f.contentWindow : null;
  }
  function iClick(sel) {
    var el = iEl(sel);
    if (el) { el.click(); return true; }
    return false;
  }

  // Wait helper
  function wait(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

  // Simulate typing into an input
  function typeInto(el, text) {
    return new Promise(function(resolve) {
      if (!el) { resolve(); return; }
      el.value = '';
      el.focus();
      var i = 0;
      var interval = setInterval(function() {
        if (i < text.length) {
          el.value += text[i++];
          el.dispatchEvent(new Event('input', {bubbles:true}));
        } else {
          clearInterval(interval);
          resolve();
        }
      }, 40);
    });
  }

  /* ── styles ──────────────────────────────────────────────────────────── */

  function injectStyles() {
    if (id('tm-tour-styles')) return;
    var s = document.createElement('style'); s.id = 'tm-tour-styles';
    s.textContent = [
      /* Backdrop with cutout spotlight */
      '.tm-sp{position:fixed;z-index:8001;pointer-events:none;border-radius:10px;',
      'box-shadow:0 0 0 9999px rgba(14,17,21,.65);transition:all .4s cubic-bezier(.4,0,.2,1);}',
      /* Step card */
      '.tm-tc{position:fixed;z-index:8002;background:#fff;border-radius:14px;width:360px;',
      'box-shadow:0 24px 60px -12px rgba(14,17,21,.3);padding:22px 22px 16px;',
      'animation:fadeIn .22s ease;font-family:Inter,system-ui,sans-serif;}',
      '.tm-tc .tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;',
      'color:var(--teal,#0E8378);margin-bottom:6px;}',
      '.tm-tc .live-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;',
      'font-weight:600;color:var(--teal-deep,#0B6A61);background:rgba(14,131,120,.1);',
      'padding:3px 9px;border-radius:100px;margin-bottom:7px;}',
      '.tm-tc .live-dot::before{content:"";width:6px;height:6px;border-radius:50%;',
      'background:var(--teal,#0E8378);animation:pulseDot 1.4s infinite;}',
      '.tm-tc h3{font-size:15px;font-weight:700;color:#0E1115;margin:0 0 7px;line-height:1.3;}',
      '.tm-tc p{font-size:13px;color:#6B7480;line-height:1.55;margin:0 0 14px;}',
      '.tm-tc p strong{color:#0E1115;font-weight:600;}',
      '.tm-tc p code{font-family:"JetBrains Mono",monospace;font-size:11px;background:#F8F6F2;',
      'padding:1px 6px;border-radius:4px;color:#0B6A61;}',
      /* API result block */
      '.tm-tc .api-box{background:#F8F6F2;border:1px solid #E6E2DA;border-radius:8px;',
      'padding:10px 12px;font-family:"JetBrains Mono",monospace;font-size:11px;color:#3F4750;',
      'line-height:1.6;margin-bottom:12px;max-height:110px;overflow:auto;}',
      '.tm-tc .api-box .k{color:#0B6A61;} .tm-tc .api-box .v{color:#0E1115;}',
      /* Progress dots */
      '.tm-dots{display:flex;gap:5px;margin-bottom:13px;}',
      '.tm-dot{width:6px;height:6px;border-radius:50%;background:#E6E2DA;transition:all .2s;}',
      '.tm-dot.active{background:#0E8378;width:18px;border-radius:3px;}',
      '.tm-dot.done{background:rgba(14,131,120,.3);}',
      /* Buttons */
      '.tm-tc-footer{display:flex;align-items:center;gap:8px;}',
      '.tm-tb{border:0;border-radius:8px;padding:8px 16px;font:inherit;font-size:13px;',
      'font-weight:500;cursor:pointer;transition:all .15s;}',
      '.tm-tb.next{background:#0E1115;color:#fff;flex:1;}',
      '.tm-tb.next:hover{background:#1e2730;}',
      '.tm-tb.back{background:transparent;color:#6B7480;padding:8px 10px;}',
      '.tm-tb.back:hover{color:#0E1115;}',
      '.tm-tb.skip{font-size:11px;color:#9AA3AE;margin-left:auto;background:none;border:none;cursor:pointer;padding:4px;}',
      '.tm-tb.skip:hover{color:#6B7480;}',
      /* Auto-action indicator */
      '.tm-tc .doing{font-size:11px;color:var(--teal,#0E8378);font-weight:600;',
      'display:flex;align-items:center;gap:6px;margin-bottom:8px;}',
      '.tm-tc .doing::before{content:"";width:5px;height:5px;border-radius:50%;',
      'background:currentColor;animation:pulseDot 1s infinite;}',
      /* Launch button */
      '#tm-tour-btn{position:fixed;bottom:24px;right:24px;z-index:7999;',
      'background:#0E1115;color:#fff;border:none;border-radius:100px;',
      'padding:10px 18px;font:500 13px/1 Inter,system-ui,sans-serif;',
      'cursor:pointer;box-shadow:0 4px 18px rgba(14,17,21,.2);',
      'display:flex;align-items:center;gap:7px;transition:all .18s;}',
      '#tm-tour-btn:hover{background:#0E8378;transform:translateY(-1px);}',
      '#tm-tour-btn .bd{width:6px;height:6px;border-radius:50%;background:#fff;',
      'opacity:.7;animation:pulseDot 1.4s infinite;}',
      /* Typing cursor effect on inputs during tour */
      '.tm-typing{outline:2px solid var(--teal,#0E8378) !important;',
      'box-shadow:0 0 0 4px rgba(14,131,120,.15) !important;}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ── spotlight ───────────────────────────────────────────────────────── */

  var spEl = null;
  function spotlight(el, pad) {
    pad = pad || 7;
    if (!spEl) {
      spEl = document.createElement('div');
      spEl.className = 'tm-sp'; spEl.id = 'tm-sp';
      document.body.appendChild(spEl);
    }
    if (!el) { spEl.style.opacity = '0'; return; }
    // el may be in iframe — get bounding rect relative to viewport
    var r = el.getBoundingClientRect();
    // iframe offset
    var iframe = document.querySelector('iframe');
    if (iframe && el.ownerDocument !== document) {
      var fr = iframe.getBoundingClientRect();
      r = {
        left: fr.left + r.left, top: fr.top + r.top,
        width: r.width, height: r.height,
        right: fr.left + r.right, bottom: fr.top + r.bottom
      };
    }
    spEl.style.cssText = [
      'position:fixed;z-index:8001;pointer-events:none;border-radius:10px;',
      'box-shadow:0 0 0 9999px rgba(14,17,21,.65);',
      'transition:all .4s cubic-bezier(.4,0,.2,1);opacity:1;',
      'left:'+(r.left-pad)+'px;top:'+(r.top-pad)+'px;',
      'width:'+(r.width+pad*2)+'px;height:'+(r.height+pad*2)+'px;',
    ].join('');
  }

  function clearSpotlight() {
    if (spEl) { spEl.style.opacity = '0'; }
  }

  /* ── card placement ──────────────────────────────────────────────────── */

  function placeCard(card, el, pos) {
    document.body.appendChild(card);
    if (!el) {
      card.style.left = '50%'; card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }
    var iframe = document.querySelector('iframe');
    var r = el.getBoundingClientRect();
    if (iframe && el.ownerDocument !== document) {
      var fr = iframe.getBoundingClientRect();
      r = { left: fr.left+r.left, top: fr.top+r.top, right: fr.left+r.right, bottom: fr.top+r.bottom, width: r.width, height: r.height };
    }
    var cw = 360, gap = 16, ww = window.innerWidth, wh = window.innerHeight;
    card.style.transform = '';
    if (pos === 'center') {
      card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%,-50%)';
    } else if (pos === 'right' && r.right + cw + gap < ww) {
      card.style.left = (r.right + gap) + 'px';
      card.style.top = Math.min(r.top, wh - 400) + 'px';
    } else if (pos === 'left' || r.right + cw + gap >= ww) {
      card.style.left = Math.max(8, r.left - cw - gap) + 'px';
      card.style.top = Math.min(r.top, wh - 400) + 'px';
    } else if (pos === 'bottom') {
      card.style.left = Math.min(r.left, ww - cw - 8) + 'px';
      card.style.top = (r.bottom + gap) + 'px';
    } else {
      card.style.left = Math.min(r.left, ww - cw - 8) + 'px';
      card.style.top = Math.max(8, r.top - 380 - gap) + 'px';
    }
  }

  /* ── build card ──────────────────────────────────────────────────────── */

  function buildCard(opts) {
    // opts: {tag, live, doing, title, body, apiBox, step, total, pos, onNext, onPrev, onSkip}
    var c = document.createElement('div'); c.className = 'tm-tc'; c.id = 'tm-tc';
    var dots = '';
    for (var i = 0; i < opts.total; i++) {
      dots += '<div class="tm-dot'+(i<opts.step-1?' done':i===opts.step-1?' active':'')+'"></div>';
    }
    c.innerHTML =
      '<div class="tag">'+opts.tag+'</div>' +
      (opts.live ? '<div class="live-dot">Live · API connected</div>' : '') +
      (opts.doing ? '<div class="doing">'+opts.doing+'</div>' : '') +
      '<h3>'+opts.title+'</h3>' +
      '<p>'+opts.body+'</p>' +
      (opts.apiBox ? '<div class="api-box">'+opts.apiBox+'</div>' : '') +
      '<div class="tm-dots">'+dots+'</div>' +
      '<div class="tm-tc-footer">' +
        (opts.step > 1 ? '<button class="tm-tb back" id="tc-back">← Back</button>' : '') +
        '<button class="tm-tb next" id="tc-next">'+(opts.step===opts.total?'Done ✓':'Next →')+'</button>' +
        '<button class="tm-tb skip" id="tc-skip">Skip tour</button>' +
      '</div>';

    c.querySelector('#tc-next').onclick = opts.onNext;
    var bk = c.querySelector('#tc-back');
    if (bk) bk.onclick = opts.onPrev;
    c.querySelector('#tc-skip').onclick = opts.onSkip;
    return c;
  }

  /* ── tour engine ─────────────────────────────────────────────────────── */

  var curStep = 0;
  var cardEl = null;
  var running = false;

  function removeCard() {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null;
  }

  function endTour() {
    removeCard(); clearSpotlight(); running = false;
    localStorage.setItem(TOUR_DONE_KEY, '1');
    var url = new URL(window.location.href);
    url.searchParams.delete('tour');
    history.replaceState({}, '', url.toString());
  }

  var STEPS = buildSteps();

  function buildSteps() {
    return [

      /* 0 — Welcome */
      {
        tag: 'Welcome · 1 of 10',
        title: 'Royal Carriers — live dispatch platform',
        body: '121 real rate confirmations are loaded. This tour <strong>drives the screen automatically</strong> — watch each feature as it happens, connected to the live API.',
        target: null, pos: 'center',
        prep: null,
      },

      /* 1 — Plan scene navigation */
      {
        tag: 'Plan scene · 2 of 10',
        title: 'Schedule built from rate sheets',
        body: '<strong>Teal days</strong> = confirmed loads parsed from PDFs. <strong>Red hatched days</strong> = empty, no load booked. Month switcher at the top-right.',
        target: '.tm-cal', pos: 'right', live: true,
        doing: 'Navigating to Plan scene…',
        prep: async function() {
          iClick('.scene-btn[data-scene="1"]');
          await wait(600);
        },
      },

      /* 2 — Click load day → broker modal */
      {
        tag: 'Broker contact · 3 of 10',
        title: 'Click a load day → broker email pre-drafted',
        body: 'Every teal day holds the real broker\'s <strong>name, email, and phone</strong> extracted from that rate sheet. The email is drafted automatically.',
        target: '.tm-day.load', pos: 'right', live: true,
        doing: 'Clicking a booked load day…',
        prep: async function() {
          await wait(400);
          var cell = iEl('.tm-day.load');
          if (cell) {
            spotlight(cell);
            await wait(700);
            cell.click();
            await wait(300);
          }
        },
      },

      /* 3 — Close broker modal, show agent */
      {
        tag: 'Agent scenarios · 4 of 10',
        title: 'Tell the agent what changed',
        body: 'Type a scenario or click a chip. The agent updates the calendar <strong>instantly</strong>. Try: <code>Max\'s truck broke down</code>',
        target: '.wp-chat-suggestions', pos: 'left',
        doing: 'Closing modal, typing agent scenario…',
        prep: async function() {
          // Close broker modal
          var modal = iEl('#tm-broker-modal');
          if (modal) modal.remove();
          await wait(300);
          var input = iEl('#wp-chat-input');
          if (input) {
            input.classList.add('tm-typing');
            spotlight(input);
            await wait(400);
            await typeInto(input, "Max's truck broke down");
            await wait(600);
            input.classList.remove('tm-typing');
            // Fire Enter
            input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
            await wait(500);
          }
        },
      },

      /* 4 — Show truck-down flag */
      {
        tag: 'Agent result · 5 of 10',
        title: 'TRUCK DOWN flagged in calendar',
        body: 'Max\'s row now shows a <strong>TRUCK DOWN</strong> badge. The schedule reflects the scenario immediately — no manual edit needed.',
        target: '.tm-rh .flag.down', pos: 'right',
        prep: async function() {
          await wait(400);
          var flag = iEl('.tm-rh .flag.down');
          if (flag) spotlight(flag);
        },
      },

      /* 5 — Urgent banner */
      {
        tag: 'Urgent · 6 of 10',
        title: 'Drivers close to empty are flagged',
        body: 'The banner auto-detects drivers with <strong>3+ empty days after their last confirmed load</strong>. Click a red day to jump straight to Find & Fill.',
        target: '.tm-urgent', pos: 'right',
        prep: async function() {
          await wait(200);
          var u = iEl('.tm-urgent');
          if (u) spotlight(u);
        },
      },

      /* 6 — View live data sources + upload zone */
      {
        tag: 'Rate confirmations · 7 of 10',
        title: 'View live data sources → Rate Confirmations',
        body: '<strong>121 parsed loads</strong> from Max, Monu, and Paul — all from real PDFs. Drag any new broker PDF onto the drop zone to add more. The schedule updates instantly.',
        target: '#rc-upload-zone', pos: 'left', live: true,
        doing: 'Opening data sources, switching to Rate Confirmations…',
        prep: async function() {
          // Close any open modal
          var m = iEl('#tm-broker-modal');
          if (m) m.remove();
          iClick('#ds-trigger');
          await wait(500);
          var rcTab = iEl('[data-source="ratecons"]');
          if (rcTab) rcTab.click();
          await wait(600);
          var zone = iEl('#rc-upload-zone');
          if (zone) spotlight(zone);
        },
        apiBox: null, // filled async below
      },

      /* 7 — Live API preview of a load */
      {
        tag: 'Live API · 8 of 10',
        title: 'Real load data from the database',
        body: 'This is a live response from <code>GET /api/loads</code> — actual fields extracted from a scanned rate sheet PDF by Claude AI.',
        target: '#rc-table-body', pos: 'left', live: true,
        doing: 'Fetching live load from API…',
        prep: async function() {
          await wait(200);
          var tbody = iEl('#rc-table-body');
          if (tbody) spotlight(tbody);
        },
        apiBox: 'loading',
      },

      /* 8 — Analytics */
      {
        tag: 'Analytics · 9 of 10',
        title: '$304K revenue · by driver · by month',
        body: 'All computed live from the 121 loads. Click <strong>any row</strong> in the load table to open the edit form — changes save via <code>PATCH /api/loads/{id}</code>.',
        target: '.tm-kpis', pos: 'right', live: true,
        doing: 'Closing modal, switching to Analytics…',
        prep: async function() {
          var ov = iEl('.ds-overlay');
          if (ov) ov.classList.remove('active');
          await wait(300);
          iClick('.scene-btn[data-scene="3"]');
          await wait(600);
          var kpis = iEl('.tm-kpis');
          if (kpis) spotlight(kpis);
        },
      },

      /* 9 — Done */
      {
        tag: 'Done · 10 of 10',
        title: 'Ready to use',
        body: 'Share with your team:<br><br><strong>https://truemile-demo.vercel.app</strong><br><br>Upload rate sheet PDFs to see the schedule fill in. Edit any load via the table. Agent scenarios reflect in real time.',
        target: null, pos: 'center',
        prep: async function() { clearSpotlight(); iClick('.scene-btn[data-scene="1"]'); },
      },
    ];
  }

  async function showStep(n) {
    removeCard(); clearSpotlight();
    if (n < 0) return;
    if (n >= STEPS.length) { endTour(); return; }
    curStep = n;
    var step = STEPS[n];

    // Run prep action
    if (step.prep) {
      try { await step.prep(); } catch(e) { console.warn('Tour prep error', e); }
    }

    // For step 7 — fetch live API data
    var apiBox = step.apiBox;
    if (apiBox === 'loading') {
      try {
        var resp = await fetch(API + '/api/loads?page_size=1');
        var data = await resp.json();
        var l = data[0] || {};
        apiBox = [
          '<div><span class="k">load_number</span>: <span class="v">'+(l.load_number||'—')+'</span></div>',
          '<div><span class="k">driver_name</span>: <span class="v">'+(l.driver_name||'—')+'</span></div>',
          '<div><span class="k">pickup</span>: <span class="v">'+(l.pickup_city||'—')+', '+(l.pickup_state||'')+'</span></div>',
          '<div><span class="k">dropoff</span>: <span class="v">'+(l.dropoff_city||'—')+', '+(l.dropoff_state||'')+'</span></div>',
          '<div><span class="k">rate</span>: <span class="v">$'+(l.rate||0).toLocaleString()+'</span></div>',
          '<div><span class="k">rpm</span>: <span class="v">$'+(l.rpm?Number(l.rpm).toFixed(2):'—')+'</span></div>',
          '<div><span class="k">broker_name</span>: <span class="v">'+(l.broker_name||'—')+'</span></div>',
          '<div><span class="k">broker_email</span>: <span class="v">'+(l.broker_email||'—')+'</span></div>',
        ].join('');
      } catch(e) { apiBox = '<div>API response unavailable</div>'; }
    }

    // Find spotlight target
    var targetEl = null;
    if (step.target) targetEl = iEl(step.target) || document.querySelector(step.target);

    var card = buildCard({
      tag: step.tag, live: step.live, doing: null,
      title: step.title, body: step.body,
      apiBox: apiBox,
      step: n + 1, total: STEPS.length,
      onNext: function() { showStep(n + 1); },
      onPrev: function() { showStep(n - 1); },
      onSkip: endTour,
    });

    placeCard(card, targetEl, step.pos);
    if (targetEl) spotlight(targetEl);
    cardEl = card;
  }

  /* ── launch button ────────────────────────────────────────────────────── */

  function addLaunchButton() {
    if (id('tm-tour-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'tm-tour-btn';
    btn.innerHTML = '<div class="bd"></div> Take a tour';
    btn.onclick = startTour;
    document.body.appendChild(btn);
  }

  function startTour() {
    injectStyles(); running = true; curStep = 0; showStep(0);
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function boot() {
    injectStyles(); addLaunchButton();
    if (new URLSearchParams(window.location.search).get('tour') === '1') {
      setTimeout(startTour, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(boot, 400); });
  } else {
    setTimeout(boot, 400);
  }

})();
