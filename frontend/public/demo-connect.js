/* ============================================================================
 * demo-connect.js — wires the Golden Mile demo UI to the live TrueMile v2 API.
 *
 * It does NOT rebuild the UI. It loads real drivers + loads from the Railway
 * backend and re-renders the Plan schedule, Analytics, and broker outreach into
 * the demo's existing scene containers, simplifying the fiction (375 trucks) to
 * Royal Carriers' three real drivers (Max / Monu / Paul).
 *
 * Backend today exposes only /api/drivers and /api/loads, so everything here is
 * computed client-side from real load data. Email send + DAT board + optimizer
 * stay stubbed (clearly labelled) until those endpoints land.
 * ========================================================================== */
(function () {
  'use strict';

  var API = 'https://truemile-v2-demo-dev.up.railway.app';
  var DAYS_IN_MONTH = { '2026-02': 28, '2026-03': 31, '2026-04': 30, '2026-05': 31, '2026-06': 30 };
  var MONTH_LABEL = { '2026-02': 'February', '2026-03': 'March', '2026-04': 'April', '2026-05': 'May', '2026-06': 'June' };
  var DRIVER_TRUCK = { Max: '106', Monu: '109', Paul: '107' };
  var DRIVER_HOME = { Max: 'Dallas, TX', Monu: 'Dallas, TX', Paul: 'Dallas, TX' };

  var state = {
    drivers: [],
    loads: [],
    byDriver: {},          // driver -> [loads]
    activeMonth: '2026-05',
    scenarios: {},         // driver -> { type, note }
    ready: false,
  };

  /* ---------- data ---------- */

  function normalizeLoad(l) {
    return {
      id: l.id,
      driver: l.driver_name || 'Unassigned',
      loadNumber: l.load_number || '—',
      pickupCity: l.pickup_city || '', pickupState: l.pickup_state || '',
      pickupDate: l.pickup_date || null,
      dropoffCity: l.dropoff_city || '', dropoffState: l.dropoff_state || '',
      dropoffDate: l.dropoff_date || null,
      rate: Number(l.rate || 0),
      miles: Number(l.loaded_miles || 0),
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
      state.loads = (res[1] || []).map(normalizeLoad).filter(function (l) { return DRIVER_TRUCK[l.driver]; });
      state.byDriver = {};
      ['Max', 'Monu', 'Paul'].forEach(function (d) { state.byDriver[d] = []; });
      state.loads.forEach(function (l) { (state.byDriver[l.driver] = state.byDriver[l.driver] || []).push(l); });
      // pick latest month that has loads
      var months = {};
      state.loads.forEach(function (l) { if (l.pickupDate) months[l.pickupDate.slice(0, 7)] = true; });
      var present = Object.keys(months).sort();
      if (present.length) state.activeMonth = present[present.length - 1];
      state.ready = true;
    });
  }

  /* ---------- schedule model ---------- */

  function loadsForDriverMonth(driver, month) {
    return (state.byDriver[driver] || []).filter(function (l) {
      return l.pickupDate && l.pickupDate.slice(0, 7) === month;
    }).sort(function (a, b) { return a.pickupDate < b.pickupDate ? -1 : 1; });
  }

  // returns array length daysInMonth: each = {state:'load'|'gap'|'off', load?}
  function dayMap(driver, month) {
    var n = DAYS_IN_MONTH[month] || 30;
    var days = []; for (var i = 0; i < n; i++) days.push({ state: 'off', load: null });
    var loads = loadsForDriverMonth(driver, month);
    var firstDay = null, lastDay = null;
    loads.forEach(function (l) {
      var p = new Date(l.pickupDate);
      var d = l.dropoffDate ? new Date(l.dropoffDate) : p;
      var startDay = p.getUTCMonth() === parseInt(month.slice(5)) - 1 ? p.getUTCDate() : 1;
      var endDay = d.getUTCMonth() === parseInt(month.slice(5)) - 1 ? d.getUTCDate() : n;
      for (var day = startDay; day <= endDay && day <= n; day++) {
        if (day >= 1 && !days[day - 1].load) { days[day - 1] = { state: 'load', load: l }; }
      }
      if (firstDay === null || startDay < firstDay) firstDay = startDay;
      if (lastDay === null || endDay > lastDay) lastDay = endDay;
    });
    // gaps = uncovered days between first and last booked day = empty / needs load
    if (firstDay !== null) {
      for (var k = firstDay; k <= lastDay; k++) {
        if (days[k - 1].state === 'off') days[k - 1] = { state: 'gap', load: null };
      }
      // tail after last load → also a gap (driver going empty)
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
    return {
      loads: loads.length, revenue: rev, miles: miles,
      rpm: rpmN ? rpmSum / rpmN : 0,
      loadedDays: loaded, gapDays: gaps,
      utilization: (loaded + gaps) ? loaded / (loaded + gaps) : 0,
    };
  }

  /* ---------- shared styles ---------- */

  function injectStyles() {
    if (document.getElementById('tm-connect-styles')) return;
    var css = document.createElement('style');
    css.id = 'tm-connect-styles';
    css.textContent = [
      '.tm-board{padding:20px 24px;font-family:Inter,system-ui,sans-serif;}',
      '.tm-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:16px;flex-wrap:wrap;}',
      '.tm-board-title{font-size:15px;font-weight:600;color:var(--ink);}',
      '.tm-board-title .sub{font-size:12px;color:var(--ink-3);font-weight:400;margin-left:8px;}',
      '.tm-month{display:flex;gap:4px;background:var(--surface-alt);padding:3px;border-radius:8px;}',
      '.tm-month button{border:0;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--ink-3);padding:5px 11px;border-radius:6px;cursor:pointer;}',
      '.tm-month button.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-sm);}',
      '.tm-urgent{margin:0 0 14px;padding:10px 14px;border-radius:8px;background:var(--red-soft);border:1px solid rgba(194,69,62,.2);font-size:12.5px;color:var(--red);display:flex;gap:8px;align-items:center;}',
      '.tm-urgent.ok{background:var(--teal-soft);border-color:rgba(14,131,120,.2);color:var(--teal-deep);}',
      '.tm-cal{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface);}',
      '.tm-row{display:grid;grid-template-columns:150px 1fr;border-bottom:1px solid var(--line-2);}',
      '.tm-row:last-child{border-bottom:0;}',
      '.tm-row-head{padding:12px 14px;border-right:1px solid var(--line-2);background:var(--surface-alt);}',
      '.tm-row-head .dn{font-weight:600;font-size:13px;color:var(--ink);}',
      '.tm-row-head .dt{font-size:11px;color:var(--ink-3);font-family:"JetBrains Mono",monospace;}',
      '.tm-row-head .flag{margin-top:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:inline-block;padding:2px 7px;border-radius:4px;}',
      '.tm-row-head .flag.down{background:var(--red);color:#fff;}',
      '.tm-row-head .flag.home{background:var(--amber-soft);color:var(--amber);}',
      '.tm-days{display:flex;overflow-x:auto;}',
      '.tm-day{flex:0 0 30px;min-height:62px;border-right:1px solid var(--line-2);padding:4px 3px;position:relative;}',
      '.tm-day .dnum{font-size:9px;color:var(--ink-4);font-family:"JetBrains Mono",monospace;}',
      '.tm-day.load{background:var(--teal-soft);cursor:pointer;}',
      '.tm-day.load:hover{background:#cde8e3;}',
      '.tm-day.load .dot{width:6px;height:6px;border-radius:50%;background:var(--teal);margin:3px auto 0;}',
      '.tm-day.gap{background:repeating-linear-gradient(45deg,#fff,#fff 4px,#fdeceb 4px,#fdeceb 8px);}',
      '.tm-day.gap .dot{width:6px;height:6px;border-radius:50%;background:var(--red);margin:3px auto 0;}',
      '.tm-day.gap.book{cursor:pointer;}',
      '.tm-day.gap.book:hover{outline:2px solid var(--red);outline-offset:-2px;}',
      '.tm-legend{display:flex;gap:18px;margin-top:12px;font-size:11px;color:var(--ink-3);}',
      '.tm-legend span{display:flex;align-items:center;gap:6px;}',
      '.tm-legend i{width:10px;height:10px;border-radius:2px;display:inline-block;}',
      // analytics
      '.tm-an{padding:20px 24px;}',
      '.tm-an-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;}',
      '.tm-kpi{padding:16px 18px;border:1px solid var(--line);border-radius:10px;background:var(--surface);}',
      '.tm-kpi .l{font-size:11px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em;}',
      '.tm-kpi .v{font-size:24px;font-weight:700;color:var(--ink);margin-top:6px;}',
      '.tm-kpi .d{font-size:11px;color:var(--teal-deep);margin-top:4px;font-weight:600;}',
      '.tm-an-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
      '.tm-panel{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 18px;}',
      '.tm-panel h4{margin:0 0 14px;font-size:13px;font-weight:600;color:var(--ink);}',
      '.tm-bar{display:grid;grid-template-columns:64px 1fr 70px;align-items:center;gap:10px;margin-bottom:9px;font-size:12px;}',
      '.tm-bar .track{height:12px;background:var(--line-2);border-radius:6px;overflow:hidden;}',
      '.tm-bar .fill{height:100%;background:var(--teal);border-radius:6px;}',
      '.tm-bar .num{text-align:right;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink);}',
      '.tm-tbl{width:100%;border-collapse:collapse;font-size:12px;}',
      '.tm-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);padding:6px 8px;border-bottom:1px solid var(--line);}',
      '.tm-tbl td{padding:7px 8px;border-bottom:1px solid var(--line-2);}',
      '.tm-tbl .mono{font-family:"JetBrains Mono",monospace;}',
      // modal
      '.tm-modal-ov{position:fixed;inset:0;background:rgba(14,17,21,.5);display:flex;align-items:center;justify-content:center;z-index:9999;}',
      '.tm-modal{background:#fff;border-radius:14px;width:560px;max-width:92vw;max-height:88vh;overflow:auto;box-shadow:var(--shadow-lg);}',
      '.tm-modal-h{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;}',
      '.tm-modal-h .t{font-size:15px;font-weight:600;}',
      '.tm-modal-h .x{border:0;background:transparent;font-size:20px;cursor:pointer;color:var(--ink-3);}',
      '.tm-modal-b{padding:20px 22px;}',
      '.tm-field{margin-bottom:12px;}',
      '.tm-field label{display:block;font-size:11px;color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}',
      '.tm-field input,.tm-field textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:13px;box-sizing:border-box;}',
      '.tm-field textarea{min-height:150px;resize:vertical;font-family:"JetBrains Mono",monospace;font-size:12px;line-height:1.5;}',
      '.tm-modal-f{display:flex;gap:10px;justify-content:flex-end;padding:0 22px 20px;}',
      '.tm-btn{border:0;border-radius:8px;padding:9px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;}',
      '.tm-btn.dark{background:var(--ink);color:#fff;}',
      '.tm-btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);}',
      '.tm-btn.teal{background:var(--teal);color:#fff;}',
      '.tm-btn[disabled]{opacity:.45;cursor:not-allowed;}',
      '.tm-pending{font-size:11px;color:var(--amber);margin-right:auto;align-self:center;}',
    ].join('\n');
    document.head.appendChild(css);
  }

  /* ---------- render: Plan schedule ---------- */

  function renderPlan() {
    // render into .wp-main only — leave .wp-side (agent panel) untouched
    var grid = document.querySelector('.scene[data-scene="1"] .wp-main');
    if (!grid) return;
    var month = state.activeMonth;
    var drivers = ['Max', 'Monu', 'Paul'];

    // urgent: drivers with a tail gap (empty after last load) this month
    var urgent = drivers.filter(function (d) {
      var dm = dayMap(d, month); var lastLoad = -1;
      for (var i = 0; i < dm.length; i++) if (dm[i].state === 'load') lastLoad = i;
      var tail = dm.slice(lastLoad + 1).filter(function (x) { return x.state === 'gap'; }).length;
      return lastLoad >= 0 && tail >= 3;
    });

    var months = Object.keys(DAYS_IN_MONTH).filter(function (m) {
      return state.loads.some(function (l) { return l.pickupDate && l.pickupDate.slice(0, 7) === m; });
    });

    var html = '<div class="tm-board">';
    html += '<div class="tm-board-head">';
    html += '<div class="tm-board-title">Royal Carriers Inc <span class="sub">3 drivers · live schedule from booked rate confirmations</span></div>';
    html += '<div class="tm-month">' + months.map(function (m) {
      return '<button data-m="' + m + '" class="' + (m === month ? 'active' : '') + '">' + MONTH_LABEL[m] + '</button>';
    }).join('') + '</div></div>';

    if (urgent.length) {
      html += '<div class="tm-urgent"><span>●</span><span><strong>' + urgent.join(', ') +
        '</strong> ' + (urgent.length > 1 ? 'are' : 'is') + ' running empty — no load booked after their last delivery this month. Find a backhaul home.</span></div>';
    } else {
      html += '<div class="tm-urgent ok"><span>●</span><span>All drivers covered through their last booked load this month.</span></div>';
    }

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
          var tip = l.pickupCity + ', ' + l.pickupState + ' → ' + l.dropoffCity + ', ' + l.dropoffState +
            '  ·  $' + l.rate.toLocaleString() + (l.miles ? '  ·  ' + l.miles + ' mi' : '') + '  ·  #' + l.loadNumber;
          html += '<div class="tm-day load" title="' + tip.replace(/"/g, '&quot;') + '" data-load="' + l.id + '"><div class="dnum">' + day + '</div><div class="dot"></div></div>';
        } else if (cell.state === 'gap') {
          html += '<div class="tm-day gap book" title="Empty — no load booked. Click to find a load." data-book="' + d + '|' + day + '"><div class="dnum">' + day + '</div><div class="dot"></div></div>';
        } else {
          html += '<div class="tm-day"><div class="dnum">' + day + '</div></div>';
        }
      });
      html += '</div></div>';
    });
    html += '</div>';
    html += '<div class="tm-legend">' +
      '<span><i style="background:var(--teal-soft)"></i> Booked load</span>' +
      '<span><i style="background:#fdeceb"></i> Empty · needs load</span>' +
      '<span><i style="background:#fff;border:1px solid var(--line)"></i> Off / home</span>' +
      '</div>';
    html += '</div>';

    grid.innerHTML = html;

    // wire month switcher
    grid.querySelectorAll('.tm-month button').forEach(function (b) {
      b.addEventListener('click', function () { state.activeMonth = b.getAttribute('data-m'); renderPlan(); });
    });
    // wire load cells → broker pre-draft
    grid.querySelectorAll('.tm-day.load').forEach(function (c) {
      c.addEventListener('click', function () {
        var l = state.loads.find(function (x) { return x.id === c.getAttribute('data-load'); });
        if (l) openBrokerModal(l);
      });
    });
    // wire empty cells → find load (jump to find/fill)
    grid.querySelectorAll('.tm-day.gap.book').forEach(function (c) {
      c.addEventListener('click', function () {
        var btn = document.querySelector('.scene-btn[data-scene="2"]');
        if (btn) btn.click();
      });
    });
  }

  /* ---------- render: Analytics ---------- */

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
    html += kpi('Total revenue', '$' + Math.round(totRev).toLocaleString(), 'Feb–May 2026 · booked');
    html += kpi('Loads delivered', String(totLoads), 'across 3 drivers');
    html += kpi('Avg RPM', '$' + avgRpm.toFixed(2), 'rate per loaded mile');
    html += kpi('Loaded miles', Math.round(totMiles).toLocaleString(), 'where reported');
    html += '</div>';

    html += '<div class="tm-an-cols">';
    // revenue by month
    html += '<div class="tm-panel"><h4>Revenue by month</h4>';
    months.forEach(function (m, i) {
      html += '<div class="tm-bar"><span>' + MONTH_LABEL[m].slice(0, 3) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + Math.round(revByMonth[i] / maxMonth * 100) + '%"></span></span>' +
        '<span class="num">$' + Math.round(revByMonth[i]).toLocaleString() + '</span></div>';
    });
    html += '</div>';
    // by driver table
    html += '<div class="tm-panel"><h4>By driver · all months</h4><table class="tm-tbl"><thead><tr>' +
      '<th>Driver</th><th>Loads</th><th>Revenue</th><th>Avg RPM</th><th>Util</th></tr></thead><tbody>';
    drivers.forEach(function (d) {
      var rev = 0, n = 0, rs = 0, rn = 0;
      (state.byDriver[d] || []).forEach(function (l) { rev += l.rate; n++; if (l.rpm) { rs += l.rpm; rn++; } });
      // utilization over all months with data for this driver
      var loaded = 0, total = 0;
      months.forEach(function (m) { var s = driverStats(d, m); loaded += s.loadedDays; total += s.loadedDays + s.gapDays; });
      var util = total ? Math.round(loaded / total * 100) : 0;
      html += '<tr><td><strong>' + d + '</strong></td><td class="mono">' + n + '</td><td class="mono">$' +
        Math.round(rev).toLocaleString() + '</td><td class="mono">$' + (rn ? (rs / rn).toFixed(2) : '—') +
        '</td><td class="mono">' + util + '%</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>'; // cols

    // recent loads
    html += '<div class="tm-panel" style="margin-top:16px;"><h4>Load-level detail · most recent 12</h4><table class="tm-tbl"><thead><tr>' +
      '<th>Load #</th><th>Driver</th><th>Lane</th><th>Pickup</th><th>Rate</th><th>RPM</th><th>Broker</th></tr></thead><tbody>';
    state.loads.slice().sort(function (a, b) { return (b.pickupDate || '') < (a.pickupDate || '') ? -1 : 1; }).slice(0, 12).forEach(function (l) {
      html += '<tr><td class="mono">' + l.loadNumber + '</td><td>' + l.driver + '</td><td>' +
        (l.pickupCity || '?') + ', ' + l.pickupState + ' → ' + (l.dropoffCity || '?') + ', ' + l.dropoffState + '</td>' +
        '<td class="mono">' + (l.pickupDate ? l.pickupDate.slice(0, 10) : '—') + '</td>' +
        '<td class="mono">$' + l.rate.toLocaleString() + '</td><td class="mono">' + (l.rpm ? '$' + l.rpm.toFixed(2) : '—') + '</td>' +
        '<td>' + (l.brokerName || '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
    wrap.innerHTML = html;
  }

  function kpi(l, v, d) {
    return '<div class="tm-kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
  }

  /* ---------- broker pre-draft modal ---------- */

  function openBrokerModal(l) {
    closeModal();
    var lane = (l.pickupCity || '?') + ', ' + l.pickupState + ' → ' + (l.dropoffCity || '?') + ', ' + l.dropoffState;
    var pickup = l.pickupDate ? new Date(l.pickupDate).toUTCString().slice(0, 16) : 'TBD';
    var body = 'Hi ' + (l.brokerName || 'there') + ',\n\n' +
      'Following up on load #' + l.loadNumber + ' (' + lane + '), pickup ' + pickup + '.\n' +
      'Royal Carriers has a truck in the area and can cover this lane. Please confirm the rate of $' +
      l.rate.toLocaleString() + ' and send the rate confirmation.\n\n' +
      'Thanks,\nRoyal Carriers Inc · Dispatch\n(469) 000-0000';
    var ov = document.createElement('div');
    ov.className = 'tm-modal-ov'; ov.id = 'tm-modal';
    ov.innerHTML =
      '<div class="tm-modal"><div class="tm-modal-h"><div class="t">Notify broker · ' + (l.brokerName || 'Unknown') + '</div>' +
      '<button class="x" data-close>×</button></div><div class="tm-modal-b">' +
      '<div class="tm-field"><label>To</label><input value="' + (l.brokerEmail || '(no email on rate sheet)') + '"></div>' +
      '<div class="tm-field"><label>Broker phone</label><input value="' + (l.brokerPhone || '—') + '"></div>' +
      '<div class="tm-field"><label>Subject</label><input value="Load #' + l.loadNumber + ' — ' + lane + '"></div>' +
      '<div class="tm-field"><label>Message (auto-drafted from rate sheet)</label><textarea>' + body + '</textarea></div>' +
      '</div><div class="tm-modal-f"><span class="tm-pending">Send pending Danish\'s email endpoint</span>' +
      '<button class="tm-btn ghost" data-copy>Copy draft</button>' +
      '<button class="tm-btn dark" disabled>Send email</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.hasAttribute('data-close')) closeModal(); });
    ov.querySelector('[data-copy]').addEventListener('click', function () {
      try { navigator.clipboard.writeText(body); this.textContent = 'Copied ✓'; } catch (e) { this.textContent = 'Copy failed'; }
    });
  }
  function closeModal() { var m = document.getElementById('tm-modal'); if (m) m.remove(); }

  /* ---------- agent scenarios ---------- */

  function applyScenario(text) {
    var t = (text || '').toLowerCase();
    var matched = false;
    ['Max', 'Monu', 'Paul'].forEach(function (d) {
      if (t.indexOf(d.toLowerCase()) === -1) return;
      if (/truck.*(down|broke|broken)|broke.*down/.test(t)) { state.scenarios[d] = { type: 'down' }; matched = true; }
      else if (/home|back/.test(t)) {
        var by = (t.match(/\b(mon|tue|wed|thu|fri|sat|sun)\w*/) || [])[0] || 'weekend';
        state.scenarios[d] = { type: 'home', by: by.charAt(0).toUpperCase() + by.slice(1) }; matched = true;
      }
    });
    if (matched) { renderPlan(); var b = document.querySelector('.scene-btn[data-scene="1"]'); if (b) b.click(); }
    return matched;
  }

  function wireAgent() {
    // relabel the suggestion chips from Golden Mile fiction → Royal Carriers drivers
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
    // hook the real agent input + Send button (capture phase, take over from demo's fiction)
    var input = document.getElementById('wp-chat-input');
    var send = document.getElementById('wp-chat-send');
    if (input) {
      input.setAttribute('placeholder', 'e.g. "Max\'s truck broke down" or "Paul needs to be home by Saturday"');
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { if (applyScenario(input.value)) { e.preventDefault(); e.stopImmediatePropagation(); } }
      }, true);
    }
    if (send) {
      send.addEventListener('click', function (e) {
        var inp = document.getElementById('wp-chat-input');
        if (inp && applyScenario(inp.value)) { e.stopImmediatePropagation(); }
      }, true);
    }
  }

  /* ---------- scene re-assert ---------- */

  function renderActive() {
    if (!state.ready) return;
    renderPlan();
    renderAnalytics();
  }

  function wireSceneSwitch() {
    document.querySelectorAll('.scene-btn[data-scene]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(renderActive, 30); });
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    injectStyles();
    loadData().then(function () {
      renderActive();
      wireAgent();
      wireSceneSwitch();
      console.log('[TM] connected — ' + state.loads.length + ' loads, ' + state.drivers.length + ' drivers');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 200); });
  else setTimeout(boot, 200);
})();
