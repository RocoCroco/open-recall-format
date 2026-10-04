# Open Recall Format

**One open, checkable format for product recalls, seen from the owner's side**, plus converters for seven official
recall sources and a reference checker that answers the question a family actually has: *is the thing I own
recalled, and what do I do?*

```text
$ orf convert cpsc fixtures/cpsc/cpsc-space-heater.json > recalls.ndjson
$ orf check recalls.ndjson --brand Govee --name "space heater"
[
  {
    "record_id": "us-cpsc:25036",
    "status": "possibly_affected",
    "ask": ["model"],
    "hint": "The model number is located on the manufacturer's label on the underside of each unit."
    ...
  }
]
$ orf check recalls.ndjson --brand Govee --name "space heater" --model H7131
[ { "record_id": "us-cpsc:25036", "status": "affected", ... } ]
```

## Why

- **Recalls barely reach owners.** CPSC staff found that about 6% of consumers act on a recall announced by press
  release, and about 50% when they are told directly. Telling people directly needs software that knows whether
  *their* unit is affected.
- **Every authority publishes differently.** CPSC, NHTSA, FDA, Health Canada, the EU Safety Gate, France's
  RappelConso and the UK's OPSS each have their own fields, vocabularies and quirks. Every app that wants to warn
  owners re-learns all of them.
- **The identifiers are hidden in prose.** In all 134 CPSC recalls of January-April 2025, the structured `Model`
  field is empty: model numbers, serial ranges and production dates are only in the description text, where a
  program cannot check them.
- **No shared format exists for this.** GS1's Product Recall standard serves the supply chain (which shipments to
  pull), the OECD GlobalRecalls portal is an upload channel for governments, and schema.org has had an open request
  for a recall type since 2022 ([#3229](https://github.com/schemaorg/schemaorg/issues/3229)).

Research and sources: [spec/mappings.md](spec/mappings.md) and [docs/research.md](docs/research.md).

## What is in this repository

| Path | What |
|---|---|
| [spec/open-recall-format-0.1.md](spec/open-recall-format-0.1.md) | The specification: record fields, unit selectors, the checking rules |
| [schema/orf-0.1.schema.json](schema/orf-0.1.schema.json) | JSON Schema 2020-12 (normative structure) |
| [schema/orf-0.1.context.jsonld](schema/orf-0.1.context.jsonld) | JSON-LD context mapping fields to schema.org |
| [vocab/](vocab/) | Closed lists as data: categories, hazards, allergens, actions, remedies, severity, authorities (with each authority's own codes and English/French keywords) |
| [src/sources/](src/sources/) | Converters: U.S. CPSC, NHTSA (API and bulk file), FDA (openFDA food, drug, device), Canada Recalls and Safety Alerts, EU Safety Gate, France RappelConso, UK OPSS |
| [src/check.ts](src/check.ts) | The reference checker |
| [src/cli.ts](src/cli.ts) | `orf`: convert, fetch, validate, check |
| [examples/](examples/) | One real converted record per source |
| [fixtures/](fixtures/) | Real records from every source, used by the tests |
| [docs/schema-org-proposal.md](docs/schema-org-proposal.md) | A concrete `ProductRecall` proposal for schema.org |

## A record

The CPSC recall of DR tow-behind mowers, as the agency publishes it: a paragraph with a flattened table
("Model Description Serial No. Range TB21044BEN DR BRUSH MOWER ... 3014835626 to 3015507481 ..."). As ORF
(abbreviated; full record in [examples/us-cpsc.json](examples/us-cpsc.json)):

```json
{
  "orf_version": "0.1",
  "id": "us-cpsc:25140",
  "category": "consumer_product",
  "summary": "DR Tow Behind Field and Brush Mowers are recalled because of a risk of cuts. Stop using them and get the free repair.",
  "products": [
    {
      "name": "Tow Behind Field and Brush Mowers",
      "brands": ["DR"],
      "scope": "listed_units",
      "identification": [
        {
          "models": ["TB21044BEN"],
          "serials": [{ "from": "3014835626", "to": "3015507481" }],
          "manufactured": { "from": "2024-04-01", "to": "2024-08-20" },
          "basis": "text"
        }
      ],
      "identification_hint": "The black and orange tow behind mowers have the following model and serial numbers, printed on a white label that is on the front frame of the mower. ..."
    }
  ],
  "hazards": [{ "type": "laceration" }],
  "severity": { "level": "unknown" },
  "actions": ["stop_using", "get_repair", "contact_firm"],
  "remedies": ["repair"],
  "source": {
    "authority": "US-CPSC",
    "id": "25140",
    "licence": "public-domain-us-gov",
    "attribution": "Source: U.S. Consumer Product Safety Commission (cpsc.gov)."
  }
}
```

## Three ideas that make it work

1. **Affected units are selectors, not prose.** Identity criteria (model, GTIN, UDI-DI, vehicle) say which variant;
   restrictions (lot, serial range, production window, best-before or use-by date) say which units. Selectors are
   alternatives.
2. **Scope is explicit.** `listed_units` (only what the selectors match), `all_units`, or `unknown`. Identifiers
   read from free text never let a checker answer "not affected": the answer is "possibly", with the question to
   ask.
3. **Owner-ready.** `identification_hint` says where the code is printed, `actions` are ordered (stop using
   first), `remedies` say what you get, and `summary` is one sentence an assistant can read aloud.

## Quick start

Requires Node.js 20 or later.

```bash
git clone https://github.com/RocoCroco/open-recall-format.git
cd open-recall-format
npm install
npm run build
npm test
npm link   # optional: makes the `orf` command available; below, `node dist/src/cli.js` works without it

# Convert a file you downloaded from a source
node dist/src/cli.js convert cpsc my-cpsc-download.json > recalls.ndjson

# Or fetch from the public APIs
node dist/src/cli.js fetch cpsc --since 2026-09-01 --until 2026-09-30 > cpsc.ndjson
node dist/src/cli.js fetch openfda-food --since 2026-09-01 --limit 200 > fda-food.ndjson
node dist/src/cli.js fetch rappelconso --since 2026-09-25 > rappelconso.ndjson
node dist/src/cli.js fetch nhtsa --make Toyota --model Camry --year 2020 > camry.ndjson

# Validate, and check an item
node dist/src/cli.js validate cpsc.ndjson
node dist/src/cli.js check camry.ndjson --make Toyota --vehicle-model Camry --year 2020
```

As a library:

```ts
import { convert, checkItem, validateRecord } from 'open-recall-format';

const records = convert('cpsc', await (await fetch(cpscUrl)).text());
for (const record of records) {
  const result = checkItem(record, { brand: 'Govee', name: 'space heater', model: 'H7131' });
  if (result.status !== 'unrelated') console.log(record.summary, result);
}
```

## Sources

| Source | Converter input | Identifiers | Licence of the data |
|---|---|---|---|
| U.S. CPSC | Recalls API JSON | parsed from prose: models, item numbers, prefixes, model and serial tables, production windows, UPCs | U.S. federal government work |
| U.S. NHTSA | recallsByVehicle API; FLAT_RCL bulk file | make, model, model years; equipment, tire and child-seat models; production windows | U.S. federal government work |
| U.S. FDA (openFDA) | food, drug, device enforcement JSON | parsed from `code_info`: lots, UPCs, UDI-DIs, serial ranges, date marks (scope always `unknown`) | CC0 1.0 |
| Canada Recalls and Safety Alerts | open data file | none in the file (scope `unknown`) | Open Government Licence - Canada |
| EU Safety Gate | notification JSON of the public site | brands, models, barcodes, batches (structured) | CC BY 4.0 (Commission Decision 2011/833/EU) |
| France RappelConso | v2 open data | barcode + lot + use-by/best-before per entry (structured) | Licence Ouverte 2.0 |
| UK OPSS | GOV.UK content API | brand, model, barcode, batches from the product table | Open Government Licence v3.0 |

Every converted record carries its source's licence and required attribution (`source.licence`,
`source.attribution`). See [NOTICE](NOTICE).

## Status and limits

- **0.1 is a draft.** It is a proposal with working converters and tests, not a standard endorsed by any authority.
  Comments are welcome.
- Converters that read prose are conservative and will miss some identifiers; when they do, the record says
  `unknown` rather than guessing. Summaries are generated in English.
- The EU Safety Gate JSON API is the public website's own and is not documented by the Commission; it may change.
- The checker matches words, codes and dates. It does not translate: an English product name will not match a
  French record, but a barcode will.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): new sources, vocabulary terms and checker cases are all welcome, each with
real fixtures and tests.

## Licence

Copyright 2026 Roc Cutal. Code, schema, context and vocabularies: [Apache License 2.0](LICENSE). Specification and documentation prose
(`spec/`, `docs/`): [CC BY 4.0](spec/LICENSE). Fixture data: the publishers' licences listed in [NOTICE](NOTICE).
