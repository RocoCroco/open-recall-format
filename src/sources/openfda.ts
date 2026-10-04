// U.S. FDA enforcement reports (openFDA food, drug and device endpoints) -> ORF. https://open.fda.gov/apis/
import { actionsInText, hazardsInText, unique } from '../describe.js';
import { makeRecord } from '../record.js';
import {
  brandsBeforeWordBrand,
  clean,
  gtinsInText,
  isoDate,
  modelCodes,
  serialRanges,
  udiDis,
} from '../text.js';
import type { Category, CodeMatch, DateMarkKind, Product, RecallRecord, UnitSelector } from '../types.js';
import { CATEGORIES, SEVERITY, termForSourceValue } from '../vocab.js';

/** The fields of an openFDA enforcement result this converter reads. */
export interface OpenFdaEnforcement {
  recall_number: string;
  event_id?: string;
  status?: string;
  classification?: string;
  product_type?: string;
  product_description?: string;
  code_info?: string;
  more_code_info?: string | null;
  reason_for_recall?: string;
  recalling_firm?: string;
  distribution_pattern?: string;
  recall_initiation_date?: string;
  report_date?: string;
  country?: string;
  openfda?: { brand_name?: string[] };
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "03/15/2026" (US order), "12/2025", "2026-01-31", "Jan 31, 2026", "January 2026" -> YYYY[-MM[-DD]]. */
function usDate(text: string): string | undefined {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDate(`${String(m[1]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${year}`, 'mdy') || undefined;
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{4})[-.](\d{2})[-.](\d{2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return isoDate(`${m[1]}-${m[2]}-${m[3]}`) || undefined;
  m = /^(\d{1,2})\s+(\d{1,2})\s+(\d{4})$/.exec(text); // "05 16 2027"
  if (m) return isoDate(`${m[1]!.padStart(2, '0')}/${m[2]!.padStart(2, '0')}/${m[3]}`, 'mdy') || undefined;
  m = /^([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/.exec(text);
  if (m) {
    const month = MONTH_NAMES.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return undefined;
    const ym = `${m[3]}-${String(month).padStart(2, '0')}`;
    return m[2] ? isoDate(`${ym}-${m[2].padStart(2, '0')}`) || undefined : ym;
  }
  return undefined;
}

const DATE_MARK =
  /\b(best\s+by|best\s+before|best\s+if\s+used\s+by|use\s+by|sell\s+by|exp(?:iration|iry)?\.?(?:\s+date)?)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\/\d{4}|\d{4}[-.]\d{2}[-.]\d{2}|\d{8}\b|\d{1,2}\s\d{1,2}\s\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{4})/gi;

function dateMarks(text: string): { kind: DateMarkKind; date: string }[] {
  const out: { kind: DateMarkKind; date: string }[] = [];
  for (const m of text.matchAll(DATE_MARK)) {
    const date = usDate(clean(m[2]));
    if (!date) continue;
    const word = m[1]!.toLowerCase();
    const kind: DateMarkKind = word.startsWith('best') ? 'best_before' : word.startsWith('use') ? 'use_by' : word.startsWith('exp') ? 'expiry' : 'other';
    out.push({ kind, date });
  }
  return out;
}

/** Lot codes: "Lot #: 123A, 124B", "Lot Numbers 2401 and 2402", "lot code 24-117". */
function lotCodes(text: string): string[] {
  const found = new Set<string>();
  const re = /\blots?\s*(?:#|no\.?|nos\.?|numbers?|codes?)?\s*[:#]?\s*((?:[A-Z0-9][A-Z0-9-/.]*)(?:\s*(?:,|;|&|and)\s*(?:[A-Z0-9][A-Z0-9-/.]*))*)/gi;
  for (const m of text.matchAll(re)) {
    for (const token of (m[1] ?? '').split(/\s*(?:,|;|&|\band\b)\s*/)) {
      const t = token.replace(/[.]+$/, '');
      if (t.length >= 3 && /\d/.test(t) && !/^(19|20)\d{2}$/.test(t)) found.add(t);
    }
  }
  return [...found];
}

function selectorsFor(r: OpenFdaEnforcement): UnitSelector[] {
  const codeText = clean(`${r.code_info ?? ''} ${r.more_code_info ?? ''}`);
  const allText = `${clean(r.product_description)} ${codeText}`;
  const gtins = gtinsInText(allText);
  const udi = udiDis(allText);
  const models: CodeMatch[] = modelCodes(allText);
  const serials = serialRanges(codeText);
  const lots = lotCodes(codeText);
  const marks = dateMarks(codeText);

  const identity = {
    models: models.length ? models : undefined,
    gtins: gtins.length ? gtins.filter((g) => !udi.includes(g)) : undefined,
    udi_di: udi.length ? udi : undefined,
  };
  if (identity.gtins?.length === 0) identity.gtins = undefined;
  const base: UnitSelector = { ...identity, lots: lots.length ? lots : undefined, serials: serials.length ? serials : undefined, basis: 'text' };

  // Several dates without lots are alternatives: one selector each. With lots, the lot is the better key.
  if (marks.length > 0 && lots.length === 0) {
    return marks.map((m) => ({ ...base, date_mark: { kind: m.kind, from: m.date, to: m.date } }));
  }
  if (marks.length === 1) base.date_mark = { kind: marks[0]!.kind, from: marks[0]!.date, to: marks[0]!.date };
  const hasCriterion = Object.entries(base).some(([k, v]) => k !== 'basis' && v !== undefined);
  return hasCriterion ? [{ ...base, note: codeText.slice(0, 500) || undefined }] : [];
}

// Where a product name ends in an FDA description: net weight, UPC, packaging, sizes.
const NAME_END =
  /(?:[,;:]\s*|\s+)(?:net\s*wt|net\s*weight|net\s*contents?|upc|product\s+of|packed\s+in|packaged\s+in|sold\s+under|item\s+(?:no|number)|each\s+(?:tablet|capsule|ml)|rx\s+only|\(?model\s+(?:number|no)|\(?\d+(?:[./]\d+)?\s*(?:oz|lbs?|g|kg|ml|l|fl\.?\s*oz|ct|count|pack|mg|mcg|grain|tablets?|capsules?)\b)/i;

/** The product name at the start of an FDA product description. */
function productName(description: string): string {
  const end = NAME_END.exec(description);
  let name = end && end.index > 8 ? description.slice(0, end.index) : description;
  // A sentence end, but not the period of "Inc." or "No.".
  name = name.split(/(?<!\b(?:Inc|Co|Corp|Ltd|No|St|Dr|Jr|Mr|Mrs|Ms))\.\s/)[0] ?? name;
  name = name.replace(/[\s,;:.-]+$/, '');
  return name.length > 140 ? `${name.slice(0, 137).trim()}...` : name;
}

/** Groups enforcement results (one per product) into one record per recall event. */
export function fromOpenFda(results: OpenFdaEnforcement[], retrieved?: string): RecallRecord[] {
  const byEvent = new Map<string, OpenFdaEnforcement[]>();
  for (const r of results) {
    const key = r.event_id || r.recall_number;
    byEvent.set(key, [...(byEvent.get(key) ?? []), r]);
  }
  return [...byEvent.entries()].map(([eventId, group]) => {
    const first = group[0]!;
    const reason = clean(first.reason_for_recall);
    const category: Category = termForSourceValue(CATEGORIES, 'US-FDA', clean(first.product_type)) ?? 'other';
    const severityLevel = termForSourceValue(SEVERITY, 'US-FDA', clean(first.classification)) ?? 'unknown';
    const firm = clean(first.recalling_firm);
    const products: Product[] = group.map((r) => {
      const description = clean(r.product_description);
      const brands = unique([...(r.openfda?.brand_name ?? []).map(clean), ...brandsBeforeWordBrand(description)].filter(Boolean));
      return {
        name: productName(description),
        brands,
        description,
        source_category: clean(r.product_type) || undefined,
        scope: 'unknown',
        identification: selectorsFor(r),
        sold: clean(r.distribution_pattern) ? { where: clean(r.distribution_pattern) } : undefined,
      };
    });
    return makeRecord({
      source: {
        authority: 'US-FDA',
        id: eventId,
        url: first.event_id
          ? `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${first.event_id}`
          : 'https://www.accessdata.fda.gov/scripts/ires/index.cfm',
        retrieved,
      },
      jurisdictions: ['US'],
      language: 'en',
      published: isoDate(first.report_date) || isoDate(first.recall_initiation_date),
      category,
      title: `${firm || 'FDA'} recall: ${reason.slice(0, 120)}`,
      products,
      hazards: hazardsInText(reason),
      hazard_text: reason || undefined,
      severity: { level: severityLevel, source_value: clean(first.classification) || undefined },
      actions: actionsInText(reason),
      remedies: [],
      firms: firm ? [{ name: firm, role: 'recalling_firm' }] : undefined,
    });
  });
}
