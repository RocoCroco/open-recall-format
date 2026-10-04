# A ProductRecall type for schema.org

A concrete proposal for [schemaorg/schemaorg#3229](https://github.com/schemaorg/schemaorg/issues/3229) ("Add an
object to represent product recalls", open since December 2022), based on the Open Recall Format and on the data
seven recall authorities publish today.

## Why schema.org needs it

- Recall notices are published as web pages by authorities (CPSC, FDA, NHTSA, Health Canada, the EU Safety Gate,
  RappelConso, UK OPSS ...) and by manufacturers and retailers. None of them can say in markup "this page is a recall
  of this product", so search engines, assistants and shopping sites cannot connect a product to its recall.
- Product pages cannot point to their recalls either. A marketplace listing a second-hand crib, or a retailer page
  for a recalled heater, has no way to state it.
- The issue lists the core: the product, who orders the recall, and whether it is voluntary or mandatory. Comments
  ask for alignment with GS1. This proposal covers that core, aligns with GS1 identifiers, and adds the three things
  owners need most: which units, what to do, and what they get.

## Proposal

### New type: `ProductRecall`

Subtype of `CreativeWork`: a recall notice is a published document (as the issue suggests), and `CreativeWork`
already gives `publisher`, `datePublished`, `dateModified`, `inLanguage`, `spatialCoverage`, `about`, `image`,
`url`, `identifier`.

| Property | Expected type | Description |
|---|---|---|
| `recalledProduct` (new) | `Product`, `ProductModel`, `ProductGroup`, `Vehicle` | The recalled product. Its `gtin`, `model`, `brand`, `productionDate` and `vehicleModelDate` (existing properties) say which variant. |
| `recallingOrganization` (new) | `Organization` | The firm that recalls the product (manufacturer, importer, retailer). The authority that publishes the notice is `publisher`. |
| `recallType` (new) | `RecallTypeEnumeration`: `VoluntaryRecall`, `MandatoryRecall` | Ordered by an authority or initiated by the firm (the issue's third property). |
| `hazard` (new) | `DefinedTerm` or `Text` | Why it is recalled: fire, choking, undeclared allergen ... A `DefinedTerm` can point to a shared vocabulary such as the ORF hazard list. |
| `affectedUnits` (new) | `Text` | Which units: lot codes, serial ranges, date codes, in words, when not all units are affected. |
| `consumerAction` (new) | `Text` or `DefinedTerm` (ordered with `ItemList` if needed) | What owners should do, first step first ("Stop using it"). |
| `recallRemedy` (new) | `RecallRemedyEnumeration`: `RefundRemedy`, `ReplacementRemedy`, `RepairRemedy`, `NewInstructionsRemedy` | What owners get. Mirrors Art. 37 of the EU General Product Safety Regulation and the CPSC remedy options. |

### New property on `Product`: `hasRecall`

Expected type `ProductRecall`; inverse of `recalledProduct`. Lets a product page, a listing for a used item or a
manual point to the recall that concerns it.

### Example: markup on a recall notice page

```json
{
  "@context": "https://schema.org",
  "@type": "ProductRecall",
  "name": "GoveeLife and Govee Smart Electric Space Heaters Recalled Due to Fire and Burn Hazards",
  "url": "https://www.cpsc.gov/Recalls/2025/GoveeLife-and-Govee-Smart-Electric-Space-Heaters-Recalled-Due-to-Fire-and-Burn-Hazards-Imported-by-Govee",
  "datePublished": "2024-11-07",
  "publisher": { "@type": "GovernmentOrganization", "name": "U.S. Consumer Product Safety Commission" },
  "recallingOrganization": { "@type": "Organization", "name": "Govee Moments Trading Limited" },
  "recallType": "https://schema.org/VoluntaryRecall",
  "spatialCoverage": { "@type": "Country", "name": "US" },
  "recalledProduct": [
    { "@type": "Product", "name": "Smart Electric Space Heater", "brand": { "@type": "Brand", "name": "Govee" }, "model": "H7131" },
    { "@type": "Product", "name": "Smart Electric Space Heater", "brand": { "@type": "Brand", "name": "Govee" }, "model": "H7130" }
  ],
  "hazard": [
    { "@type": "DefinedTerm", "name": "Fire", "termCode": "fire" },
    { "@type": "DefinedTerm", "name": "Burns", "termCode": "burns" }
  ],
  "consumerAction": "Stop using the heater and contact Govee for a refund.",
  "recallRemedy": "https://schema.org/RefundRemedy"
}
```

(Only two of the six models shown. CPSC recalls are announced jointly with the firm; whether a recall is voluntary
is the authority's statement, shown here as an example of the property.)

### Example: a product page pointing to its recall

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Govee Smart Space Heater H7131",
  "gtin": "...",
  "hasRecall": {
    "@type": "ProductRecall",
    "url": "https://www.cpsc.gov/Recalls/2025/GoveeLife-and-Govee-Smart-Electric-Space-Heaters-Recalled-Due-to-Fire-and-Burn-Hazards-Imported-by-Govee"
  }
}
```

## How it relates to the Open Recall Format

schema.org markup describes a page; ORF is a data format for recall feeds with the detail needed to check units
automatically (code ranges, prefixes, lot and date restrictions, vehicle years, scope). They are designed to map
onto each other:

| schema.org (proposed) | ORF |
|---|---|
| `ProductRecall` | a record |
| `recalledProduct` + `gtin` / `model` / `brand` | `products[]`, `identification[].gtins` / `models`, `brands` |
| `publisher` | `source.authority` |
| `recallingOrganization` | `firms[]` with role `recalling_firm` |
| `hazard` (`DefinedTerm`, `termCode`) | `hazards[].type` (ORF hazard vocabulary) |
| `affectedUnits` | `identification[]` (lots, serials, date marks) |
| `consumerAction` | `actions` |
| `recallRemedy` | `remedies` |
| `datePublished`, `spatialCoverage`, `inLanguage` | `published`, `jurisdictions`, `language` |

## Open questions for the community

1. `CreativeWork` (a notice) or `Event`/`Action` (the act of recalling)? This proposal follows the issue's
   suggestion; an `Action` view could come later.
2. Should `affectedUnits` be structured (ranges, prefixes) in schema.org, or stay text and leave structure to feeds
   such as ORF?
3. Should `hazard` reuse an external vocabulary (the EU Safety Gate risk types are the most widely used) through
   `DefinedTermSet`?
