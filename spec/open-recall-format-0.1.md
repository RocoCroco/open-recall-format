# Open Recall Format 0.1

**Status:** draft for comment, 2026-10-03. **Editor:** Roc Cutal. **Licence:** CC BY 4.0 (this document); the schema, vocabularies and
reference code are Apache-2.0.

The Open Recall Format (ORF) describes one product recall **from the owner's side**: which units are affected, how
an owner recognises them, what the danger is, and what to do. It is meant to be produced from the data that recall
authorities already publish, and consumed by anything that warns people: assistants, apps, marketplaces, consumer
groups.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## 1. Goals and non-goals

Goals:

1. **One record shape for every authority**, so a consumer writes one integration instead of one per agency.
2. **Affected units as data that can be checked**, not prose: models, GTINs, lots, serial ranges, production
   windows, date marks, vehicles.
3. **Honest uncertainty**: a record says when it does not know which units are affected, and a checker never turns
   "unknown" into "not affected".
4. **Owner-ready content**: where to find the identifier on the product, the first thing to do, the remedy, and a
   one-sentence summary any assistant can read aloud.
5. **Provenance**: every record names its source, its licence and the attribution the licence requires.

Non-goals: replacing the authorities' own notices (an ORF record links to the official notice and never changes its
meaning); supply-chain messaging between businesses (that is the GS1 Product Recall standard, see
[mappings.md](mappings.md)); deciding what is dangerous (the authority decides; ORF reports).

## 2. Records

A record is a JSON object valid against [`schema/orf-0.1.schema.json`](../schema/orf-0.1.schema.json) (JSON Schema
2020-12). The schema is normative for structure; this section explains meaning. Unknown properties are not allowed
in 0.1.

| Field | Required | Meaning |
|---|---|---|
| `orf_version` | yes | `"0.1"` |
| `id` | yes | `<authority in lower case>:<source id>`, e.g. `us-cpsc:25036`. Stable for the same recall. |
| `source` | yes | `authority` (see `vocab/authorities.json`), `agency` (sub-agency or notifying country), `id` (the authority's identifier), `url` (the official notice), `licence`, `attribution`, `retrieved` (when the producer read the source) |
| `jurisdictions` | yes | ISO 3166-1 alpha-2 codes, or `EU` |
| `language` | yes | BCP 47 tag of the free-text fields (the authority's language; ORF does not translate) |
| `published`, `updated` | `published` | YYYY-MM-DD. When the authority gives only a "last updated" date, producers use it for `published` and say so in their documentation. |
| `category` | yes | `vocab/categories.json`: food, drug, medical_device, cosmetic, vehicle, vehicle_equipment, child_restraint, tire, consumer_product, other |
| `title` | yes | The authority's headline |
| `summary` | yes | One plain sentence for speech (section 7) |
| `products` | yes | One or more recalled products (section 3) |
| `hazards` | yes (may be empty) | Hazard terms from `vocab/hazards.json`; an `undeclared_allergen` hazard MAY name its `allergen`, a `microbiological` hazard MAY name its `agent`; `source_value` keeps the authority's own code |
| `hazard_text` | no | The authority's description of the hazard |
| `severity` | yes | `level`: serious, moderate, low or unknown, mapped only from the authority's own classification (`vocab/severity.json`), with `source_value`. Producers MUST NOT infer severity from words in the text. |
| `actions` | yes (may be empty) | What the owner should do, from `vocab/actions.json`, most urgent first (section 5) |
| `remedies` | yes (may be empty) | What the owner gets: refund, replacement, repair, instructions_or_label, other, none |
| `instructions` | no | The authority's own instructions |
| `contact` | no | `text`, `phone`, `email`, `url` |
| `firms` | no | `name` and `role`: recalling_firm, manufacturer, importer, distributor, retailer |
| `incidents` | no | `text`, and `injuries` / `deaths` when the authority states numbers |
| `related` | no | ids of related ORF records (joint recalls, earlier versions) |

## 3. Products and affected units

A product has a `name`, the `brands` printed on it (empty when unbranded or unknown), optional `description`,
`source_category`, `gpc_brick` (GS1 GPC), `units` (counts per country), `sold` (where and when), `images`, and:

- `identification`: a list of **unit selectors**. Selectors are alternatives: a unit is affected if it matches any
  one of them.
- `scope`:
  - `all_units`: every unit of this product, from this brand, is affected.
  - `listed_units`: only units that match a selector are affected. `identification` MUST NOT be empty.
  - `unknown`: the source does not say clearly. Selectors MAY be present (for example identifiers read from free
    text), but they are examples, not a complete list.
- `identification_hint`: where the owner finds the identifier, in the authority's words ("The model number is on the
  manufacturer's label on the underside of the unit.").

Producers MUST use `listed_units` only when the identifiers come from structured fields, or from text in a form the
producer parsed completely (for example a model list or a model and serial table). When in doubt, producers MUST use
`unknown`.

### 3.1 Unit selectors

A selector is an object with one or more criteria and a `basis` (`structured`: from the authority's data fields;
`text`: parsed from its prose). Criteria are of two kinds:

**Identity** criteria say which variant of the product it is. If the owner can check any one of them and it
matches, the variant is identified:

| Criterion | Value |
|---|---|
| `models` | list of code matches (3.2) |
| `gtins` | GTIN-8, -12, -13 or -14, digits only |
| `udi_di` | medical device UDI device identifiers |
| `vehicle` | `make`, optional `model`, optional `years` (`from`, `to`, inclusive) |

**Restriction** criteria narrow the variant down to some units. Every restriction listed in a selector MUST hold:

| Criterion | Value |
|---|---|
| `lots` | list of code matches |
| `serials` | list of code matches |
| `manufactured` | date range |
| `date_mark` | date range with `kind`: best_before, use_by, expiry, other |

`note` keeps anything that does not fit, in the authority's words.

### 3.2 Code matches and dates

A code match is an exact code (`"H7131"`), a prefix (`{"prefix": "CANY"}`) or an inclusive range
(`{"from": "3014835626", "to": "3015507481"}`). Date ranges have `from` and/or `to`, each `YYYY`, `YYYY-MM` or
`YYYY-MM-DD`; a partial date covers its whole year or month.

## 4. Checking an owned item

An **owned item** is what an owner knows: any of `name`, `brand`, `category`, `model`, `gtin`, `udi_di`, `lot`,
`serial`, `manufactured`, `date_mark`, `vehicle` (`make`, `model`, `year`). A **checker** compares an item with a
record and returns one status, the reasons, and what to `ask` the owner next:

| Status | Meaning |
|---|---|
| `affected` | the item is one of the recalled units |
| `possibly_affected` | it may be; `ask` lists the details that would settle it, most useful first |
| `not_affected` | the recall is about this product, but the item's identifiers exclude it |
| `unrelated` | the recall is about something else |

The reference checker is `src/check.ts`; its behaviour on real records is fixed by `test/check.test.ts`. A
conforming checker MUST follow these rules:

1. **Comparing codes.** Codes are compared in upper case with everything except letters and digits removed
   (`"LTD-SM 23"` equals `"LTDSM23"`). GTINs and UDI-DIs are compared as 14 digits (left-padded with zeros).
   Numeric ranges compare as numbers; alphanumeric ranges compare character by character when all codes have the
   same length.
2. **Lots** match when one code contains the other and the shorter has at least 4 characters (lots are often
   printed with a prefix: `LOT L26/2194`).
3. **Models.** A model that the source wrote with the brand inside (`BRIDGESTONE R192`) also matches without the
   brand words. A listed model without digits is a family name and covers models that start with it (`SNUGRIDE`
   covers `SnugRide 35`). A model that only starts like a listed one, or that a listed one only starts like
   (`H71301` and `H7130`), is a partial match: the checker asks for the full model and MUST NOT answer `affected`.
4. **Dates.** An item date inside the range matches; outside, it does not; a less precise date that overlaps the
   edge of the range (the month of a window that ends mid-month) is partial.
5. **A selector** fails if any identity criterion the owner gave contradicts it and none matches, or if any
   restriction does not hold. It matches when an identity criterion matches (or it has none) and every restriction
   holds. Otherwise it is partial, and the missing or partial criteria are what to ask.
6. **Same product.** A GTIN or UDI-DI match identifies the product by itself. Otherwise the brand (from `brands`,
   the vehicle make, or the record's non-retailer `firms`, or written as a phrase in the product name) and the kind
   of product (a significant word shared by the owner's name for it and the product's name, description, category
   or the title) are compared. A different brand, a different kind, a different category or a different vehicle make
   or model is `unrelated`.
7. **Scope.** If a selector matches: `affected`. If one is partial: `possibly_affected`. If all fail: `not_affected`
   when the scope is `listed_units` and the product is confirmed (brand confirmed, or GTIN/UDI-DI matched),
   `unrelated` when the product is not confirmed, and `possibly_affected` when the scope is `unknown`. With no
   selectors: `affected` for `all_units`, `possibly_affected` for `unknown`.
8. **Confirmation.** An `affected` result without a GTIN or UDI-DI match requires a confirmed brand, and a confirmed
   kind of product or a matching identity criterion (model, vehicle); otherwise it becomes `possibly_affected` and
   the checker asks for the brand or the product name. A record
   that names no brand cannot rule out other brands: the result says so in its reasons.
9. **Several products.** The best status over the record's products decides (affected, then possibly_affected, then
   not_affected, then unrelated).

The rule a checker MUST never break: **`not_affected` only when the record lists the affected units completely and
the item is confirmed to be that product.**

## 5. Actions and remedies

`actions` are ordered by urgency; the order of `vocab/actions.json` is the default order (do not drive, park
outside, stop using, do not eat, keep away from children, see a doctor, dispose, return to the store, contact a
dealer, get the repair, contact the company, contact the retailer). The vocabulary follows what the EU General
Product Safety Regulation (Art. 36) requires a recall notice to say first, an invitation to stop using the product,
and the consumer actions RappelConso publishes. `remedies` follow GPSR Art. 37 (repair, replacement, refund) and the
CPSC remedy options.

## 6. Vocabularies

`vocab/*.json` hold every closed list: categories, hazards, allergens (marked `us_major` for the nine US major food
allergens and `eu_annex_ii` for the 14 of Regulation (EU) No 1169/2011), actions, remedies, severity, authorities.
Each term carries `source_values` (the codes authorities use, for mapping) and, where producers read prose,
`keywords` in English and French. They are data so that implementations in any language can share them.

## 7. The summary

`summary` MUST be one or two plain sentences, at most 400 characters, with no URL and no markup, so it can be read
aloud as is. It SHOULD say what the product is, why it is recalled, the first action and the remedy, e.g. "GoveeLife
and Govee Smart Electric Space Heaters are recalled because of a risk of fire and burns. Stop using them and contact
the company to get a refund." Producers MAY write it in the record's `language`; the reference implementation
writes English.

## 8. Provenance and licences

`source.licence` and `source.attribution` MUST be carried with the record wherever it is redistributed. The
reference values per authority are in `vocab/authorities.json`. ORF never changes the meaning of the official
notice; when a converter cannot map a value it keeps it in `source_value`, `note` or the free-text fields.

## 9. Privacy

An owned item says what is in someone's home. Checkers SHOULD run where the owner's data already is (on the device,
in the assistant's own service) against a copy of the records, rather than send inventories to a third party. ORF
records contain no personal data.

## 10. Versioning

`orf_version` follows MAJOR.MINOR. A minor version adds optional fields or vocabulary terms; a producer of 0.x MUST
NOT emit fields of a later version. Consumers SHOULD ignore records whose major version they do not know. 0.1 is a
draft: comments and counter-proposals are welcome (CONTRIBUTING.md).

## 11. Conformance

- A **producer** conforms if every record it emits is valid against the schema and it follows the scope rule of
  section 3.
- A **checker** conforms if it follows section 4. The cases in `test/check.test.ts` (built on real records from
  CPSC, NHTSA, FDA, Health Canada, EU Safety Gate and RappelConso) are the conformance suite for 0.1.
