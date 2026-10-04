# Changelog

## 0.1.0 (2026-10-03)

First public draft.

- Specification 0.1: records, products, unit selectors (identity and restriction criteria), scope, the checking
  rules, vocabularies, provenance.
- JSON Schema 2020-12 and a JSON-LD context mapped to schema.org.
- Vocabularies: categories, hazards, allergens (US major nine, EU Annex II), actions, remedies, severity,
  authorities with licences.
- Converters: U.S. CPSC, U.S. NHTSA (recallsByVehicle API and FLAT_RCL bulk file), U.S. FDA (openFDA food, drug,
  device), Canada Recalls and Safety Alerts, EU Safety Gate, France RappelConso v2, UK OPSS.
- Reference checker and the `orf` command (convert, fetch, validate, check).
- A proposal for a schema.org `ProductRecall` type (docs/schema-org-proposal.md).
