// Helpers that turn recall prose into data. Each one is conservative: better nothing than a wrong value.
import type { CodeMatch, DateRange, UnitCount } from './types.js';

// ---- cleaning -------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Plain text from HTML: tags become spaces, entities are decoded, whitespace is collapsed. */
export function stripHtml(html: string): string {
  return clean(decodeEntities(html.replace(/<(br|\/p|\/li|\/tr|\/h\d)[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ')));
}

/** Collapses whitespace (including non-breaking spaces) and trims. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/[\s ]+/g, ' ').trim();
}

/** Sentences, split at ". ", "! ", "? " (and at ".X" when a period was glued to the next sentence). */
export function sentences(text: string): string[] {
  return clean(text)
    .replace(/([a-z])\.([A-Z])/g, '$1. $2')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- dates ----------------------------------------------------------------------------------------------------------

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * YYYY-MM-DD from `2024-11-07T00:00:00`, `20240614`, or a slash date in the given order (NHTSA's API writes
 * `28/05/2020`, day first; openFDA uses YYYYMMDD). Returns '' when the value is not a real date.
 */
export function isoDate(value: string | null | undefined, slashOrder: 'dmy' | 'mdy' = 'dmy'): string {
  const v = (value ?? '').trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) {
    const [a, b] = [Number(match[1]), Number(match[2])];
    y = Number(match[3]);
    [d, m] = slashOrder === 'dmy' ? [a, b] : [b, a];
  } else {
    return '';
  }
  return validDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : '';
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december)';
const PROSE_DATE = String.raw`${MONTH}\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})`;
const PROSE_RANGE = new RegExp(
  String.raw`\b(?:between|from)\s+${PROSE_DATE}\s*,?\s*(?:and|through|to|until|-)\s+${PROSE_DATE}`,
  'gi',
);

/**
 * A manufacturing window from prose: "manufactured between April 1, 2024, and August 20, 2024". Only ranges that a
 * manufacturing word introduces count (so sale periods are not taken for production dates). Month-only dates cover
 * the whole month.
 */
export function manufacturedRange(text: string): DateRange | undefined {
  for (const m of text.matchAll(PROSE_RANGE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
    if (!/\b(manufactured|made|produced|built|production|manufacture|manufacturing)\b[^.]*$/i.test(before)) continue;
    const month = (name: string | undefined) => MONTHS.indexOf((name ?? '').toLowerCase()) + 1;
    const [m1, d1, y1, m2, d2, y2] = [month(m[1]), m[2], Number(m[3]), month(m[4]), m[5], Number(m[6])];
    return {
      from: `${y1}-${pad(m1)}-${pad(d1 ? Number(d1) : 1)}`,
      to: `${y2}-${pad(m2)}-${pad(d2 ? Number(d2) : lastDay(y2, m2))}`,
    };
  }
  return undefined;
}

/** "from May 2024 through January 2025" -> { from: '2024-05', to: '2025-01' } (sale periods, month precision). */
export function monthRange(text: string): DateRange | undefined {
  const m = new RegExp(
    String.raw`\b(?:from|between)\s+${MONTH}\s+(\d{4})\s+(?:through|to|and|until)\s+${MONTH}\s+(\d{4})`,
    'i',
  ).exec(text);
  if (!m) return undefined;
  const month = (name: string | undefined) => MONTHS.indexOf((name ?? '').toLowerCase()) + 1;
  return { from: `${m[2]}-${pad(month(m[1]))}`, to: `${m[4]}-${pad(month(m[3]))}` };
}

// ---- codes ----------------------------------------------------------------------------------------------------------

/** Uppercase letters and digits only: "LTD-SM 23" -> "LTDSM23". Used to compare model, lot and serial codes. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const hasDigit = (s: string) => /\d/.test(s);
const hasLetter = (s: string) => /[A-Za-z]/.test(s);

/** Mixed letters and digits, no spaces: "H7131", "LDQMFJ8D-BK", "601-1004" is not (no letter). */
export function looksLikeModelCode(token: string): boolean {
  return token.length >= 3 && hasDigit(token) && hasLetter(token) && !/\s/.test(token);
}

/**
 * Model codes named in clauses about models: "Model Numbers H7130 (including the H7130101 variation), H7131" and
 * "model number DXH70CFAVX". A code needs a digit and a letter, so years and quantities are never taken.
 */
export function modelCodes(text: string): string[] {
  const found = new Set<string>();
  const clauses = text.match(/\bmodels?(?:\s+(?:numbers?|nos?\.?|#))?\b[^.;]*/gi) ?? [];
  for (const clause of clauses) {
    for (const token of clause.match(/\b[A-Z0-9][A-Z0-9-]{2,}\b/g) ?? []) {
      if (looksLikeModelCode(token)) found.add(token);
    }
  }
  return [...found];
}

/** Codes in quotes in sentences about models or SKUs: `SKU "LDQMFJ8D-BR," or "LDQMFJ8D-BK"`. */
export function quotedCodes(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of sentences(text)) {
    if (!/\b(sku|skus|model|models|item|items|style|part)\b/i.test(sentence)) continue;
    for (const m of sentence.matchAll(/["“]([^"”]{2,30})["”]/g)) {
      const value = m[1]?.trim().replace(/[,.;:]+$/, '');
      if (value && looksLikeModelCode(value)) found.add(value);
    }
  }
  return [...found];
}

/** Prefixes: "model numbers beginning with 310", `a model number beginning with "CANY"`. */
export function modelPrefixes(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\bmodel(?:\s+(?:numbers?|nos?\.?))?\s+(?:beginning|starting)\s+with\s+["“]?([A-Z0-9-]{2,})/gi;
  for (const m of text.matchAll(pattern)) {
    const prefix = m[1]?.toUpperCase();
    if (prefix) found.add(prefix);
  }
  return [...found];
}

export interface SerialRow {
  model: string;
  serials: CodeMatch;
}

/**
 * Model/serial tables flattened into prose by the source, e.g.
 * "Model Description Serial No. Range TB21044BEN DR BRUSH MOWER ... 3014835626 to 3015507481 TB23244BEN ...".
 * Each range is paired with the first model code after the previous range; rows without a known model are skipped.
 */
export function serialTable(text: string, knownModels: string[]): SerialRow[] {
  if (!/\bserial/i.test(text)) return [];
  const known = new Set(knownModels.map(normalizeCode));
  const rows: SerialRow[] = [];
  const range = /\b([A-Z0-9]*\d{4,})\s+(?:to|through|-|–)\s+([A-Z0-9]*\d{4,})\b/g;
  let start = 0;
  for (const m of text.matchAll(range)) {
    const segment = text.slice(start, m.index);
    start = (m.index ?? 0) + m[0].length;
    const tokens = segment.match(/\b[A-Z0-9][A-Z0-9-]{2,}\b/g) ?? [];
    // A model named elsewhere in the text, else the first long letters-and-digits code of the row.
    const model =
      tokens.find((t) => known.has(normalizeCode(t))) ?? tokens.find((t) => looksLikeModelCode(t) && t.length >= 6);
    if (model && m[1] && m[2]) rows.push({ model, serials: { from: m[1], to: m[2] } });
  }
  return rows;
}

/** Serial ranges anywhere: "Serial No. 1000 to 1690", "serial numbers 0001 through 1500". */
export function serialRanges(text: string): CodeMatch[] {
  const out: CodeMatch[] = [];
  const re = /\bserial\s*(?:numbers?|nos?\.?|#)?\s*:?\s*([A-Z0-9]*\d{3,})\s+(?:to|through|-|–)\s+([A-Z0-9]*\d{3,})/gi;
  for (const m of text.matchAll(re)) if (m[1] && m[2]) out.push({ from: m[1], to: m[2] });
  return out;
}

/** GTIN/UPC/EAN digits named in the text: "UPC 0 12345 67890 5", "UPC: 089301008588", "EAN 8710124155013". */
export function gtinsInText(text: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:UPC|UPCs|GTIN|EAN|barcode|bar code|UDI-DI)\s*(?:codes?|numbers?|#|no\.?)?\s*:?\s*((?:\d[\d\s-]{6,20}\d)(?:\s*(?:,|and|or)\s*\d[\d\s-]{6,20}\d)*)/gi;
  for (const m of text.matchAll(re)) {
    for (const part of (m[1] ?? '').split(/\s*(?:,|and|or)\s*/)) {
      const digits = part.replace(/[\s-]/g, '');
      if (/^(\d{8}|\d{12,14})$/.test(digits)) found.add(digits);
    }
  }
  return [...found];
}

/** UDI device identifiers: "UDI-DI: 00802526559044, 00802526578014". */
export function udiDis(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\bUDI(?:-DI)?\s*:?\s*((?:\(01\))?\d{14}(?:\s*,\s*(?:\(01\))?\d{14})*)/gi)) {
    for (const part of (m[1] ?? '').split(',')) {
      const digits = part.replace(/\(01\)/, '').trim();
      if (/^\d{14}$/.test(digits)) found.add(digits);
    }
  }
  return [...found];
}

/** GTIN compared as 14 digits (UPC-A 12 digits and EAN-13 are the same number with leading zeros). */
export function gtin14(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 14 ? digits.padStart(14, '0') : digits;
}

// ---- brands and firms -----------------------------------------------------------------------------------------------

const CORPORATE = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|gmbh|s\.?a\.?s?|plc|pty|bv|ag|lp|llp)\b\.?/gi;

/** Lower case, accents removed, corporate suffixes and punctuation dropped: "Govee, Inc." -> "govee". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CORPORATE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Verbs that headlines put between the firm and "Recall": "IKEA Reannounces Recall", "Acme Expands Recall".
const HEADLINE_VERBS =
  /\s+(re-?announces?|announces?|expands?|issues?|voluntarily|is|has|to|in|with|and|amends?|updates?)$/i;

/** The recalling firm from a CPSC-style headline: "Enerco Recalls DEWALT Heaters Due to ..." -> "Enerco". */
export function firmFromTitle(title: string): string {
  const m = /^(.+?)\s+Recalls?\b/i.exec(title.trim());
  let firm = (m?.[1] ?? '').split(',').at(-1)?.trim() ?? '';
  while (HEADLINE_VERBS.test(firm)) firm = firm.replace(HEADLINE_VERBS, '').trim();
  return firm.split(/\s+/).length > 5 ? '' : firm;
}

/** Brand names quoted in sentences about markings: `"GoveeLife" or "Govee" is printed on the front`. */
export function quotedBrands(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of sentences(text)) {
    if (!/\b(printed|label|labeled|labelled|branded|brand|logo|engraved|stamped|embossed|molded|moulded|says|reads)\b/i.test(sentence)) {
      continue;
    }
    for (const m of sentence.matchAll(/["“]([A-Z][^"”]{0,30})["”]/g)) {
      const value = m[1]?.trim().replace(/[,.;:]+$/, '');
      if (value && !looksLikeModelCode(value) && !/^[A-Z ]+:/.test(value)) found.add(value);
    }
  }
  return [...found];
}

/** "Smarter Snacks brand Vegan Protein Puff" -> ["Smarter Snacks"]; "Dorsey brand, MVP brand, ... Onions" -> all. */
export function brandsBeforeWordBrand(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|,\s*|\band\s+)([A-Z0-9][\w'’&.-]*(?:\s+[A-Z0-9][\w'’&.-]*){0,3})\s+brand\b/g)) {
    const brand = m[1]?.trim();
    if (brand && !/^(various|multiple|several|certain|the|no)$/i.test(brand)) found.add(brand);
  }
  return [...found];
}

// ---- quantities and contacts ----------------------------------------------------------------------------------------

const COUNTRY_WORDS: Record<string, string> = { canada: 'CA', mexico: 'MX', 'united states': 'US', 'the u.s.': 'US' };

/** "About 512,500 (In addition, about 48,600 in Canada)" -> US 512500 + CA 48600 (the first count is the source's country). */
export function unitCounts(text: string, homeCountry: string): UnitCount[] {
  const out: UnitCount[] = [];
  const re = /\b(about|approximately|nearly|more than|over)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\s+(?:units?|items?|pieces?))?(?:\s+(?:were\s+sold\s+)?in\s+(Canada|Mexico|the U\.S\.|United States))?/gi;
  for (const m of text.matchAll(re)) {
    const count = Number((m[2] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(count) || count === 0) continue;
    const country = m[3] ? COUNTRY_WORDS[m[3].toLowerCase()] : out.length === 0 ? homeCountry : undefined;
    if (!country) continue;
    out.push({ count, approximate: Boolean(m[1]), country });
  }
  return out;
}

/** The first phone number: "833-772-5360", "1-888-462-4743", "(800) 555-1212". */
export function phoneNumber(text: string): string | undefined {
  const m = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/.exec(text);
  return m ? `+1-${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function firstUrl(text: string): string | undefined {
  const m = /\bhttps?:\/\/[^\s"'<>),]+/i.exec(text);
  return m?.[0].replace(/[.;:]+$/, '');
}

export function firstEmail(text: string): string | undefined {
  return /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/.exec(text)?.[0];
}

/** Sentences that tell the owner where to find an identifier ("The model number is located on the hang tag."). */
export function identificationHint(text: string): string | undefined {
  const hints = sentences(text).filter(
    (s) =>
      /\b(model|serial|lot|batch|date code|upc|sku|item number|manufacture date|production date)\b/i.test(s) &&
      /\b(located|printed|found|stamped|listed|molded|moulded|engraved|affixed|appears|on the (?:label|tag|sticker|bottom|back|underside|side))\b/i.test(
        s,
      ),
  );
  return hints.length > 0 ? hints.slice(0, 2).join(' ') : undefined;
}
