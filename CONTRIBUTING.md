# Contributing

Thank you for helping recalls reach the people who own the products. Every kind of contribution is welcome:
comments on the specification, new sources, vocabulary terms, checker cases, bug reports with a real record.

## Ground rules

- **Real data first.** Every converter change comes with real records in `fixtures/` (unmodified, with their
  licence in `NOTICE` and their origin in `fixtures/README.md`) and tests that use them.
- **Never guess.** If a converter cannot be sure which units are affected, the record says `scope: "unknown"`.
  Placeholders and free text never become identifiers. Severity comes only from the authority.
- **The checker's one rule:** `not_affected` only when the record lists the affected units completely and the item
  is confirmed to be that product (spec section 4).
- **Keep vocabularies as data.** New terms go in `vocab/*.json` and in the schema enum together; a test fails if
  they drift apart.

## Development

```bash
npm install
npm run build
npm test
node scripts/check-control-chars.mjs   # guards against control characters in sources
npm run examples                       # regenerate examples/ after changing a converter
```

Node.js 20 or later. TypeScript in strict mode; small modules; comments explain why, not what.

## Adding a source

1. Save a handful of real records in `fixtures/<source>/`, including the awkward ones, and document where they
   came from.
2. Add `src/sources/<source>.ts` exporting a typed `from<Source>(...)` that returns `RecallRecord`s through
   `makeRecord`, and register it in `src/convert.ts` (and `src/fetch.ts` if the source has a public API).
3. Map the authority's codes in the `source_values` of the vocabularies, and add the authority with its licence to
   `vocab/authorities.json`.
4. Add a section to `spec/mappings.md` and tests to `test/converters.test.ts` (and `test/check.test.ts` when the
   source brings a new kind of identifier).

## Changing the format

Open an issue first with the problem, a real record that shows it, and the proposed change. Minor versions only
add optional fields or terms (spec section 10).

## Licences of contributions

By contributing you agree that code, schema and vocabulary contributions are licensed under Apache-2.0 and prose in
`spec/` and `docs/` under CC BY 4.0, as described in the README.
