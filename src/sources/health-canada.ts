// Government of Canada Recalls and Safety Alerts (Health Canada, Transport Canada, CFIA), open data file -> ORF.
// https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3
// The open file has no brand, model or lot fields and no publication date (only "Last updated"); records say so
// through scope "unknown" rather than guessing.
import { actionsInText, hazardsInText, remediesInText } from '../describe.js';
import { makeRecord } from '../record.js';
import { brandsBeforeWordBrand, clean, decodeEntities, firstEmail, isoDate, phoneNumber } from '../text.js';
import type { RecallRecord } from '../types.js';
import { CATEGORIES, SEVERITY, termForSourceValue } from '../vocab.js';

/** One row of HCRSAMOpenData.json (the English file). */
export interface HealthCanadaRecall {
  NID: string;
  Title?: string | null;
  URL?: string | null;
  Organization?: string | null;
  Product?: string | null;
  Issue?: string | null;
  'What you should do'?: string | null;
  Category?: string | null;
  'Recall class'?: string | null;
  'Last updated'?: string | null;
  Archived?: string | null;
}

const AGENCY: Record<string, string> = { TC: 'TC', CFIA: 'CFIA' };

export function fromHealthCanada(row: HealthCanadaRecall, retrieved = new Date().toISOString()): RecallRecord {
  const title = clean(row.Title);
  const organization = clean(row.Organization);
  const todo = clean(decodeEntities(row['What you should do'] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\.([A-Z])/g, '. $1');
  // "School Bus recalled by MICRO BIRD" (Transport Canada rows) names the maker in the product field.
  const byMaker = /^(.*?)\s+recalled by\s+(.+)$/i.exec(clean(row.Product));
  const name = clean(byMaker ? byMaker[1] : row.Product) || title;
  const brands = byMaker?.[2] ? [clean(byMaker[2])] : brandsBeforeWordBrand(title);
  const recallClass = clean(row['Recall class']).split(/\s+-\s+/)[0] ?? '';
  const published = isoDate(row['Last updated']) || retrieved.slice(0, 10);

  return makeRecord({
    source: {
      authority: 'CA-RSA',
      agency: AGENCY[organization] ?? 'HC',
      id: clean(row.NID),
      url: clean(row.URL) || 'https://recalls-rappels.canada.ca/en',
      retrieved,
    },
    jurisdictions: ['CA'],
    language: 'en',
    published,
    updated: isoDate(row['Last updated']) || undefined,
    category: termForSourceValue(CATEGORIES, 'CA-RSA', organization) ?? 'other',
    title,
    products: [
      {
        name,
        brands,
        source_category: clean(row.Category) || undefined,
        scope: 'unknown',
        identification: [],
      },
    ],
    hazards: hazardsInText(`${clean(row.Issue)} ${title}`),
    hazard_text: clean(row.Issue) || undefined,
    severity: recallClass && recallClass !== '--'
      ? { level: termForSourceValue(SEVERITY, 'CA-RSA', recallClass) ?? 'unknown', source_value: clean(row['Recall class']) }
      : { level: 'unknown' },
    actions: actionsInText(todo),
    remedies: remediesInText(todo),
    instructions: todo || undefined,
    contact: todo ? { phone: phoneNumber(todo), email: firstEmail(todo) } : undefined,
  });
}
