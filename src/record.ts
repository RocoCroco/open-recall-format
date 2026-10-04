import { summarize, unique, uniqueHazards, sortActions } from './describe.js';
import { ORF_VERSION, type RecallRecord, type Source } from './types.js';
import { AUTHORITIES } from './vocab.js';

export type RecordDraft = Omit<RecallRecord, 'orf_version' | 'id' | 'summary' | 'source'> & {
  source: Omit<Source, 'licence' | 'attribution'> & Partial<Pick<Source, 'licence' | 'attribution'>>;
  summary?: string;
};

/** Completes a converter's draft: id, version, licence and attribution from vocab/authorities.json, summary. */
export function makeRecord(draft: RecordDraft): RecallRecord {
  const authority = AUTHORITIES[draft.source.authority];
  const hazards = uniqueHazards(draft.hazards);
  const actions = sortActions(draft.actions);
  const remedies = unique(draft.remedies);
  const record: RecallRecord = {
    orf_version: ORF_VERSION,
    id: `${draft.source.authority.toLowerCase()}:${draft.source.id}`,
    ...draft,
    source: {
      ...draft.source,
      licence: draft.source.licence ?? authority?.licence ?? 'unknown',
      attribution: draft.source.attribution ?? authority?.attribution ?? draft.source.authority,
    },
    hazards,
    actions,
    remedies,
    summary: '',
  };
  record.summary = draft.summary ?? summarize(record);
  return dropEmpty(record);
}

/** Removes undefined values, empty strings and empty optional arrays/objects, so records stay small and valid. */
function dropEmpty<T>(value: T): T {
  const REQUIRED_ARRAYS = new Set(['brands', 'identification', 'hazards', 'actions', 'remedies', 'products', 'jurisdictions']);
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) {
      const items = v.map((x) => walk(x)).filter((x) => x !== undefined);
      return items.length === 0 && !REQUIRED_ARRAYS.has(key ?? '') ? undefined : items;
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v)
        .map(([k, x]) => [k, walk(x, k)] as const)
        .filter(([, x]) => x !== undefined);
      return entries.length === 0 ? undefined : Object.fromEntries(entries);
    }
    if (v === undefined || v === null || v === '') return undefined;
    return v;
  };
  return walk(value) as T;
}
