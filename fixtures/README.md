# Fixtures

Real records from each source, saved unmodified on 2026-10-03 (the NHTSA files and the CPSC heater file a few
days earlier). Tests convert them and check the results, so every converter is tested against what the agencies
actually publish, quirks included. Licences and attribution: see NOTICE.

| Folder | What | How it was fetched |
|---|---|---|
| `cpsc/` | CPSC Recalls API records: the Govee heaters (models only in the prose), the DR mowers (a flattened model and serial table, and a retailer field copied from an unrelated recall: "Bowling alleys nationwide ... for about $5"), restraint kits with a model prefix, item numbers, numeric model lists, a notice without identifiers | `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-01-01&RecallDateEnd=2025-04-30` |
| `nhtsa/` | `recallsByVehicle` for a 2020 Camry (dates are day first: `04/11/2020`), and 21 lines of the bulk file FLAT_RCL (vehicles, equipment, tires, child seats) | `https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020`, `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip` |
| `openfda/` | Food (undeclared allergens, Listeria), drug and device enforcement reports | `https://api.fda.gov/{food,drug,device}/enforcement.json?search=...` |
| `health-canada/` | Seven rows of the open data file (consumer products, CFIA food, Transport Canada, a medical device, a drug) | `https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json` |
| `eu-safety-gate/` | Five notifications (cosmetics, sandals, a lighting chain with the brand "nincs", magnets, a soft toy) | `https://ec.europa.eu/safety-gate-alerts/public/api/notification/<id>?language=en` |
| `rappelconso/` | Food (use-by dates, lots, allergens) and non-food records, including a placeholder GTIN and free text in the lot field | `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-trie/records` |
| `uk-opss/` | Two GOV.UK content items (a recall with "All batches", a report with a model), a search result and the finder (which lists the official values of risk level, category and measure) | `https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall`, `https://www.gov.uk/api/content/product-safety-alerts-reports-recalls/...` |
