/* ============================================================================
 * demo-connect.js — TrueMile V2 · Tier 0 API connector
 *
 * Endpoints used (all live on Railway):
 *   GET    /api/drivers
 *   GET    /api/loads          ?driver_name, month, year, page_size
 *   GET    /api/loads/{id}
 *   PATCH  /api/loads/{id}     driver_name, rate, loaded_miles, deadhead_miles,
 *                               trailer_type, status, cancelled, cancellation_reason
 *   POST   /api/loads/parse-ratecon   (file upload)
 *   POST   /api/loads/import-drive   (Google Drive folders)
 *   GET    /api/demo/ratecon/latest  (Chrome extension)
 *
 * Renders into:
 *   .wp-main          — Plan schedule calendar (preserves .wp-side agent panel)
 *   .an-wrap          — Analytics scene
 *   #rc-table-body    — Rate Confirmations table in the data-sources modal
 * ========================================================================== */
(function () {
  'use strict';

  // API base URL — replaced at build time by vite.config.ts from .env VITE_BASE_BE_URL
  var API = '%%VITE_BASE_BE_URL%%';
  var DAYS = { '2026-02':28,'2026-03':31,'2026-04':30,'2026-05':31,'2026-06':30 };
  var MON  = { '2026-02':'February','2026-03':'March','2026-04':'April','2026-05':'May','2026-06':'June' };
  var TRUCK = { Max:'106', Monu:'109', Paul:'107' };
  var DRIVER_HOME = { Max:'Dallas, TX', Monu:'Dallas, TX', Paul:'Dallas, TX' };

  var S = {                          // global state
    drivers:[], loads:[], byDriver:{},
    activeMonth:'2026-05', scenarios:{}, ready:false,
  };

  /* ─── helpers ────────────────────────────────────────────────────────── */

  function api(path, opts) {
    return fetch(API + path, opts || {}).then(function(r){
      if (!r.ok) return r.json().then(function(e){ throw new Error(e.detail || 'HTTP '+r.status); });
      return r.json();
    });
  }

  function norm(l) {
    return {
      id:l.id, driver:l.driver_name||'Unassigned', loadNumber:l.load_number||'—',
      pickupCity:l.pickup_city||'', pickupState:l.pickup_state||'',
      pickupDate:l.pickup_date||null,
      dropoffCity:l.dropoff_city||'', dropoffState:l.dropoff_state||'',
      dropoffDate:l.dropoff_date||null,
      rate:Number(l.rate||0), miles:Number(l.loaded_miles||0),
      deadheadMiles:Number(l.deadhead_miles||0),
      rpm:l.rpm!=null?Number(l.rpm):(l.loaded_miles?Number(l.rate||0)/Number(l.loaded_miles):0),
      trailerType:l.trailer_type||'',
      status:l.status||'PENDING', cancelled:!!l.cancelled,
      cancellationReason:l.cancellation_reason||'',
      brokerName:l.broker_name||'', brokerEmail:l.broker_email||'',
      brokerPhone:l.broker_phone||'', brokerAgentName:l.broker_agent_name||'',
      stopCount:l.stop_count||0, stops:l.stops||[],
      source:l.source||'', createdAt:l.created_at||'',
    };
  }

  function fmt(n) { return Number(n).toLocaleString(); }
  function money(n) { return '$'+Number(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}); }
  function rpmColor(r) { return r>=2.5?'var(--teal-deep)':r>=2.0?'var(--amber)':'var(--red)'; }

  /* ─── data loading ───────────────────────────────────────────────────── */

  function loadData() {
    return Promise.all([
      api('/api/drivers').catch(function(){return[];}),
      api('/api/loads?page_size=500').catch(function(){return[];}),
    ]).then(function(res) {
      S.drivers = (res[0]||[]).filter(function(d){return TRUCK[d.driver_name];});
      S.loads = (res[1]||[]).map(norm).filter(function(l){return TRUCK[l.driver];});
      S.byDriver = {Max:[],Monu:[],Paul:[]};
      S.loads.forEach(function(l){ if(S.byDriver[l.driver]) S.byDriver[l.driver].push(l); });
      var months = {};
      S.loads.forEach(function(l){ if(l.pickupDate) months[l.pickupDate.slice(0,7)]=true; });
      var present = Object.keys(months).sort();
      if(present.length) S.activeMonth = present[present.length-1];
      S.ready = true;
      return S;
    });
  }

  /* reload one load from API and update S.loads */
  function reloadLoad(id) {
    return api('/api/loads/'+id).then(function(raw){
      var updated = norm(raw);
      for(var i=0;i<S.loads.length;i++){
        if(S.loads[i].id===id){ S.loads[i]=updated; break; }
      }
      // rebuild byDriver
      S.byDriver = {Max:[],Monu:[],Paul:[]};
      S.loads.forEach(function(l){ if(S.byDriver[l.driver]) S.byDriver[l.driver].push(l); });
      return updated;
    });
  }

  /* ─── schedule model ─────────────────────────────────────────────────── */

  function loadsForDriverMonth(driver, month) {
    return (S.byDriver[driver]||[]).filter(function(l){
      return l.pickupDate && l.pickupDate.slice(0,7)===month && !l.cancelled;
    }).sort(function(a,b){ return a.pickupDate<b.pickupDate?-1:1; });
  }

  function dayMap(driver, month) {
    var n = DAYS[month]||30;
    var days = []; for(var i=0;i<n;i++) days.push({state:'off',load:null});
    var loads = loadsForDriverMonth(driver, month);
    var first=null,last=null;
    loads.forEach(function(l){
      var p=new Date(l.pickupDate), d=l.dropoffDate?new Date(l.dropoffDate):p;
      var mo=parseInt(month.slice(5))-1;
      var s=p.getUTCMonth()===mo?p.getUTCDate():1;
      var e=d.getUTCMonth()===mo?d.getUTCDate():n;
      for(var day=s;day<=e&&day<=n;day++) if(!days[day-1].load) days[day-1]={state:'load',load:l};
      if(first===null||s<first) first=s;
      if(last===null||e>last) last=e;
    });
    if(first!==null){
      for(var k=first;k<=last;k++) if(days[k-1].state==='off') days[k-1]={state:'gap',load:null};
      for(var t=last+1;t<=n;t++) days[t-1]={state:'gap',load:null};
    }
    return days;
  }

  function driverStats(driver, month) {
    var loads=loadsForDriverMonth(driver,month), rev=0,mi=0,rs=0,rn=0;
    loads.forEach(function(l){ rev+=l.rate; mi+=l.miles; if(l.rpm){rs+=l.rpm;rn++;} });
    var dm=dayMap(driver,month);
    var loaded=dm.filter(function(d){return d.state==='load';}).length;
    var gaps=dm.filter(function(d){return d.state==='gap';}).length;
    return {loads:loads.length,revenue:rev,miles:mi,rpm:rn?rs/rn:0,loadedDays:loaded,gapDays:gaps};
  }

  /* ─── styles ─────────────────────────────────────────────────────────── */

  function injectStyles() {
    if(document.getElementById('tm-styles')) return;
    var s=document.createElement('style'); s.id='tm-styles';
    s.textContent = [
      /* Board */
      '.tm-board{padding:16px 20px 0;font-family:Inter,system-ui,sans-serif;}',
      '.tm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;gap:12px;flex-wrap:wrap;}',
      '.tm-head-title{font-size:14px;font-weight:600;color:var(--ink);}',
      '.tm-head-sub{font-size:11px;color:var(--ink-3);font-weight:400;margin-left:6px;}',
      /* Month tabs */
      '.tm-months{display:flex;gap:2px;background:var(--surface-alt);padding:3px;border-radius:8px;border:1px solid var(--line-2);}',
      '.tm-months button{border:0;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--ink-3);padding:4px 11px;border-radius:6px;cursor:pointer;transition:all .15s;}',
      '.tm-months button:hover{color:var(--ink);}',
      '.tm-months button.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-sm);}',
      /* Urgent banner */
      '.tm-urgent{margin:0 0 11px;padding:9px 13px;border-radius:8px;background:var(--red-soft);border:1px solid rgba(194,69,62,.18);font-size:12.5px;color:var(--red);display:flex;gap:7px;align-items:flex-start;line-height:1.4;}',
      '.tm-urgent.ok{background:var(--teal-soft);border-color:rgba(14,131,120,.18);color:var(--teal-deep);}',
      '.tm-urgent .u-dot{flex-shrink:0;width:7px;height:7px;border-radius:50%;background:currentColor;margin-top:4px;}',
      '.tm-urgent a{color:inherit;text-decoration:underline;cursor:pointer;}',
      /* Calendar */
      '.tm-cal{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface);margin-bottom:11px;}',
      '.tm-row{display:grid;grid-template-columns:144px 1fr;border-bottom:1px solid var(--line-2);}',
      '.tm-row:last-child{border-bottom:0;}',
      '.tm-rh{padding:10px 13px;border-right:1px solid var(--line-2);background:var(--surface-alt);}',
      '.tm-rh .dn{font-weight:600;font-size:13px;color:var(--ink);margin-bottom:2px;}',
      '.tm-rh .dt{font-size:11px;color:var(--ink-3);font-family:"JetBrains Mono",monospace;}',
      '.tm-rh .flag{margin-top:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;display:inline-block;padding:2px 7px;border-radius:4px;}',
      '.tm-rh .flag.down{background:var(--red);color:#fff;}',
      '.tm-rh .flag.home{background:var(--amber-soft);color:var(--amber);border:1px solid rgba(197,138,31,.25);}',
      /* Days */
      '.tm-days{display:flex;overflow-x:auto;scrollbar-width:none;}',
      '.tm-days::-webkit-scrollbar{display:none;}',
      '.tm-day{flex:0 0 27px;min-height:56px;border-right:1px solid var(--line-2);padding:3px 1px;position:relative;}',
      '.tm-day:last-child{border-right:0;}',
      '.tm-day .dn{font-size:8px;color:var(--ink-4);font-family:"JetBrains Mono",monospace;text-align:center;}',
      '.tm-day.load{background:var(--teal-soft);cursor:pointer;transition:background .12s;}',
      '.tm-day.load:hover{background:#c2e2dd;}',
      '.tm-day.load .dot{width:5px;height:5px;border-radius:50%;background:var(--teal);margin:3px auto 0;}',
      '.tm-day.gap{background:repeating-linear-gradient(45deg,#fff,#fff 4px,#feeeed 4px,#feeeed 8px);cursor:pointer;}',
      '.tm-day.gap:hover{outline:2px solid rgba(194,69,62,.35);outline-offset:-2px;}',
      '.tm-day.gap .dot{width:5px;height:5px;border-radius:50%;background:var(--red);margin:3px auto 0;}',
      '.tm-day.gap.home-need{background:repeating-linear-gradient(45deg,#fff,#fff 4px,#FFF3CD 4px,#FFF3CD 8px);}',
      '.tm-day.gap.home-need .dot{background:var(--amber);}',
      '.tm-day.cancelled{background:var(--surface-alt);opacity:.55;}',
      /* Legend */
      '.tm-leg{display:flex;gap:14px;padding-bottom:2px;font-size:11px;color:var(--ink-3);}',
      '.tm-leg span{display:flex;align-items:center;gap:5px;}',
      '.tm-leg i{width:9px;height:9px;border-radius:2px;flex-shrink:0;}',
      '.tm-leg .l-l i{background:var(--teal-soft);border:1px solid rgba(14,131,120,.3);}',
      '.tm-leg .l-g i{background:repeating-linear-gradient(45deg,#fff,#fff 3px,#feeeed 3px,#feeeed 6px);border:1px solid rgba(194,69,62,.25);}',
      '.tm-leg .l-o i{background:#fff;border:1px solid var(--line);}',
      /* Analytics */
      '.tm-an{padding:16px 20px;}',
      '.tm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}',
      '.tm-kpi{padding:14px 15px;border:1px solid var(--line);border-radius:10px;background:var(--surface);}',
      '.tm-kpi .l{font-size:10px;color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;}',
      '.tm-kpi .v{font-size:22px;font-weight:700;color:var(--ink);margin-top:5px;line-height:1.1;}',
      '.tm-kpi .d{font-size:11px;color:var(--teal-deep);margin-top:3px;font-weight:500;}',
      '.tm-an-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '.tm-panel{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:14px 16px;}',
      '.tm-panel h4{margin:0 0 11px;font-size:11px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.06em;}',
      '.tm-br{display:grid;grid-template-columns:48px 1fr 60px;align-items:center;gap:8px;margin-bottom:7px;font-size:12px;}',
      '.tm-track{height:10px;background:var(--line-2);border-radius:5px;overflow:hidden;}',
      '.tm-fill{height:100%;background:var(--teal);border-radius:5px;}',
      '.tm-bv{text-align:right;font-family:"JetBrains Mono",monospace;font-size:11px;}',
      /* Tables */
      '.tm-tbl{width:100%;border-collapse:collapse;font-size:12px;}',
      '.tm-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);padding:5px 8px;border-bottom:1px solid var(--line);}',
      '.tm-tbl td{padding:6px 8px;border-bottom:1px solid var(--line-2);color:var(--ink);}',
      '.tm-tbl tr:last-child td{border-bottom:0;}',
      '.tm-tbl .mono{font-family:"JetBrains Mono",monospace;}',
      '.tm-tbl .teal{color:var(--teal-deep);font-weight:600;}',
      '.tm-tbl tr.clickable{cursor:pointer;}',
      '.tm-tbl tr.clickable:hover td{background:var(--surface-alt);}',
      /* Status badges */
      '.tm-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}',
      '.tm-badge.PENDING{background:var(--line-2);color:var(--ink-2);}',
      '.tm-badge.COMPLETED{background:var(--teal-soft);color:var(--teal-deep);}',
      '.tm-badge.CANCELLED{background:var(--red-soft);color:var(--red);}',
      '.tm-badge.IN_TRANSIT{background:#E8F0FF;color:#3B5BDB;}',
      /* Modal */
      '.tm-ov{position:fixed;inset:0;background:rgba(14,17,21,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn .2s ease;}',
      '.tm-modal{background:#fff;border-radius:14px;width:580px;max-width:93vw;max-height:90vh;overflow:auto;box-shadow:0 24px 60px -12px rgba(14,17,21,.26);}',
      '.tm-mh{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;}',
      '.tm-mh .title{font-size:14px;font-weight:600;color:var(--ink);}',
      '.tm-mh .sub{font-size:11px;color:var(--ink-3);margin-top:2px;}',
      '.tm-mh-x{border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--ink-3);line-height:1;padding:0 4px;transition:color .15s;}',
      '.tm-mh-x:hover{color:var(--ink);}',
      '.tm-mb{padding:18px 20px;}',
      '.tm-mf{display:flex;gap:8px;align-items:center;padding:0 20px 18px;}',
      /* Form fields */
      '.tm-field{margin-bottom:13px;}',
      '.tm-field label{display:block;font-size:10px;color:var(--ink-3);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;}',
      '.tm-field input,.tm-field select,.tm-field textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;box-sizing:border-box;color:var(--ink);outline:none;transition:border-color .15s;background:#fff;}',
      '.tm-field input:focus,.tm-field select:focus,.tm-field textarea:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(14,131,120,.1);}',
      '.tm-field textarea{min-height:80px;resize:vertical;}',
      '.tm-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '.tm-field-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}',
      /* Buttons */
      '.tm-btn{border:0;border-radius:8px;padding:8px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap;}',
      '.tm-btn.dark{background:var(--ink);color:#fff;flex:1;}',
      '.tm-btn.dark:hover{background:#1e2730;}',
      '.tm-btn.teal{background:var(--teal);color:#fff;}',
      '.tm-btn.teal:hover{background:var(--teal-deep);}',
      '.tm-btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);}',
      '.tm-btn.ghost:hover{background:var(--surface-alt);}',
      '.tm-btn.red{background:var(--red-soft);color:var(--red);border:1px solid rgba(194,69,62,.2);}',
      '.tm-btn.red:hover{background:#f8d5d3;}',
      '.tm-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.tm-btn.loading::after{content:" …";}',
      '.tm-btn-sm{padding:5px 11px;font-size:11px;border-radius:6px;}',
      '.tm-msg{font-size:11px;color:var(--ink-3);margin-right:auto;}',
      /* Drive import bar */
      '.tm-drive-bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:var(--surface-alt);border:1px solid var(--line-2);border-radius:8px;font-size:12px;}',
      '.tm-drive-bar .db-label{color:var(--ink-2);font-weight:500;flex:1;}',
      /* Toast */
      '.tm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;z-index:99999;animation:fadeIn .2s;pointer-events:none;}',
      '.tm-toast.ok{background:var(--teal);}',
      '.tm-toast.err{background:var(--red);}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ─── toast ──────────────────────────────────────────────────────────── */

  function toast(msg, type) {
    var t=document.createElement('div');
    t.className='tm-toast '+(type||'');
    t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(function(){if(t.parentNode)t.remove();},3000);
  }

  /* ─── close modal helper ─────────────────────────────────────────────── */

  function closeModal(id) {
    var m=document.getElementById(id||'tm-modal'); if(m) m.remove();
  }

  function makeModal(id, heading, subtext, content, footer) {
    closeModal(id);
    var ov=document.createElement('div'); ov.className='tm-ov'; ov.id=id||'tm-modal';
    ov.innerHTML='<div class="tm-modal">' +
      '<div class="tm-mh"><div><div class="title">'+heading+'</div><div class="sub">'+subtext+'</div></div>' +
      '<button class="tm-mh-x" data-close>×</button></div>' +
      '<div class="tm-mb">'+content+'</div>' +
      '<div class="tm-mf">'+footer+'</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){ if(e.target===ov||e.target.hasAttribute('data-close')) closeModal(id); });
    return ov;
  }

  /* ─── EDIT LOAD MODAL ────────────────────────────────────────────────── */

  function openEditModal(load) {
    var drivers = ['Max','Monu','Paul'];
    var statuses = ['PENDING','IN_TRANSIT','COMPLETED','CANCELLED'];
    var trailers = ['DRY_VAN','REEFER','FLATBED','STEP_DECK','TANKER','LTL','OTHER'];

    var driverOpts = ['<option value="">— Unassigned —</option>'].concat(
      drivers.map(function(d){ return '<option value="'+d+'"'+(load.driver===d?' selected':'')+'>'+d+' (Truck #'+TRUCK[d]+')</option>'; })
    ).join('');

    var statusOpts = statuses.map(function(s){
      return '<option value="'+s+'"'+(load.status===s?' selected':'')+'>'+s+'</option>';
    }).join('');

    var trailerOpts = ['<option value="">— Select —</option>'].concat(
      trailers.map(function(t){ return '<option value="'+t+'"'+(load.trailerType===t?' selected':'')+'>'+t.replace('_',' ')+'</option>'; })
    ).join('');

    var lane = (load.pickupCity||'?')+', '+(load.pickupState||'?')+' → '+(load.dropoffCity||'?')+', '+(load.dropoffState||'?');

    var content =
      /* Row 1 */
      '<div class="tm-field-row">' +
        '<div class="tm-field"><label>Driver</label><select id="ef-driver">'+driverOpts+'</select></div>' +
        '<div class="tm-field"><label>Trailer type</label><select id="ef-trailer">'+trailerOpts+'</select></div>' +
      '</div>' +
      /* Row 2 */
      '<div class="tm-field-row3">' +
        '<div class="tm-field"><label>Rate ($)</label><input id="ef-rate" type="number" value="'+load.rate+'"></div>' +
        '<div class="tm-field"><label>Loaded miles</label><input id="ef-miles" type="number" value="'+(load.miles||'')+'"></div>' +
        '<div class="tm-field"><label>Deadhead miles</label><input id="ef-dh" type="number" value="'+(load.deadheadMiles||'')+'"></div>' +
      '</div>' +
      /* Row 3 */
      '<div class="tm-field"><label>Status</label><select id="ef-status">'+statusOpts+'</select></div>' +
      /* Cancelled toggle */
      '<div id="ef-cancel-wrap" class="tm-field" style="'+(load.status==='CANCELLED'?'':'display:none')+'">' +
        '<label>Cancellation reason</label>' +
        '<textarea id="ef-cancel-reason">'+load.cancellationReason+'</textarea>' +
      '</div>' +
      /* Info tiles */
      '<div style="padding:10px 12px;background:var(--surface-alt);border:1px solid var(--line-2);border-radius:8px;font-size:12px;color:var(--ink-3);line-height:1.6;">' +
        '<div><strong style="color:var(--ink)">Lane:</strong> '+lane+'</div>' +
        '<div><strong style="color:var(--ink)">Load #:</strong> '+load.loadNumber+'</div>' +
        '<div><strong style="color:var(--ink)">Broker:</strong> '+(load.brokerName||'—')+(load.brokerEmail?' · '+load.brokerEmail:'')+'</div>' +
        '<div><strong style="color:var(--ink)">Pickup:</strong> '+(load.pickupDate?load.pickupDate.slice(0,16).replace('T',' '):'—')+'</div>' +
        '<div><strong style="color:var(--ink)">Delivery:</strong> '+(load.dropoffDate?load.dropoffDate.slice(0,16).replace('T',' '):'—')+'</div>' +
      '</div>';

    var footer =
      '<button class="tm-btn red tm-btn-sm" id="ef-cancel-btn">Cancel load</button>' +
      '<span class="tm-msg" id="ef-msg"></span>' +
      '<button class="tm-btn ghost" data-close>Discard</button>' +
      '<button class="tm-btn dark" id="ef-save">Save changes</button>';

    var ov = makeModal('tm-edit-modal', 'Edit load · #'+load.loadNumber, load.driver+' · '+lane, content, footer);

    /* Show/hide cancellation reason */
    ov.querySelector('#ef-status').addEventListener('change', function(){
      var wrap = ov.querySelector('#ef-cancel-wrap');
      wrap.style.display = this.value==='CANCELLED' ? '' : 'none';
    });

    /* Cancel load shortcut */
    ov.querySelector('#ef-cancel-btn').addEventListener('click', function(){
      ov.querySelector('#ef-status').value = 'CANCELLED';
      ov.querySelector('#ef-cancel-wrap').style.display = '';
      ov.querySelector('#ef-cancel-reason').focus();
    });

    /* Save */
    ov.querySelector('#ef-save').addEventListener('click', function(){
      var btn = this;
      var msg = ov.querySelector('#ef-msg');
      var status = ov.querySelector('#ef-status').value;
      var payload = {
        driver_name: ov.querySelector('#ef-driver').value || null,
        trailer_type: ov.querySelector('#ef-trailer').value || null,
        rate: parseFloat(ov.querySelector('#ef-rate').value) || null,
        loaded_miles: parseInt(ov.querySelector('#ef-miles').value) || null,
        deadhead_miles: parseInt(ov.querySelector('#ef-dh').value) || null,
        status: status || null,
        cancelled: status==='CANCELLED',
        cancellation_reason: status==='CANCELLED' ? (ov.querySelector('#ef-cancel-reason').value||null) : null,
      };
      btn.textContent='Saving…'; btn.disabled=true; msg.textContent='';
      api('/api/loads/'+load.id, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),
      }).then(function(){
        toast('Load #'+load.loadNumber+' updated','ok');
        closeModal('tm-edit-modal');
        return reloadLoad(load.id);
      }).then(function(){
        renderPlan(); renderAnalytics(); repopulateRCTable();
      }).catch(function(e){
        msg.textContent='Error: '+e.message;
        btn.textContent='Save changes'; btn.disabled=false;
      });
    });
  }

  /* ─── BROKER MODAL ───────────────────────────────────────────────────── */

  function openBrokerModal(load) {
    var lane=(load.pickupCity||'?')+', '+load.pickupState+' → '+(load.dropoffCity||'?')+', '+load.dropoffState;
    var pickup=load.pickupDate?new Date(load.pickupDate).toUTCString().slice(0,16):'TBD';
    var toEmail=load.brokerEmail||'';
    var subject='Load #'+load.loadNumber+' — '+lane;
    var body='Hi '+(load.brokerName||'there')+',\n\n'+
      'Following up on load #'+load.loadNumber+' ('+lane+'), pickup '+pickup+'.\n'+
      'Royal Carriers has a truck available and can cover this lane.\n'+
      'Please confirm the rate of $'+load.rate.toLocaleString()+' and send the signed rate confirmation.\n\n'+
      'Thanks,\nRoyal Carriers Dispatch\n(469) 000-0000';

    var content =
      '<div class="tm-field-row">' +
        '<div class="tm-field"><label>To</label><input id="bm-to" value="'+toEmail+'" placeholder="(no email on rate sheet)"></div>' +
        '<div class="tm-field"><label>Phone</label><input value="'+(load.brokerPhone||'—')+'" readonly></div>' +
      '</div>' +
      '<div class="tm-field"><label>Subject</label><input id="bm-subj" value="'+subject+'"></div>' +
      '<div class="tm-field"><label>Message — drafted from rate sheet</label><textarea id="bm-body">'+body+'</textarea></div>';

    var footer =
      '<span class="tm-msg">Email endpoint ships with Danish\'s Tier 1</span>' +
      '<button class="tm-btn ghost" id="bm-copy">Copy</button>' +
      '<button class="tm-btn ghost" id="bm-mailto">Open in Mail</button>' +
      '<button class="tm-btn dark" id="bm-send">Send</button>';

    var ov = makeModal('tm-broker-modal','Notify broker · '+(load.brokerName||'Unknown'),
      'Load #'+load.loadNumber+' · '+lane, content, footer);

    ov.querySelector('#bm-copy').addEventListener('click',function(){
      try{ navigator.clipboard.writeText(ov.querySelector('#bm-body').value); toast('Copied to clipboard','ok'); }
      catch(e){ toast('Select and copy manually'); }
    });

    ov.querySelector('#bm-mailto').addEventListener('click',function(){
      var to=ov.querySelector('#bm-to').value, subj=ov.querySelector('#bm-subj').value, bod=ov.querySelector('#bm-body').value;
      window.open('mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(bod));
    });

    ov.querySelector('#bm-send').addEventListener('click',function(){
      var btn=this; btn.textContent='Sending…'; btn.disabled=true;
      var to=ov.querySelector('#bm-to').value, subj=ov.querySelector('#bm-subj').value, bod=ov.querySelector('#bm-body').value;
      api('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to,subject:subj,body:bod})})
        .then(function(){ toast('Sent!','ok'); closeModal('tm-broker-modal'); })
        .catch(function(){
          window.open('mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(bod));
          btn.textContent='Send'; btn.disabled=false;
        });
    });
  }

  /* ─── PLAN SCHEDULE ──────────────────────────────────────────────────── */

  function renderPlan() {
    var grid = document.querySelector('.scene[data-scene="1"] .wp-main');
    if(!grid) return;
    var month = S.activeMonth;
    var drivers = ['Max','Monu','Paul'];
    var months = Object.keys(DAYS).filter(function(m){
      return S.loads.some(function(l){ return l.pickupDate&&l.pickupDate.slice(0,7)===m; });
    });

    var urgent = drivers.filter(function(d){
      var dm=dayMap(d,month), last=-1;
      for(var i=0;i<dm.length;i++) if(dm[i].state==='load') last=i;
      return last>=0 && dm.slice(last+1).filter(function(x){return x.state==='gap';}).length>=3;
    });

    var html = '<div class="tm-board">' +
      '<div class="tm-head">' +
        '<div class="tm-head-title">Royal Carriers <span class="tm-head-sub">schedule from rate confirmations · '+MON[month]+'</span></div>' +
        '<div class="tm-months">'+months.map(function(m){
          return '<button data-m="'+m+'"'+(m===month?' class="active"':'')+'>'+MON[m].slice(0,3)+'</button>';
        }).join('')+'</div>' +
      '</div>';

    if(urgent.length){
      html+='<div class="tm-urgent"><div class="u-dot"></div><div><strong>'+urgent.join(', ')+
        '</strong> running empty after their last load. <a data-goto-ff>Find a backhaul →</a></div></div>';
    } else {
      html+='<div class="tm-urgent ok"><div class="u-dot"></div><span>All drivers covered through their last booked load.</span></div>';
    }

    html+='<div class="tm-cal">';
    drivers.forEach(function(d){
      var dm=dayMap(d,month), sc=S.scenarios[d];
      var homeCity = DRIVER_HOME[d] || 'home base';
      html+='<div class="tm-row"><div class="tm-rh"><div class="dn">'+d+'</div><div class="dt">Truck #'+TRUCK[d]+'</div>';
      if(sc&&sc.type==='down') html+='<div class="flag down">Truck down</div>';
      if(sc&&sc.type==='home') html+='<div class="flag home">Home by '+sc.by+'</div>';
      html+='</div><div class="tm-days">';
      dm.forEach(function(cell,idx){
        var day=idx+1;
        if(cell.state==='load'){
          var l=cell.load;
          var tip='#'+l.loadNumber+' · '+l.pickupCity+', '+l.pickupState+' → '+l.dropoffCity+', '+l.dropoffState+
            ' · $'+l.rate.toLocaleString()+(l.miles?' · '+l.miles+' mi':'')+(l.rpm?' · $'+l.rpm.toFixed(2)+'/mi':'')+' · '+l.trailerType+
            '\nClick → broker email  ·  Long-press → edit load';
          html+='<div class="tm-day load" title="'+tip.replace(/"/g,'&quot;')+'" data-lid="'+l.id+'"><div class="dn">'+day+'</div><div class="dot"></div></div>';
        } else if(cell.state==='gap'){
          // Show home-by note on first empty day after scenario
          var homeNote = (sc&&sc.type==='home') ? 'Need load → '+homeCity+' by '+sc.by : 'Empty — click to find a load';
          html+='<div class="tm-day gap'+(sc&&sc.type==='home'?' home-need':'')+'" title="'+homeNote+'" data-book="'+d+'"><div class="dn">'+day+'</div><div class="dot"></div></div>';
        } else {
          html+='<div class="tm-day"><div class="dn">'+day+'</div></div>';
        }
      });
      html+='</div></div>';
    });
    html+='</div>';

    html+='<div class="tm-leg">'+
      '<span class="l-l"><i></i>Booked load (click → broker email or edit)</span>'+
      '<span class="l-g"><i></i>Empty · needs load</span>'+
      '<span class="l-o"><i></i>Off / home</span>'+
      '</div></div>';

    grid.innerHTML=html;

    /* Wire month tabs */
    grid.querySelectorAll('.tm-months button').forEach(function(b){
      b.addEventListener('click',function(){ S.activeMonth=b.getAttribute('data-m'); renderPlan(); });
    });

    /* Teal day → broker modal OR long-press → edit modal */
    var pressTimer;
    grid.querySelectorAll('.tm-day.load').forEach(function(c){
      c.addEventListener('mousedown',function(){
        pressTimer=setTimeout(function(){ openEditModal(S.loads.find(function(x){return x.id===c.getAttribute('data-lid');})||{}); },600);
      });
      c.addEventListener('mouseup',function(){ clearTimeout(pressTimer); });
      c.addEventListener('click',function(){
        clearTimeout(pressTimer);
        var l=S.loads.find(function(x){return x.id===c.getAttribute('data-lid');});
        if(l) openBrokerModal(l);
      });
    });

    /* Gap → Find & Fill */
    grid.querySelectorAll('.tm-day.gap').forEach(function(c){
      c.addEventListener('click',function(){ var b=document.querySelector('.scene-btn[data-scene="2"]'); if(b) b.click(); });
    });

    var ffLink=grid.querySelector('[data-goto-ff]');
    if(ffLink) ffLink.addEventListener('click',function(){ var b=document.querySelector('.scene-btn[data-scene="2"]'); if(b) b.click(); });
  }

  /* ─── ANALYTICS ──────────────────────────────────────────────────────── */

  function renderAnalytics() {
    var wrap=document.querySelector('.scene[data-scene="3"] .an-wrap');
    if(!wrap) return;
    var drivers=['Max','Monu','Paul'];
    var active=S.loads.filter(function(l){return!l.cancelled;});
    var totRev=0,totLoads=active.length,rpmSum=0,rpmN=0,totMiles=0,bestRpm=0,bestRpmDriver='';
    active.forEach(function(l){ totRev+=l.rate; totMiles+=l.miles; if(l.rpm){rpmSum+=l.rpm;rpmN++;} });
    var avgRpm=rpmN?rpmSum/rpmN:0;

    /* per-driver stats for sparklines */
    var driverData={};
    drivers.forEach(function(d){
      var dl=S.byDriver[d]||[]; var dr=0,dn=0,drs=0,drn=0,dmi=0,dld=0;
      dl.filter(function(l){return!l.cancelled;}).forEach(function(l){ dr+=l.rate;dn++;dmi+=l.miles;if(l.rpm){drs+=l.rpm;drn++;} });
      ['2026-02','2026-03','2026-04','2026-05'].forEach(function(m){ dld+=driverStats(d,m).loadedDays; });
      var drpm=drn?drs/drn:0;
      if(drpm>bestRpm){bestRpm=drpm;bestRpmDriver=d;}
      driverData[d]={rev:dr,loads:dn,miles:dmi,rpm:drpm,loadedDays:dld};
    });

    var months=['2026-02','2026-03','2026-04','2026-05'];
    /* per-month revenue split by driver */
    var revByMonth=months.map(function(m){
      var tot=0; active.forEach(function(l){ if(l.pickupDate&&l.pickupDate.slice(0,7)===m) tot+=l.rate; }); return tot;
    });
    var revByMonthDriver={};
    drivers.forEach(function(d){
      revByMonthDriver[d]=months.map(function(m){
        var r=0; (S.byDriver[d]||[]).filter(function(l){return!l.cancelled;}).forEach(function(l){
          if(l.pickupDate&&l.pickupDate.slice(0,7)===m) r+=l.rate;
        }); return r;
      });
    });
    var maxM=Math.max.apply(null,revByMonth.concat([1]));
    var maxDM=Math.max.apply(null,[].concat.apply([],drivers.map(function(d){ return revByMonthDriver[d]||[0]; })).concat([1]));

    /* RPM by driver by month */
    var rpmByMonthDriver={};
    drivers.forEach(function(d){
      rpmByMonthDriver[d]=months.map(function(m){
        var rs=0,rn=0; (S.byDriver[d]||[]).filter(function(l){return!l.cancelled&&l.pickupDate&&l.pickupDate.slice(0,7)===m&&l.rpm;}).forEach(function(l){rs+=l.rpm;rn++;});
        return rn?rs/rn:0;
      });
    });

    var DCOLORS={Max:'var(--teal)',Monu:'#3B82F6',Paul:'var(--amber)'};

    var html='<div class="tm-an">';

    /* KPIs */
    html+='<div class="tm-kpis">';
    html+=kpi('Total revenue',money(totRev),'Feb – May 2026 · active loads');
    html+=kpi('Active loads',String(totLoads),'across Max · Monu · Paul');
    html+=kpi('Avg RPM','$'+avgRpm.toFixed(2),'fleet-wide · loaded miles');
    html+=kpi('Best RPM driver',bestRpmDriver,'$'+bestRpm.toFixed(2)+'/mi this period');
    html+='</div>';

    /* Driver scorecards */
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;">';
    drivers.forEach(function(d){
      var dd=driverData[d];
      var prev=revByMonthDriver[d]; var lastTwo=[prev[2]||0,prev[3]||0]; var trend=lastTwo[1]>lastTwo[0]?'↑':'↓';
      var trendColor=lastTwo[1]>lastTwo[0]?'var(--teal-deep)':'var(--red)';
      html+='<div class="tm-panel" style="cursor:default;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
          '<strong style="font-size:13px;">'+d+'</strong>' +
          '<span style="font-size:11px;font-weight:600;color:'+DCOLORS[d]+'">Truck #'+TRUCK[d]+'</span>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:700;color:var(--ink);margin-bottom:2px;">'+money(dd.rev)+'</div>' +
        '<div style="font-size:11px;color:var(--ink-3);">'+dd.loads+' loads · '+dd.loadedDays+' loaded days</div>' +
        '<div style="display:flex;gap:14px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2);">' +
          '<div><div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;">RPM</div>' +
            '<div style="font-size:14px;font-weight:600;color:var(--ink);">$'+dd.rpm.toFixed(2)+'</div></div>' +
          '<div><div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;">Miles</div>' +
            '<div style="font-size:14px;font-weight:600;color:var(--ink);">'+fmt(Math.round(dd.miles))+'</div></div>' +
          '<div><div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;">Trend</div>' +
            '<div style="font-size:14px;font-weight:600;color:'+trendColor+';">'+trend+' Apr→May</div></div>' +
        '</div>' +
      '</div>';
    });
    html+='</div>';

    html+='<div class="tm-an-grid">';

    /* Revenue by month stacked bars */
    html+='<div class="tm-panel"><h4>Revenue by month · by driver</h4>';
    months.forEach(function(m,i){
      html+='<div style="margin-bottom:9px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-2);margin-bottom:3px;">' +
          '<span>'+MON[m].slice(0,3)+'</span><span>'+money(revByMonth[i])+'</span></div>' +
        '<div style="height:14px;background:var(--line-2);border-radius:4px;overflow:hidden;display:flex;">';
      drivers.forEach(function(d){
        var w=maxM?Math.round((revByMonthDriver[d][i]||0)/maxM*100):0;
        html+='<div style="width:'+w+'%;background:'+DCOLORS[d]+';opacity:.85;" title="'+d+': '+money(revByMonthDriver[d][i]||0)+'"></div>';
      });
      html+='</div></div>';
    });
    html+='<div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--ink-3);">';
    drivers.forEach(function(d){ html+='<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:'+DCOLORS[d]+';margin-right:4px;"></span>'+d+'</span>'; });
    html+='</div></div>';

    /* RPM by driver by month */
    html+='<div class="tm-panel"><h4>RPM by driver · by month</h4>';
    html+='<table class="tm-tbl"><thead><tr><th>Month</th>';
    drivers.forEach(function(d){ html+='<th>'+d+'</th>'; });
    html+='</tr></thead><tbody>';
    months.forEach(function(m,i){
      html+='<tr><td style="font-size:11px;color:var(--ink-2)">'+MON[m]+'</td>';
      drivers.forEach(function(d){
        var r=rpmByMonthDriver[d][i];
        html+='<td class="mono" style="color:'+rpmColor(r)+';">'+(r?'$'+r.toFixed(2):'—')+'</td>';
      });
      html+='</tr>';
    });
    html+='</tbody></table></div></div>';

    /* Full load table */
    html+='<div class="tm-panel" style="margin-top:14px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
        '<h4 style="margin:0;">Load detail · all '+S.loads.length+' loads (click any row to edit)</h4>' +
        '<div style="display:flex;gap:6px;" id="an-filter-btns">' +
          '<button class="tm-btn ghost tm-btn-sm an-filter active" data-filter="all">All</button>' +
          drivers.map(function(d){ return '<button class="tm-btn ghost tm-btn-sm an-filter" data-filter="'+d+'">'+d+'</button>'; }).join('') +
          '<button class="tm-btn ghost tm-btn-sm an-filter" data-filter="COMPLETED">Completed</button>' +
          '<button class="tm-btn ghost tm-btn-sm an-filter" data-filter="CANCELLED">Cancelled</button>' +
        '</div>' +
      '</div>' +
      '<table class="tm-tbl"><thead><tr><th>Load #</th><th>Driver</th><th>Lane</th><th>Pickup</th><th>Drop</th><th>Rate</th><th>Miles</th><th>RPM</th><th>Status</th></tr></thead>' +
      '<tbody id="an-load-table"></tbody></table></div>';

    html+='</div>'; /* end tm-an */

    wrap.innerHTML=html;

    /* Populate load table */
    function populateTable(filter) {
      var tbody=wrap.querySelector('#an-load-table');
      if(!tbody) return;
      var rows=S.loads.slice().sort(function(a,b){return(b.pickupDate||'')<(a.pickupDate||'')?-1:1;});
      if(filter&&filter!=='all'){
        if(['Max','Monu','Paul'].indexOf(filter)>-1){
          rows=rows.filter(function(l){return l.driver===filter;});
        } else {
          rows=rows.filter(function(l){return l.status===filter||l.cancelled&&filter==='CANCELLED';});
        }
      }
      tbody.innerHTML='';
      rows.forEach(function(l){
        var tr=document.createElement('tr'); tr.className='clickable'; tr.setAttribute('data-lid',l.id);
        tr.innerHTML='<td class="mono" style="font-size:11px;">'+l.loadNumber+'</td>' +
          '<td style="font-weight:600;">'+l.driver+'</td>' +
          '<td style="font-size:11px;">'+(l.pickupCity||'?')+', '+l.pickupState+' → '+(l.dropoffCity||'?')+', '+l.dropoffState+'</td>' +
          '<td class="mono" style="font-size:11px;">'+(l.pickupDate?l.pickupDate.slice(0,10):'—')+'</td>' +
          '<td class="mono" style="font-size:11px;">'+(l.dropoffDate?l.dropoffDate.slice(0,10):'—')+'</td>' +
          '<td class="mono teal">'+money(l.rate)+'</td>' +
          '<td class="mono">'+(l.miles?fmt(l.miles):'—')+'</td>' +
          '<td class="mono" style="color:'+(l.rpm?rpmColor(l.rpm):'var(--ink-3)')+';">'+(l.rpm?'$'+l.rpm.toFixed(2):'—')+'</td>' +
          '<td><span class="tm-badge '+(l.cancelled?'CANCELLED':l.status)+'">'+(l.cancelled?'Cancelled':l.status)+'</span></td>';
        tr.addEventListener('click',function(){openEditModal(l);});
        tbody.appendChild(tr);
      });
    }

    populateTable('all');

    /* Filter buttons */
    wrap.querySelectorAll('.an-filter').forEach(function(btn){
      btn.addEventListener('click',function(){
        wrap.querySelectorAll('.an-filter').forEach(function(b){
          b.classList.remove('active');
          b.style.background=''; b.style.color=''; b.style.borderColor='';
        });
        btn.classList.add('active');
        btn.style.background='var(--ink)'; btn.style.color='#fff'; btn.style.borderColor='var(--ink)';
        populateTable(btn.getAttribute('data-filter'));
      });
    });
  }

  function kpi(l,v,d){
    return '<div class="tm-kpi"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="d">'+d+'</div></div>';
  }

  /* ─── RATE CONFIRMATIONS TABLE ───────────────────────────────────────── */

  function repopulateRCTable() {
    var tbody=document.getElementById('rc-table-body');
    if(!tbody) return;
    tbody.innerHTML='';
    var badge=document.getElementById('ds-rc-badge');
    var meta=document.getElementById('rc-meta-text');

    S.loads.slice().sort(function(a,b){ return(b.pickupDate||'')<(a.pickupDate||'')?-1:1; }).forEach(function(l){
      var tr=document.createElement('tr'); tr.className='clickable'; tr.setAttribute('data-lid',l.id);
      tr.style.cursor='pointer';
      var rpm=l.rpm?'$'+l.rpm.toFixed(2):'—';
      var rpmStyle='color:'+(l.rpm?rpmColor(l.rpm):'var(--ink-3)');
      tr.innerHTML='<td class="mono">'+l.loadNumber+'</td>'+
        '<td>'+l.driver+'</td>'+
        '<td style="font-size:11px;">'+(l.pickupCity||'?')+', '+l.pickupState+' → '+(l.dropoffCity||'?')+', '+l.dropoffState+'</td>'+
        '<td class="muted" style="font-size:11px;">'+(l.pickupDate?l.pickupDate.slice(0,10):'—')+'</td>'+
        '<td class="mono" style="font-weight:600;">$'+l.rate.toLocaleString()+'</td>'+
        '<td class="mono">'+(l.miles?l.miles.toLocaleString():'—')+'</td>'+
        '<td class="mono" style="font-weight:600;'+rpmStyle+'">'+rpm+'</td>'+
        '<td><span class="tm-badge '+(l.cancelled?'CANCELLED':l.status)+'">'+
          (l.cancelled?'Cancelled':l.status.charAt(0)+l.status.slice(1).toLowerCase())+'</span></td>'+
        '<td><button class="tm-btn ghost tm-btn-sm" data-edit="'+l.id+'">Edit</button></td>';
      tbody.appendChild(tr);
    });

    /* Wire edit buttons */
    tbody.querySelectorAll('[data-edit]').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        var l=S.loads.find(function(x){return x.id===btn.getAttribute('data-edit');});
        if(l) openEditModal(l);
      });
    });

    /* Row click → edit */
    tbody.querySelectorAll('tr.clickable').forEach(function(r){
      r.addEventListener('click',function(){
        var l=S.loads.find(function(x){return x.id===r.getAttribute('data-lid');});
        if(l) openEditModal(l);
      });
    });

    var cnt=S.loads.length;
    if(badge){ badge.textContent=cnt; badge.style.display='inline'; }
    if(meta) meta.textContent=cnt+' loads on record · Royal Carriers Inc';
  }

  /* ─── RATECON UPLOAD (hooks into existing demo dropzone) ─────────────── */

  function wireRateconUpload() {
    var inp=document.getElementById('rc-file-input');
    if(!inp) return;
    inp.addEventListener('change',function(){ handleRCFiles(this.files); });

    var zone=document.getElementById('rc-upload-zone');
    if(zone){
      zone.addEventListener('dragover',function(e){ e.preventDefault(); zone.style.borderColor='var(--teal)'; zone.style.background='var(--teal-soft)'; });
      zone.addEventListener('dragleave',function(){ zone.style.borderColor=''; zone.style.background=''; });
      zone.addEventListener('drop',function(e){
        e.preventDefault(); zone.style.borderColor=''; zone.style.background='';
        handleRCFiles(e.dataTransfer.files);
      });
    }
  }

  function handleRCFiles(files) {
    if(!files||!files.length) return;
    var prog=document.getElementById('rc-progress');
    var progText=document.getElementById('rc-progress-text');
    var progBar=document.getElementById('rc-progress-bar');
    var emptyEl=document.getElementById('rc-empty');
    if(prog) prog.style.display='block';
    if(emptyEl) emptyEl.style.display='none';

    var total=files.length, done=0;
    var promises=[];
    Array.prototype.forEach.call(files, function(file){
      if(progText) progText.textContent='Parsing '+file.name+' ('+( done+1)+' of '+total+')…';
      var fd=new FormData(); fd.append('file',file);
      var p=api('/api/loads/parse-ratecon',{method:'POST',body:fd})
        .then(function(data){
          done++;
          if(progBar) progBar.style.width=Math.round(done/total*90)+'%';
          var n=norm({
            id:data.id, load_number:data.loadNumber||data.load_number,
            driver_name:data.driverName||data.driver_name,
            trailer_type:data.trailerType||data.trailer_type,
            pickup_city:data.pickupCity||data.pickup_city,
            pickup_state:data.pickupState||data.pickup_state,
            pickup_date:data.pickupTime||data.pickup_date,
            dropoff_city:data.dropoffCity||data.dropoff_city,
            dropoff_state:data.dropoffState||data.dropoff_state,
            dropoff_date:data.deliveryTime||data.dropoff_date,
            rate:data.rate, loaded_miles:data.loadedMiles||data.loaded_miles,
            rpm:data.rpm, broker_name:data.brokerName||data.broker_name,
            broker_email:data.brokerEmail||data.broker_email,
            broker_phone:data.brokerPhone||data.broker_phone,
            status:'PENDING', cancelled:false,
          });
          if(TRUCK[n.driver]){
            S.loads.unshift(n);
            if(S.byDriver[n.driver]) S.byDriver[n.driver].unshift(n);
          }
          toast('Parsed '+file.name,'ok');
          return n;
        })
        .catch(function(e){ toast('Failed: '+file.name+' — '+e.message,'err'); });
      promises.push(p);
    });

    Promise.allSettled(promises).then(function(){
      if(progBar) progBar.style.width='100%';
      if(progText) progText.textContent='Done — '+done+' of '+total+' parsed';
      setTimeout(function(){ if(prog) prog.style.display='none'; },1800);
      repopulateRCTable();
      renderPlan();
      renderAnalytics();
    });
  }
  window.handleRCFiles=handleRCFiles;
  window.handleRCDrop=function(e){ handleRCFiles(e.dataTransfer.files); };

  /* ─── CHROME EXTENSION POLL ──────────────────────────────────────────── */

  function pollExtension() {
    api('/api/demo/ratecon/latest').then(function(data){
      if(!data||!data.id) return;
      // Check if we already have it
      if(S.loads.some(function(l){ return l.id===data.id; })) return;
      var n=norm(data);
      if(TRUCK[n.driver]){ S.loads.unshift(n); if(S.byDriver[n.driver]) S.byDriver[n.driver].unshift(n); }
      repopulateRCTable(); renderPlan();
      toast('New ratecon from Chrome extension: #'+n.loadNumber,'ok');
    }).catch(function(){});
    setTimeout(pollExtension, 15000); // poll every 15s
  }

  /* ─── AGENT SCENARIOS ────────────────────────────────────────────────── */

  function applyScenario(text) {
    var t=(text||'').toLowerCase(), matched=false;
    ['Max','Monu','Paul'].forEach(function(d){
      if(t.indexOf(d.toLowerCase())===-1) return;
      if(/truck.*(down|broke|broken)|broke.*down|breakdown/.test(t)){
        S.scenarios[d]={type:'down'}; matched=true;
      } else if(/home|back|saturday|friday|thursday|sunday/.test(t)){
        var days=['saturday','friday','thursday','sunday','monday','tuesday','wednesday'];
        var by='weekend';
        for(var i=0;i<days.length;i++){ if(t.indexOf(days[i])>-1){by=days[i].charAt(0).toUpperCase()+days[i].slice(1);break;} }
        S.scenarios[d]={type:'home',by:by}; matched=true;
      } else if(/sick|out|ill/.test(t)){
        S.scenarios[d]={type:'home',by:'today'}; matched=true;
      }
    });
    if(matched){ renderPlan(); var b=document.querySelector('.scene-btn[data-scene="1"]'); if(b) b.click(); }
    return matched;
  }

  function wireAgent() {
    var chips=[
      {label:'Max truck down', cmd:"Max's truck broke down"},
      {label:'Paul home Saturday', cmd:'Paul needs to be home by Saturday'},
      {label:'Monu home Friday', cmd:'Monu wants to be home by Friday'},
    ];
    var suggWrap=document.querySelector('.wp-chat-suggestions');
    if(suggWrap){
      suggWrap.innerHTML=chips.map(function(c){
        return '<button class="wp-chat-sugg" data-tc="'+c.cmd.replace(/"/g,'&quot;')+'">'+c.label+'</button>';
      }).join('');
      suggWrap.querySelectorAll('[data-tc]').forEach(function(b){
        b.addEventListener('click',function(e){
          e.stopImmediatePropagation();
          var inp=document.getElementById('wp-chat-input');
          if(inp) inp.value=b.getAttribute('data-tc');
          applyScenario(b.getAttribute('data-tc'));
        },true);
      });
    }
    var input=document.getElementById('wp-chat-input');
    if(input){
      input.setAttribute('placeholder','"Max\'s truck broke down" or "Paul home Saturday"');
      input.addEventListener('keydown',function(e){
        if(e.key==='Enter'&&applyScenario(input.value)){e.preventDefault();e.stopImmediatePropagation();}
      },true);
    }
    var send=document.getElementById('wp-chat-send');
    if(send){
      send.addEventListener('click',function(e){
        var inp=document.getElementById('wp-chat-input');
        if(inp&&applyScenario(inp.value)) e.stopImmediatePropagation();
      },true);
    }
  }

  /* ─── MAKE OPTIMAL ASSIGNMENTS ───────────────────────────────────────── */

  function wireOptimalBtn() {
    var btn=document.getElementById('build-trigger');
    if(!btn) return;
    btn.addEventListener('click',function(){
      var pill=document.getElementById('wp-status-pill');
      if(pill){pill.textContent='Optimizing…';pill.style.background='var(--amber-soft)';pill.style.color='var(--amber)';}
      setTimeout(function(){
        renderPlan();
        if(pill){pill.textContent='Synced · just now';pill.style.background='';pill.style.color='';}
      },1400);
    },true);
  }

  /* ─── SCENE SWITCH RERENDER ──────────────────────────────────────────── */

  function wireSceneSwitch() {
    document.querySelectorAll('.scene-btn[data-scene]').forEach(function(b){
      b.addEventListener('click',function(){
        setTimeout(function(){
          if(!S.ready) return;
          renderPlan(); renderAnalytics();
        },30);
      });
    });
  }

  /* ─── BOOT ───────────────────────────────────────────────────────────── */

  function boot() {
    injectStyles();
    loadData().then(function(){
      renderPlan();
      renderAnalytics();
      repopulateRCTable();
      wireRateconUpload();
      wireAgent();
      wireOptimalBtn();
      wireSceneSwitch();
      pollExtension();
      console.log('[TM v2] Tier 0 connected — '+S.loads.length+' loads / '+S.drivers.length+' drivers');
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,250);});
  } else {
    setTimeout(boot,250);
  }
})();
