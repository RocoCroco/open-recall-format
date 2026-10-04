// RappelConso (France, DGCCRF) open data, v2 -> ORF.
// https://data.economie.gouv.fr/explore/dataset/rappelconso-v2-gtin-trie/
// `identification_produits` packs one entry per unit group: "GTIN$lot$date kind$date from$date to", entries joined by
// "|". Real values include placeholders ("000000000"), "tous les lots" and free text in the lot field; when the data
// looks unreliable the record says scope "unknown" instead of risking a wrong "not affected".
import { hazardsInText, unique } from '../describe.js';
import { makeRecord } from '../record.js';
import { clean } from '../text.js';
import type { Action, DateMarkKind, Product, RecallRecord, Remedy, Scope, UnitSelector } from '../types.js';
import { ACTIONS, CATEGORIES, REMEDIES, termForSourceValue } from '../vocab.js';

/** One row of the RappelConso v2 dataset (the fields this converter reads). */
export interface RappelConsoRecord {
  id?: number;
  numero_fiche: string;
  numero_version?: number;
  categorie_produit?: string | null;
  sous_categorie_produit?: string | null;
  marque_produit?: string | null;
  modeles_ou_references?: string | null;
  identification_produits?: string | null;
  conditionnements?: string | null;
  date_debut_commercialisation?: string | null;
  date_date_fin_commercialisation?: string | null;
  zone_geographique_de_vente?: string | null;
  distributeurs?: string | null;
  motif_rappel?: string | null;
  risques_encourus?: string | null;
  description_complementaire_risque?: string | null;
  conduites_a_tenir_par_le_consommateur?: string | null;
  numero_contact?: string | null;
  modalites_de_compensation?: string | null;
  informations_complementaires_publiques?: string | null;
  liens_vers_les_images?: string | null;
  lien_vers_la_fiche_rappel?: string | null;
  date_publication?: string | null;
  libelle?: string | null;
}

const NO_BRAND = /^(sans marque|non concern[ée]|aucune|inconnue?|-)$/i;

const DATE_KIND: [RegExp, DateMarkKind][] = [
  [/limite de consommation/i, 'use_by'],
  [/durabilit[ée] minimale/i, 'best_before'],
  [/p[ée]remption|expiration/i, 'expiry'],
];

interface Entry {
  selector?: UnitSelector;
  reliable: boolean;
}

function parseLots(text: string): { lots?: string[]; allLots: boolean; note?: string } {
  const value = clean(text).replace(/^(?:n°|no|num[ée]ro)?\s*(?:de\s+)?lots?\s*(?:n°)?\s*:?\s*/i, '');
  if (!value) return { allLots: false };
  if (/^(tous les lots|all lots|tous lots)/i.test(value)) return { allLots: true };
  const tokens = value.split(/\s*(?:,|;|\bet\b|\/(?=\s))\s*/i).map((t) => t.trim()).filter(Boolean);
  // Free text ("siehe bei meiner produktliste") is kept as a note, never as lot codes.
  const words = value.match(/\p{L}{3,}/gu) ?? [];
  if (words.length >= 2 || tokens.some((t) => !/\d/.test(t))) return { allLots: false, note: value };
  return { lots: tokens, allLots: false };
}

function parseEntry(entry: string): Entry {
  const [gtinRaw = '', lotRaw = '', kindRaw = '', fromRaw = '', toRaw = ''] = entry.split('$').map(clean);
  const gtin = gtinRaw.replace(/\D/g, '');
  const validGtin = /^(\d{8}|\d{12,14})$/.test(gtin) && !/^0+$/.test(gtin);
  const parsed = parseLots(lotRaw);
  // Values with a capacity or size unit ("200/300/350/400ah") describe the product, they are not lot codes.
  const unitLike = Boolean(parsed.lots?.some((l) => /\d\s*(ah|mah|v|w|kg|g|ml|l|cm|mm)$/i.test(l)));
  const { lots, allLots, note } = unitLike ? { lots: undefined, allLots: false, note: lotRaw } : parsed;
  const kind = DATE_KIND.find(([re]) => re.test(kindRaw))?.[1];
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : undefined;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : from;
  const selector: UnitSelector = {
    gtins: validGtin ? [gtin] : undefined,
    lots: allLots ? undefined : lots,
    date_mark: kind && from ? { kind, from, to } : undefined,
    basis: 'structured',
    note: note ? `Lot field: ${note}` : undefined,
  };
  const hasCriterion = Boolean(selector.gtins || selector.lots || selector.date_mark);
  return { selector: hasCriterion ? selector : undefined, reliable: validGtin && !note };
}

function selectorKey(s: UnitSelector): string {
  return JSON.stringify([s.gtins, s.lots, s.date_mark]);
}

/** Groups dataset rows (one per GTIN in the "gtin-trie" dataset) into one record per recall notice. */
export function fromRappelConso(rows: RappelConsoRecord[], retrieved?: string): RecallRecord[] {
  const byNotice = new Map<string, RappelConsoRecord[]>();
  for (const r of rows) byNotice.set(r.numero_fiche, [...(byNotice.get(r.numero_fiche) ?? []), r]);
  return [...byNotice.values()].map((group) => fromNotice(group, retrieved));
}

function fromNotice(group: RappelConsoRecord[], retrieved?: string): RecallRecord {
  const first = group[0]!;
  const selectors = new Map<string, UnitSelector>();
  let reliable = true;
  for (const r of group) {
    for (const raw of clean(r.identification_produits).split('|').filter(Boolean)) {
      const entry = parseEntry(raw);
      reliable &&= entry.reliable;
      if (entry.selector) selectors.set(selectorKey(entry.selector), entry.selector);
    }
  }
  const identification = [...selectors.values()];
  const scope: Scope = identification.length === 0 ? 'unknown' : reliable ? 'listed_units' : 'unknown';
  const brand = clean(first.marque_produit);
  const name = clean(first.libelle) || clean(first.modeles_ou_references) || 'Produit';
  const images = clean(first.liens_vers_les_images)
    .split('|')
    .map(clean)
    .filter((u) => u.startsWith('https://'))
    .map((url) => ({ url }));
  const where = [clean(first.distributeurs), clean(first.zone_geographique_de_vente)].filter(Boolean).join(' - ');
  const product: Product = {
    name,
    brands: brand && !NO_BRAND.test(brand) ? [brand] : [],
    description: [clean(first.modeles_ou_references), clean(first.conditionnements)].filter(Boolean).join(' - ') || undefined,
    source_category: [clean(first.categorie_produit), clean(first.sous_categorie_produit)].filter(Boolean).join(' / ') || undefined,
    scope,
    identification,
    sold: {
      where: where || undefined,
      from: clean(first.date_debut_commercialisation).slice(0, 10) || undefined,
      to: clean(first.date_date_fin_commercialisation).slice(0, 10) || undefined,
    },
    images,
  };

  const conduct = clean(first.conduites_a_tenir_par_le_consommateur).split('|').map(clean).filter(Boolean);
  const actions = conduct.map((c) => termForSourceValue(ACTIONS, 'FR-RAPPELCONSO', c)).filter((a): a is Action => Boolean(a));
  const remedies = clean(first.modalites_de_compensation)
    .split('|')
    .map((c) => termForSourceValue(REMEDIES, 'FR-RAPPELCONSO', clean(c)))
    .filter((r): r is Remedy => Boolean(r));
  const reason = clean(first.motif_rappel);
  const risks = clean(first.risques_encourus);
  const fiche = clean(first.lien_vers_la_fiche_rappel);

  return makeRecord({
    source: {
      authority: 'FR-RAPPELCONSO',
      id: clean(first.numero_fiche),
      url: fiche.startsWith('https://') ? fiche : 'https://rappel.conso.gouv.fr/',
      retrieved,
    },
    jurisdictions: ['FR'],
    language: 'fr',
    published: clean(first.date_publication).slice(0, 10),
    category: termForSourceValue(CATEGORIES, 'FR-RAPPELCONSO', clean(first.categorie_produit)) ?? 'other',
    title: `${brand && !NO_BRAND.test(brand) ? `${brand} - ` : ''}${name}: ${reason}`,
    products: [product],
    hazards: hazardsInText(`${reason} ${risks} ${clean(first.description_complementaire_risque)}`, 'fr'),
    hazard_text: [reason, risks].filter(Boolean).join(' - ') || undefined,
    severity: { level: 'unknown' },
    actions: unique(actions),
    remedies: unique(remedies),
    instructions: conduct.join('; ') || undefined,
    contact: {
      phone: clean(first.numero_contact) && clean(first.numero_contact) !== 'null' ? clean(first.numero_contact) : undefined,
      text: clean(first.informations_complementaires_publiques) || undefined,
    },
  });
}
