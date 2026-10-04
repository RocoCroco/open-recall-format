# Mappings

How each source's fields become ORF fields (what the converters in `src/sources/` do), and how ORF relates to the
existing standards. Read 2026-10-03.

## Sources

### U.S. CPSC (Recalls API)

| CPSC | ORF |
|---|---|
| `RecallNumber` | `source.id`, `id` |
| `RecallDate`, `LastPublishDate` | `published`, `updated` |
| `Title` | `title`; recalling firm from "X Recalls ..." -> `firms[]` |
| `Products[].Name`, `.Type`, `.NumberOfUnits` | `products[].name`, `source_category`, `units` ("About 512,500 (In addition, about 48,600 in Canada)" -> US and CA counts) |
| `Products[].Model` | `identification[].models` (structured). Empty in all 134 recalls of Jan-Apr 2025, so: |
| `Description` | model codes in "model number(s)" clauses, quoted SKUs, item numbers, prefixes ("beginning with"), model and serial tables, production windows ("manufactured between"), UPCs; brands quoted on labels; `identification_hint` from sentences that say where a code is printed |
| `ProductUPCs[].UPC` | `identification[].gtins` |
| `Hazards[].Name` | `hazard_text`, `hazards` (keywords) |
| `Remedies[].Name` | `instructions`, `actions` (keywords) |
| `RemedyOptions[].Option` | `remedies` (Refund, Replace, Repair, New Instructions, Label) |
| `Manufacturers`, `Importers`, `Distributors` | `firms[]` |
| `Retailers[].Name` | `products[].sold` (where, from-to month, price). CPSC data errors are kept as published. |
| `Images[]` | `products[].images` |
| `ConsumerContact` | `contact` (text, phone, email, the recall page among the links) |
| `Injuries[].Name` | `incidents.text` |
| (none) | `severity.level` = unknown: CPSC does not classify |

Scope: `listed_units` when identifiers were found and no model number in a model clause was left unread;
`all_units` when the notice names no identifiers and no subset ("certain", "some", "model", "lot" ...);
otherwise `unknown`.

### U.S. NHTSA

| NHTSA | ORF |
|---|---|
| `NHTSACampaignNumber` / FLAT_RCL `CAMPNO` | `source.id` |
| `ReportReceivedDate` (API, **day first**: `28/05/2020`) / `RCDATE` (YYYYMMDD) | `published` |
| `Make`, `Model`, `ModelYear` (one result per year) | `identification[].vehicle` with year ranges, one product per make and model |
| FLAT_RCL `RCLTYPECD` V / E / T / C | `category` vehicle / vehicle_equipment / tire / child_restraint |
| FLAT_RCL `BGMAN`, `ENDMAN` | `identification[].manufactured` |
| FLAT_RCL `POTAFF` | `products[].units` |
| `Component` | `products[].source_category`, `title` |
| `Summary`/`DESC_DEFECT`, `Consequence` | `hazard_text`, `hazards` |
| `Remedy`/`CORRECTIVE_ACTION` | `instructions`, `actions`, `remedies` |
| `parkIt`, `parkOutSide` | `actions` do_not_drive / park_outside, `severity` serious |
| `Notes` | `contact` |

### U.S. FDA (openFDA enforcement: food, drug, device)

| openFDA | ORF |
|---|---|
| `event_id` (records grouped by event) | `source.id`; one product per `recall_number` |
| `report_date` | `published` |
| `product_type` | `category` (Food, Drugs, Devices) |
| `classification` | `severity` (Class I serious, II moderate, III low) |
| `product_description` | `products[].name` (up to the net weight, UPC or strength), `description`, brands written "X brand", GTINs and UDI-DIs |
| `openfda.brand_name` | `products[].brands` |
| `code_info`, `more_code_info` | lots, date marks (best by, use by, exp), serial ranges, model numbers; the full text in `note` |
| `reason_for_recall` | `hazards` (allergens, organisms), `hazard_text` |
| `recalling_firm` | `firms[]` |
| `distribution_pattern` | `products[].sold.where` |

Scope: always `unknown`, because `code_info` is free text.

### Canada, Recalls and Safety Alerts (open data file)

| Field | ORF |
|---|---|
| `NID`, `URL` | `source.id`, `source.url` |
| `Organization` | `source.agency` (CFIA, TC, HC) and `category` |
| `Product` | `products[].name`; "X recalled by MAKER" (Transport Canada) -> brand |
| `Title` | `title`; "X brand Y" -> brands |
| `Issue` | `hazard_text`, `hazards` |
| `Recall class` | `severity` (Type I / Class 1 serious ...) |
| `What you should do` (HTML) | `instructions`, `actions`, `remedies`, `contact` |
| `Last updated` | `published` and `updated` (the file has no publication date) |

Scope: always `unknown` (the file has no identifiers).

### EU Safety Gate

| Safety Gate | ORF |
|---|---|
| `reference` | `source.id` (e.g. `SR/02783/26`) |
| `id` | `source.url` `.../alertDetail/<id>`, image addresses |
| `country.key` | `source.agency` (notifying country) |
| `notificationType.code` | `severity` (A12, serious risk) |
| `product.versions[EN].name/description`, `nameSpecific` | `products[].name`, `description` |
| `product.brands[]` | `brands` (placeholders such as "nincs", "sans marque" dropped) |
| `product.modelTypes[]`, `barcodes[]`, `batchNumbers[]` | `identification` models, gtins, lots (structured) |
| `product.productCategory.key` | `category`, `source_category` |
| `risk.riskType[].key` | `hazards` (source_value kept) |
| `risk.versions[EN]` | `hazard_text` |
| `measureTaken.measures[]` | `instructions`; recall from consumers -> stop_using |
| `measureTaken.companyRecalls[].link` | `contact.url` |

### France, RappelConso (v2)

| RappelConso | ORF |
|---|---|
| `numero_fiche` | `source.id` (rows grouped by notice) |
| `identification_produits` (`GTIN$lot$date kind$from$to`, entries joined by `|`) | one selector per entry: `gtins`, `lots` ("n° lot : 123", "26265 et 26266"; "tous les lots" means none), `date_mark` (date limite de consommation = use_by, date de durabilité minimale = best_before) |
| `marque_produit`, `libelle`, `modeles_ou_references` | `brands`, `name`, `description` |
| `categorie_produit` | `category` |
| `motif_rappel`, `risques_encourus` | `hazards` (French keywords), `hazard_text` |
| `conduites_a_tenir_par_le_consommateur` | `actions` (six fixed values) |
| `modalites_de_compensation` | `remedies` (remboursement, echange, réparation, autre) |
| `distributeurs`, `zone_geographique_de_vente`, commercialisation dates | `products[].sold` |
| `numero_contact`, `informations_complementaires_publiques` | `contact` |

Scope: `listed_units`, unless a GTIN is a placeholder or the lot field holds free text or sizes, then `unknown`.

### UK OPSS (GOV.UK)

| GOV.UK | ORF |
|---|---|
| `base_path` | `source.url`; the reference at its end (`2609-0229`) is `source.id` |
| `details.metadata.product_risk_level` | `severity` (serious, high -> serious; medium -> moderate; low) |
| `details.metadata.product_measure_type` | `actions`, `remedies` |
| `details.metadata.product_category` | `category` |
| body summary ("Product:", "Hazard:", "Corrective action:") | `products[].name`, `hazard_text`, `instructions` |
| body table (Brand, Model, Batches, Barcode, Type, Product Description) | `brands`, `identification`, `source_category`, `description`; "(All batches)" means no lot restriction |

## Standards

### GS1 Product Recall (XML, B2B)

ORF is the consumer-side companion of the GS1 messages; where both describe the same thing, ORF uses GS1 keys.

| GS1 Product Recall Notification element | ORF |
|---|---|
| `gtin` | `identification[].gtins` |
| `brandName`, `tradeItemName` | `brands`, `name` |
| `gpcCategoryCode` | `gpc_brick` |
| `productRecallReasonCode`, `productRecallReasonDescription`, `explanationForProductRecall` | `hazards`, `hazard_text` |
| `incidentRiskLevelCode` | `severity` |
| `consumerInstructions` | `instructions`, `actions` |
| `consumerContact` | `contact` |
| `countryOfOrigin` | (description) |
| batch/lot and serial details | `lots`, `serials` |

Element names from the GS1 XML 3.6 element guide published by GS1 Germany. GS1 messages address trading partners
(which shipments to pull); ORF addresses owners (is the one in my home affected, and what do I do).

### EU General Product Safety Regulation, recall notice (Art. 36, template in Implementing Regulation (EU) 2024/1435)

| Notice element | ORF |
|---|---|
| Heading "Product Safety Recall" | (implied by the record) |
| Product description, images, name, brand, identification numbers, place and time of sale | `products[].name`, `images`, `brands`, `identification`, `sold` |
| Clear description of the risk, without words that play it down | `hazards`, `hazard_text`, `summary` |
| Procedure for consumers, beginning with an invitation to stop using the product | `actions` (ordered; stop_using first) |
| Remedies available (Art. 37: repair, replacement, refund) | `remedies` |

### schema.org

There is no recall type in schema.org (issue #3229, open since December 2022). The JSON-LD context
(`schema/orf-0.1.context.jsonld`) maps ORF fields to existing schema.org terms where they fit (`name`, `brand`,
`gtin`, `model`, `image`, `datePublished`, `productionDate`, `telephone` ...) and to the `urn:open-recall-format`
namespace for the rest. A concrete proposal for schema.org is in `docs/schema-org-proposal.md`.
