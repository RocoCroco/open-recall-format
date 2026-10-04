// U.S. NHTSA -> ORF: the recallsByVehicle API and the bulk recall file (FLAT_RCL, tab-separated).
import { actionsInText, hazardsInText, remediesInText, unique } from '../describe.js';
import { makeRecord } from '../record.js';
import { clean, isoDate, modelCodes, modelPrefixes, phoneNumber } from '../text.js';
import type { Action, Category, Product, RecallRecord, UnitSelector } from '../types.js';

const recallPage = (campaign: string) => `https://www.nhtsa.gov/recalls?nhtsaId=${campaign}`;

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

/** Contiguous runs of years: [2018, 2019, 2021] -> 2018-2019 and 2021-2021. */
function yearRuns(years: number[]): { from: number; to: number }[] {
  const sorted = unique(years).sort((a, b) => a - b);
  const runs: { from: number; to: number }[] = [];
  for (const y of sorted) {
    const last = runs.at(-1);
    if (last && y === last.to + 1) last.to = y;
    else runs.push({ from: y, to: y });
  }
  return runs;
}

// ---- recallsByVehicle API: one result per campaign x make x model x year ---------------------------------------------

export interface NhtsaVehicleResult {
  Manufacturer?: string;
  NHTSACampaignNumber: string;
  /** Day first: "28/05/2020". */
  ReportReceivedDate?: string;
  Component?: string;
  Summary?: string;
  Consequence?: string;
  Remedy?: string;
  Notes?: string;
  ModelYear?: string;
  Make?: string;
  Model?: string;
  parkIt?: boolean;
  parkOutSide?: boolean;
}

export function fromNhtsaVehicleResults(results: NhtsaVehicleResult[], retrieved?: string): RecallRecord[] {
  const byCampaign = new Map<string, NhtsaVehicleResult[]>();
  for (const r of results) byCampaign.set(r.NHTSACampaignNumber, [...(byCampaign.get(r.NHTSACampaignNumber) ?? []), r]);

  return [...byCampaign.entries()].map(([campaign, group]) => {
    const first = group[0]!;
    const byModel = new Map<string, { make: string; model: string; years: number[] }>();
    for (const r of group) {
      const make = clean(r.Make);
      const model = clean(r.Model);
      const key = `${make}|${model}`;
      const entry = byModel.get(key) ?? { make, model, years: [] };
      const year = Number(r.ModelYear);
      if (Number.isInteger(year) && year > 1885 && year !== 9999) entry.years.push(year);
      byModel.set(key, entry);
    }
    const products: Product[] = [...byModel.values()].map(({ make, model, years }) => {
      const runs = yearRuns(years);
      const selectors: UnitSelector[] = (runs.length ? runs : [undefined]).map((run) => ({
        vehicle: { make: titleCase(make), model: model || undefined, years: run },
        basis: 'structured',
      }));
      return {
        name: `${titleCase(make)} ${model}`.trim(),
        brands: [titleCase(make)],
        source_category: clean(first.Component) || undefined,
        scope: 'listed_units',
        identification: selectors,
        identification_hint: 'Check the model year and model on the vehicle registration, or look up the VIN at nhtsa.gov/recalls.',
      };
    });
    return vehicleRecord({
      campaign,
      manufacturer: clean(first.Manufacturer),
      component: clean(first.Component),
      received: isoDate(first.ReportReceivedDate, 'dmy'),
      defect: clean(first.Summary),
      consequence: clean(first.Consequence),
      corrective: clean(first.Remedy),
      notes: clean(first.Notes),
      category: 'vehicle',
      products,
      parkIt: first.parkIt === true,
      parkOutside: first.parkOutSide === true,
      retrieved,
    });
  });
}

// ---- bulk file FLAT_RCL: one row per campaign x make x model x year --------------------------------------------------

export interface NhtsaFlatRow {
  campaign: string;
  make: string;
  model: string;
  year?: number;
  component: string;
  manufacturer: string;
  /** Manufacturing window (YYYY-MM-DD), when the file gives it. */
  begin: string;
  end: string;
  /** V vehicle, E equipment, T tire, C child seat. */
  type: 'V' | 'E' | 'T' | 'C';
  unitsAffected?: number;
  received: string;
  defect: string;
  consequence: string;
  corrective: string;
  notes: string;
}

/** One line of FLAT_RCL (fields documented in NHTSA's RCL.txt); undefined for malformed lines. */
export function parseNhtsaFlatLine(line: string): NhtsaFlatRow | undefined {
  const f = line.split('\t');
  const type = f[10];
  if (f.length < 23 || (type !== 'V' && type !== 'E' && type !== 'C' && type !== 'T')) return undefined;
  const year = Number(f[4]);
  const units = Number(f[11]);
  return {
    campaign: clean(f[1]),
    make: clean(f[2]),
    model: clean(f[3]),
    year: Number.isInteger(year) && year > 1885 && year !== 9999 ? year : undefined,
    component: clean(f[6]),
    manufacturer: clean(f[7]),
    begin: isoDate(f[8]),
    end: isoDate(f[9]),
    type,
    unitsAffected: Number.isInteger(units) && units > 0 ? units : undefined,
    received: isoDate(f[15]),
    defect: clean(f[19]),
    consequence: clean(f[20]),
    corrective: clean(f[21]),
    notes: clean(f[22]),
  };
}

const FLAT_CATEGORY: Record<NhtsaFlatRow['type'], Category> = {
  V: 'vehicle',
  E: 'vehicle_equipment',
  T: 'tire',
  C: 'child_restraint',
};

export function fromNhtsaFlatFile(lines: Iterable<string>, retrieved?: string): RecallRecord[] {
  const byCampaign = new Map<string, NhtsaFlatRow[]>();
  for (const line of lines) {
    const row = parseNhtsaFlatLine(line);
    if (row) byCampaign.set(row.campaign, [...(byCampaign.get(row.campaign) ?? []), row]);
  }
  return [...byCampaign.entries()].map(([campaign, group]) => {
    const first = group[0]!;
    const manufactured = first.begin || first.end ? { from: first.begin || undefined, to: first.end || undefined } : undefined;
    const byModel = new Map<string, NhtsaFlatRow[]>();
    for (const r of group) byModel.set(`${r.make}|${r.model}`, [...(byModel.get(`${r.make}|${r.model}`) ?? []), r]);
    // Equipment recalls often name more model codes in the prose than in the model column.
    const proseModels = [...modelCodes(first.defect), ...modelPrefixes(first.defect).map((prefix) => ({ prefix }))];

    const products: Product[] = [...byModel.values()].map((rows) => {
      const { make, model } = rows[0]!;
      const brand = titleCase(make);
      let selectors: UnitSelector[];
      if (first.type === 'V') {
        const runs = yearRuns(rows.map((r) => r.year).filter((y): y is number => y !== undefined));
        selectors = (runs.length ? runs : [undefined]).map((years) => ({
          vehicle: { make: brand, model: model || undefined, years },
          manufactured,
          basis: 'structured' as const,
        }));
      } else {
        const models = unique([model, ...proseModels].filter((m) => m !== '' && m !== 'UNKNOWN'));
        selectors = models.length > 0 || manufactured ? [{ models: models.length ? models : undefined, manufactured, basis: 'structured' }] : [];
      }
      return {
        name: `${brand} ${model}`.trim(),
        brands: brand ? [brand] : [],
        source_category: first.component || undefined,
        units: first.unitsAffected ? [{ count: first.unitsAffected, approximate: false, country: 'US' }] : undefined,
        scope: selectors.length > 0 ? 'listed_units' : 'unknown',
        identification: selectors,
        identification_hint:
          first.type === 'C'
            ? 'The model number and date of manufacture are on a label on the side or bottom of the car seat.'
            : first.type === 'T'
              ? 'The tire identification number (TIN) and the size are molded into the tire sidewall.'
              : undefined,
      };
    });
    return vehicleRecord({
      campaign,
      manufacturer: titleCase(first.manufacturer),
      component: first.component,
      received: first.received,
      defect: first.defect,
      consequence: first.consequence,
      corrective: first.corrective,
      notes: first.notes,
      category: FLAT_CATEGORY[first.type],
      products,
      parkIt: false,
      parkOutside: false,
      retrieved,
    });
  });
}

// ---- shared --------------------------------------------------------------------------------------------------------

interface Campaign {
  campaign: string;
  manufacturer: string;
  component: string;
  received: string;
  defect: string;
  consequence: string;
  corrective: string;
  notes: string;
  category: Category;
  products: Product[];
  parkIt: boolean;
  parkOutside: boolean;
  retrieved?: string;
}

function vehicleRecord(c: Campaign): RecallRecord {
  const actions: Action[] = actionsInText(`${c.corrective} ${c.notes}`);
  if (c.parkIt) actions.unshift('do_not_drive');
  if (c.parkOutside) actions.unshift('park_outside');
  if (c.category === 'vehicle' && /\bdealers?\b/i.test(c.corrective)) actions.push('contact_dealer');
  const remedies = remediesInText(c.corrective);
  const subject = c.products.length === 1 ? c.products[0]!.name : c.manufacturer;
  const contactText = c.notes;
  return makeRecord({
    source: { authority: 'US-NHTSA', id: c.campaign, url: recallPage(c.campaign), retrieved: c.retrieved },
    jurisdictions: ['US'],
    language: 'en',
    published: c.received,
    category: c.category,
    title: `${subject}${c.component ? `: ${titleCase(c.component)}` : ''} recall`,
    products: c.products,
    hazards: hazardsInText(c.consequence || c.defect),
    hazard_text: [c.defect, c.consequence].filter(Boolean).join(' ') || undefined,
    severity: c.parkIt || c.parkOutside
      ? { level: 'serious', source_value: c.parkIt ? 'parkIt' : 'parkOutSide' }
      : { level: 'unknown' },
    actions,
    remedies: remedies.length > 0 ? remedies : [],
    instructions: c.corrective || undefined,
    contact: contactText ? { text: contactText, phone: phoneNumber(contactText) } : undefined,
    firms: c.manufacturer ? [{ name: c.manufacturer, role: 'manufacturer' }] : undefined,
  });
}
