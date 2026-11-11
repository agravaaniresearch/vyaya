/* Vyaya page logic: loads the data files, wires the controls, renders the headline,
   charts, detail view and exports. All arithmetic lives in engine.js. */
(function () {
  'use strict';
  var E = window.VyayaEngine;
  var COLORS = { s1: '#C0461F', s2: '#1F8A70', s3: '#B07A00', s4: '#9C3D8C', ink: '#2B2420', ink2: '#5A4E46', ink3: '#85776C', rule: '#E2D6C6', surface: '#FBF7F0' };
  var FILES = { assumptions: 'assumptions.json', tariffs: 'electricity_tariffs.json', compute: 'compute_prices.json', sources: 'sources.json', formulas: 'formulas.json', openItems: 'open_items.json' };
  var S = { data: null, values: {}, defaults: {}, result: null, built: null, charts: {}, volMode: 'all' };

  /* ---------- formatting ---------- */
  function inr(x, opts) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    var d = (opts && opts.dp !== undefined) ? opts.dp : (Math.abs(x) < 10 ? 2 : 0);
    return '₹' + x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function inrWords(x) {
    if (!isFinite(x)) return '—';
    if (Math.abs(x) >= 1e7) return '₹' + (x / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' crore';
    if (Math.abs(x) >= 1e5) return '₹' + (x / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' lakh';
    return inr(x, { dp: 0 });
  }
  function count(x) { return (x === null || !isFinite(x)) ? '—' : Math.round(x).toLocaleString('en-IN'); }
  function pct(x) { return (x === null || !isFinite(x)) ? '—' : (x * 100).toLocaleString('en-IN', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + '%'; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- data loading ---------- */
  function loadData() {
    if (window.VYAYA_DATA) return Promise.resolve(window.VYAYA_DATA);
    var keys = Object.keys(FILES);
    return Promise.all(keys.map(function (k) {
      return fetch('data/' + FILES[k], { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(FILES[k]); return r.json(); });
    })).then(function (docs) { var d = {}; keys.forEach(function (k, idx) { d[k] = docs[idx]; }); return d; });
  }

  /* ---------- scenario in the URL hash ---------- */
  function readHash() {
    try {
      var h = location.hash.replace(/^#/, '');
      if (!h) return {};
      return JSON.parse(decodeURIComponent(atob(h)));
    } catch (e) { return {}; }
  }
  function changedValues() {
    var out = {};
    Object.keys(S.values).forEach(function (k) { if (S.values[k] !== S.defaults[k]) out[k] = S.values[k]; });
    return out;
  }
  function writeHash() {
    var c = changedValues();
    var h = Object.keys(c).length ? btoa(encodeURIComponent(JSON.stringify(c))) : '';
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* sandboxed */ }
  }

  function assumption(id) { return S.data.assumptions.assumptions.filter(function (a) { return a.id === id; })[0]; }
  function set(id, v) { S.values[id] = v; schedule(); }
  var pending = null;
  function schedule() { if (pending) return; pending = requestAnimationFrame(function () { pending = null; update(); }); }

  /* ---------- main controls ---------- */
  var LOGMIN = 1, LOGMAX = 6;
  function sliderToN(s) { return Math.round(Math.pow(10, LOGMIN + (LOGMAX - LOGMIN) * s / 1000)); }
  function nToSlider(n) { if (!(n > 0)) return 0; return Math.round(1000 * (Math.log10(n) - LOGMIN) / (LOGMAX - LOGMIN)); }

  function fillSelect(el, options, value) {
    el.innerHTML = options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
  }
  function optionsFor(a) {
    if (a.options) return a.options;
    if (a.optionsFrom === 'compute_prices') return S.data.compute.rows.map(function (r) { return { value: r.id, label: r.tier + ': ' + r.label + (r.pricePerGpuHour !== null ? ' (' + (r.currency === 'USD' ? '$' + r.pricePerGpuHour : '₹' + r.pricePerGpuHour) + '/GPU-hr)' : '') }; });
    if (a.optionsFrom === 'electricity_tariffs') return S.data.tariffs.rows.map(function (r) { return { value: r.id, label: r.state + (r.landedInrPerKwh !== null ? ' (₹' + r.landedInrPerKwh + '/kWh, ' + r.status + ')' : ' (no verified figure yet)') }; });
    return [];
  }

  function wireMain() {
    var range = $('c-patients-range'), box = $('c-patients');
    range.addEventListener('input', function () { var n = sliderToN(+range.value); box.value = n; set('patientsPerMonth', n); });
    box.addEventListener('input', function () { var n = Math.max(0, +box.value || 0); range.value = nToSlider(n); set('patientsPerMonth', n); });
    [['c-state', 'state'], ['c-route', 'route'], ['c-residency', 'residency'], ['c-tier', 'rentTier']].forEach(function (p) {
      $(p[0]).addEventListener('change', function (e) { set(p[1], e.target.value); });
    });
    $('c-review').addEventListener('input', function (e) { set('reviewFraction', +e.target.value); });
    $('c-reprice').addEventListener('input', function (e) { set('repricingFactor', +e.target.value); });
    $('vol-mode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.volMode = b.dataset.v;
      Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
      update();
    });
    $('toggle-detail').addEventListener('click', function () {
      var d = $('detail'); var open = d.classList.toggle('hidden') === false;
      this.setAttribute('aria-expanded', open); this.textContent = open ? 'Hide the working' : 'Show the working: every input, formula and source';
      if (open) renderDetail();
    });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
      ['inputs', 'formulas', 'register', 'sources', 'open', 'history'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
    });
    $('reset').addEventListener('click', function () { S.values = Object.assign({}, S.defaults); syncMain(); renderInputs(); update(); });
    $('copylink').addEventListener('click', function () {
      writeHash();
      var done = function () { $('copied').textContent = 'Link copied.'; setTimeout(function () { $('copied').textContent = ''; }, 2500); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, function () { $('copied').textContent = location.href; });
      else $('copied').textContent = location.href;
    });
  }

  function syncMain() {
    var v = S.values;
    $('c-patients').value = v.patientsPerMonth; $('c-patients-range').value = nToSlider(v.patientsPerMonth);
    fillSelect($('c-state'), optionsFor(assumption('state')), v.state);
    fillSelect($('c-route'), optionsFor(assumption('route')), v.route);
    fillSelect($('c-residency'), optionsFor(assumption('residency')), v.residency);
    fillSelect($('c-tier'), optionsFor(assumption('rentTier')), v.rentTier);
    $('c-review').value = v.reviewFraction; $('c-reprice').value = v.repricingFactor;
  }

  /* ---------- headline ---------- */
  function routeName(id) { return { api: 'a per-token API', rented: 'a rented GPU', owned: 'an owned rig' }[id] || id; }

  function buyRentSentence(r) {
    var owned = r.routes.owned, cloud = [r.routes.api, r.routes.rented].filter(function (x) { return x.available; });
    if (!owned.available) return 'Buying is not costed: ' + (owned.reason || 'the rig has no capacity') + '.';
    if (!cloud.length) return 'Only buying a rig is allowed under the data-residency rule, so there is no buy-versus-rent choice.';
    var bestCloud = cloud.reduce(function (a, b) { return a.monthly.total <= b.monthly.total ? a : b; });
    var be = bestCloud.id === 'api' ? r.breakEven.ownedVsApi : r.breakEven.ownedVsRented;
    var winner = owned.monthly.total < bestCloud.monthly.total ? 'Buying a rig is cheaper than renting' : 'Renting (' + routeName(bestCloud.id).replace(/^an? /, '') + ') is cheaper than buying a rig';
    var tail;
    if (be.value === null) tail = ' ' + be.reason;
    else if (be.beyondCapacity) tail = ' Buying would only match renting at about ' + count(be.value) + ' patients a month, which is beyond one rig\'s capacity of ' + count(r.trace.C8_capacityPerRig) + ', so at full use the rig still costs more.';
    else tail = ' The two break even at about ' + count(be.value) + ' patients a month.';
    return '<b>Buy or rent:</b> ' + winner + ' at this volume.' + tail;
  }

  function renderHeadline() {
    var r = S.result, c = r.chosen, N = r.patientsPerMonth;
    $('h-pp').textContent = c && c.available && c.perPatient !== null ? inr(c.perPatient) : '—';
    $('h-month').textContent = c && c.available ? inrWords(c.monthly.total) : '—';
    $('h-manual').textContent = inr(r.manualPerPatient);
    if (!c || !c.available) {
      $('h-sentence').textContent = 'No route can be costed with the current settings. ' + (c && c.reason ? c.reason : '');
      $('h-buyrent').innerHTML = ''; $('h-manualline').textContent = ''; $('h-share').textContent = '';
    } else {
      $('h-sentence').innerHTML = (N > 0
        ? 'At <b>' + count(N) + '</b> patients a month, extracting their reports with AI would cost about <b>' + inr(c.perPatient) + '</b> per patient, or <b>' + inrWords(c.monthly.total) + '</b> a month, using ' + routeName(c.id) + (S.values.route === 'cheapest' ? ', the cheapest route allowed' : '') + '.'
        : 'With no patients, AI still costs <b>' + inrWords(c.monthly.total) + '</b> a month in fixed costs using ' + routeName(c.id) + '.');
      $('h-buyrent').innerHTML = buyRentSentence(r);
      var mb = c.manualBreakEven;
      var cheaper = c.perPatient !== null && c.perPatient < r.manualPerPatient;
      var line = N > 0 ? ('Manual data entry costs about ' + inr(r.manualPerPatient) + ' per patient, so at this volume AI is ' + (cheaper ? 'cheaper' : 'more expensive') + '. ') : '';
      if (mb.value === null) line += mb.reason;
      else line += 'AI would match manual entry at about ' + count(mb.value) + ' patients a month' + (mb.beyondCapacity ? ' (beyond one rig\'s capacity, so indicative only)' : '') + '.';
      $('h-manualline').textContent = line;
      $('h-share').textContent = 'Compute is ' + pct(c.computeShare) + ' of the monthly bill; people and validation make up the rest.';
    }
    var ph = E.placeholdersInUse(S.data, S.values);
    $('h-notincluded').innerHTML = r.notIncluded.map(function (x) { return '<span class="chip ni">' + esc(x) + '</span>'; }).join('')
      + (ph.length ? '<span class="chip">' + ph.length + ' inputs are still placeholders or illustrations</span>' : '')
      + (S.built.meta.tariffFallback ? '<span class="chip">Electricity: national default used, no verified figure for this state</span>' : '');
    $('h-flags').innerHTML = r.flags.filter(function (f) { return !/Repricing factor is 1/.test(f.text); }).map(function (f) { return '<div class="flag ' + f.level + '">' + esc(f.text) + '</div>'; }).join('');
    $('h-honest').textContent = 'This is an estimate built from your inputs and from defaults, each of which shows its source, status and last-verified date under the working. It is not a quote, and it is not a full cost while anything is listed as not included.';
    var st = S.built.meta.tariffRow;
    $('c-state-hint').textContent = 'Landed tariff used: ₹' + S.built.inputs.gridTariff + '/kWh from ' + S.built.meta.tariffSource + (S.values.captiveOverride ? '; overridden by captive solar.' : '.');
    $('c-review-v').textContent = pct(S.values.reviewFraction) + (S.values.reviewMode === 'accuracy' ? ' (ignored: worked out from accuracy, now ' + pct(r.review.fraction) + ')' : '');
    $('c-reprice-v').textContent = S.values.repricingFactor.toFixed(1) + '×';
    void st;
  }

  /* ---------- charts ---------- */
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = COLORS.ink2;
  Chart.defaults.borderColor = COLORS.rule;
  Chart.defaults.devicePixelRatio = Math.max(2, window.devicePixelRatio || 1); // sharp exports

  var vLines = {
    id: 'vLines',
    afterDatasetsDraw: function (chart, args, o) {
      var lines = (o && o.lines) || [], x = chart.scales.x, ctx = chart.ctx, area = chart.chartArea;
      lines.forEach(function (l, idx) {
        if (!(l.value > 0) || l.value < x.min || l.value > x.max) return;
        var px = x.getPixelForValue(l.value);
        ctx.save(); ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash(l.dash || [5, 4]);
        ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS.ink; ctx.font = '600 11px ' + Chart.defaults.font.family;
        var tw = ctx.measureText(l.label).width, ty = area.top + 12 + idx * 14;
        var tx = px + 4 + tw > area.right ? px - 4 - tw : px + 4;
        ctx.fillStyle = 'rgba(251,247,240,0.9)'; ctx.fillRect(tx - 2, ty - 10, tw + 4, 13);
        ctx.fillStyle = COLORS.ink; ctx.fillText(l.label, tx, ty);
        ctx.restore();
      });
    }
  };
  var bgFill = { id: 'bgFill', beforeDraw: function (chart) { var c = chart.ctx; c.save(); c.fillStyle = COLORS.surface; c.fillRect(0, 0, chart.width, chart.height); c.restore(); } };
  Chart.register(vLines, bgFill);

  function tipInr(ctx) { return ctx.dataset.label + ': ' + inr(ctx.parsed.y !== undefined && ctx.chart.options.indexAxis !== 'y' ? ctx.parsed.y : ctx.parsed.x); }

  function makeOrUpdate(key, canvasId, config) {
    if (S.charts[key]) { S.charts[key].data = config.data; S.charts[key].options = config.options; S.charts[key].update('none'); return; }
    S.charts[key] = new Chart($(canvasId), config);
  }

  var volumes = E.logVolumes(10, 1000000, 140);
  function renderVolume() {
    var r = S.result, sw = E.sweep(S.built.inputs, volumes), all = S.volMode === 'all';
    function series(label, key, color, dash) {
      return { label: label, data: sw.map(function (p) { return { x: p.n, y: p[key] }; }), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, borderDash: dash || [], spanGaps: false, tension: 0 };
    }
    var ds = [
      series('Per-token API', all ? 'api' : 'apiCompute', COLORS.s1),
      series('Rented GPU', all ? 'rented' : 'rentedCompute', COLORS.s2),
      series('Owned rig', all ? 'owned' : 'ownedCompute', COLORS.s3)
    ];
    if (all) ds.push(series('Manual entry', 'manual', COLORS.s4, [6, 4]));
    var lines = [{ value: r.patientsPerMonth, label: 'You: ' + count(r.patientsPerMonth), color: COLORS.ink, dash: [2, 3] }];
    var bestCloud = [r.routes.api, r.routes.rented].filter(function (x) { return x.available; }).sort(function (a, b) { return a.monthly.total - b.monthly.total; })[0];
    if (bestCloud) { var be = bestCloud.id === 'api' ? r.breakEven.ownedVsApi : r.breakEven.ownedVsRented; if (be.value && !be.beyondCapacity) lines.push({ value: be.value, label: 'Buy = rent', color: COLORS.s3 }); }
    if (all && r.chosen && r.chosen.available && r.chosen.manualBreakEven.value) lines.push({ value: r.chosen.manualBreakEven.value, label: 'AI = manual', color: COLORS.s4 });
    makeOrUpdate('volume', 'ch-volume', {
      type: 'line', data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'logarithmic', min: 10, max: 1000000, title: { display: true, text: 'Patients per month' }, grid: { color: '#EEE5D8' }, ticks: { callback: function (v) { return [10, 100, 1000, 10000, 100000, 1000000].indexOf(v) >= 0 ? (v >= 100000 ? (v / 100000) + ' lakh' : v.toLocaleString('en-IN')) : ''; } } },
          y: { type: 'logarithmic', title: { display: true, text: 'Rupees per patient' }, grid: { color: '#EEE5D8' }, ticks: { callback: function (v) { var s = String(v); return /^[125]/.test(s) || v === 1 ? '₹' + v.toLocaleString('en-IN') : ''; } } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, boxHeight: 2 } },
          tooltip: { callbacks: { title: function (it) { return count(it[0].parsed.x) + ' patients a month'; }, label: function (c) { return c.dataset.label + ': ' + inr(c.parsed.y); } } },
          vLines: { lines: lines }
        }
      }
    });
    S.tables = S.tables || {};
    S.tables.volume = { head: ['Patients per month', 'API', 'Rented GPU', 'Owned rig', 'Manual'], rows: [10, 100, 1000, 10000, 100000, 1000000].map(function (n) {
      var p = E.sweep(S.built.inputs, [n])[0];
      return [count(n), inr(all ? p.api : p.apiCompute), inr(all ? p.rented : p.rentedCompute), inr(all ? p.owned : p.ownedCompute), inr(p.manual)];
    }) };
  }

  function renderMoney() {
    var r = S.result, ids = ['api', 'rented', 'owned'].filter(function (id) { return r.routes[id].available; });
    var labels = ids.map(function (id) { return r.routes[id].label; });
    function seg(label, f, color) { return { label: label, data: ids.map(function (id) { return f(r.routes[id].monthly); }), backgroundColor: color, borderColor: COLORS.surface, borderWidth: { right: 2 }, borderSkipped: false, borderRadius: 0, barThickness: 26 }; }
    var ds = [
      seg('Compute', function (m) { return m.compute; }, COLORS.s1),
      seg('Review staff', function (m) { return m.review; }, COLORS.s2),
      seg('Engineering', function (m) { return m.engineering; }, COLORS.s3),
      seg('Validation', function (m) { return m.validation; }, COLORS.s4)
    ];
    makeOrUpdate('money', 'ch-money', {
      type: 'bar', data: { labels: labels, datasets: ds },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { stacked: true, title: { display: true, text: 'Rupees per month' }, ticks: { callback: function (v) { return inrWords(v); } }, grid: { color: '#EEE5D8' } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + inr(c.parsed.x, { dp: 0 }); }, footer: function (it) { var m = r.routes[ids[it[0].dataIndex]].monthly; return 'Total: ' + inr(m.total, { dp: 0 }); } } } }
      }
    });
    S.tables.money = { head: ['Route', 'Compute', 'Review staff', 'Engineering', 'Validation', 'Total'], rows: ids.map(function (id) { var m = r.routes[id].monthly; return [r.routes[id].label, inr(m.compute, { dp: 0 }), inr(m.review, { dp: 0 }), inr(m.engineering, { dp: 0 }), inr(m.validation, { dp: 0 }), inr(m.total, { dp: 0 })]; }) };
  }

  function renderPayers() {
    var r = S.result, names = { patient: 'Patient', hospital: 'Hospital', insurer: 'Insurer or scheme', consortium: 'Pooled consortium' };
    var keys = Object.keys(names);
    makeOrUpdate('payers', 'ch-payers', {
      type: 'bar', data: { labels: keys.map(function (k) { return names[k]; }), datasets: [{ label: 'Monthly share', data: keys.map(function (k) { return r.whoPays[k] || 0; }), backgroundColor: COLORS.s2, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'start', barThickness: 22 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Rupees per month' }, ticks: { callback: function (v) { return inrWords(v); } }, grid: { color: '#EEE5D8' } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var k = keys[c.dataIndex]; return inr(c.parsed.x, { dp: 0 }) + ' a month (' + (S.built.inputs.payerShares[k] || 0) + '%)' + (r.patientsPerMonth > 0 ? ', ' + inr(c.parsed.x / r.patientsPerMonth) + ' per patient' : ''); } } } } }
    });
    var pool = r.pooled ? [['Pooled: ' + r.pooled.centres + ' centres of ' + count(r.pooled.perCentreVolume) + ' patients', inr(r.pooled.perPatient) + ' per patient, against ' + inr(r.pooled.singleCentrePerPatient) + ' alone']] : [];
    S.tables.payers = { head: ['Payer', 'Share', 'Rupees per month'], rows: keys.map(function (k) { return [names[k], (S.built.inputs.payerShares[k] || 0) + '%', inr(r.whoPays[k] || 0, { dp: 0 })]; }).concat(pool.map(function (p) { return [p[0], '', p[1]]; })) };
  }

  function renderStress() {
    var r = S.result, k = S.values.repricingFactor;
    var ids = ['api', 'rented', 'owned'];
    var labels = ['Per-token API', 'Rented GPU', 'Owned rig'];
    function comp(set, id) { var x = set[id]; return x && x.available && r.patientsPerMonth > 0 ? x.computePerPatient : null; }
    makeOrUpdate('stress', 'ch-stress', {
      type: 'bar', data: { labels: labels, datasets: [
        { label: 'Quoted', data: ids.map(function (id) { return comp(r.routes, id); }), backgroundColor: COLORS.s2, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', borderColor: COLORS.surface, borderWidth: 2 },
        { label: 'Stress-tested at ' + k.toFixed(1) + '×', data: ids.map(function (id) { return comp(r.routesStressed, id); }), backgroundColor: COLORS.s1, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', borderColor: COLORS.surface, borderWidth: 2 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Compute rupees per patient' }, ticks: { callback: function (v) { return inr(v); } }, grid: { color: '#EEE5D8' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + inr(c.parsed.y); } } } } }
    });
    function beText(q, s) { return (q.value && !q.beyondCapacity ? count(q.value) : 'none within one rig') + ' → ' + (s.value && !s.beyondCapacity ? count(s.value) : 'none within one rig'); }
    $('stress-sub').textContent = 'Compute cost per patient if cloud prices rise ' + k.toFixed(1) + '×. The owned rig is unchanged. Buy-versus-rent break-even moves from ' + beText(r.breakEven.ownedVsRented, r.breakEven.ownedVsRentedStressed) + ' patients a month against the rented GPU, and ' + beText(r.breakEven.ownedVsApi, r.breakEven.ownedVsApiStressed) + ' against the API. A scenario, not a forecast.';
    S.tables.stress = { head: ['Route', 'Quoted', 'Stress-tested'], rows: ids.map(function (id, j) { return [labels[j], inr(comp(r.routes, id)), inr(comp(r.routesStressed, id))]; }) };
  }

  /* ---------- table toggle and export buttons ---------- */
  var CARDS = [['volume', 'card-volume'], ['money', 'card-money'], ['payers', 'card-payers'], ['stress', 'card-stress']];
  function wireCards() {
    CARDS.forEach(function (c) {
      var card = $(c[1]), actions = card.querySelector('.actions');
      var tb = document.createElement('button'); tb.className = 'btn'; tb.textContent = 'Table';
      tb.addEventListener('click', function () { var w = card.querySelector('.tbl-wrap'); if (w) { w.remove(); tb.textContent = 'Table'; } else { showTable(c[0], card); tb.textContent = 'Hide table'; } });
      actions.appendChild(tb);
      ['PNG', 'JPEG', 'PowerPoint'].forEach(function (fmt) {
        var b = document.createElement('button'); b.className = 'btn'; b.textContent = fmt;
        b.addEventListener('click', function () { exportChart(c[0], card, fmt); });
        actions.appendChild(b);
      });
    });
  }
  function tableHtml(t) { return '<table class="data"><thead><tr>' + t.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + t.rows.map(function (r) { return '<tr>' + r.map(function (x, j) { return '<td' + (j ? ' class="n"' : '') + '>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>'; }
  function showTable(key, card) { var w = document.createElement('div'); w.className = 'tbl-wrap'; w.innerHTML = tableHtml(S.tables[key]); card.appendChild(w); }
  function refreshTables() { CARDS.forEach(function (c) { var w = $(c[1]).querySelector('.tbl-wrap'); if (w) w.innerHTML = tableHtml(S.tables[c[0]]); }); }

  function caveatLines() {
    var r = S.result, v = S.values, b = S.built;
    var ph = E.placeholdersInUse(S.data, v).map(function (a) { return a.label; });
    var lines = [
      'Estimate built from the user\'s own inputs and sourced defaults. Not a quote. Volume: ' + count(r.patientsPerMonth) + ' patients a month; headline route: ' + (r.chosen ? r.chosen.label : 'none') + '.',
      'Not included: ' + (r.notIncluded.length ? r.notIncluded.join('; ') : 'nothing listed') + '.',
      'Key assumptions: electricity ₹' + b.inputs.gridTariff + '/kWh (' + b.meta.tariffSource + '); GPU tier ' + b.meta.tier.label + '; hardware life ' + v.lifeYears + ' years; review fraction ' + pct(r.review.fraction) + '; repricing scenario ' + v.repricingFactor + '×; GST on cloud ' + v.cloudGstPct + '%.',
      ph.length ? 'Placeholders or illustrative values still in use (' + ph.length + '): ' + ph.slice(0, 10).join(', ') + (ph.length > 10 ? ', and ' + (ph.length - 10) + ' more' : '') + '.' : 'No placeholder defaults in use.',
      'Vyaya engine ' + E.ENGINE_VERSION + ', data ' + S.data.assumptions.meta.dataVersion + ', generated ' + new Date().toISOString().slice(0, 10) + '. Formulas and sources: see the detail view.'
    ];
    return lines;
  }

  function wrapText(ctx, text, maxW) {
    var words = text.split(' '), out = [], line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; });
    if (line) out.push(line); return out;
  }

  function composeImage(key, card) {
    var chart = S.charts[key], W = 1600, pad = 48;
    var src = chart.canvas;
    var tmp = document.createElement('canvas'); var tctx = tmp.getContext('2d');
    tctx.font = '20px ' + Chart.defaults.font.family;
    var cav = []; caveatLines().forEach(function (l) { cav = cav.concat(wrapText(tctx, l, W - 2 * pad)); });
    var sub = card.querySelector('.sub').textContent;
    tctx.font = '22px ' + Chart.defaults.font.family;
    var subLines = wrapText(tctx, sub, W - 2 * pad);
    var chartH = Math.round((W - 2 * pad) * src.height / src.width);
    var H = pad + 44 + subLines.length * 30 + 16 + chartH + 24 + cav.length * 27 + pad;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = COLORS.surface; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.s1; ctx.fillRect(0, 0, W, 8);
    var y = pad + 30;
    ctx.fillStyle = COLORS.ink; ctx.font = '600 34px ' + Chart.defaults.font.family; ctx.fillText(card.querySelector('h2').textContent, pad, y);
    y += 14; ctx.font = '22px ' + Chart.defaults.font.family; ctx.fillStyle = COLORS.ink2;
    subLines.forEach(function (l) { y += 30; ctx.fillText(l, pad, y); });
    y += 16;
    ctx.drawImage(src, pad, y, W - 2 * pad, chartH);
    y += chartH + 24;
    ctx.strokeStyle = COLORS.rule; ctx.beginPath(); ctx.moveTo(pad, y - 10); ctx.lineTo(W - pad, y - 10); ctx.stroke();
    ctx.font = '20px ' + Chart.defaults.font.family; ctx.fillStyle = COLORS.ink2;
    cav.forEach(function (l) { y += 27; ctx.fillText(l, pad, y); });
    return cv;
  }

  function download(url, name) { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  function exportChart(key, card, fmt) {
    var cv = composeImage(key, card), base = 'vyaya-' + key + '-' + new Date().toISOString().slice(0, 10);
    if (fmt === 'PNG') return download(cv.toDataURL('image/png'), base + '.png');
    if (fmt === 'JPEG') return download(cv.toDataURL('image/jpeg', 0.92), base + '.jpg');
    var pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
    var slide = pptx.addSlide(); slide.background = { color: 'FBF7F0' };
    var ratio = cv.height / cv.width, maxW = 13.33 - 0.6, maxH = 7.5 - 0.4;
    var w = Math.min(maxW, maxH / ratio), h = w * ratio;
    slide.addImage({ data: cv.toDataURL('image/png'), x: (13.33 - w) / 2, y: (7.5 - h) / 2, w: w, h: h });
    slide.addNotes(caveatLines().join('\n'));
    pptx.writeFile({ fileName: base + '.pptx' });
  }

  /* ---------- detail view ---------- */
  function sourceLink(id) {
    var s = S.data.sources.sources.filter(function (x) { return x.id === id; })[0];
    if (!s) return esc(id);
    return s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher) + '</a>' : esc(s.publisher);
  }
  function badge(st) { return '<span class="badge ' + esc(st) + '">' + esc(st) + '</span>'; }

  function renderInputs() {
    var html = S.data.assumptions.groups.map(function (g) {
      var items = S.data.assumptions.assumptions.filter(function (a) { return a.group === g.id; });
      return '<div class="inputs-group"><h3>' + esc(g.label) + '</h3><div class="inputs-grid">' + items.map(function (a) {
        var v = S.values[a.id], ctl;
        if (a.type === 'bool') ctl = '<input type="checkbox" data-id="' + a.id + '"' + (v ? ' checked' : '') + '>';
        else if (a.type === 'select') ctl = '<select data-id="' + a.id + '">' + optionsFor(a).map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === v ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
        else ctl = '<input type="number" data-id="' + a.id + '" value="' + (v === null ? '' : v) + '"' + (a.min !== undefined ? ' min="' + a.min + '"' : '') + (a.max !== undefined ? ' max="' + a.max + '"' : '') + (a.step ? ' step="' + a.step + '"' : '') + (a.nullable ? ' placeholder="blank"' : '') + '>';
        return '<div class="inp' + (v !== a.value ? ' changed' : '') + '"><div class="lab"><span>' + esc(a.label) + '</span>' + badge(a.status) + '</div><div class="ctlrow">' + ctl + '<span class="unit">' + esc(a.unit) + '</span></div>' + (a.reason ? '<div class="why">' + esc(a.reason) + (a.sources.length ? ' Source: ' + a.sources.map(sourceLink).join(', ') + '.' : '') + '</div>' : '') + '</div>';
      }).join('') + '</div></div>';
    }).join('');
    $('tab-inputs').innerHTML = '<p class="small">Inputs you have changed are outlined. Badges show where each default comes from: statutory, secondary (check the primary source), placeholder or illustrative (replace with your own figure), or user (your choice).</p>' + html;
  }

  function wireInputs() {
    $('tab-inputs').addEventListener('input', onInp); $('tab-inputs').addEventListener('change', onInp);
    function onInp(e) {
      var el = e.target, id = el.dataset.id; if (!id) return;
      var a = assumption(id), v;
      if (a.type === 'bool') v = el.checked;
      else if (a.type === 'select') v = el.value;
      else v = el.value === '' ? (a.nullable ? null : a.value) : +el.value;
      S.values[id] = v; el.closest('.inp').classList.toggle('changed', v !== a.value);
      syncMain(); schedule();
    }
  }

  function fmtTrace(v) { if (typeof v === 'number') return Math.abs(v) >= 100 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : v.toLocaleString('en-IN', { maximumFractionDigits: 4 }); return String(v); }
  function renderFormulas() {
    var t = S.result.trace;
    $('tab-formulas').innerHTML = '<p class="small">Each formula as the engine applies it, with today\'s values from your inputs. Where the formula differs from the handover brief, the change is stated.</p>' + S.data.formulas.formulas.map(function (f) {
      var live = f.trace.filter(function (k) { return t[k] !== undefined && t[k] !== null; }).map(function (k) { return k + ' = ' + fmtTrace(t[k]); }).join('   ');
      return '<div class="formula"><h4>' + esc(f.id) + ' · ' + esc(f.name) + ' <span class="small">(brief §' + esc(f.section) + ', v' + esc(f.version) + ', ' + esc(f.units) + ')</span></h4><code>' + esc(f.expression) + '</code><div class="small">' + esc(f.derivation) + (f.sources.length ? ' Sources: ' + f.sources.map(sourceLink).join(', ') + '.' : '') + '</div>' + (f.changeFromBrief ? '<div class="chg">Change from the brief: ' + esc(f.changeFromBrief) + '</div>' : '') + (live ? '<div class="live">' + esc(live) + '</div>' : '') + '</div>';
    }).join('');
  }

  function renderRegister() {
    var rows = S.data.assumptions.assumptions.map(function (a) { return '<tr><td>' + esc(a.label) + '</td><td class="n">' + esc(a.value === null ? 'blank' : a.value) + ' ' + esc(a.unit) + '</td><td>' + badge(a.status) + '</td><td>' + (a.sources.map(sourceLink).join(', ') || '—') + '</td><td>' + esc(a.lastVerified || '—') + '</td><td>' + esc(a.reason) + '</td></tr>'; }).join('');
    var trows = S.data.tariffs.rows.map(function (r) { return '<tr><td>' + esc(r.state) + '</td><td class="n">' + (r.landedInrPerKwh === null ? '—' : '₹' + r.landedInrPerKwh) + '</td><td>' + badge(r.status) + '</td><td>' + (r.sources.map(sourceLink).join(', ') || '—') + '</td><td>' + esc(r.lastVerified || '—') + '</td><td>' + esc(r.note) + '</td></tr>'; }).join('');
    var crows = S.data.compute.rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="n">' + (r.pricePerGpuHour === null ? '—' : (r.currency === 'USD' ? '$' : '₹') + r.pricePerGpuHour) + '</td><td>' + badge(r.status) + '</td><td>' + (r.sources.map(sourceLink).join(', ') || '—') + '</td><td>' + esc(r.lastVerified || '—') + '</td><td>' + esc(r.note) + '</td></tr>'; }).join('');
    var head = '<thead><tr><th>Item</th><th>Default</th><th>Status</th><th>Source</th><th>Last verified</th><th>Reason and caveats</th></tr></thead>';
    $('tab-register').innerHTML = '<h3>Inputs</h3><div class="tbl-wrap"><table class="data">' + head + '<tbody>' + rows + '</tbody></table></div><h3>Rented GPU tiers (per GPU-hour, before GST)</h3><div class="tbl-wrap"><table class="data">' + head + '<tbody>' + crows + '</tbody></table></div><h3>State electricity, landed tariff</h3><div class="tbl-wrap"><table class="data">' + head + '<tbody>' + trows + '</tbody></table></div><p class="small">Always outside the total: ' + esc(S.data.assumptions.alwaysExcluded.join('; ')) + '.</p>';
  }

  function renderSources() {
    $('tab-sources').innerHTML = '<p class="small">"How read" says how each source was actually checked during the build. A search snippet is not a verified reading; those figures carry a secondary status until someone opens the primary document.</p><div class="tbl-wrap"><table class="data"><thead><tr><th>Source</th><th>Type</th><th>How read</th><th>Accessed</th><th>Notes</th></tr></thead><tbody>' + S.data.sources.sources.map(function (s) {
      return '<tr><td>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : esc(s.title)) + '<br><span class="small">' + esc(s.publisher) + '</span></td><td>' + esc(s.type) + '</td><td>' + esc(s.howRead) + '</td><td>' + esc(s.accessed) + '</td><td>' + esc(s.notes) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function renderOpen() {
    $('tab-open').innerHTML = '<div class="tbl-wrap"><table class="data"><thead><tr><th>Item</th><th>Status</th><th>Detail</th><th>Decision</th></tr></thead><tbody>' + S.data.openItems.items.map(function (o) {
      return '<tr><td><b>' + esc(o.id) + '</b> ' + esc(o.topic) + '</td><td>' + esc(o.status) + '</td><td>' + esc(o.detail) + '</td><td>' + esc(o.decision) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function renderHistory() {
    var rows = [];
    S.data.assumptions.assumptions.forEach(function (a) { a.history.forEach(function (h) { rows.push('<tr><td>' + esc(h.date) + '</td><td>' + esc(a.label) + '</td><td class="n">' + esc(h.previous) + ' → ' + esc(a.value) + '</td><td>' + esc(h.reason) + '</td></tr>'); }); });
    $('tab-history').innerHTML = '<p class="small">Changes to defaults, with the previous value and the reason, so any past estimate can be reproduced. The repository\'s commit history and CHANGELOG.md hold the full record. This page: engine ' + E.ENGINE_VERSION + ', data ' + esc(S.data.assumptions.meta.dataVersion) + '.</p><div class="tbl-wrap"><table class="data"><thead><tr><th>Date</th><th>Item</th><th>Change</th><th>Reason</th></tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="4">No changes yet.</td></tr>') + '</tbody></table></div>';
  }

  function renderDetail() { renderFormulas(); renderRegister(); renderSources(); renderOpen(); renderHistory(); }

  /* ---------- update loop ---------- */
  function update() {
    S.built = E.buildInputs(S.data, S.values);
    S.result = E.calculate(S.built.inputs);
    renderHeadline();
    renderVolume(); renderMoney(); renderPayers(); renderStress();
    refreshTables();
    if (!$('detail').classList.contains('hidden')) renderFormulas();
    writeHash();
  }

  loadData().then(function (d) {
    S.data = d;
    S.defaults = E.defaultValues(d);
    S.values = Object.assign({}, S.defaults, readHash());
    $('footer').innerHTML = 'Vyaya engine ' + E.ENGINE_VERSION + ' · data ' + esc(d.assumptions.meta.dataVersion) + ' · MIT licence · Open source: corrections to any figure are welcome by pull request with a source link.';
    syncMain(); wireMain(); wireCards(); renderInputs(); wireInputs();
    update();
  }).catch(function (err) {
    $('h-sentence').textContent = 'The data files could not be loaded (' + err.message + '). If you opened this file directly from disk, use the standalone build in dist/ or serve the folder, for example with "npm run serve".';
  });
})();
