/*
 * Vyaya formula engine.
 *
 * Pure functions only: no DOM, no network. The same file runs in the browser
 * (as window.VyayaEngine) and in Node (require('./js/engine.js')) for tests.
 *
 * Every intermediate value is written to a trace keyed by the formula ids in
 * data/formulas.json, so the detail view can show the working for any result.
 *
 * Units: rupees (INR), months, hours, minutes, tokens. Fractions are 0..1.
 * Anything that cannot be computed is returned as null with a reason, never
 * as Infinity or NaN.
 */
(function (root) {
  'use strict';

  var ENGINE_VERSION = '0.2.0';
  var HOURS_PER_MONTH_DEFAULT = 8760 / 12; // 730

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function isBlank(x) { return x === null || x === undefined || x === '' || (typeof x === 'number' && !isFinite(x)); }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function safeDiv(a, b) { return (num(a) && num(b) && b !== 0) ? a / b : null; }

  /* ---------- 6.1 Workload ---------- */
  function workload(i, t) {
    var tin = !isBlank(i.measuredTin) ? i.measuredTin : i.pagesPerPatient * i.inTokPerPage;
    var tout = !isBlank(i.measuredTout) ? i.measuredTout : i.pagesPerPatient * i.outTokPerPage;
    t.W1_tin = tin; t.W2_tout = tout;
    t.W_measured = !isBlank(i.measuredTin) || !isBlank(i.measuredTout);
    return { tin: tin, tout: tout };
  }

  /* Optional helper: throughput from measured token speeds (aggregate per GPU, with batching). */
  function patientsPerGpuHourFromTps(tin, tout, prefillTps, decodeTps) {
    if (!(prefillTps > 0) || !(decodeTps > 0)) return null;
    var secondsPerPatient = tin / prefillTps + tout / decodeTps;
    return secondsPerPatient > 0 ? 3600 / secondsPerPatient : null;
  }

  /* ---------- Electricity: landed tariff ---------- */
  function landedTariff(i, t) {
    var v;
    if (i.captiveOverride) {
      var loss = clamp(i.captiveLossPct / 100, 0, 0.95);
      v = (i.captivePpa + i.captiveWheeling + i.captiveCss + i.captiveOther) / (1 - loss);
      t.E1_source = 'captive';
    } else {
      v = i.gridTariff;
      t.E1_source = 'grid table';
    }
    t.E1_landedTariff = v;
    return v;
  }

  /* ---------- 6.2 Compute routes ---------- */
  function cloudTax(i) { return 1 + (i.cloudGstPct || 0) / 100; }

  function routeApi(i, w, k, t, suffix) {
    var blocked = i.residency === 'india' && !i.apiHostedInIndia || i.residency === 'onprem';
    var perPatientUsd = (w.tin / 1e6) * i.apiPriceInPerM + (w.tout / 1e6) * i.apiPriceOutPerM;
    var perPatient = perPatientUsd * i.usdInr * cloudTax(i) * k;
    t['C1_apiPerPatient' + suffix] = perPatient;
    return {
      id: 'api', label: 'Per-token API',
      available: !blocked,
      blockedReason: blocked ? (i.residency === 'onprem' ? 'Data may not leave the hospital.' : 'Data must stay in India and this API is not marked as India-hosted.') : null,
      variablePerPatient: perPatient, fixedMonthly: 0, capacityPerUnit: null
    };
  }

  function routeRented(i, w, k, t, suffix) {
    var blocked = i.residency === 'onprem' || (i.residency === 'india' && !i.rentHostedInIndia);
    var ppgh = !isBlank(i.rentPrefillTps) && !isBlank(i.rentDecodeTps)
      ? patientsPerGpuHourFromTps(w.tin, w.tout, i.rentPrefillTps, i.rentDecodeTps)
      : i.rentPatientsPerGpuHour;
    var eff = clamp(i.rentEfficiency, 0.01, 1);
    var perPatient = num(i.rentRateInr) ? safeDiv(i.rentRateInr * cloudTax(i) * k, ppgh * eff) : null;
    t['C2_rentPatientsPerGpuHour'] = ppgh;
    t['C2_rentPerPatient' + suffix] = perPatient;
    return {
      id: 'rented', label: 'Rented GPU',
      available: !blocked && perPatient !== null,
      blockedReason: blocked ? (i.residency === 'onprem' ? 'Data may not leave the hospital.' : 'Data must stay in India and this GPU tier is not marked as India-hosted.') : (perPatient === null ? (num(i.rentRateInr) ? 'Throughput is missing or zero.' : 'No GPU-hour price is set for this tier.') : null),
      variablePerPatient: perPatient, fixedMonthly: 0, capacityPerUnit: null
    };
  }

  /* Capital recovery per month. With zero cost of capital this is straight-line depreciation. */
  function capitalPerMonth(price, lifeYears, residualPct, annualRatePct) {
    var n = Math.max(1, Math.round(lifeYears * 12));
    var res = price * clamp(residualPct / 100, 0, 1);
    var r = (annualRatePct || 0) / 100 / 12;
    if (r === 0) return (price - res) / n;
    var crf = r / (1 - Math.pow(1 + r, -n));
    return (price - res * Math.pow(1 + r, -n)) * crf;
  }

  function routeOwned(i, w, N, t) {
    var tariff = landedTariff(i, t);
    var hours = i.hoursPerMonth || HOURS_PER_MONTH_DEFAULT;
    var ppgh = !isBlank(i.ownPrefillTps) && !isBlank(i.ownDecodeTps)
      ? patientsPerGpuHourFromTps(w.tin, w.tout, i.ownPrefillTps, i.ownDecodeTps)
      : i.ownPatientsPerGpuHour;
    var gpus = Math.max(1, i.rigGpuCount);
    var capacity = ppgh > 0 ? ppgh * gpus * hours * clamp(i.dutyCycle, 0, 1) : 0;

    var capital = capitalPerMonth(i.rigPriceInr, i.lifeYears, i.residualPct, i.costOfCapitalPct);
    var failure = i.rigPriceInr * i.annualFailureRate * clamp(i.gpuShareOfPrice, 0, 1) * clamp(i.failureUncoveredShare, 0, 1) / 12;
    var pue = Math.max(1, i.pue);
    var idleEnergy = i.rigPowerKw * clamp(i.idlePowerFrac, 0, 1) * hours * pue * tariff;
    var maintenance = i.maintenanceInrPerMonth || 0;
    var perRigFixed = capital + failure + idleEnergy + maintenance;
    var land = isBlank(i.landInrPerMonth) ? 0 : i.landInrPerMonth; // site-level, not per rig

    // Active energy above idle, per patient: kW above idle x PUE x tariff x rig-hours per patient.
    var variable = ppgh > 0 ? i.rigPowerKw * (1 - clamp(i.idlePowerFrac, 0, 1)) * pue * tariff / (ppgh * gpus) : null;

    var rigs = capacity > 0 ? Math.max(1, Math.ceil(N / capacity)) : 1;
    var utilisation = capacity > 0 ? N / (capacity * rigs) : null;

    t.C3_capitalPerMonth = capital;
    t.C3_depreciationStraightLine = (i.rigPriceInr * (1 - clamp(i.residualPct / 100, 0, 1))) / Math.max(1, Math.round(i.lifeYears * 12));
    t.C3_taxDepreciationYear1 = i.rigPriceInr * (i.taxWdvPct / 100);
    t.C4_failurePerMonth = failure;
    t.C5_idleEnergyPerMonth = idleEnergy;
    t.C5_activeEnergyPerPatient = variable;
    t.C5_powerPerMonthAtVolume = idleEnergy * rigs + (variable || 0) * N;
    t.C6_maintenancePerMonth = maintenance;
    t.C7_landPerMonth = land;
    t.C8_perRigFixed = perRigFixed;
    t.C8_ownPatientsPerGpuHour = ppgh;
    t.C8_capacityPerRig = capacity;
    t.C8_rigsNeeded = rigs;
    t.C8_utilisation = utilisation;

    return {
      id: 'owned', label: 'Owned rig',
      available: capacity > 0,
      blockedReason: capacity > 0 ? null : 'Throughput or duty cycle is zero, so the rig has no capacity.',
      variablePerPatient: variable,
      fixedMonthly: perRigFixed * rigs + land,
      perRigFixed: perRigFixed, land: land,
      capacityPerUnit: capacity, rigs: rigs, utilisation: utilisation,
      exceedsOneRig: N > capacity && capacity > 0
    };
  }

  /* Buy-versus-rent break-even for one rig: F / (c - v). */
  function buyRentBreakEven(owned, cloud) {
    if (!owned.available || !cloud.available) return { value: null, reason: 'One of the two routes is unavailable.' };
    var F = owned.perRigFixed + owned.land;
    var c = cloud.variablePerPatient, v = owned.variablePerPatient;
    if (!num(c) || !num(v)) return { value: null, reason: 'A per-patient cost is missing.' };
    if (c <= v) return { value: null, reason: 'Cloud cost per patient is at or below the rig\'s own running cost per patient, so owning never breaks even.' };
    var n = F / (c - v);
    if (n > owned.capacityPerUnit) {
      return { value: n, beyondCapacity: true, reason: 'Break-even lies beyond one rig\'s capacity, so at full use the rig still costs more than renting.' };
    }
    return { value: n, beyondCapacity: false, reason: null };
  }

  /* ---------- 6.3 People and accuracy link ---------- */
  function reviewModel(i, t) {
    var e = clamp(i.modelErrorRate, 0, 1);
    var s = clamp(i.reviewSensitivity, 0, 1);
    var k = Math.max(1, i.reviewTargeting || 1);
    var f, feasible = true, note = null;
    if (i.reviewMode === 'accuracy') {
      var target = 1 - clamp(i.requiredAccuracy, 0, 1);
      if (e <= target) { f = 0; note = 'The model already meets the required accuracy, so no review is needed for accuracy.'; }
      else if (s === 0) { f = 1; feasible = false; note = 'Review catches nothing (sensitivity is zero), so the required accuracy cannot be reached.'; }
      else {
        var needed = (1 - target / e) / (s * k);
        if (needed * k > 1 + 1e-12) { feasible = false; note = 'Even reviewing every output cannot reach the required accuracy with this error rate and review sensitivity.'; f = Math.min(1, 1 / k); }
        else f = clamp(needed, 0, 1);
      }
    } else {
      f = clamp(i.reviewFraction, 0, 1);
    }
    var caught = Math.min(1, k * f) * s;
    var residual = e * (1 - caught);
    t.P3_reviewFraction = f; t.P3_residualErrorRate = residual; t.P3_accuracyAchieved = 1 - residual;
    return { fraction: f, residual: residual, feasible: feasible, note: note };
  }

  /* ---------- Full calculation at one volume ---------- */
  function calculate(inputs, opts) {
    opts = opts || {};
    var i = inputs;
    var N = Math.max(0, i.patientsPerMonth || 0);
    var t = {};
    var flags = [];
    var w = workload(i, t);
    var k = num(i.repricingFactor) && i.repricingFactor > 0 ? i.repricingFactor : 1;

    var quoted = {
      api: routeApi(i, w, 1, t, ''),
      rented: routeRented(i, w, 1, t, ''),
      owned: routeOwned(i, w, N, t)
    };
    var stressed = {
      api: routeApi(i, w, k, t, '_stressed'),
      rented: routeRented(i, w, k, t, '_stressed'),
      owned: quoted.owned
    };

    // People
    var rv = reviewModel(i, t);
    var reviewPerPatient = rv.fraction * i.reviewMinutes * i.reviewStaffInrPerMin;
    var buildMonthly = capitalPerMonth(i.buildCostInr, i.buildAmortMonths / 12, 0, i.costOfCapitalPct);
    var peopleFixed = buildMonthly + (i.supportInrPerMonth || 0);
    t.P1_buildAmortised = buildMonthly;
    t.P2_support = i.supportInrPerMonth || 0;
    t.P3_reviewPerPatient = reviewPerPatient;
    t.P4_peopleFixed = peopleFixed;

    // Validation
    var perCaseUnit = i.clinMinPerCase * i.clinInrPerMin + i.annoMinPerCase * i.annoInrPerMin;
    var initialStudy = i.valSampleSize * perCaseUnit + (i.valAnalysisInr || 0);
    var governance = i.governanceInr || 0;
    var oneTimeAmort = safeDiv(initialStudy + governance, i.valAmortMonths) || 0;
    var costPerRef = isBlank(i.costPerRefAnswerInr) ? perCaseUnit : i.costPerRefAnswerInr;
    var reval = (i.changesPerYear * i.revalSampleSize * costPerRef) / 12;
    var auditPerPatient = i.auditFraction * i.auditMinutes * i.auditInrPerMin;
    var errorIncluded = !isBlank(i.costPerUncaughtErrorInr);
    var errorPerPatient = errorIncluded ? rv.residual * i.costPerUncaughtErrorInr : 0;
    var validationFixed = oneTimeAmort + reval;
    t.V1_initialStudy = initialStudy; t.V1_perCase = perCaseUnit;
    t.V5_governance = governance; t.V1_oneTimeAmortised = oneTimeAmort;
    t.V2_costPerRefAnswer = costPerRef; t.V2_revalidationPerMonth = reval;
    t.V3_auditPerPatient = auditPerPatient; t.V3_monitoringPerMonth = auditPerPatient * N;
    t.V4_errorPerPatient = errorPerPatient; t.V4_errorPerMonth = errorPerPatient * N;
    t.V_validationFixed = validationFixed;

    var nonComputeVariable = reviewPerPatient + auditPerPatient + errorPerPatient;
    var nonComputeFixed = peopleFixed + validationFixed;

    // Manual baseline
    var manualPerPatient = !isBlank(i.manualCostPerPatientInr) ? i.manualCostPerPatientInr : i.manualMinutes * i.manualInrPerMin;
    var manualErrorIncluded = !isBlank(i.manualErrorRate) && errorIncluded;
    if (manualErrorIncluded) manualPerPatient += i.manualErrorRate * i.costPerUncaughtErrorInr;
    t.M1_manualPerPatient = manualPerPatient;

    function totals(route) {
      if (!route.available) return { available: false, reason: route.blockedReason, id: route.id, label: route.label };
      var computeMonthly = route.fixedMonthly + route.variablePerPatient * N;
      var reviewMonthly = reviewPerPatient * N;
      var monitoringMonthly = auditPerPatient * N;
      var errorMonthly = errorPerPatient * N;
      var total = computeMonthly + reviewMonthly + peopleFixed + validationFixed + monitoringMonthly + errorMonthly;
      var aiFixed = (route.id === 'owned' ? route.perRigFixed + route.land : 0) + nonComputeFixed;
      var aiVariable = route.variablePerPatient + nonComputeVariable;
      var manualBE;
      if (aiVariable >= manualPerPatient) manualBE = { value: null, reason: 'AI running cost per patient is at or above the manual cost, so AI never breaks even with manual entry.' };
      else {
        var nb = aiFixed / (manualPerPatient - aiVariable);
        manualBE = { value: nb, reason: null };
        if (route.id === 'owned' && nb > route.capacityPerUnit) { manualBE.beyondCapacity = true; manualBE.reason = 'Break-even lies beyond one rig\'s capacity; more rigs would be needed and the figure is indicative only.'; }
      }
      if (errorIncluded && isBlank(i.manualErrorRate)) { manualBE.notLikeForLike = true; manualBE.reason = (manualBE.reason ? manualBE.reason + ' ' : '') + 'Not like for like: AI is charged for its errors and manual entry is not.'; }
      return {
        id: route.id, label: route.label, available: true,
        monthly: {
          compute: computeMonthly, review: reviewMonthly, engineering: peopleFixed,
          validationOneTime: oneTimeAmort, revalidation: reval, monitoring: monitoringMonthly, errors: errorMonthly,
          people: reviewMonthly + peopleFixed,
          validation: oneTimeAmort + reval + monitoringMonthly + errorMonthly,
          total: total
        },
        perPatient: N > 0 ? total / N : null,
        computePerPatient: N > 0 ? computeMonthly / N : null,
        computeShare: total > 0 ? computeMonthly / total : null,
        aiFixed: aiFixed, aiVariable: aiVariable,
        manualBreakEven: manualBE,
        rigs: route.rigs, utilisation: route.utilisation, exceedsOneRig: route.exceedsOneRig
      };
    }

    var routes = { api: totals(quoted.api), rented: totals(quoted.rented), owned: totals(quoted.owned) };
    var routesStressed = { api: totals(stressed.api), rented: totals(stressed.rented), owned: routes.owned };

    function cheapest(set) {
      var best = null;
      ['api', 'rented', 'owned'].forEach(function (id) {
        var r = set[id];
        if (r.available && (best === null || r.monthly.total < best.monthly.total - 1e-9)) best = r;
      });
      return best;
    }
    var chosenId = i.route && i.route !== 'cheapest' ? i.route : (cheapest(routes) || {}).id;
    var chosen = chosenId ? routes[chosenId] : null;
    if (chosen && !chosen.available) flags.push({ level: 'warn', text: 'The selected route is unavailable: ' + chosen.reason });

    var breakEven = {
      ownedVsApi: buyRentBreakEven(quoted.owned, quoted.api),
      ownedVsRented: buyRentBreakEven(quoted.owned, quoted.rented),
      ownedVsApiStressed: buyRentBreakEven(quoted.owned, stressed.api),
      ownedVsRentedStressed: buyRentBreakEven(quoted.owned, stressed.rented)
    };

    // Who pays
    var shares = i.payerShares || {};
    var shareSum = 0; Object.keys(shares).forEach(function (p) { shareSum += shares[p] || 0; });
    var whoPays = {};
    if (chosen && chosen.available) Object.keys(shares).forEach(function (p) { whoPays[p] = chosen.monthly.total * (shares[p] || 0) / 100; });
    if (Math.abs(shareSum - 100) > 0.01) flags.push({ level: 'warn', text: 'Payer shares add up to ' + shareSum.toFixed(1) + '% rather than 100%.' });

    // Pooled scenario
    var pooled = null;
    var centres = Math.floor(i.pooledCentres || 1);
    if (centres > 1 && i.perCentreVolume > 0 && !opts.noPool) {
      var poolInputs = Object.assign({}, i, { patientsPerMonth: centres * i.perCentreVolume });
      var pr = calculate(poolInputs, { noPool: true });
      var L = clamp(i.localValidationShare, 0, 1);
      var pc = pr.chosen;
      if (pc && pc.available) {
        var sharedFixed = pr.trace.P4_peopleFixed + (1 - L) * pr.trace.V_validationFixed;
        var localFixed = L * pr.trace.V_validationFixed;
        var single = calculate(Object.assign({}, i, { patientsPerMonth: i.perCentreVolume }), { noPool: true }).chosen;
        // Under the on-premises rule each hospital keeps its own rig, so compute is not pooled.
        var computeShare = i.residency === 'onprem' && single && single.available ? single.monthly.compute : pc.monthly.compute / centres;
        var perCentreMonthly = sharedFixed / centres + localFixed + computeShare
          + (pc.monthly.review + pc.monthly.monitoring + pc.monthly.errors) / centres;
        pooled = {
          centres: centres, computePooled: i.residency !== 'onprem', perCentreVolume: i.perCentreVolume,
          perCentreMonthly: perCentreMonthly, perPatient: perCentreMonthly / i.perCentreVolume,
          singleCentrePerPatient: single && single.available ? single.perPatient : null,
          route: pc.id
        };
        t.W7_pooledPerPatient = pooled.perPatient;
      }
    }

    // Not included and placeholder flags
    var notIncluded = [];
    if (isBlank(i.landInrPerMonth)) notIncluded.push('Land and building (left blank)');
    if (!(i.costOfCapitalPct > 0)) notIncluded.push('Cost of money (no interest is charged on the rig or the build cost)');
    if (!errorIncluded) notIncluded.push('Cost of uncaught errors (no scenario value set)');
    if (isBlank(i.manualErrorRate)) notIncluded.push('Errors made by manual entry (no manual error rate set)');
    if (!(i.cloudGstPct > 0)) notIncluded.push('GST on cloud services (set to zero)');
    (i.alwaysExcluded || []).forEach(function (x) { notIncluded.push(x); });

    if (errorIncluded && isBlank(i.manualErrorRate)) flags.push({ level: 'warn', text: 'AI is charged for its uncaught errors but manual entry is not, because no manual error rate is set. Set one for a like-for-like comparison.' });
    if (!rv.feasible) flags.push({ level: 'warn', text: rv.note });
    if (rv.note && rv.feasible) flags.push({ level: 'info', text: rv.note });
    if (quoted.owned.exceedsOneRig) flags.push({ level: 'info', text: 'If you buy instead: this volume needs ' + quoted.owned.rigs + ' rigs, and the owned-rig cost assumes whole rigs are bought.' });
    if (N === 0) flags.push({ level: 'info', text: 'With zero patients the cost per patient is undefined; monthly fixed costs still apply.' });
    if (k === 1) flags.push({ level: 'info', text: 'Repricing factor is 1, so stress-tested cloud costs equal quoted costs.' });
    if (i.correctedInputs && i.correctedInputs.length) flags.push({ level: 'warn', text: 'Some inputs were outside their allowed range and were adjusted: ' + i.correctedInputs.join('; ') + '.' });
    if (!num(i.lifeYears) || i.lifeYears <= 0) flags.push({ level: 'warn', text: 'Effective hardware life must be above zero.' });

    return {
      engineVersion: ENGINE_VERSION,
      patientsPerMonth: N,
      workload: w,
      routes: routes, routesStressed: routesStressed,
      chosen: chosen, chosenStressed: chosenId ? routesStressed[chosenId] : null,
      cheapest: cheapest(routes), cheapestStressed: cheapest(routesStressed),
      breakEven: breakEven,
      manualPerPatient: manualPerPatient,
      review: rv,
      whoPays: whoPays, payerShareSum: shareSum,
      pooled: pooled,
      notIncluded: notIncluded,
      flags: flags,
      trace: t
    };
  }

  /* Cost-versus-volume sweep for charts. */
  function sweep(inputs, volumes) {
    return volumes.map(function (n) {
      var r = calculate(Object.assign({}, inputs, { patientsPerMonth: n }), { noPool: true });
      function pp(set, id, key) { var x = set[id]; return x && x.available && n > 0 ? x[key] : null; }
      return {
        n: n,
        api: pp(r.routes, 'api', 'perPatient'), rented: pp(r.routes, 'rented', 'perPatient'), owned: pp(r.routes, 'owned', 'perPatient'),
        apiCompute: pp(r.routes, 'api', 'computePerPatient'), rentedCompute: pp(r.routes, 'rented', 'computePerPatient'), ownedCompute: pp(r.routes, 'owned', 'computePerPatient'),
        apiStressed: pp(r.routesStressed, 'api', 'perPatient'), rentedStressed: pp(r.routesStressed, 'rented', 'perPatient'),
        manual: r.manualPerPatient
      };
    });
  }

  function logVolumes(min, max, count) {
    var out = [], a = Math.log10(min), b = Math.log10(max);
    for (var j = 0; j < count; j++) out.push(Math.round(Math.pow(10, a + (b - a) * j / (count - 1))));
    return out.filter(function (v, idx, arr) { return idx === 0 || v !== arr[idx - 1]; });
  }

  /*
   * Turn the data files plus the user's values into the flat input object the
   * engine reads. `values` maps assumption id to value; missing ids take the
   * default from data/assumptions.json.
   */
  function defaultValues(data) {
    var v = {};
    data.assumptions.assumptions.forEach(function (a) { v[a.id] = a.value; });
    return v;
  }

  function buildInputs(data, values) {
    var v = Object.assign(defaultValues(data), values || {});
    var meta = { corrected: [] };
    // Clamp every numeric input to its declared range; replace non-numbers with the default.
    data.assumptions.assumptions.forEach(function (a) {
      if (a.type === 'bool' || a.type === 'select') return;
      var x = v[a.id];
      if (x === null || x === undefined || x === '') { if (!a.nullable) { v[a.id] = a.value; } else v[a.id] = null; return; }
      x = typeof x === 'number' ? x : Number(x);
      if (!isFinite(x)) { v[a.id] = a.value; meta.corrected.push(a.label + ' was not a number; reset to the default, ' + a.value); return; }
      var y = x;
      if (num(a.min)) y = Math.max(a.min, y);
      if (num(a.max)) y = Math.min(a.max, y);
      if (y !== x) meta.corrected.push(a.label + ' was ' + x + '; set to the ' + (y > x ? 'minimum' : 'maximum') + ', ' + y);
      v[a.id] = y;
    });
    var inp = Object.assign({}, v);

    var rows = data.tariffs.rows;
    var nat = rows.filter(function (r) { return r.id === 'national-default'; })[0];
    var row = rows.filter(function (r) { return r.id === v.state; })[0] || nat;
    if (!isBlank(v.gridTariffOverride)) { inp.gridTariff = v.gridTariffOverride; meta.tariffSource = 'your own figure'; }
    else if (row && num(row.landedInrPerKwh)) { inp.gridTariff = row.landedInrPerKwh; meta.tariffSource = row.state + ' (' + row.status + ')'; }
    else { inp.gridTariff = nat.landedInrPerKwh; meta.tariffSource = 'national working default (no verified figure for ' + row.state + ')'; meta.tariffFallback = true; }
    meta.tariffRow = row;

    var tiers = data.compute.rows;
    var tier = tiers.filter(function (r) { return r.id === v.rentTier; })[0] || tiers[0];
    var price = num(tier.pricePerGpuHour) ? tier.pricePerGpuHour : v.rentCustomRateInr;
    inp.rentRateInr = num(price) ? (tier.currency === 'USD' ? price * v.usdInr : price) : null;
    inp.rentHostedInIndia = !!tier.hostedInIndia;
    meta.tier = tier;

    inp.payerShares = { patient: v.payerPatient, hospital: v.payerHospital, insurer: v.payerInsurer, consortium: v.payerConsortium };
    inp.alwaysExcluded = data.assumptions.alwaysExcluded || [];
    inp.correctedInputs = meta.corrected;
    return { inputs: inp, meta: meta, values: v };
  }

  /* Defaults still in use that are placeholders or illustrations, so outputs can say so. */
  function placeholdersInUse(data, values) {
    var out = [];
    data.assumptions.assumptions.forEach(function (a) {
      if ((a.status === 'placeholder' || a.status === 'illustrative') && values[a.id] === a.value && a.value !== null) out.push(a);
    });
    return out;
  }

  var api = {
    ENGINE_VERSION: ENGINE_VERSION,
    buildInputs: buildInputs,
    defaultValues: defaultValues,
    placeholdersInUse: placeholdersInUse,
    calculate: calculate,
    sweep: sweep,
    logVolumes: logVolumes,
    capitalPerMonth: capitalPerMonth,
    patientsPerGpuHourFromTps: patientsPerGpuHourFromTps
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VyayaEngine = api;
})(typeof window !== 'undefined' ? window : this);
