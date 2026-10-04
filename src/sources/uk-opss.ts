// UK OPSS Product Safety Alerts, Reports and Recalls (GOV.UK content API item) -> ORF.
// https://www.gov.uk/api/content/product-safety-alerts-reports-recalls/<slug>
import { actionsInText, hazardsInText, remediesInText, unique } from '../describe.js';
import { makeRecord } from '../record.js';
import { clean, stripHtml } from '../text.js';
import type { Action, Product, RecallRecord, Remedy, UnitSelector } from '../types.js';
import { ACTIONS, CATEGORIES, REMEDIES, SEVERITY, termForSourceValue } from '../vocab.js';

/** The fields of a GOV.UK content item this converter reads. */
export interface GovUkContentItem {
  base_path: string;
  title: string;
  first_published_at?: string;
  public_updated_at?: string;
  details: {
    body?: string;
    metadata?: {
      product_alert_type?: string;
      product_category?: string;
      product_measure_type?: string[];
      product_recall_alert_date?: string;
      product_risk_level?: string;
    };
  };
}

const NO_BRAND = /^(unknown|unbranded|no brand|none|n\/a|not known)$/i;

/** Key/value rows of every table in the body: [{ Type: '...', Brand: '...', Batches: '...' }, ...]. */
function tables(html: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const fields: Record<string, string> = {};
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => stripHtml(m[1] ?? ''));
      if (cells.length >= 2 && cells[0]) fields[cells[0]] = cells.slice(1).join(' ');
    }
    if (Object.keys(fields).length > 0) out.push(fields);
  }
  return out;
}

/** "Hazard: The product presents ..." from the summary paragraphs. */
function summaryLine(html: string, label: string): string {
  const m = new RegExp(`<p>\\s*${label}:\\s*([\\s\\S]*?)</p>`, 'i').exec(html);
  return m ? stripHtml(m[1] ?? '') : '';
}

const field = (fields: Record<string, string>, ...names: string[]) =>
  clean(Object.entries(fields).find(([k]) => names.some((n) => k.toLowerCase() === n.toLowerCase()))?.[1]);

function listOf(value: string): string[] {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map(clean)
    .filter((v) => v && !/^(unknown|not known|n\/a|none|-)$/i.test(v));
}

function productFrom(fields: Record<string, string>, fallbackName: string): Product {
  const brands = unique(listOf(field(fields, 'Brand')).flatMap((b) => b.split('/')).map(clean).filter((b) => b && !NO_BRAND.test(b)));
  const models = listOf(field(fields, 'Model', 'Model number', 'Model name'));
  const gtins = unique(listOf(field(fields, 'Barcode', 'Barcodes')).map((b) => b.replace(/\s/g, '')).filter((b) => /^(\d{8}|\d{12,14})$/.test(b)));
  const batchText = field(fields, 'Batches', 'Batch', 'Batch number');
  const lots = /all batches/i.test(batchText) ? [] : listOf(batchText).filter((l) => /\d/.test(l));
  const selector: UnitSelector = {
    models: models.length ? models : undefined,
    gtins: gtins.length ? gtins : undefined,
    lots: lots.length ? lots : undefined,
    basis: 'structured',
  };
  const identification = selector.models || selector.gtins ? [selector] : lots.length ? [{ lots, basis: 'structured' as const }] : [];
  return {
    name: fallbackName,
    brands,
    description: field(fields, 'Product Description', 'Description') || undefined,
    source_category: field(fields, 'Type') || undefined,
    scope: identification.length > 0 ? 'listed_units' : 'unknown',
    identification,
  };
}

export function fromUkOpss(item: GovUkContentItem, retrieved?: string): RecallRecord {
  const html = item.details.body ?? '';
  const meta = item.details.metadata ?? {};
  const productLine = summaryLine(html, 'Product');
  const hazard = summaryLine(html, 'Hazard');
  const corrective = summaryLine(html, 'Corrective action');
  const name = productLine.replace(/\s+sold (?:by|via|on)\s+.*$/i, '') || item.title;
  const found = tables(html);
  const products = (found.length > 0 ? found : [{}]).map((fields) => productFrom(fields, name));
  const reference = /(\d{4}-\d{4})\/?$/.exec(item.base_path)?.[1] ?? item.base_path.split('/').at(-1) ?? item.base_path;
  const measures = meta.product_measure_type ?? [];
  const measureActions = measures.map((m) => termForSourceValue(ACTIONS, 'GB-OPSS', m)).filter((a): a is Action => Boolean(a));
  const measureRemedies = measures.map((m) => termForSourceValue(REMEDIES, 'GB-OPSS', m)).filter((r): r is Remedy => Boolean(r));
  const risk = clean(meta.product_risk_level);

  return makeRecord({
    source: { authority: 'GB-OPSS', id: reference, url: `https://www.gov.uk${item.base_path}`, retrieved },
    jurisdictions: ['GB'],
    language: 'en',
    published: clean(meta.product_recall_alert_date) || clean(item.first_published_at).slice(0, 10),
    updated: clean(item.public_updated_at).slice(0, 10) || undefined,
    category: termForSourceValue(CATEGORIES, 'GB-OPSS', clean(meta.product_category)) ?? 'consumer_product',
    title: item.title,
    products,
    hazards: hazardsInText(hazard),
    hazard_text: hazard || undefined,
    severity: risk ? { level: termForSourceValue(SEVERITY, 'GB-OPSS', risk) ?? 'unknown', source_value: risk } : { level: 'unknown' },
    actions: unique([...measureActions, ...actionsInText(corrective)]),
    remedies: unique([...measureRemedies, ...remediesInText(corrective)]),
    instructions: [corrective, measures.length ? `Measures: ${measures.join(', ')}.` : ''].filter(Boolean).join(' ') || undefined,
  });
}
