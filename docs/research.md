# Research: how recalls are published today

The survey behind the Open Recall Format (read 2026-10-03). It covers what exists, why none of it answers the
owner's question, and the data problems found in each source while writing the converters, so that others do not
have to find them again.

## 1. The owner's problem

- About **6%** of consumers act on a recall announced by press release; about **50%** when owners are told
  directly (CPSC staff, Recall Effectiveness Workshop, 2017; workshop report February 2018, which lists home voice
  assistants among the ways to reach owners).
- Only **42%** of parents return a car seat registration card, the only way a maker can warn them (Safe Kids
  Worldwide, "Car Seat Recalls: What Every Parent Needs to Know", 2015).
- **53%** of parents of children under 8 have used pre-owned children's equipment; **63%** find it hard to tell if
  it is safe (C.S. Mott Children's Hospital National Poll on Children's Health, May 2023). Second-hand items reach
  no registration list and no retailer email.

Direct notice needs software that can tell whether a specific unit in a specific home is affected. That needs the
recall data in a form a program can check.

## 2. Existing standards and services

| Work | What it is | What it does not do |
|---|---|---|
| GS1 Product Recall (XML 3.x) | B2B messages (Notification, Removal Confirmation, Closeout) between suppliers, retailers and regulators, keyed on GTIN and batch; element guide 3.6 published by GS1 Germany | Not public; addresses stock, not owners; most things in a home no longer carry a scannable GTIN |
| OECD GlobalRecalls portal (2012; 47 countries) | Governments upload notices as zipped XML through an API with keys; GS1 GPC categories and GTINs ([OECD 2020](https://www.oecd.org/content/dam/oecd/en/publications/reports/2020/05/oecd-globalrecalls-portal_a4bf1196/d8b0d605-en.pdf)) | Non-food only; no documented public read API; the report notes notices "could not be loaded due to non-compliant data" |
| EU GPSR Art. 36 and Implementing Regulation (EU) 2024/1435 | What a consumer recall notice must say (product with identification numbers, the risk, the procedure starting with "stop using", the remedies) | A document layout, not data |
| schema.org | No recall type; [#3229](https://github.com/schemaorg/schemaorg/issues/3229) open since December 2022 | - |
| Open-source code | Single-agency API clients; a few single-agency MCP servers; paid scrapers that each define a private "unified schema" | No shared, documented, versioned format; no way to say which units are affected |

## 3. The sources, and what we found in their data

### U.S. CPSC (Recalls API)

- The structured `Products[].Model` field is **empty in all 134 recalls of January-April 2025**. Model numbers,
  item numbers, serial ranges and production windows are only in `Description`, sometimes as a table flattened into
  a sentence ("Model Description Serial No. Range TB21044BEN DR BRUSH MOWER PREMIER 44T 10.5 HP BS ES 3014835626 to
  3015507481 TB23244BEN ...").
- Fields can be wrong: recall 25-140 (DR mowers) lists as retailer "Bowling alleys nationwide from January 2018
  through July 2019 for about $5", text from an unrelated recall.
- Brands are rarely a field: they appear as quoted text ("'GoveeLife' or 'Govee' is printed on the front") or in
  the headline ("Enerco Recalls DEWALT ... Heaters"). Quoted text also holds model prefixes (`"CANY"`), which are not
  brands.
- Queries by `LastPublishDate` are rejected; `RecallDateStart`/`RecallDateEnd` work. Requests from some cloud
  networks are refused.
- CPSC does not classify severity.

### U.S. NHTSA

- The recallsByVehicle API writes `ReportReceivedDate` **day first** (`28/05/2020` for campaign 20V314000). A
  fixture like `04/11/2020` looks valid either way; check with a day above 12.
- One API result per campaign x make x model x year: group by campaign and turn years into ranges.
- The bulk file FLAT_RCL (fields in NHTSA's RCL.txt) covers equipment (E), tires (T) and child seats (C) that the
  vehicle API does not, with manufacturing windows (`BGMAN`, `ENDMAN`). Model names are often families
  ("SNUGRIDE"), and tire models include the brand ("BRIDGESTONE R192"). Year 9999 means unknown.

### U.S. FDA (openFDA enforcement)

- One result per product (`recall_number`); group by `event_id` for the recall.
- Identifiers are free text in `code_info` in many formats: "Lot#:26080483; Exp :03/13/2027", "Best By: 2026
  AUGUST 31", "05 16 2027", "2026.07.11", "NOV/05/2026", "Use By: 20270127". Some values are malformed
  ("Exp :0/18/2026").
- No consumer instructions in the data; classification is Class I/II/III.
- Licence: CC0 1.0 (GMDN content excepted).

### Canada, Recalls and Safety Alerts

- The open data file (34,168 rows on 2026-10-03, about 15 MB) has `Title`, `Product`, `Issue`, `Category`,
  `Recall class`, `What you should do` (HTML), `Last updated`. No brand, model, lot or publication date; some rows
  have no date at all.
- The older detail API (`healthycanadians.gc.ca/recall-alert-rappel-avis/api/...`) still answers but stopped at
  2021.
- Severity mixes "Type I/II/III" (health products), "Class 1/2/3" (food) and ranges ("Type II - Type III").
- Brands appear as "Smarter Snacks brand ..." in food titles and "School Bus recalled by MICRO BIRD" for Transport
  Canada.

### EU Safety Gate

- Records are rich and structured (brands, model types, barcodes, batch numbers, risk types, measures, country of
  origin), but the JSON API is the public website's own and is not documented.
- Brand placeholders in the notifying country's language: "nincs" (Hungarian for "none").
- Risk types are keys (`riskType.electric.shock`); measures distinguish withdrawal from the market (retail) from
  recall from consumers (owners).

### France, RappelConso

- The best owner-side data we found: per entry a GTIN, a lot and a use-by or best-before date, and closed lists for
  consumer actions (six values) and compensation (four values).
- `identification_produits` packs entries as `GTIN$lot$date kind$from$to` joined by `|`, with real-world values
  such as a placeholder GTIN `000000000`, "tous les lots", free text in another language ("siehe bei meiner
  produktliste") and capacities ("200/300/350/400ah") in the lot field.
- Everything is lower case.

### UK OPSS

- GOV.UK's search API gives official facets (risk level: serious, high, medium, low, not-provided; 12 measure
  types; 31 categories); the content API gives a body with a product table (Brand, Model, Batches, Barcode).
- "Batches: ... (All batches)" means no lot restriction.

## 4. What this means for a format

1. Identifiers must be data, with ranges, prefixes and dates, and must say where they came from (structured or
   parsed).
2. A record must be able to say "I don't know which units", and a checker must respect it.
3. Severity can only come from the authority.
4. Placeholders and free text must never become identifiers.
5. Every record must carry its licence and attribution.
