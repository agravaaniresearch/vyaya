# Contributing to Vyaya

Vyaya is only as good as its defaults, and most of them are placeholders. The most useful contribution is a sourced figure that replaces one.

## The rules for any figure

1. **Cite a source you have opened.** Add it to `data/sources.json` with its URL, publisher, the date you accessed it, and `howRead` set honestly (for example "read in full" or "table on page 112"). Prefer primary sources: SERC tariff orders, gazette notifications, the IndiaAI portal, vendor price pages, peer-reviewed reports.
2. **Never cite Wikipedia.** The tests reject any link to it.
3. **Set the status truthfully.** `statutory` for statute or rule, `secondary` for anything you did not read in the primary document, `placeholder` when no authoritative figure exists.
4. **Record the change.** When you change an existing default in `data/assumptions.json`, add an entry to its `history` array with the date, the previous value and the reason, so any past estimate can be reproduced.
5. **Electricity is landed cost, commercial or HT only.** Include energy charge, demand or fixed charge spread over units, fuel adjustment, duty and surcharges. Domestic tariffs are not accepted (the schema rejects categories that say domestic or residential). Say which category a hospital would fall under.
6. **No land arithmetic.** Land stays a single optional user figure by design.

## Adding a state tariff

Edit the state's row in `data/electricity_tariffs.json`: set `landedInrPerKwh`, `category`, `tariffYear`, `status`, `sources` and `lastVerified`, and explain in `note` how you converted the order's charges into a per-unit landed figure.

## Adding a GPU tier

Add a row to `data/compute_prices.json`. Older and previous-generation GPUs are welcome: the calculator deliberately does not assume top-end hardware. State the currency, whether the provider hosts in India, and whether the price is before or after GST and subsidy.

## Changing a formula

Formulas live in `js/engine.js` and are documented in `data/formulas.json`. A formula change needs: an updated `expression`, `derivation` and incremented `version` in `formulas.json`; a test in `tests/engine.test.js` with a hand-checkable value; a bump of `ENGINE_VERSION`; and a line in `CHANGELOG.md`.

## Before you open a pull request

```
npm install
npm test
npm run build
```

A reviewer checks each entry against its source before merging. The reviewer for contributed data will be named here once assigned.
