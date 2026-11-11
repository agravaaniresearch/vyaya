const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');

const root = path.join(__dirname, '..');
function load(name) { return JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8')); }
const data = {
  assumptions: load('assumptions.json'),
  tariffs: load('electricity_tariffs.json'),
  compute: load('compute_prices.json'),
  sources: load('sources.json'),
  formulas: load('formulas.json')
};
function run(values) { return E.calculate(E.buildInputs(data, values).inputs); }
function close(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 * Math.max(1, Math.abs(b)) : tol); }
module.exports = { E, data, run, close, root };
