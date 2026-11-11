/* Data integrity: schemas, cross-references, and the sources policy. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { data, root } = require('./helpers');

const ajv = new Ajv({ allErrors: true, strict: false });
const pairs = [
  ['sources.json', 'sources.schema.json', data.sources],
  ['assumptions.json', 'assumptions.schema.json', data.assumptions],
  ['electricity_tariffs.json', 'electricity_tariffs.schema.json', data.tariffs],
  ['compute_prices.json', 'compute_prices.schema.json', data.compute],
  ['formulas.json', 'formulas.schema.json', data.formulas]
];
for (const [file, schemaFile, doc] of pairs) {
  test(file + ' matches its schema', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema', schemaFile), 'utf8'));
    const ok = ajv.validate(schema, doc);
    assert.ok(ok, JSON.stringify(ajv.errors, null, 2));
  });
}

const sourceIds = new Set(data.sources.sources.map(s => s.id));
test('every cited source exists', () => {
  const cited = [];
  data.assumptions.assumptions.forEach(a => a.sources.forEach(s => cited.push(s)));
  data.tariffs.rows.forEach(r => r.sources.forEach(s => cited.push(s)));
  data.compute.rows.forEach(r => r.sources.forEach(s => cited.push(s)));
  data.formulas.formulas.forEach(f => f.sources.forEach(s => cited.push(s)));
  cited.forEach(s => assert.ok(sourceIds.has(s), 'unknown source ' + s));
});

test('every formula input is a known assumption', () => {
  const ids = new Set(data.assumptions.assumptions.map(a => a.id));
  data.formulas.formulas.forEach(f => f.inputs.forEach(i => assert.ok(ids.has(i), f.id + ' cites unknown input ' + i)));
});

test('every assumption belongs to a declared group and ids are unique', () => {
  const groups = new Set(data.assumptions.groups.map(g => g.id));
  const seen = new Set();
  data.assumptions.assumptions.forEach(a => {
    assert.ok(groups.has(a.group), a.id);
    assert.ok(!seen.has(a.id), 'duplicate ' + a.id); seen.add(a.id);
  });
});

test('sourced defaults carry a source and a verification date', () => {
  data.assumptions.assumptions.filter(a => a.status === 'statutory' || a.status === 'secondary').forEach(a => {
    assert.ok(a.sources.length > 0, a.id); assert.ok(a.lastVerified, a.id);
  });
  data.tariffs.rows.filter(r => r.landedInrPerKwh !== null && r.status !== 'placeholder').forEach(r => {
    assert.ok(r.sources.length > 0 && r.lastVerified, r.id);
  });
});

test('the national electricity default exists', () => {
  assert.ok(data.tariffs.rows.find(r => r.id === 'national-default' && typeof r.landedInrPerKwh === 'number'));
});

test('no Wikipedia links anywhere in the repository', () => {
  const skip = new Set(['node_modules', '.git', 'vendor', 'dist']);
  const offenders = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(json|js|md|html|css|yml)$/.test(name) && !p.endsWith('data.test.js') && !p.endsWith('.schema.json')) {
        if (/wikipedia\.org/i.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
      }
    }
  })(root);
  assert.deepEqual(offenders, []);
});
