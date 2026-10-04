// U.S. CPSC Recalls API -> ORF. https://www.saferproducts.gov/RestWebServices/Recall?format=json
import { actionsInText, hazardsInText, remediesInText, unique } from '../describe.js';
import { makeRecord } from '../record.js';
import {
  clean,
  firmFromTitle,
  firstEmail,
  firstUrl,
  gtinsInText,
  identificationHint,
  isoDate,
  looksLikeModelCode,
  manufacturedRange,
  modelCodes,
  modelPrefixes,
  monthRange,
  normalizeName,
  phoneNumber,
  quotedBrands,
  quotedCodes,
  serialRanges,
  serialTable,
  unitCounts,
} from '../text.js';
import type { CodeMatch, Firm, FirmRole, Product, RecallRecord, Remedy, Scope, UnitSelector } from '../types.js';
import { REMEDIES, termForSourceValue } from '../vocab.js';

interface Named {
  Name?: string | null;
}

/** The fields of a CPSC recall this converter reads (the API sends more). */
export interface CpscRecall {
  RecallID?: number;
  RecallNumber?: string | null;
  RecallDate?: string | null;
  LastPublishDate?: string | null;
  Title?: string | null;
  Description?: string | null;
  URL?: string | null;
  ConsumerContact?: string | null;
  Products?: { Name?: string | null; Model?: string | null; Type?: string | null; NumberOfUnits?: string | null }[];
  ProductUPCs?: { UPC?: string | null }[];
  Images?: { URL?: string | null; Caption?: string | null }[];
  Injuries?: Named[];
  Hazards?: Named[];
  Remedies?: Named[];
  RemedyOptions?: { Option?: string | null }[];
  Manufacturers?: Named[];
  Importers?: Named[];
  Distributors?: Named[];
  Retailers?: Named[];
}

const names = (list: Named[] | undefined) => (list ?? []).map((x) => clean(x.Name)).filter(Boolean);

/** The recall page among the contact links ("https://recall.goveelife.com/heater-recall"), else the first link. */
function recallUrl(text: string): string | undefined {
  const urls = text.match(/\bhttps?:\/\/[^\s"'<>),]+/gi)?.map((u) => u.replace(/[.;:]+$/, '')) ?? [];
  return urls.find((u) => /recall/i.test(u)) ?? firstUrl(text);
}

/** "Enerco Group Inc., of Cleveland, Ohio" -> "Enerco Group Inc." */
function firmName(text: string): string {
  return text.split(/,\s+of\s+/i)[0]!.trim();
}

/** Numbers in a model clause that we did not take as codes (e.g. "model 1003"): the list may be incomplete. */
function hasUncapturedModelNumbers(text: string, captured: Set<string>): boolean {
  const clauses = text.match(/\bmodels?(?:\s+(?:numbers?|nos?\.?|#))?\b[^.;]*/gi) ?? [];
  for (const clause of clauses) {
    for (const token of clause.match(/\b\d[\d-]{2,}\b/g) ?? []) {
      if (/^(19|20)\d{2}$/.test(token)) continue; // a year
      if (!captured.has(token)) return true;
    }
  }
  return false;
}

/**
 * Numeric model codes that are unambiguous: with a hyphen ("22-371"), long ("100234"), or in an explicit list
 * ("models: 0480, 0455, 0456"). Item numbers count as models: `"ITEM NO. PG1045"`.
 */
function numericModelCodes(text: string): string[] {
  const clauses = text.match(/\bmodels?(?:\s+(?:numbers?|nos?\.?|#))?\b[^.;]*/gi) ?? [];
  const found = new Set<string>();
  for (const clause of clauses) {
    const explicitList = /^models?(?:\s+(?:numbers?|nos?\.?))?\s*:/i.test(clause);
    for (const token of clause.match(/\b\d[\d-]{1,}\d\b/g) ?? []) {
      if (/^(19|20)\d{2}$/.test(token) && !explicitList) continue;
      if (token.includes('-') || token.length >= 5 || (explicitList && token.length >= 3)) found.add(token);
    }
  }
  for (const m of text.matchAll(/\bitem\s+(?:no\.?|number|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/gi)) {
    if (m[1] && /\d/.test(m[1])) found.add(m[1]);
  }
  return [...found];
}

// Words that say only some units are recalled, or that identifiers exist somewhere: then "unknown", not "all".
const SOME_UNITS =
  /\b(certain|some|select|selected|specific|the following|listed|below|model|models|serial|lot|lots|batch|date code|upc|sku|item (?:no|number)|style (?:no|number)|manufactured (?:between|from|before|after|in)|made (?:between|from|before|after|in)|produced)\b/i;

function identification(raw: CpscRecall, description: string): { scope: Scope; selectors: UnitSelector[] } {
  const structuredModels = (raw.Products ?? [])
    .flatMap((p) => clean(p.Model).split(/\s*[,;]\s*/))
    .filter(Boolean);
  const textModels = unique([...modelCodes(description), ...quotedCodes(description), ...numericModelCodes(description)]);
  const models = unique([...structuredModels, ...textModels]);
  const prefixes = modelPrefixes(description);
  const gtins = unique([
    ...(raw.ProductUPCs ?? []).map((u) => clean(u.UPC).replace(/\D/g, '')).filter((u) => /^(\d{8}|\d{12,14})$/.test(u)),
    ...gtinsInText(description),
  ]);
  const manufactured = manufacturedRange(description);
  const basis = textModels.length > 0 || prefixes.length > 0 ? 'text' : 'structured';

  const selectors: UnitSelector[] = [];
  const rows = serialTable(description, models);
  if (rows.length > 0) {
    for (const row of rows) selectors.push({ models: [row.model], serials: [row.serials], manufactured, basis: 'text' });
  } else if (models.length > 0 || prefixes.length > 0 || gtins.length > 0) {
    const codes: CodeMatch[] = [...models, ...prefixes.map((prefix) => ({ prefix }))];
    const serials = serialRanges(description);
    selectors.push({
      models: codes.length > 0 ? codes : undefined,
      gtins: gtins.length > 0 ? gtins : undefined,
      serials: serials.length > 0 ? serials : undefined,
      manufactured,
      basis,
    });
  } else if (manufactured) {
    selectors.push({ manufactured, basis: 'text' });
  }

  let scope: Scope;
  if (selectors.length === 0) {
    // A CPSC notice that names no identifiers and no subset recalls every unit of the product it describes.
    const all = /\ball (?:models|sizes|colors|colours|styles|units|versions)\b/i.test(description);
    scope = all || (description.length > 0 && !SOME_UNITS.test(description)) ? 'all_units' : 'unknown';
  } else if (rows.length > 0) {
    scope = 'listed_units'; // a model and serial table, read row by row
  } else {
    const captured = new Set(models);
    // A model list we may have read only in part must not let a checker answer "not affected".
    scope = hasUncapturedModelNumbers(description, captured) ? 'unknown' : 'listed_units';
  }
  return { scope, selectors };
}

function brandsOf(raw: CpscRecall, description: string, productName: string): string[] {
  // A quoted model prefix ('a model number beginning with "CANY"') is not a brand.
  const prefixes = new Set(modelPrefixes(description));
  const quoted = quotedBrands(description).filter((b) => !prefixes.has(b.toUpperCase()));
  const firm = firmFromTitle(clean(raw.Title));
  const brands = [...quoted];
  // The recalling firm counts as a brand when the product carries its name, or when no brand is printed.
  if (firm && (brands.length === 0 || normalizeName(productName).startsWith(normalizeName(firm)))) brands.push(firm);
  return unique(brands.filter((b) => !looksLikeModelCode(b)));
}

function soldInfo(retailers: string[]): Product['sold'] {
  const text = retailers.join(' ');
  if (!text) return undefined;
  const months = monthRange(text);
  const price = /\bfor (?:about |between |approximately )?(\$[\d,.]+(?:\s*(?:and|to|-)\s*\$[\d,.]+)?)/i.exec(text)?.[1];
  const where = text.split(/\s+(?:from|between)\s+[A-Z][a-z]+\s+\d{4}/)[0]?.trim();
  return { where, from: months?.from, to: months?.to, price: price?.replace(/[.,]+$/, '') };
}

export function fromCpsc(raw: CpscRecall, retrieved?: string): RecallRecord {
  const id = clean(raw.RecallNumber) || String(raw.RecallID ?? '');
  const description = clean(raw.Description);
  const title = clean(raw.Title);
  const hazardText = names(raw.Hazards).join(' ');
  const instructions = names(raw.Remedies).join(' ');
  const contactText = clean(raw.ConsumerContact);
  const images = (raw.Images ?? [])
    .filter((i) => clean(i.URL).startsWith('https://'))
    .map((i) => ({ url: clean(i.URL), caption: clean(i.Caption) || undefined }));
  const { scope, selectors } = identification(raw, description);

  const products: Product[] = (raw.Products?.length ? raw.Products : [{ Name: title }]).map((p) => {
    const name = clean(p.Name) || title;
    return {
      name,
      brands: brandsOf(raw, description, name),
      description,
      source_category: clean(p.Type) || undefined,
      units: unitCounts(clean(p.NumberOfUnits), 'US'),
      scope,
      identification: selectors,
      identification_hint: identificationHint(description),
      sold: soldInfo(names(raw.Retailers)),
      images,
    };
  });

  const firms: Firm[] = [];
  const addFirms = (list: Named[] | undefined, role: FirmRole) => {
    for (const n of names(list)) firms.push({ name: firmName(n), role });
  };
  const recallingFirm = firmFromTitle(title);
  if (recallingFirm) firms.push({ name: recallingFirm, role: 'recalling_firm' });
  addFirms(raw.Manufacturers, 'manufacturer');
  addFirms(raw.Importers, 'importer');
  addFirms(raw.Distributors, 'distributor');

  const optionRemedies = (raw.RemedyOptions ?? [])
    .map((o) => termForSourceValue(REMEDIES, 'US-CPSC', clean(o.Option)))
    .filter((r): r is Remedy => Boolean(r));

  return makeRecord({
    source: {
      authority: 'US-CPSC',
      id,
      url: clean(raw.URL) || `https://www.cpsc.gov/Recalls`,
      retrieved,
    },
    jurisdictions: ['US'],
    language: 'en',
    published: isoDate(raw.RecallDate),
    updated: isoDate(raw.LastPublishDate) || undefined,
    category: 'consumer_product',
    title,
    products,
    hazards: hazardsInText(`${hazardText} ${title}`),
    hazard_text: hazardText || undefined,
    severity: { level: 'unknown' },
    actions: actionsInText(instructions),
    remedies: optionRemedies.length > 0 ? optionRemedies : remediesInText(instructions),
    instructions: instructions || undefined,
    contact: contactText
      ? { text: contactText, phone: phoneNumber(contactText), email: firstEmail(contactText), url: recallUrl(contactText) }
      : undefined,
    firms,
    incidents: { text: names(raw.Injuries).join(' ') || undefined },
  });
}
