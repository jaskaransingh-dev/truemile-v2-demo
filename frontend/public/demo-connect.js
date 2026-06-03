/* ============================================================================
 * demo-connect.js — wires the Golden Mile demo UI to the live TrueMile v2 API.
 * Renders into .wp-main (plan schedule), .an-wrap (analytics).
 * Preserves all demo.html interactions: agent feed, Find & Fill, data sources.
 * ========================================================================== */
(function () {
  'use strict';

  var API = 'https://truemile-v2-demo-dev.up.railway.app';
  var DAYS_IN_MONTH = { '2026-02': 28, '2026-03': 31, '2026-04': 30, '2026-05': 31, '2026-06': 30 };
  var MONTH_LABEL = { '2026-02': 'February', '2026-03': 'March', '2026-04': 'April', '2026-05': 'May', '2026-06': 'June' };
  var DRIVER_TRUCK = { Max: '106', Monu: '109', Paul: '107' };

  var state = {
    drivers: [], loads: [], byDriver: {},
    activeMonth: '2026-05', scenarios: {}, ready: false,
  };

  /* ── data ─────────────────────────────────────────────────────────────── */

  function norm(l) {
    return {
      id: l.id, driver: l.driver_name || 'Unassigned',
      loadNumber: l.load_number || '—',
      pickupCity: l.pickup_city || '', pickupState: l.pickup_state || '',
      pickupDate: l.pickup_date || null,
      dropoffCity: l.dropoff_city || '', dropoffState: l.dropoff_state || '',
      dropoffDate: l.dropoff_date || null,
      rate: Number(l.rate || 0), miles: Number(l.loaded_miles || 0),
      rpm: l.rpm != null ? Number(l.rpm) : (l.loaded_miles ? Number(l.rate || 0) / Number(l.loaded_miles) : 0),
      brokerName: l.broker_name || '', brokerEmail: l.broker_email || '', brokerPhone: l.broker_phone || '',
    };
  }

  function loadData() {
    return Promise.all([
      fetch(API + '/api/drivers').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch(API + '/api/loads?page_size=500').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    ]).then(function (res) {
      state.drivers = (res[0] || []).filter(function (d) { return DRIVER_TRUCK[d.driver_name]; });
      state.loads = (res[1] || []).map(norm).filter(function (l) { return DRIVER_TRUCK[l.driver]; });
      state.byDriver = { Max: [], Monu: [], Paul: [] };
      state.loads.forEach(function (l) { if (state.byDriver[l.driver]) state.byDriver[l.driver].push(l); });
      var months = {};
      state.loads.forEach(function (l) { if (l.pickupDate) months[l.pickupDate.slice(0, 7)] = true; });
      var present = Object.keys(months).sort();
      if (present.length) state.activeMonth = present[present.length - 1];
      state.ready = true;
    });
  }

  /* ── schedule model ───────────────────────────────────────────────────── */

  function loadsForDriverMonth(driver, month) {
    return (state.byDriver[driver] || []).filter(function (l) {
      return l.pickupDate && l.pickupDate.slice(0, 7) === month;
    }).sort(function (a, b) { return a.pickupDate < b.pickupDate ? -1 : 1; });
  }

  function dayMap(driver, month) {
    var n = DAYS_IN_MONTH[month] || 30;
    var days = []; for (var i = 0; i < n; i++) days.push({ state: 'off', load: null });
    var loads = loadsForDriverMonth(driver, month);
    var firstDay = null, lastDay = null;
    loads.forEach(function (l) {
      var p = new Date(l.pickupDate);
      var d = l.dropoffDate ? new Date(l.dropoffDate) : p;
      var mo = parseInt(month.slice(5)) - 1;
      var s = p.getUTCMonth() === mo ? p.getUTCDate() : 1;
      var e = d.getUTCMonth() === mo ? d.getUTCDate() : n;
      for (var day = s; day <= e && day <= n; day++) {
        if (!days[day - 1].load) days[day - 1] = { state: 'load', load: l };
      }
      if (firstDay === null || s < firstDay) firstDay = s;
      if (lastDay === null || e > lastDay) lastDay = e;
    });
    if (firstDay !== null) {
      for (var k = firstDay; k <= lastDay; k++) {
        if (days[k - 1].state === 'off') days[k - 1] = { state: 'gap', load: null };
      }
      for (var t = lastDay + 1; t <= n; t++) days[t - 1] = { state: 'gap', load: null };
    }
    return days;
  }

  function driverStats(driver, month) {
    var loads = loadsForDriverMonth(driver, month);
    var rev = 0, miles = 0, rpmSum = 0, rpmN = 0;
    loads.forEach(function (l) { rev += l.rate; miles += l.miles; if (l.rpm) { rpmSum += l.rpm; rpmN++; } });
    var dm = dayMap(driver, month);
    var loaded = dm.filter(function (d) { return d.state === 'load'; }).length;
    var gaps = dm.filter(function (d) { return d.state === 'gap'; }).length;
    return { loads: loads.length, revenue: rev, miles: miles, rpm: rpmN ? rpmSum / rpmN : 0, loadedDays: loaded, gapDays: gaps };
  }

  /* ── shared styles ───────────────────────────────────────────────────── */

  function injectStyles() {
    if (document.getElementById('tm-connect-styles')) return;
    var css = document.createElement('style');
    css.id = 'tm-connect-styles';
    css.textContent = [
      /* Board layout */
      '.tm-board{padding:18px 22px 0;font-family:Inter,system-ui,sans-serif;}',
      '.tm-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:16px;flex-wrap:wrap;}',
      '.tm-board-title{font-size:14px;font-weight:600;color:var(--ink);}',
      '.tm-board-title .sub{font-size:11px;color:var(--ink-3);font-weight:400;margin-left:8px;}',
      /* Month tabs — match demo pill style */
      '.tm-month{display:flex;gap:3px;background:var(--surface-alt);padding:3px;border-radius:8px;border:1px solid var(--line-2);}',
      '.tm-month button{border:0;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--ink-3);padding:5px 12px;border-radius:6px;cursor:pointer;transition:all .15s;}',
      '.tm-month button:hover{color:var(--ink);}',
      '.tm-month button.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-sm);}',
      /* Urgent banner */
      '.tm-urgent{margin:0 0 12px;padding:10px 14px;border-radius:8px;background:var(--red-soft);border:1px solid rgba(194,69,62,.18);font-size:12.5px;color:var(--red);display:flex;gap:8px;align-items:flex-start;line-height:1.4;}',
      '.tm-urgent.ok{background:var(--teal-soft);border-color:rgba(14,131,120,.18);color:var(--teal-deep);}',
      '.tm-urgent .u-dot{flex-shrink:0;width:7px;height:7px;border-radius:50%;background:currentColor;margin-top:4px;}',
      /* Calendar */
      '.tm-cal{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface);margin-bottom:12px;}',
      '.tm-row{display:grid;grid-template-columns:148px 1fr;border-bottom:1px solid var(--line-2);}',
      '.tm-row:last-child{border-bottom:0;}',
      '.tm-row-head{padding:10px 14px;border-right:1px solid var(--line-2);background:var(--surface-alt);}',
      '.tm-row-head .dn{font-weight:600;font-size:13px;color:var(--ink);margin-bottom:2px;}',
      '.tm-row-head .dt{font-size:11px;color:var(--ink-3);font-family:"JetBrains Mono",monospace;}',
      '.tm-row-head .flag{margin-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;display:inline-block;padding:2px 8px;border-radius:4px;}',
      '.tm-row-head .flag.down{background:var(--red);color:#fff;}',
      '.tm-row-head .flag.home{background:var(--amber-soft);color:var(--amber);border:1px solid rgba(197,138,31,.3);}',
      /* Day cells */
      '.tm-days{display:flex;overflow-x:auto;scrollbar-width:none;}',
      '.tm-days::-webkit-scrollbar{display:none;}',
      '.tm-day{flex:0 0 28px;min-height:58px;border-right:1px solid var(--line-2);padding:3px 2px;position:relative;transition:background .12s;}',
      '.tm-day:last-child{border-right:0;}',
      '.tm-day .dnum{font-size:8.5px;color:var(--ink-4);font-family:"JetBrains Mono",monospace;text-align:center;line-height:1;}',
      '.tm-day.load{background:var(--teal-soft);cursor:pointer;}',
      '.tm-day.load:hover{background:#c4e4df;}',
      '.tm-day.load .dot{width:5px;height:5px;border-radius:50%;background:var(--teal);margin:4px auto 0;}',
      '.tm-day.gap{background:repeating-linear-gradient(45deg,#fff,#fff 4px,#feeeed 4px,#feeeed 8px);cursor:pointer;}',
      '.tm-day.gap:hover{outline:2px solid rgba(194,69,62,.4);outline-offset:-2px;}',
      '.tm-day.gap .dot{width:5px;height:5px;border-radius:50%;background:var(--red);margin:4px auto 0;}',
      /* Legend */
      '.tm-legend{display:flex;gap:16px;padding:0 2px 2px;font-size:11px;color:var(--ink-3);}',
      '.tm-legend span{display:flex;align-items:center;gap:5px;}',
      '.tm-legend i{width:9px;height:9px;border-radius:2px;display:inline-block;flex-shrink:0;}',
      '.tm-legend .l-load i{background:var(--teal-soft);border:1px solid rgba(14,131,120,.3);}',
      '.tm-legend .l-gap i{background:repeating-linear-gradient(45deg,#fff,#fff 3px,#feeeed 3px,#feeeed 6px);border:1px solid rgba(194,69,62,.25);}',
      '.tm-legend .l-off i{background:#fff;border:1px solid var(--line);}',
      /* Analytics */
      '.tm-an{padding:18px 22px;}',
      '.tm-an-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;}',
      '.tm-kpi{padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--surface);}',
      '.tm-kpi .l{font-size:10px;color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;}',
      '.tm-kpi .v{font-size:22px;font-weight:700;color:var(--ink);margin-top:5px;line-height:1.1;}',
      '.tm-kpi .d{font-size:11px;color:var(--teal-deep);margin-top:3px;font-weight:500;}',
      '.tm-an-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '.tm-panel{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:14px 16px;}',
      '.tm-panel h4{margin:0 0 12px;font-size:12px;font-weight:600;color:var(--ink);text-transform:uppercase;letter-spacing:.05em;}',
      '.tm-bar-row{display:grid;grid-template-columns:52px 1fr 64px;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;}',
      '.tm-track{height:10px;background:var(--line-2);border-radius:5px;overflow:hidden;}',
      '.tm-fill{height:100%;background:var(--teal);border-radius:5px;transition:width .4s ease;}',
      '.tm-bar-val{text-align:right;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink);}',
      '.tm-tbl{width:100%;border-collapse:collapse;font-size:12px;}',
      '.tm-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);padding:5px 8px;border-bottom:1px solid var(--line);}',
      '.tm-tbl td{padding:6px 8px;border-bottom:1px solid var(--line-2);color:var(--ink);}',
      '.tm-tbl tr:last-child td{border-bottom:0;}',
      '.tm-tbl .mono{font-family:"JetBrains Mono",monospace;}',
      '.tm-tbl .teal{color:var(--teal-deep);font-weight:600;}',
      /* Broker modal */
      '.tm-modal-ov{position:fixed;inset:0;background:rgba(14,17,21,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn .2s ease;}',
      '.tm-modal{background:#fff;border-radius:14px;width:540px;max-width:92vw;max-height:88vh;overflow:auto;box-shadow:0 24px 60px -12px rgba(14,17,21,.22);}',
      '.tm-modal-h{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;}',
      '.tm-modal-h .t{font-size:14px;font-weight:600;color:var(--ink);}',
      '.tm-modal-h .x{border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--ink-3);line-height:1;padding:0 4px;}',
      '.tm-modal-h .x:hover{color:var(--ink);}',
      '.tm-modal-b{padding:18px 20px;}',
      '.tm-field{margin-bottom:12px;}',
      '.tm-field label{display:block;font-size:10px;color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;}',
      '.tm-field input,.tm-field textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;box-sizing:border-box;color:var(--ink);outline:none;transition:border-color .15s;}',
      '.tm-field input:focus,.tm-field textarea:focus{border-color:var(--teal);}',
      '.tm-field textarea{min-height:140px;resize:vertical;font-family:"JetBrains Mono",monospace;font-size:11.5px;line-height:1.55;}',
      '.tm-modal-f{display:flex;gap:8px;align-items:center;padding:0 20px 18px;}',
      '.tm-btn{border:0;border-radius:8px;padding:8px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap;}',
      '.tm-btn.dark{background:var(--ink);color:#fff;}',
      '.tm-btn.dark:hover{background:#1e2730;}',
      '.tm-btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);}',
      '.tm-btn.ghost:hover{background:var(--surface-alt);}',
      '.tm-btn.teal{background:var(--teal);color:#fff;}',
      '.tm-btn.teal:hover{background:var(--teal-deep);}',
      '.tm-btn.amber{background:var(--amber-soft);color:var(--amber);border:1px solid rgba(197,138,31,.25);}',
      '.tm-btn.amber:hover{background:#f5e5c0;}',
      '.tm-pending{font-size:11px;color:var(--ink-3);margin-right:auto;}',
    ].join('');
    document.head.appendChild(css);
  }

  /* ── render: Plan schedule ──────────────────────────────────────────── */

  function renderPlan() {
    var grid = document.querySelector('.scene[data-scene="1"] .wp-main');
    if (!grid) return;
    var month = state.activeMonth;
    var drivers = ['Max', 'Monu', 'Paul'];
    var months = Object.keys(DAYS_IN_MONTH).filter(function (m) {
      return state.loads.some(function (l) { return l.pickupDate && l.pickupDate.slice(0, 7) === m; });
    });

    /* Urgent: drivers with ≥3 empty days after their last booked load */
    var urgent = drivers.filter(function (d) {
      var dm = dayMap(d, month); var last = -1;
      for (var i = 0; i < dm.length; i++) if (dm[i].state === 'load') last = i;
      return last >= 0 && dm.slice(last + 1).filter(function (x) { return x.state === 'gap'; }).length >= 3;
    });

    var html = '<div class="tm-board">';

    /* Header + month switcher */
    html += '<div class="tm-board-head">';
    html += '<div class="tm-board-title">Royal Carriers <span class="sub">schedule from booked rate confirmations · ' + MONTH_LABEL[month] + '</span></div>';
    html += '<div class="tm-month">' + months.map(function (m) {
      return '<button data-m="' + m + '"' + (m === month ? ' class="active"' : '') + '>' + MONTH_LABEL[m].slice(0, 3) + '</button>';
    }).join('') + '</div></div>';

    /* Urgent banner */
    if (urgent.length) {
      html += '<div class="tm-urgent"><div class="u-dot"></div><div><strong>' + urgent.join(', ') +
        '</strong> ' + (urgent.length > 1 ? 'are' : 'is') + ' running empty — no load booked after their last delivery. ' +
        '<span style="text-decoration:underline;cursor:pointer;" data-goto-ff>Find a backhaul →</span></div></div>';
    } else {
      html += '<div class="tm-urgent ok"><div class="u-dot"></div><span>All drivers covered through their last booked load this month.</span></div>';
    }

    /* Calendar grid */
    html += '<div class="tm-cal">';
    drivers.forEach(function (d) {
      var dm = dayMap(d, month);
      var sc = state.scenarios[d];
      html += '<div class="tm-row"><div class="tm-row-head"><div class="dn">' + d + '</div><div class="dt">Truck #' + DRIVER_TRUCK[d] + '</div>';
      if (sc && sc.type === 'down') html += '<div class="flag down">Truck down</div>';
      if (sc && sc.type === 'home') html += '<div class="flag home">Home by ' + sc.by + '</div>';
      html += '</div><div class="tm-days">';
      dm.forEach(function (cell, idx) {
        var day = idx + 1;
        if (cell.state === 'load') {
          var l = cell.load;
          var tip = '#' + l.loadNumber + '  ·  ' + (l.pickupCity || '?') + ', ' + l.pickupState + ' → ' + (l.dropoffCity || '?') + ', ' + l.dropoffState +
            '  ·  $' + l.rate.toLocaleString() + (l.miles ? '  ·  ' + l.miles + ' mi' : '') + (l.rpm ? '  ·  $' + l.rpm.toFixed(2) + '/mi' : '');
          html += '<div class="tm-day load" title="' + tip.replace(/"/g, '&quot;') + '" data-load-id="' + l.id + '"><div class="dnum">' + day + '</div><div class="dot"></div></div>';
        } else if (cell.state === 'gap') {
          html += '<div class="tm-day gap" title="Empty · click to find a load" data-book-driver="' + d + '"><div class="dnum">' + day + '</div><div class="dot"></div></div>';
        } else {
          html += '<div class="tm-day"><div class="dnum">' + day + '</div></div>';
        }
      });
      html += '</div></div>';
    });
    html += '</div>';

    /* Legend */
    html += '<div class="tm-legend">' +
      '<span class="l-load"><i></i>Booked load</span>' +
      '<span class="l-gap"><i></i>Empty · needs load</span>' +
      '<span class="l-off"><i></i>Off / home</span>' +
      '</div></div>';

    grid.innerHTML = html;

    /* Wire month tabs */
    grid.querySelectorAll('.tm-month button').forEach(function (b) {
      b.addEventListener('click', function () { state.activeMonth = b.getAttribute('data-m'); renderPlan(); });
    });

    /* Wire booked-load cells → broker modal */
    grid.querySelectorAll('.tm-day.load').forEach(function (c) {
      c.addEventListener('click', function () {
        var l = state.loads.find(function (x) { return x.id === c.getAttribute('data-load-id'); });
        if (l) openBrokerModal(l);
      });
    });

    /* Wire empty cells → jump to Find & Fill */
    grid.querySelectorAll('.tm-day.gap').forEach(function (c) {
      c.addEventListener('click', function () { gotoScene(2); });
    });

    /* Wire urgent "Find a backhaul" link */
    var ff = grid.querySelector('[data-goto-ff]');
    if (ff) ff.addEventListener('click', function () { gotoScene(2); });
  }

  function gotoScene(n) {
    var btn = document.querySelector('.scene-btn[data-scene="' + n + '"]');
    if (btn) btn.click();
  }

  /* ── render: Analytics ──────────────────────────────────────────────── */

  function renderAnalytics() {
    var wrap = document.querySelector('.scene[data-scene="3"] .an-wrap');
    if (!wrap) return;
    var drivers = ['Max', 'Monu', 'Paul'];
    var totRev = 0, totLoads = state.loads.length, rpmSum = 0, rpmN = 0, totMiles = 0;
    state.loads.forEach(function (l) { totRev += l.rate; totMiles += l.miles; if (l.rpm) { rpmSum += l.rpm; rpmN++; } });
    var avgRpm = rpmN ? rpmSum / rpmN : 0;

    var months = ['2026-02', '2026-03', '2026-04', '2026-05'];
    var revByMonth = months.map(function (m) {
      var r = 0; state.loads.forEach(function (l) { if (l.pickupDate && l.pickupDate.slice(0, 7) === m) r += l.rate; }); return r;
    });
    var maxMonth = Math.max.apply(null, revByMonth.concat([1]));

    var html = '<div class="tm-an">';
    html += '<div class="tm-an-kpis">';
    html += kpi('Total revenue', '$' + fmt(totRev), 'Feb – May 2026 · booked');
    html += kpi('Loads delivered', String(totLoads), 'Max · Monu · Paul');
    html += kpi('Avg RPM', '$' + avgRpm.toFixed(2), 'rate per loaded mile');
    html += kpi('Loaded miles', fmt(Math.round(totMiles)), 'where reported');
    html += '</div>';

    html += '<div class="tm-an-cols">';
    /* Revenue by month */
    html += '<div class="tm-panel"><h4>Revenue by month</h4>';
    months.forEach(function (m, i) {
      html += '<div class="tm-bar-row"><span style="font-size:11px;color:var(--ink-2);">' + MONTH_LABEL[m].slice(0, 3) + '</span>' +
        '<div class="tm-track"><div class="tm-fill" style="width:' + Math.round(revByMonth[i] / maxMonth * 100) + '%"></div></div>' +
        '<div class="tm-bar-val">$' + fmt(Math.round(revByMonth[i])) + '</div></div>';
    });
    html += '</div>';

    /* By driver */
    html += '<div class="tm-panel"><h4>By driver · all months</h4>';
    html += '<table class="tm-tbl"><thead><tr><th>Driver</th><th>Loads</th><th>Revenue</th><th>Avg RPM</th><th>Loaded days</th></tr></thead><tbody>';
    drivers.forEach(function (d) {
      var rev = 0, n = 0, rs = 0, rn = 0, loadedDays = 0;
      (state.byDriver[d] || []).forEach(function (l) { rev += l.rate; n++; if (l.rpm) { rs += l.rpm; rn++; } });
      months.forEach(function (m) { loadedDays += driverStats(d, m).loadedDays; });
      html += '<tr><td><strong>' + d + '</strong></td><td class="mono">' + n + '</td><td class="mono teal">$' +
        fmt(Math.round(rev)) + '</td><td class="mono">' + (rn ? '$' + (rs / rn).toFixed(2) : '—') +
        '</td><td class="mono">' + loadedDays + 'd</td></tr>';
    });
    html += '</tbody></table></div></div>';

    /* Load-level table */
    html += '<div class="tm-panel" style="margin-top:14px;"><h4>Load detail · most recent 15</h4>';
    html += '<table class="tm-tbl"><thead><tr><th>Load #</th><th>Driver</th><th>Lane</th><th>Pickup</th><th>Rate</th><th>RPM</th><th>Broker</th></tr></thead><tbody>';
    state.loads.slice().sort(function (a, b) { return (b.pickupDate || '') < (a.pickupDate || '') ? -1 : 1; }).slice(0, 15).forEach(function (l) {
      html += '<tr><td class="mono">' + l.loadNumber + '</td><td>' + l.driver + '</td>' +
        '<td style="font-size:11px;">' + (l.pickupCity || '?') + ', ' + l.pickupState + ' → ' + (l.dropoffCity || '?') + ', ' + l.dropoffState + '</td>' +
        '<td class="mono" style="font-size:11px;">' + (l.pickupDate ? l.pickupDate.slice(0, 10) : '—') + '</td>' +
        '<td class="mono teal">$' + l.rate.toLocaleString() + '</td>' +
        '<td class="mono">' + (l.rpm ? '$' + l.rpm.toFixed(2) : '—') + '</td>' +
        '<td style="font-size:11px;">' + (l.brokerName || '—') + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    wrap.innerHTML = html;
  }

  function kpi(l, v, d) {
    return '<div class="tm-kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
  }
  function fmt(n) { return Number(n).toLocaleString(); }

  /* ── broker pre-draft modal ─────────────────────────────────────────── */

  function openBrokerModal(l) {
    closeModal();
    var lane = (l.pickupCity || '?') + ', ' + l.pickupState + ' → ' + (l.dropoffCity || '?') + ', ' + l.dropoffState;
    var pickup = l.pickupDate ? new Date(l.pickupDate).toUTCString().slice(0, 16) : 'TBD';
    var toEmail = l.brokerEmail || '';
    var subject = 'Load #' + l.loadNumber + ' — ' + lane;
    var body = 'Hi ' + (l.brokerName || 'there') + ',\n\n' +
      'Following up on load #' + l.loadNumber + ' (' + lane + '), pickup ' + pickup + '.\n' +
      'Royal Carriers has a truck available and can cover this lane. Please confirm the rate of $' +
      l.rate.toLocaleString() + ' and send the signed rate confirmation.\n\n' +
      'Thanks,\nRoyal Carriers Dispatch\n(469) 000-0000';

    var ov = document.createElement('div');
    ov.className = 'tm-modal-ov'; ov.id = 'tm-modal';
    ov.innerHTML =
      '<div class="tm-modal">' +
        '<div class="tm-modal-h">' +
          '<div class="t">Notify broker · ' + (l.brokerName || 'Unknown') + '</div>' +
          '<button class="x" data-close>×</button>' +
        '</div>' +
        '<div class="tm-modal-b">' +
          '<div class="tm-field"><label>To</label>' +
            '<input id="tm-to" value="' + toEmail + '" placeholder="(no email on rate sheet)"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
            '<div class="tm-field"><label>Broker phone</label>' +
              '<input value="' + (l.brokerPhone || '—') + '"></div>' +
            '<div class="tm-field"><label>Load #</label>' +
              '<input value="' + l.loadNumber + '" readonly></div>' +
          '</div>' +
          '<div class="tm-field"><label>Subject</label><input id="tm-subj" value="' + subject + '"></div>' +
          '<div class="tm-field"><label>Message — auto-drafted from rate sheet</label>' +
            '<textarea id="tm-body">' + body + '</textarea></div>' +
        '</div>' +
        '<div class="tm-modal-f">' +
          '<span class="tm-pending">Email send live when Danish\'s endpoint ships</span>' +
          '<button class="tm-btn ghost" data-copy>Copy draft</button>' +
          '<button class="tm-btn amber" data-mailto>Open in Mail</button>' +
          '<button class="tm-btn dark" data-send>Send email</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);

    /* Close */
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.hasAttribute('data-close')) closeModal();
    });

    /* Copy draft */
    ov.querySelector('[data-copy]').addEventListener('click', function () {
      var b = document.getElementById('tm-body');
      try { navigator.clipboard.writeText(b ? b.value : body); this.textContent = 'Copied ✓'; }
      catch (e2) { this.textContent = 'Select and copy'; }
    });

    /* Open in Mail (mailto: fallback — fully functional now) */
    ov.querySelector('[data-mailto]').addEventListener('click', function () {
      var to = (document.getElementById('tm-to') || {}).value || toEmail;
      var subj = (document.getElementById('tm-subj') || {}).value || subject;
      var bod = (document.getElementById('tm-body') || {}).value || body;
      window.open('mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(bod));
    });

    /* Send email — POST to API when endpoint exists, otherwise mailto */
    ov.querySelector('[data-send]').addEventListener('click', function () {
      var to = (document.getElementById('tm-to') || {}).value || toEmail;
      var subj = (document.getElementById('tm-subj') || {}).value || subject;
      var bod = (document.getElementById('tm-body') || {}).value || body;
      var btn = this;
      btn.textContent = 'Sending…'; btn.disabled = true;
      fetch(API + '/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to, subject: subj, body: bod }),
      }).then(function (r) {
        if (r.ok) { btn.textContent = 'Sent ✓'; btn.className = 'tm-btn teal'; closeModal(); }
        else { throw new Error('HTTP ' + r.status); }
      }).catch(function () {
        /* Fallback: open mailto when endpoint not yet live */
        window.open('mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(bod));
        btn.textContent = 'Send email'; btn.disabled = false;
      });
    });
  }

  function closeModal() { var m = document.getElementById('tm-modal'); if (m) m.remove(); }

  /* ── agent scenarios ────────────────────────────────────────────────── */

  function applyScenario(text) {
    var t = (text || '').toLowerCase();
    var matched = false;
    ['Max', 'Monu', 'Paul'].forEach(function (d) {
      if (t.indexOf(d.toLowerCase()) === -1) return;
      if (/truck.*(down|broke|broken)|broke.*down|breakdown/.test(t)) {
        state.scenarios[d] = { type: 'down' }; matched = true;
      } else if (/home|back|saturday|friday|thursday|sunday/.test(t)) {
        var days = ['saturday', 'friday', 'thursday', 'sunday', 'monday', 'tuesday', 'wednesday'];
        var by = 'weekend';
        for (var i = 0; i < days.length; i++) { if (t.indexOf(days[i]) > -1) { by = days[i].charAt(0).toUpperCase() + days[i].slice(1); break; } }
        state.scenarios[d] = { type: 'home', by: by }; matched = true;
      } else if (/sick|out|ill/.test(t)) {
        state.scenarios[d] = { type: 'home', by: 'today' }; matched = true;
      }
    });
    if (matched) { renderPlan(); gotoScene(1); }
    return matched;
  }

  /* ── wire agent panel ───────────────────────────────────────────────── */

  function wireAgent() {
    /* Relabel suggestion chips to Royal Carriers drivers */
    var chips = [
      { label: 'Max truck down', cmd: "Max's truck broke down" },
      { label: 'Paul home Saturday', cmd: 'Paul needs to be home by Saturday' },
      { label: 'Monu home Friday', cmd: 'Monu wants to be home by Friday' },
    ];
    var suggWrap = document.querySelector('.wp-chat-suggestions');
    if (suggWrap) {
      suggWrap.innerHTML = chips.map(function (c) {
        return '<button class="wp-chat-sugg" data-tm-cmd="' + c.cmd.replace(/"/g, '&quot;') + '">' + c.label + '</button>';
      }).join('');
      suggWrap.querySelectorAll('[data-tm-cmd]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopImmediatePropagation();
          var inp = document.getElementById('wp-chat-input');
          if (inp) inp.value = b.getAttribute('data-tm-cmd');
          applyScenario(b.getAttribute('data-tm-cmd'));
        }, true);
      });
    }

    /* Update placeholder text */
    var input = document.getElementById('wp-chat-input');
    if (input) {
      input.setAttribute('placeholder', 'e.g. "Max\'s truck broke down" or "Paul home by Saturday"');
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && applyScenario(input.value)) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }

    var sendBtn = document.getElementById('wp-chat-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', function (e) {
        var inp = document.getElementById('wp-chat-input');
        if (inp && applyScenario(inp.value)) e.stopImmediatePropagation();
      }, true);
    }
  }

  /* ── intercept Make optimal assignments ─────────────────────────────── */

  function wireOptimalBtn() {
    var buildBtn = document.getElementById('build-trigger');
    if (!buildBtn) return;
    buildBtn.addEventListener('click', function () {
      /* Show a brief "Optimizing…" state then just re-render our real schedule */
      var pill = document.getElementById('wp-status-pill');
      if (pill) { pill.textContent = 'Optimizing…'; pill.style.background = 'var(--amber-soft)'; pill.style.color = 'var(--amber)'; }
      setTimeout(function () {
        renderPlan();
        if (pill) { pill.textContent = 'Synced · just now'; pill.style.background = ''; pill.style.color = ''; }
      }, 1400);
    }, true);
  }

  /* ── wire scene switch ──────────────────────────────────────────────── */

  function wireSceneSwitch() {
    document.querySelectorAll('.scene-btn[data-scene]').forEach(function (b) {
      b.addEventListener('click', function () {
        setTimeout(function () {
          if (!state.ready) return;
          renderPlan();
          renderAnalytics();
        }, 30);
      });
    });
  }

  /* ── boot ───────────────────────────────────────────────────────────── */

  function boot() {
    injectStyles();
    loadData().then(function () {
      renderPlan();
      renderAnalytics();
      wireAgent();
      wireSceneSwitch();
      wireOptimalBtn();
      console.log('[TM-connect] ready — ' + state.loads.length + ' loads / ' + state.drivers.length + ' drivers');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 250); });
  } else {
    setTimeout(boot, 250);
  }
})();
