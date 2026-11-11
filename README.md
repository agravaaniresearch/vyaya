# Vyaya

*Vyaya (व्यय) is Sanskrit for expenditure.*

Vyaya is a transparent calculator for what it costs a hospital to use AI to extract structured data from printed clinical reports, costed per patient and per month. It was built first for Indian hospitals. It asks two questions: who pays, and what the hospital gets for the money compared with doing the work by hand.

It compares three ways of running the model (a per-token API, a rented GPU, and a rig the hospital buys) and then adds the costs that usually dwarf compute: engineering, staff review of outputs, validation on the hospital's own documents, governance, and the cost of errors. Every cloud price can be stress-tested against the possibility that today's subsidised or investor-funded prices do not last.

## Use it

Open the published page (GitHub Pages, from this repository), or download `dist/vyaya-standalone.html` and open it in any browser; it works offline. Nothing you type leaves your device. The front screen gives one headline answer in plain words, with four charts. "Show the working" opens every input, formula, source and open item.

Each chart exports as PNG, JPEG or a PowerPoint slide. The export carries the key assumptions, every "not included" item and the list of placeholder values still in use, so a figure never travels without its caveats. "Copy a link to this scenario" puts your changed inputs in the URL.

## What the numbers are, and are not

Every default carries a status:

| Status | Meaning |
|---|---|
| statutory | Set by an Indian statute or rule and cited (hardware life under Companies Act Schedule II; 40% WDV under the Income-tax Act) |
| secondary | From a secondary source that cites primary documents; check the primary before relying on it |
| placeholder | No authoritative source exists; replace with your own figure |
| illustrative | Invented during design to show how costs behave; not a finding |
| user | A choice only you can make |

Most inputs are placeholders or illustrations, because purchase price, throughput, review effort, error costs and the manual baseline have no authoritative public source. The page counts how many are still at their defaults and says so on every output. Land is deliberately not computed: it is an optional monthly figure, and when blank every output lists it as not included.

## Repository layout

```
index.html                 the page (reads data/ at load time)
css/vyaya.css              styles (warm palette, validated for colour-vision deficiency)
js/engine.js               the formula engine: pure functions, runs in browser and Node
js/app.js                  page logic, charts, exports, detail view
data/assumptions.json      every input: default, status, source, reason, change history
data/electricity_tariffs.json   state-wise landed grid tariff (commercial or HT only)
data/compute_prices.json   rented GPU tiers: subsidised government, Indian commercial, hyperscaler
data/sources.json          every source, with how it was actually read
data/formulas.json         derivation record for each formula, including changes from the brief
data/open_items.json       open items and unresolved review findings
schema/                    JSON Schemas for every data file (enforced by the tests)
tests/                     engine tests (hand-checked values and edge cases) and data integrity tests
docs/FORMULA-CROSSCHECK.md where and why the engine departs from the handover brief
docs/REVIEW-FINDINGS.md    the review council's findings and what was done about them
dist/vyaya-standalone.html single-file build for offline use
vendor/                    Chart.js 4.6.1 and PptxGenJS 3.12.0 (MIT), vendored so the page needs no network
```

## Develop

```
npm install
npm test          # engine and data tests
npm run serve     # http://localhost:8080
npm run build     # rebuild dist/vyaya-standalone.html after changing anything
```

To host on GitHub Pages, enable Pages for the `main` branch, root folder. No build step is needed for the hosted page.

## Contributing data

Corrections and new rows are welcome by pull request, especially state tariffs from SERC tariff orders and GPU prices. See [CONTRIBUTING.md](CONTRIBUTING.md). Every figure needs a source link and a last-verified date. Wikipedia is not accepted as a source.

## Licence

MIT. See [LICENSE](LICENSE).
