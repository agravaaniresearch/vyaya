/* Engine tests: hand-computed values from the defaults, and every edge case in brief section 6.8. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, data, run, close } = require('./helpers');

// Hand calculation at the shipped defaults (documented in docs/FORMULAS.md, section "Worked check").
test('API cost per patient matches hand calculation', () => {
  const r = run({ patientsPerMonth: 1000 });
  // (18000/1e6 x 0.10 + 4800/1e6 x 0.40) USD x 88 x 1.18
  assert.ok(close(r.trace.C1_apiPerPatient, 0.00372 * 88 * 1.18));
});

test('Rented GPU cost per patient matches hand calculation', () => {
  const r = run({ patientsPerMonth: 1000 });
  assert.ok(close(r.trace.C2_rentPerPatient, 65 * 1.18 / 25));
});

test('Owned rig fixed and variable parts match hand calculation', () => {
  const r = run({ patientsPerMonth: 1000 });
  const capital = 1800000 / 72;
  const failure = 1800000 * 0.09 * 0.6 / 12;
  const idle = 1.5 * 0.3 * 730 * 1.6 * 9;
  assert.ok(close(r.trace.C3_capitalPerMonth, capital));
  assert.ok(close(r.trace.C4_failurePerMonth, failure));
  assert.ok(close(r.trace.C5_idleEnergyPerMonth, idle));
  assert.ok(close(r.trace.C8_perRigFixed, capital + failure + idle + 10000));
  assert.ok(close(r.trace.C5_activeEnergyPerPatient, 1.5 * 0.7 * 1.6 * 9 / 40));
  assert.ok(close(r.trace.C8_capacityPerRig, 20 * 2 * 730 * 0.9));
});

test('Total monthly cost at 1,000 patients matches hand calculation (API route)', () => {
  const r = run({ patientsPerMonth: 1000, route: 'api' });
  const compute = 1000 * 0.00372 * 88 * 1.18;
  const review = 1000 * 0.2 * 3 * 5;
  const people = 2500000 / 36 + 60000;
  const oneTime = (500 * (10 * 25 + 15 * 6) + 300000 + 200000) / 36;
  const reval = 2 * 100 * 340 / 12;
  const audit = 1000 * 0.02 * 5 * 20;
  assert.ok(close(r.chosen.monthly.total, compute + review + people + oneTime + reval + audit));
  assert.ok(close(r.chosen.perPatient, r.chosen.monthly.total / 1000));
});

test('Buy-versus-rent break-even equals F / (c - v)', () => {
  const r = run({ patientsPerMonth: 1000 });
  const F = r.trace.C8_perRigFixed;
  const expected = F / (r.trace.C2_rentPerPatient - r.trace.C5_activeEnergyPerPatient);
  assert.ok(close(r.breakEven.ownedVsRented.value, expected));
  // At the break-even volume the two compute costs are equal.
  const n = expected;
  const owned = F + r.trace.C5_activeEnergyPerPatient * n;
  const rented = r.trace.C2_rentPerPatient * n;
  assert.ok(close(owned, rented, 1e-6));
});

test('Capital recovery reduces to straight line at zero interest and rises with interest', () => {
  assert.ok(close(E.capitalPerMonth(1200000, 5, 0, 0), 20000));
  assert.ok(E.capitalPerMonth(1200000, 5, 0, 10) > 20000);
  // Standard annuity check: 12 lakh over 60 months at 12% a year is about 26,693 a month.
  assert.ok(close(E.capitalPerMonth(1200000, 5, 0, 12), 26693.33, 1));
});

test('Throughput from token speeds', () => {
  // 18,000 tokens at 6,000/s = 3 s; 4,800 at 1,200/s = 4 s; 3600/7 patients per hour.
  assert.ok(close(E.patientsPerGpuHourFromTps(18000, 4800, 6000, 1200), 3600 / 7));
  assert.equal(E.patientsPerGpuHourFromTps(18000, 4800, 0, 1200), null);
});

// ---- Edge cases from brief section 6.8 ----

test('6.8 zero patients: per-patient cost is undefined, monthly fixed cost remains, no NaN or Infinity', () => {
  const r = run({ patientsPerMonth: 0 });
  for (const id of ['api', 'rented', 'owned']) {
    assert.equal(r.routes[id].perPatient, null);
    assert.ok(Number.isFinite(r.routes[id].monthly.total));
    assert.ok(r.routes[id].monthly.total > 0);
  }
  assert.ok(r.flags.some(f => /zero patients/.test(f.text)));
  assert.doesNotMatch(JSON.stringify(r), /NaN|Infinity/);
});

test('6.8 volume above rig capacity: extra rigs are bought and flagged', () => {
  const cap = run({}).trace.C8_capacityPerRig;
  const r = run({ patientsPerMonth: Math.ceil(cap * 2.5) });
  assert.equal(r.trace.C8_rigsNeeded, 3);
  assert.equal(r.routes.owned.exceedsOneRig, true);
  assert.ok(r.flags.some(f => /needs 3 rigs/.test(f.text)));
});

test('6.8 blank land: listed as not included and contributes zero', () => {
  const r = run({ landInrPerMonth: null });
  assert.ok(r.notIncluded.some(x => /Land/.test(x)));
  assert.equal(r.trace.C7_landPerMonth, 0);
  const withLand = run({ landInrPerMonth: 5000 });
  assert.ok(!withLand.notIncluded.some(x => /Land/.test(x)));
  assert.ok(close(withLand.routes.owned.monthly.total - r.routes.owned.monthly.total, 5000));
});

test('6.8 every blank optional field still produces finite output', () => {
  const nullable = data.assumptions.assumptions.filter(a => a.nullable).map(a => a.id);
  const values = {}; nullable.forEach(id => { values[id] = null; });
  const r = run(values);
  assert.doesNotMatch(JSON.stringify(r), /NaN|Infinity/);
});

test('6.8 AI variable cost at or above manual cost: break-even versus manual is undefined and says so', () => {
  const r = run({ manualCostPerPatientInr: 1 });
  const be = r.routes.api.manualBreakEven;
  assert.equal(be.value, null);
  assert.match(be.reason, /never breaks even/);
});

test('6.8 cloud cost below owned variable cost: no buy-versus-rent break-even', () => {
  const r = run({ rentTier: 'custom', rentCustomRateInr: 1 });
  assert.ok(r.trace.C2_rentPerPatient < r.trace.C5_activeEnergyPerPatient);
  assert.equal(r.breakEven.ownedVsRented.value, null);
  assert.match(r.breakEven.ownedVsRented.reason, /never breaks even/);
});

test('6.8 effective life above and below the statutory default moves depreciation the right way', () => {
  const base = run({ lifeYears: 6 }).trace.C3_capitalPerMonth;
  assert.ok(run({ lifeYears: 3 }).trace.C3_capitalPerMonth > base);
  assert.ok(run({ lifeYears: 10 }).trace.C3_capitalPerMonth < base);
  assert.ok(close(run({ lifeYears: 3 }).trace.C3_capitalPerMonth, 1800000 / 36));
});

test('6.8 repricing factor of exactly one: stressed equals quoted', () => {
  const r = run({ repricingFactor: 1 });
  assert.ok(close(r.trace.C1_apiPerPatient_stressed, r.trace.C1_apiPerPatient));
  assert.ok(close(r.trace.C2_rentPerPatient_stressed, r.trace.C2_rentPerPatient));
  assert.ok(close(r.breakEven.ownedVsRentedStressed.value, r.breakEven.ownedVsRented.value));
});

test('Repricing above one lowers the buy-versus-rent break-even', () => {
  const r = run({ repricingFactor: 2 });
  assert.ok(r.breakEven.ownedVsRentedStressed.value < r.breakEven.ownedVsRented.value);
});

// ---- Other behaviour ----

test('Accuracy mode derives the review fraction and reaches the target', () => {
  const r = run({ reviewMode: 'accuracy', requiredAccuracy: 0.98, modelErrorRate: 0.05, reviewSensitivity: 0.9 });
  // f = (1 - 0.02/0.05) / 0.9 = 0.6667
  assert.ok(close(r.review.fraction, (1 - 0.02 / 0.05) / 0.9));
  assert.ok(close(r.trace.P3_accuracyAchieved, 0.98));
});

test('Unreachable accuracy is flagged', () => {
  const r = run({ reviewMode: 'accuracy', requiredAccuracy: 0.999, modelErrorRate: 0.2, reviewSensitivity: 0.9 });
  assert.equal(r.review.feasible, false);
  assert.equal(r.review.fraction, 1);
  assert.ok(r.flags.some(f => f.level === 'warn'));
});

test('On-premises residency leaves only the owned rig', () => {
  const r = run({ residency: 'onprem' });
  assert.equal(r.routes.api.available, false);
  assert.equal(r.routes.rented.available, false);
  assert.equal(r.cheapest.id, 'owned');
});

test('India residency blocks a foreign API but keeps India-hosted GPUs', () => {
  const r = run({ residency: 'india', apiHostedInIndia: false });
  assert.equal(r.routes.api.available, false);
  assert.equal(r.routes.rented.available, true);
});

test('USD tiers are converted at the exchange rate', () => {
  const r = run({ rentTier: 'hyperscaler-h100-mumbai', usdInr: 90 });
  assert.ok(close(r.trace.C2_rentPerPatient, 5.97 * 90 * 1.18 / 25));
});

test('Captive solar landed cost grosses up for losses', () => {
  const r = run({ captiveOverride: true, captivePpa: 2.5, captiveWheeling: 1, captiveCss: 1.5, captiveOther: 0.5, captiveLossPct: 10 });
  assert.ok(close(r.trace.E1_landedTariff, 5.5 / 0.9));
});

test('State without a verified tariff falls back to the national default', () => {
  const b = E.buildInputs(data, { state: 'pb' });
  assert.equal(b.inputs.gridTariff, 9.0);
  assert.equal(b.meta.tariffFallback, true);
  assert.equal(E.buildInputs(data, { state: 'ka' }).inputs.gridTariff, 8.5);
});

test('Payer shares split the total and a bad sum is flagged', () => {
  const r = run({ payerHospital: 60, payerInsurer: 40 });
  assert.ok(close(r.whoPays.hospital + r.whoPays.insurer, r.chosen.monthly.total));
  const bad = run({ payerHospital: 60 });
  assert.ok(bad.flags.some(f => /add up to 60/.test(f.text)));
});

test('Pooling lowers cost per patient for small centres', () => {
  const r = run({ pooledCentres: 10, perCentreVolume: 500 });
  assert.ok(r.pooled.perPatient < r.pooled.singleCentrePerPatient);
});

test('Manual error cost is added only when both inputs are set', () => {
  const a = run({ manualErrorRate: 0.03 });
  assert.equal(a.manualPerPatient, 20);
  const b = run({ manualErrorRate: 0.03, costPerUncaughtErrorInr: 1000 });
  assert.equal(b.manualPerPatient, 50);
});

test('Cost per patient falls with volume on every route', () => {
  const s = E.sweep(E.buildInputs(data, {}).inputs, [100, 1000, 10000]);
  for (const k of ['api', 'rented', 'owned']) assert.ok(s[0][k] > s[1][k] && s[1][k] > s[2][k]);
});

// ---- Regression tests from the review council ----

test('Council A1: custom tier with no price makes the rented route unavailable, not free', () => {
  const r = run({ rentTier: 'custom' });
  assert.equal(r.routes.rented.available, false);
  assert.match(r.routes.rented.reason, /No GPU-hour price/);
  assert.notEqual(r.cheapest.id, 'rented');
});

test('Council A2: out-of-range and non-numeric inputs are clamped and named, blanks stay blank', () => {
  const r = run({ buildAmortMonths: 0, costOfCapitalPct: -1200, pagesPerPatient: NaN, payerPatient: -50, landInrPerMonth: null });
  assert.doesNotMatch(JSON.stringify(r), /NaN|Infinity/);
  const f = r.flags.find(x => /adjusted/.test(x.text));
  assert.ok(f && /Months to spread the build cost over was 0; set to the minimum, 1/.test(f.text));
  assert.ok(r.notIncluded.some(x => /Land/.test(x)));
  assert.ok(close(r.trace.P1_buildAmortised, 2500000));
});

test('Council A2: build cost with interest reduces to build / months at zero rate', () => {
  assert.ok(close(run({ costOfCapitalPct: 0 }).trace.P1_buildAmortised, 2500000 / 36));
  assert.ok(run({ costOfCapitalPct: 10 }).trace.P1_buildAmortised > 2500000 / 36);
  assert.ok(!run({ costOfCapitalPct: 10 }).notIncluded.some(x => /Cost of money/.test(x)));
});

test('Council A4: error cost without a manual error rate is flagged and labelled not like for like', () => {
  const r = run({ costPerUncaughtErrorInr: 2000 });
  assert.ok(r.flags.some(f => /like-for-like/.test(f.text)));
  assert.equal(r.routes.api.manualBreakEven.notLikeForLike, true);
});

test('Council A5: infeasible targeted review bills only what can still catch errors', () => {
  const r = run({ reviewMode: 'accuracy', modelErrorRate: 0.5, requiredAccuracy: 0.9, reviewSensitivity: 0.5, reviewTargeting: 4 });
  assert.equal(r.review.feasible, false);
  assert.ok(close(r.review.fraction, 0.25));
});

test('Council A6: pooling under the on-premises rule keeps a rig at each centre', () => {
  const pooledOnprem = run({ residency: 'onprem', pooledCentres: 5, perCentreVolume: 1000 });
  const single = run({ residency: 'onprem', patientsPerMonth: 1000 });
  assert.equal(pooledOnprem.pooled.computePooled, false);
  assert.ok(pooledOnprem.pooled.perCentreMonthly > single.routes.owned.monthly.compute);
  assert.equal(run({ pooledCentres: 1.9 }).pooled, null);
});
