# Changelog

All changes to formulas, defaults and assumptions are recorded here with the reason, so any past estimate can be reproduced. Each data file also carries a dataVersion, and each default carries its own change history in `data/assumptions.json`.

## 0.2.1 — 12 November 2026

Connection to Nikasha, the readiness framework for clinical AI tools (https://github.com/agravaaniresearch/nikasha).

- Engine: new `toCostProfile(result, inputs)` maps a calculation onto the shared deployment cost profile (`schema/cost-profile.schema.json`). It is a pure mapping and adds no formula; worst and best are the repriced and quoted cloud prices; the unit is per patient. No existing output changes.
- Schema: `schema/cost-profile.schema.json` added, a copy of the canonical contract kept in the Nikasha repository. The two copies must stay identical.
- Tests: `tests/profile.test.js` checks the profile against the schema, that its layers add up to the chosen route, and that it introduces no arithmetic of its own.
- Nikasha vendors this engine and the tariff and assumption files at a pinned commit and reads six shared inputs from them (hardware life, residual value, cost of capital, GPU failure rate, uncovered share of a failure, PUE), so the two projects hold one copy of each figure.

## 0.2.0 — 11 November 2026 (data 2026-11-11b)

Changes after the review council (see `docs/REVIEW-FINDINGS.md`).

- Engine: inputs are clamped to declared ranges, with named warnings. A custom tier with no price makes that route unavailable. The build cost carries the cost of money. Infeasible targeted review is capped at 1/k. Pooling under the on-premises rule keeps a rig at each centre. A missing manual error rate raises a not-like-for-like warning. Formulas C2, P3, P4, M2 and W7 moved to version 2.
- Data: added a `verification` field to the data and schemas. Last-verified dates were removed where only a snippet was read. The PIB wording was corrected. The IndiaAI rows are labelled "eligibility required". The hyperscaler row is relabelled as reserved capacity. Residual value is now a user input. Governance is relabelled for the DPDP Act and CDSCO. Notes were added on ITC apportionment, out-of-pocket payers, and the scope of the statutes. Open items OI-9 to OI-12 were added.
- Page: front-screen wording and charts were revised for non-expert readers. The mobile layout was fixed. Chart exports are rendered at twice the resolution.
- Tests: 44 in total, including a regression test for each council fix.
- Exports: inside a sandboxed viewer the page uses the host's downloads capability when it is offered, and ordinary links elsewhere.

## 0.1.0 — 11 November 2026 (data 2026-11-11)

First build from the handover brief.

- Formula engine (`js/engine.js`) with a trace of every intermediate value. It departs from the brief in 14 places, each documented in `docs/FORMULA-CROSSCHECK.md`. The main departures are a 6-year statutory life for servers, power that follows volume with idle draw and PUE, GPU count in capacity, exchange rate and GST on cloud bills, an optional cost of money, governance included in the total, a wider break-even numerator against manual entry, an explicit link between accuracy and review, and a local share of validation under pooling.
- Data files, each with a JSON Schema: assumptions register, state tariffs (four states from a secondary source, the rest falling back to a flagged national default), GPU tiers, sources with how each was read, derivation record, and open items.
- Page: a plain headline, four charts, PNG, JPEG and PowerPoint export with caveats printed on the image, a detail view of the working, and shareable scenario links.
- Standalone single-file build, CI workflow, MIT licence, and contribution guide.
