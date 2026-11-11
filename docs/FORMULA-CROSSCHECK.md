# Formula cross-check against the handover brief

This note records build step 1: every formula in section 6 of the handover brief was recomputed independently and tested against the edge cases in section 6.8 before the engine was finalised. Where this note and the brief disagree, the reasoning is given and the engine follows this note. The derivation record for each formula, with sources, is in `data/formulas.json`, and the page shows it under "Show the working".

## Disagreements with the brief

**1. Statutory hardware life is 6 years, not 3.** The brief cites Companies Act Schedule II for a 3-year life for computers. Part C item XII of Schedule II has two lines: servers and networks at 6 years, and end-user devices such as desktops and laptops at 3 years. A GPU rig is a server, so the default is 6 years. The 3-year figure remains selectable, and the change is logged in the assumption's history. The tax view (40% written-down value) is unchanged, but the Income-tax Act, 2025 replaced the 1961 Act from 1 April 2026; the rate is reported as retained, while the section number still needs confirming in the Gazette text.

**2. Power and utilisation contradicted each other.** The brief's power formula multiplied by a separate utilisation input while patients per month was also a slider, so a user could set 100 patients and 100% utilisation at once. Utilisation now follows from volume. This splits power into a fixed idle part and a variable part per patient, which the buy-versus-rent break-even needs anyway, since that formula refers to an "owned variable cost per patient" that the brief never defined.

**3. Idle draw and cooling were missing.** A switched-on rig draws power while idle, and a server room needs cooling. Both are now inputs (idle share of full load, and PUE), defaulting to flagged placeholders.

**4. Rig capacity omitted the number of GPUs.** The brief's capacity is patients per GPU-hour times hours times duty cycle, which describes one GPU. Capacity now multiplies by GPU count.

**5. API prices need a currency step.** API and hyperscaler prices are quoted in US dollars. An exchange-rate input converts them.

**6. GST on cloud bills is likely a real cost for hospitals.** Cloud services carry 18% GST. Hospital healthcare services are exempt, so input tax credit is generally unavailable. The default adds 18% to every cloud price and can be set to zero on a tax adviser's advice.

**7. Buying without a cost of money flatters buying.** Straight-line depreciation charges no interest, though buying ties up capital and renting does not. A cost-of-money input uses the standard capital-recovery formula; at zero it reduces exactly to the brief's formula, and the output lists cost of money as not included while it is zero.

**8. Governance costs were listed but not totalled.** Section 6.4 lists ethics, DPIA and regulatory costs; section 6.5's total omits them. They are now amortised with the validation study.

**9. Break-even against manual entry used too small a numerator.** The brief divides fixed people cost alone by the margin per patient. Validation fixed costs and, on the owned route, the rig's fixed cost are also fixed. Leaving them out understates the volume needed.

**10. The accuracy link needed a formula.** The brief says required accuracy and review fraction must be linked but gives no relationship. The engine uses residual error = e × (1 − min(1, k·f) × s), where e is the model's error rate, f the review fraction, s the share of errors a reviewer catches and k a targeting factor (1 for random review). Solving for f gives the review fraction needed for a required accuracy, flagged when unreachable.

**11. The failure figure: 27% over three years is linear.** (148 faulty-GPU + 72 HBM3 interruptions) / 16,384 GPUs × 365/54 = 9.1% a year, which matches the brief. Three linear years give 27%; compounding gives 24.9%. More importantly, the Llama 3 report counts job interruptions, not hardware replacements, so the figure is an upper-leaning placeholder. The "replacement share" is split into GPU share of rig price and the share not covered by warranty, so each part can be checked.

**12. Like-for-like manual baseline.** If AI is charged for its uncaught errors, manual entry should be charged for its own. A manual error rate input does this when a cost per error is set.

**13. Pooling cannot share all of validation.** Accuracy must be shown on each hospital's own documents, so a local share of validation stays with each centre.

**14. Volumes above one rig's capacity.** The brief calls these invalid. The engine prices whole extra rigs and flags the result, so the chart does not stop abruptly. Buy-versus-rent break-evens beyond one rig's capacity are reported as such.

## Edge cases (brief section 6.8)

| Case | Behaviour | Test |
|---|---|---|
| Zero patients | Cost per patient is reported as undefined; monthly fixed costs are still shown; no NaN or Infinity anywhere in the result | `6.8 zero patients` |
| Volume above rig capacity | Whole rigs are added and the output says how many | `6.8 volume above rig capacity` |
| Blank land | Contributes zero and is listed as not included on every output and export | `6.8 blank land` |
| Every optional field blank | Output stays finite | `6.8 every blank optional field` |
| AI variable cost at or above manual | Break-even versus manual is null with a plain reason | `6.8 AI variable cost at or above manual` |
| Cloud below owned variable cost | Buy-versus-rent break-even is null with a plain reason | `6.8 cloud cost below owned variable cost` |
| Life above or below 6 years | Depreciation moves inversely; 3 years gives price/36 | `6.8 effective life` |
| Repricing factor of exactly one | Stressed equals quoted, including break-evens | `6.8 repricing factor of exactly one` |

## Worked check at the shipped defaults (1,000 patients a month)

These figures use illustrative and placeholder defaults and are not findings. They exist only to show the arithmetic can be followed by hand.

- Tokens: 12 pages × 1,500 = 18,000 in; 12 × 400 = 4,800 out.
- API: (0.018 × $0.10 + 0.0048 × $0.40) × 88 × 1.18 = ₹0.386 per patient.
- Rented GPU: ₹65 × 1.18 / 25 patients per GPU-hour = ₹3.07 per patient.
- Owned rig fixed per month: capital ₹18,00,000 / 72 = ₹25,000; failure ₹18,00,000 × 0.09 × 0.6 / 12 = ₹8,100; idle power 1.5 kW × 0.3 × 730 h × 1.6 × ₹9 = ₹4,730; maintenance ₹10,000; total ₹47,830.
- Owned active power per patient: 1.5 × 0.7 × 1.6 × 9 / (20 × 2) = ₹0.378.
- Capacity of one rig: 20 × 2 × 730 × 0.9 = 26,280 patients a month.
- Buy-versus-rent against the rented GPU: 47,830 / (3.068 − 0.378) = 17,781 patients a month.
- People: build ₹25,00,000 / 36 + support ₹60,000 = ₹1,29,444; review 1,000 × 0.2 × 3 × ₹5 = ₹3,000.
- Validation: study 500 × ₹340 + ₹3,00,000 = ₹4,70,000, plus governance ₹2,00,000, over 36 months = ₹18,611; re-validation 2 × 100 × ₹340 / 12 = ₹5,667; monitoring 1,000 × 0.02 × 5 × ₹20 = ₹2,000.
- Total on the API route: ₹1,59,109 a month, ₹159 per patient; compute is 0.24% of it.

The automated tests assert each of these lines.
