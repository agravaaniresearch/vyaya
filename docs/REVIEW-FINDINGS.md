# Review council findings

The council met on 11 November 2026 under the rules in section 8A of the handover brief. Three reviewers worked independently in round one:

- **Reviewer A** recomputed every formula and probed the edge cases.
- **Reviewer B** challenged each assumption against its source, and opened the Schedule II bare text, the Llama 3 reliability section and the PIB February 2026 PDF.
- **Reviewer C** read the front screen as a non-expert hospital administrator, on desktop and on mobile.

In round two, each reviewer responded once to the other reviewers' findings and to the builder's proposed resolutions. The council then stopped. Nothing it said overrides the author's decisions in section 3 of the brief.

Reviewer A confirmed every default-case figure by hand: API ₹0.386 per patient; rented GPU ₹3.068; capital ₹25,000 a month; failure allowance ₹8,100; idle power ₹4,730; capacity 26,280; break-even 17,781. The reviewer found no sign, unit or double-counting errors.

## Changed

| Finding | Change |
|---|---|
| A1 | A "Your own quote" tier left blank made the rented route free. It is now unavailable, with a reason. A test covers this. |
| A2 | Out-of-range or non-numeric inputs, such as zero amortisation months or a negative interest rate, could silently delete costs or produce NaN. Every numeric input is now clamped to its declared range. Blank optional fields stay blank. Each correction is named in a warning, with the original value, on the page and in exports. |
| A2 (round two) | The build cost now carries the same cost of money as the rig. The "not included" text is therefore accurate, and the build cost reduces to build ÷ months at a zero rate. |
| A4 | Setting a cost per error without a manual error rate charged AI for its errors but not manual entry. This now raises a warning, and the break-even against manual entry is labelled "not like for like". |
| A5 | When the accuracy target was out of reach, targeted review billed more effort than could help. The review fraction is now min(1, 1/k). |
| A6 | Under the on-premises rule, pooling now keeps a rig at each centre, and the number of centres is a whole number. |
| A7, A8 | Negative payer shares and a repricing factor of zero or below are clamped. |
| B1 | Search-snippet sources no longer carry a last-verified date. Each default records how it was actually checked. The council's own readings are recorded as what they were: the bare text on a secondary host, a section read through a fetch tool, and the PIB PDF opened. |
| B2 | The PIB wording was corrected: ₹65 is not described as an average. The IndiaAI rows say "eligibility required". |
| B3 | The hyperscaler row is relabelled as a reserved capacity block, not an on-demand price. |
| B5, B6 | The tariff notes now name the secondary source, the HT industrial category and the kVAh billing. The Schedule II link now points to the bare text. The notes state that Schedule II binds companies and that 40% WDV is irrelevant to tax-exempt hospitals. |
| B7 | Residual value is now a user choice, not a statutory figure. |
| B8 | "DPIA" was replaced with DPDP Act compliance, ethics committee, and CDSCO clearance if the tool is a medical device. |
| B11, B13, B14 | Added the ITC apportionment note and the out-of-pocket payer note. The IndiaAI price range is now worded the same way everywhere. |
| C1 to C11 | The stress-card text was rewritten, including the case of no repricing. The manual baseline is marked illustrative in the headline. The buy-or-rent sentence was simplified. The headline says "the only route your data rule allows" when that is true. Compute share shows "under 0.1%" for small values, and the headline explains why cost per patient falls steeply. The mobile overflow under the working is fixed. Front-screen jargon was replaced. The y-axis ticks on the volume chart were thinned. The stress chart has value labels and whole-rupee ticks. The who-pays chart has a plain sentence. The "not included" chips collapse to the three that can change a verdict, plus a toggle. The rig flag is prefixed "If you buy instead". |
| C (round two) | The headline states the hardware life in one clause, with the 3-year result. It notes when rented prices are for newer GPUs than the owned rig. Warnings are listed first. The slider shows the clamped value. |

## Left open for the author

These items are recorded in `data/open_items.json`.

- **OI-5, hardware life.** The default is 6 years under Schedule II for servers; the brief said 3. Reviewers A and B note that this changes the default verdict, and that accounting life is not GPU obsolescence.
- **OI-11, default rented tier.** Reviewer B first proposed Indian commercial H100, because IndiaAI eligibility excludes most private hospitals. In round two, Reviewers A and B objected: that default makes top-end hardware the rental default, which runs against section 3, and combined with a 6-year life it moves the verdict far from the brief. The default stays at the brief's IndiaAI rate.

  Break-even of the owned rig against the rented GPU at the shipped defaults:

  | Life | Rented tier | Break-even (patients a month) |
  |---|---|---|
  | 3 years | IndiaAI ₹65 | 27,074 (beyond one rig's capacity of 26,280) |
  | 6 years | IndiaAI ₹65 | 17,781 |
  | 3 years | Commercial H100 | 4,434 |
  | 6 years | Commercial H100 | 2,912 |

- **OI-9, hardware classes.** Every priced rental row is H100-class, while the owned default is an older rig. No sourced older-GPU rental price was available.
- **OI-12, unconfirmed prices.** PIB's ₹65 cannot be an H100 rate, given the ₹153 L1 bid and the 40% subsidy cap. The GST treatment of the AWS figure is unconfirmed.
- **OI-10, scope of the statutes.** Schedule II and the Income-tax WDV rate do not bind trust, society, government or tax-exempt hospitals.
