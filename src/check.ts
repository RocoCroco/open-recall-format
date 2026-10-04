// The reference checker: is an owned item affected by a recall? Normative rules: spec section 6.
import { gtin14, normalizeCode, normalizeName } from './text.js';
import type { Category, CodeMatch, DateRange, Product, RecallRecord, UnitSelector, VehicleMatch } from './types.js';

/** What an owner knows about something they have. Every field is optional. */
export interface OwnedItem {
  /** What it is, in the owner's words: "space heater", "car seat". */
  name?: string;
  brand?: string;
  category?: Category;
  model?: string;
  gtin?: string;
  udi_di?: string;
  lot?: string;
  serial?: string;
  /** When it was made: YYYY, YYYY-MM or YYYY-MM-DD. */
  manufactured?: string;
  /** The best-before, use-by or expiry date printed on it: YYYY, YYYY-MM or YYYY-MM-DD. */
  date_mark?: string;
  vehicle?: { make: string; model?: string; year?: number };
}

/**
 * affected           the item is one of the recalled units
 * possibly_affected  it may be; `ask` lists what would settle it, most useful first
 * not_affected       the recall concerns this product, but the item's identifiers exclude it
 * unrelated          the recall is about something else
 */
export type CheckStatus = 'affected' | 'possibly_affected' | 'not_affected' | 'unrelated';

export type AskField =
  | 'name'
  | 'brand'
  | 'model'
  | 'gtin'
  | 'udi_di'
  | 'vehicle'
  | 'lot'
  | 'serial'
  | 'manufactured'
  | 'date_mark';

export interface CheckResult {
  status: CheckStatus;
  record_id: string;
  /** Index of the product in `record.products` that decided the result. */
  product?: number;
  reasons: string[];
  ask: AskField[];
  /** Where the owner can find the missing identifier, from the record. */
  hint?: string;
}

type Outcome = 'match' | 'partial' | 'mismatch' | 'missing';

const RANK: Record<CheckStatus, number> = { affected: 3, possibly_affected: 2, not_affected: 1, unrelated: 0 };

// ---- comparing values -------------------------------------------------------------------------------------------------

function compareCode(item: string, code: CodeMatch, kind: 'model' | 'lot' | 'serial'): Outcome {
  const value = normalizeCode(item);
  if (!value) return 'missing';
  if (typeof code === 'string') {
    const listed = normalizeCode(code);
    if (!listed) return 'mismatch';
    if (value === listed) return 'match';
    if (kind === 'lot' && Math.min(value.length, listed.length) >= 4 && (value.includes(listed) || listed.includes(value))) {
      return 'match'; // lot codes are often printed with a prefix: "LOT L26/2194" vs "L26/2194"
    }
    // A listed family name without digits ("SNUGRIDE") covers the models named after it ("SnugRide 35").
    if (kind === 'model' && !/\d/.test(listed) && listed.length >= 4 && value.startsWith(listed)) return 'match';
    if (kind === 'model' && value.length >= 3 && (value.startsWith(listed) || listed.startsWith(value))) {
      return 'partial'; // a variation or a code cut short: worth asking for the full number
    }
    return 'mismatch';
  }
  if ('prefix' in code) return value.startsWith(normalizeCode(code.prefix)) ? 'match' : 'mismatch';
  return inRange(value, normalizeCode(code.from), normalizeCode(code.to));
}

function inRange(value: string, from: string, to: string): Outcome {
  if (/^\d+$/.test(value) && /^\d+$/.test(from) && /^\d+$/.test(to)) {
    const v = BigInt(value);
    return v >= BigInt(from) && v <= BigInt(to) ? 'match' : 'mismatch';
  }
  // Alphanumeric ranges compare character by character when every code has the same length.
  if (value.length === from.length && value.length === to.length) {
    return value >= from && value <= to ? 'match' : 'mismatch';
  }
  return 'mismatch';
}

/** "BRIDGESTONE R192" with brand Bridgestone -> also "R192": sources often put the brand inside the model. */
function withoutBrand(code: CodeMatch, brands: string[]): CodeMatch[] {
  if (typeof code !== 'string') return [code];
  const brandWords = new Set(brands.flatMap((b) => normalizeName(b).split(' ')));
  const rest = normalizeName(code)
    .split(' ')
    .filter((w) => w && !brandWords.has(w))
    .join(' ');
  return rest && rest !== normalizeName(code) ? [code, rest] : [code];
}

function anyOf(
  item: string | undefined,
  codes: CodeMatch[] | undefined,
  kind: 'model' | 'lot' | 'serial',
  brands: string[] = [],
): Outcome {
  if (!codes) return 'missing';
  if (!item) return 'missing';
  const variants = kind === 'model' ? codes.flatMap((c) => withoutBrand(c, brands)) : codes;
  const outcomes = variants.map((c) => compareCode(item, c, kind));
  if (outcomes.includes('match')) return 'match';
  return outcomes.includes('partial') ? 'partial' : 'mismatch';
}

/** [first day, last day] covered by YYYY, YYYY-MM or YYYY-MM-DD. */
function interval(date: string): [string, string] | undefined {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date.trim());
  if (!m) return undefined;
  const [y, mo, d] = [m[1]!, m[2], m[3]];
  if (d) return [`${y}-${mo}-${d}`, `${y}-${mo}-${d}`];
  if (mo) {
    const last = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
    return [`${y}-${mo}-01`, `${y}-${mo}-${String(last).padStart(2, '0')}`];
  }
  return [`${y}-01-01`, `${y}-12-31`];
}

function compareDate(item: string | undefined, range: DateRange | undefined): Outcome {
  if (!range) return 'missing';
  if (!item) return 'missing';
  const it = interval(item);
  if (!it) return 'missing';
  const start = range.from ? interval(range.from)?.[0] : '0000-01-01';
  const end = range.to ? interval(range.to)?.[1] : '9999-12-31';
  if (!start || !end) return 'partial';
  if (it[0] >= start && it[1] <= end) return 'match';
  if (it[1] < start || it[0] > end) return 'mismatch';
  return 'partial'; // the owner's date is less precise than the recall's window
}

const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

function compareVehicle(item: OwnedItem['vehicle'], v: VehicleMatch): Outcome {
  if (!item) return 'missing';
  if (!sameName(item.make, v.make)) return 'mismatch';
  let outcome: Outcome = 'match';
  if (v.model) {
    if (!item.model) outcome = 'missing';
    else if (!sameName(item.model, v.model)) {
      const [a, b] = [normalizeName(item.model), normalizeName(v.model)];
      // "RAV4" and "RAV4 HYBRID": the same family, not proof.
      if (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `)) outcome = 'partial';
      else return 'mismatch';
    }
  }
  if (v.years) {
    if (item.year === undefined) return outcome === 'match' ? 'missing' : outcome;
    if (item.year < v.years.from || item.year > v.years.to) return 'mismatch';
  }
  return outcome;
}

// ---- products ---------------------------------------------------------------------------------------------------------

interface SelectorResult {
  outcome: 'yes' | 'partial' | 'no';
  ask: AskField[];
  /** Matched through a globally unique identifier (GTIN, UDI-DI). */
  unique: boolean;
  /** Matched through any identity criterion (model, GTIN, UDI-DI, vehicle). */
  identity: boolean;
  /** The GTIN or UDI-DI matched, even if a lot or date then ruled the unit out: it is this product. */
  sameProduct: boolean;
}

function evaluateSelector(s: UnitSelector, item: OwnedItem, brands: string[]): SelectorResult {
  const identities: [AskField, Outcome][] = [];
  if (s.models) identities.push(['model', anyOf(item.model, s.models, 'model', brands)]);
  if (s.gtins) {
    identities.push([
      'gtin',
      item.gtin ? (s.gtins.some((g) => gtin14(g) === gtin14(item.gtin!)) ? 'match' : 'mismatch') : 'missing',
    ]);
  }
  if (s.udi_di) {
    identities.push([
      'udi_di',
      item.udi_di ? (s.udi_di.some((u) => gtin14(u) === gtin14(item.udi_di!)) ? 'match' : 'mismatch') : 'missing',
    ]);
  }
  if (s.vehicle) identities.push(['vehicle', compareVehicle(item.vehicle, s.vehicle)]);

  const restrictions: [AskField, Outcome][] = [];
  if (s.lots) restrictions.push(['lot', anyOf(item.lot, s.lots, 'lot')]);
  if (s.serials) restrictions.push(['serial', anyOf(item.serial, s.serials, 'serial')]);
  if (s.manufactured) restrictions.push(['manufactured', compareDate(item.manufactured, s.manufactured)]);
  if (s.date_mark) restrictions.push(['date_mark', compareDate(item.date_mark, s.date_mark)]);

  const all = [...identities, ...restrictions];
  const sameProduct = identities.some(([f, o]) => o === 'match' && (f === 'gtin' || f === 'udi_di'));
  const no: SelectorResult = { outcome: 'no', ask: [], unique: false, identity: false, sameProduct };
  // Identity: any identifier the owner gave that contradicts the recall rules the selector out...
  if (identities.some(([, o]) => o === 'mismatch') && !identities.some(([, o]) => o === 'match')) return no;
  // ...and so does any restriction that does not hold.
  if (restrictions.some(([, o]) => o === 'mismatch')) return no;

  const ask: AskField[] = [];
  const identityMatch = identities.find(([, o]) => o === 'match');
  if (identities.length > 0 && !identityMatch) {
    const partial = identities.find(([, o]) => o === 'partial');
    ask.push(partial ? partial[0] : identities[0]![0]);
  }
  for (const [field, o] of restrictions) if (o !== 'match') ask.push(field);
  return {
    outcome: ask.length === 0 && all.length > 0 ? 'yes' : 'partial',
    ask,
    unique: identityMatch !== undefined && (identityMatch[0] === 'gtin' || identityMatch[0] === 'udi_di'),
    identity: identityMatch !== undefined,
    sameProduct,
  };
}

const STOP = new Set(
  'the and with for from of a an in on by to at or its their this that these those recalled recall recalls product products set pack kit due sold brand new model models'.split(
    ' ',
  ),
);

/** "heaters" -> "heater", "tires" -> "tire", "batteries" -> "battery", "boxes" -> "box", "glass" stays. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Significant words, lower case, accents removed, simple plurals folded. */
function words(text: string): Set<string> {
  return new Set(
    normalizeName(text)
      .split(' ')
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
      .map(singular),
  );
}

/** The brand phrase occurs in `text` as whole words. */
function phraseIn(phrase: string, text: string): boolean {
  const p = normalizeName(phrase);
  return p.length > 0 && ` ${normalizeName(text)} `.includes(` ${p} `);
}

function brandMatches(itemBrand: string, product: Product, record: RecallRecord): 'yes' | 'no' | 'unknown' {
  const wanted = normalizeName(itemBrand);
  const candidates = [
    ...product.brands,
    ...(product.identification.flatMap((s) => (s.vehicle ? [s.vehicle.make] : []))),
    ...(record.firms ?? []).filter((f) => f.role !== 'retailer').map((f) => f.name),
  ].map(normalizeName);
  for (const c of candidates) {
    if (!c) continue;
    if (c === wanted || c.startsWith(`${wanted} `) || wanted.startsWith(`${c} `)) return 'yes';
  }
  if (phraseIn(itemBrand, `${product.name} ${product.description ?? ''} ${record.title}`)) return 'yes';
  return product.brands.length === 0 ? 'unknown' : 'no';
}

function evaluateProduct(product: Product, record: RecallRecord, item: OwnedItem): Omit<CheckResult, 'record_id'> {
  const reasons: string[] = [];
  const hint = product.identification_hint;
  const selectors = product.identification.map((s) => evaluateSelector(s, item, product.brands));
  const uniqueHit = selectors.some((r) => r.outcome === 'yes' && r.unique);

  if (!uniqueHit) {
    if (item.category && item.category !== record.category) {
      return { status: 'unrelated', reasons: [`The recall is about ${record.category}, not ${item.category}.`], ask: [] };
    }
    const vehicleRules = product.identification.flatMap((s) => (s.vehicle ? [s.vehicle] : []));
    if (item.vehicle && vehicleRules.length === 0) {
      return { status: 'unrelated', reasons: ['The recall is not about a vehicle.'], ask: [] };
    }
    // A different make or model is a different product, whatever the year.
    if (item.vehicle && vehicleRules.every((v) => compareVehicle({ ...item.vehicle!, year: undefined }, { ...v, years: undefined }) === 'mismatch')) {
      return { status: 'unrelated', reasons: [`The recall covers ${product.name}.`], ask: [] };
    }
  }

  // Is this the same kind of product from the same brand?
  let brand: 'yes' | 'no' | 'unknown' = 'unknown';
  if (item.brand) brand = brandMatches(item.brand, product, record);
  else if (item.vehicle) brand = brandMatches(item.vehicle.make, product, record);
  if (!uniqueHit && brand === 'no') {
    return { status: 'unrelated', reasons: [`The recall names ${product.brands.join(', ')}, not ${item.brand ?? item.vehicle?.make}.`], ask: [] };
  }

  let sameKind: 'yes' | 'no' | 'unknown' = 'unknown';
  if (item.vehicle) sameKind = 'yes';
  else if (item.name) {
    const productWords = words(`${product.name} ${product.description ?? ''} ${product.source_category ?? ''} ${record.title}`);
    sameKind = [...words(item.name)].some((w) => productWords.has(w)) ? 'yes' : 'no';
  }
  const identityHit = selectors.some((r) => r.outcome === 'yes' && r.identity);
  if (!uniqueHit && sameKind === 'no' && !identityHit) {
    return { status: 'unrelated', reasons: [`The recalled product is "${product.name}".`], ask: [] };
  }

  // Which units?
  let status: CheckStatus;
  let ask: AskField[] = [];
  if (selectors.some((r) => r.outcome === 'yes')) {
    status = 'affected';
    reasons.push('Its identifiers match the recalled units.');
  } else if (selectors.some((r) => r.outcome === 'partial')) {
    status = 'possibly_affected';
    ask = [...new Set(selectors.filter((r) => r.outcome === 'partial').flatMap((r) => r.ask))];
    reasons.push('Some recalled units match; one more detail settles it.');
  } else if (selectors.length > 0) {
    if (product.scope === 'listed_units') {
      // "Not affected" says the recall is about this product; without a confirmed brand it is just another product.
      return brand === 'yes' || selectors.some((r) => r.sameProduct)
        ? { status: 'not_affected', reasons: ['The recall lists specific units and this item is not one of them.'], ask: [] }
        : { status: 'unrelated', reasons: ['None of the recalled units match this item.'], ask: [] };
    }
    status = 'possibly_affected';
    reasons.push('The listed units do not include this item, but the source may not list every affected unit.');
  } else if (product.scope === 'all_units') {
    status = 'affected';
    reasons.push('Every unit of this product is recalled.');
  } else {
    status = 'possibly_affected';
    reasons.push('The recall does not say which units are affected; compare with the notice.');
  }

  // Without a confirmed brand and kind of product, a match is only possible (a GTIN or UDI-DI is proof on its own).
  if (status === 'affected' && !uniqueHit) {
    if (brand !== 'yes') {
      status = 'possibly_affected';
      if (product.brands.length > 0) ask.unshift('brand');
      reasons.push(product.brands.length > 0 ? 'The brand is not confirmed.' : 'The recall does not name a brand.');
    }
    if (sameKind !== 'yes' && !identityHit) {
      status = 'possibly_affected';
      ask.unshift('name');
    }
  } else if (status === 'possibly_affected' && brand === 'unknown' && product.brands.length === 0) {
    reasons.push('The recall does not name a brand, so other brands cannot be ruled out.');
  }
  return { status, reasons, ask: [...new Set(ask)], hint: status === 'possibly_affected' ? hint : undefined };
}

/** Checks one item against one recall; the best-matching product decides. */
export function checkItem(record: RecallRecord, item: OwnedItem): CheckResult {
  let best: CheckResult | undefined;
  record.products.forEach((product, index) => {
    const result = { record_id: record.id, product: index, ...evaluateProduct(product, record, item) };
    if (!best || RANK[result.status] > RANK[best.status]) best = result;
  });
  return best ?? { status: 'unrelated', record_id: record.id, reasons: ['The record has no products.'], ask: [] };
}

/** Checks one item against many recalls; returns every result that is not `unrelated`, most serious first. */
export function checkRecords(records: Iterable<RecallRecord>, item: OwnedItem): CheckResult[] {
  const out: CheckResult[] = [];
  for (const record of records) {
    const result = checkItem(record, item);
    if (result.status !== 'unrelated') out.push(result);
  }
  return out.sort((a, b) => RANK[b.status] - RANK[a.status]);
}
