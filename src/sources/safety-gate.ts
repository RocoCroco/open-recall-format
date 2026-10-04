// EU Safety Gate alert (the JSON the public site loads from /safety-gate-alerts/public/api/notification/<id>) -> ORF.
// That API is not documented by the Commission; this converter reads it defensively and keeps the site's own codes.
import { unique } from '../describe.js';
import { makeRecord } from '../record.js';
import { clean } from '../text.js';
import type { Action, Hazard, HazardType, RecallRecord, UnitSelector } from '../types.js';
import { ACTIONS, CATEGORIES, HAZARDS, SEVERITY, termForSourceValue } from '../vocab.js';

interface Keyed {
  key?: string;
  name?: string;
}

interface Versioned {
  language?: Keyed;
}

/** The fields of a Safety Gate notification this converter reads. */
export interface SafetyGateNotification {
  id: number;
  reference: string;
  notificationType?: { code?: string };
  country?: Keyed;
  publicationDate?: string;
  modificationDate?: string;
  product?: {
    name?: string | null;
    nameSpecific?: string | null;
    productCategory?: Keyed;
    brands?: { brand?: string }[];
    modelTypes?: { modelType?: string }[];
    barcodes?: { barcode?: string }[];
    batchNumbers?: { batchNumber?: string }[];
    versions?: (Versioned & { name?: string | null; description?: string | null; packageDescription?: string | null })[];
    photos?: { id: number; published?: boolean; mainPicture?: boolean }[];
  };
  risk?: {
    riskType?: Keyed[];
    versions?: (Versioned & { riskDescription?: string | null; legalProvision?: string | null })[];
  };
  measureTaken?: {
    measures?: { measureCategory?: Keyed; measureType?: Keyed; measureVoluntaryEconomicOperator?: Keyed | null }[];
    companyRecalls?: { link?: string | null }[];
  };
  traceability?: { countryOrigin?: Keyed };
}

const BASE = 'https://ec.europa.eu/safety-gate-alerts';

// Brand fields that mean "no brand" in the notifying country's language ("nincs" is Hungarian for "none").
const NO_BRAND = new Set(['nincs', 'none', 'no brand', 'unknown', 'n/a', 'na', '-', 'sans marque', 'ohne marke', 'brak', 'unbranded', 'senza marca', 'sin marca', 'geen merk', 'nevěděno', 'не е известна']);

function english<T extends Versioned>(versions: T[] | undefined): T | undefined {
  return versions?.find((v) => v.language?.key === 'EN') ?? versions?.[0];
}

/** "measure.category.recall.of.product.from.consumers" -> "Recall of product from consumers". */
function readable(key: string | undefined, prefix: string): string {
  const words = (key ?? '').replace(prefix, '').replace(/\./g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : '';
}

export function fromSafetyGate(n: SafetyGateNotification, retrieved?: string): RecallRecord {
  const p = n.product ?? {};
  const productText = english(p.versions);
  const riskText = english(n.risk?.versions);
  const brands = unique((p.brands ?? []).map((b) => clean(b.brand)).filter((b) => b && !NO_BRAND.has(b.toLowerCase())));
  const models = unique((p.modelTypes ?? []).map((m) => clean(m.modelType)).filter(Boolean));
  const gtins = unique((p.barcodes ?? []).map((b) => clean(b.barcode).replace(/\s/g, '')).filter((b) => /^(\d{8}|\d{12,14})$/.test(b)));
  const lots = unique((p.batchNumbers ?? []).map((b) => clean(b.batchNumber)).filter(Boolean));

  const selectors: UnitSelector[] =
    models.length || gtins.length
      ? [{ models: models.length ? models : undefined, gtins: gtins.length ? gtins : undefined, lots: lots.length ? lots : undefined, basis: 'structured' }]
      : lots.length
        ? [{ lots, basis: 'structured' }]
        : [];

  const hazards: Hazard[] = (n.risk?.riskType ?? []).map((r) => {
    const type = termForSourceValue(HAZARDS, 'EU-SAFETY-GATE', r.key ?? '') as HazardType | undefined;
    return type ? { type, source_value: r.key } : { type: 'other', source_value: r.key };
  });

  const measures = n.measureTaken?.measures ?? [];
  const actions = unique(
    measures
      .map((m) => termForSourceValue(ACTIONS, 'EU-SAFETY-GATE', m.measureCategory?.key ?? ''))
      .filter((a): a is Action => Boolean(a)),
  );
  const instructions = unique(
    measures.map((m) => {
      const what = readable(m.measureCategory?.key, 'measure.category.');
      const how = readable(m.measureType?.key, 'measure.type.').toLowerCase();
      return how ? `${what} (${how})` : what;
    }),
  ).join('; ');
  const recallLink = (n.measureTaken?.companyRecalls ?? []).map((c) => clean(c.link)).find((l) => /^https?:\/\//.test(l));
  const origin = n.traceability?.countryOrigin?.name;
  const description = [clean(p.nameSpecific), clean(productText?.description), origin ? `Country of origin: ${origin}.` : '']
    .filter(Boolean)
    .join(' ');
  const name = clean(productText?.name) || clean(p.name) || clean(p.nameSpecific) || 'Product';

  return makeRecord({
    source: {
      authority: 'EU-SAFETY-GATE',
      agency: n.country?.key,
      id: n.reference,
      url: `${BASE}/screen/webReport/alertDetail/${n.id}?lang=en`,
      retrieved,
    },
    jurisdictions: ['EU'],
    language: 'en',
    published: clean(n.publicationDate).slice(0, 10),
    updated: clean(n.modificationDate).slice(0, 10) || undefined,
    category: termForSourceValue(CATEGORIES, 'EU-SAFETY-GATE', p.productCategory?.key ?? '') ?? 'consumer_product',
    title: `${name}${brands[0] ? ` (${brands[0]})` : ''}: ${hazards.map((h) => readable(h.source_value, 'riskType.').toLowerCase()).join(', ') || 'risk'} risk`,
    products: [
      {
        name,
        brands,
        description: description || undefined,
        source_category: readable(p.productCategory?.key, 'product.category.') || undefined,
        scope: selectors.length > 0 ? 'listed_units' : 'unknown',
        identification: selectors,
        images: (p.photos ?? [])
          .filter((ph) => ph.published !== false)
          .sort((a, b) => Number(b.mainPicture ?? false) - Number(a.mainPicture ?? false))
          .map((ph) => ({ url: `${BASE}/public/api/notification/image/${ph.id}` })),
      },
    ],
    hazards,
    hazard_text: [clean(riskText?.riskDescription), clean(riskText?.legalProvision)].filter(Boolean).join(' ') || undefined,
    // "A12" (Article 12 of the General Product Safety Directive) is the serious-risk notification type.
    severity: {
      level: termForSourceValue(SEVERITY, 'EU-SAFETY-GATE', n.notificationType?.code ?? '') ?? 'unknown',
      source_value: n.notificationType?.code,
    },
    actions,
    remedies: [],
    instructions: instructions || undefined,
    contact: recallLink ? { url: recallLink } : undefined,
  });
}
