/* The shared cost-profile contract with Nikasha (schema/cost-profile.schema.json).
   The canonical schema lives in agravaaniresearch/nikasha; this copy must stay identical. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { E, data, run, root } = require('./helpers');

const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema', 'cost-profile.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function profile(values) {
  const b = E.buildInputs(data, values);
  return E.toCostProfile(E.calculate(b.inputs), b.inputs);
}

test('default scenario produces a valid per-patient profile', () => {
  const p = profile({});
  assert.ok(validate(p), JSON.stringify(validate.errors, null, 2));
  assert.equal(p.unit, 'per_patient');
  assert.equal(p.figures.valid, false, 'Vyaya does not compute energy per study');
});

test('layers add up to the chosen route per patient, in both price cases', () => {
  const r = run({});
  const p = E.toCostProfile(r, E.buildInputs(data, {}).inputs);
  const sum = (k) => p.layers.reduce((a, l) => a + l.perStudy[k], 0);
  assert.ok(Math.abs(sum('best') - r.chosen.perPatient) < 1e-6);
  assert.ok(Math.abs(sum('worst') - r.chosenStressed.perPatient) < 1e-6);
});

test('repricing makes the worst case at least as expensive as the best', () => {
  const p = profile({ repricingFactor: 3 });
  assert.ok(p.total.worst >= p.total.best);
  assert.ok(validate(p));
});

test('zero patients gives an indeterminate, still valid, profile', () => {
  const p = profile({ patientsPerMonth: 0 });
  assert.ok(validate(p), JSON.stringify(validate.errors));
  assert.equal(p.affordability.verdict, 'INDETERMINATE');
});

test('the profile adds no formula: net equals per patient minus manual', () => {
  const r = run({});
  const p = E.toCostProfile(r, E.buildInputs(data, {}).inputs);
  assert.ok(Math.abs(p.net.best - (r.chosen.perPatient - r.manualPerPatient)) < 1e-9);
});
