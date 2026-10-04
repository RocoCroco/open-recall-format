// The vocabularies are plain JSON (vocab/*.json) so implementations in any language can reuse them.
import actionsJson from '../vocab/actions.json' with { type: 'json' };
import allergensJson from '../vocab/allergens.json' with { type: 'json' };
import authoritiesJson from '../vocab/authorities.json' with { type: 'json' };
import categoriesJson from '../vocab/categories.json' with { type: 'json' };
import hazardsJson from '../vocab/hazards.json' with { type: 'json' };
import remediesJson from '../vocab/remedies.json' with { type: 'json' };
import severityJson from '../vocab/severity.json' with { type: 'json' };
import type { Action, Allergen, Category, HazardType, Remedy, SeverityLevel } from './types.js';

export type Language = 'en' | 'fr';

interface KeywordTerm {
  keywords?: Partial<Record<Language, string[]>>;
  source_values?: Record<string, string[]>;
}

type Terms<K extends string, T = KeywordTerm> = Record<K, T>;

export const HAZARDS = hazardsJson.terms as Terms<HazardType>;
export const ALLERGENS = allergensJson.terms as Terms<Allergen, KeywordTerm & { label: string }>;
export const ACTIONS = actionsJson.terms as Terms<Action, KeywordTerm & { spoken: string }>;
export const REMEDIES = remediesJson.terms as Terms<Remedy, KeywordTerm & { spoken: string }>;
export const CATEGORIES = categoriesJson.terms as Terms<Category>;
export const SEVERITY = severityJson.terms as Terms<SeverityLevel>;
export const AUTHORITIES = authoritiesJson.terms as Record<
  string,
  { name: string; jurisdictions: string[]; licence: string; attribution: string }
>;

/** Action terms in urgency order (the order of vocab/actions.json). */
export const ACTION_ORDER = Object.keys(ACTIONS) as Action[];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patterns = new Map<string, RegExp>();

/** A case-insensitive whole-word pattern for a list of phrases (works with accented letters). */
export function phrasePattern(phrases: string[]): RegExp | undefined {
  if (phrases.length === 0) return undefined;
  const key = phrases.join('\u0000');
  let re = patterns.get(key);
  if (!re) {
    const body = phrases.map((p) => escape(p).replace(/\s+/g, '\\s+')).join('|');
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
    patterns.set(key, re);
  }
  return re;
}

/** Terms whose keywords (in `language`) occur in `text`, in vocabulary order. */
export function termsInText<K extends string>(
  terms: Terms<K, KeywordTerm>,
  text: string,
  language: Language = 'en',
): K[] {
  const found: K[] = [];
  for (const [term, def] of Object.entries(terms) as [K, KeywordTerm][]) {
    const re = phrasePattern(def.keywords?.[language] ?? []);
    if (re?.test(text)) found.push(term);
  }
  return found;
}

/** The term whose `source_values` for `authority` contain `value` (case-insensitive); `*` matches anything. */
export function termForSourceValue<K extends string>(
  terms: Terms<K, KeywordTerm>,
  authority: string,
  value: string,
): K | undefined {
  const wanted = value.trim().toLowerCase();
  let wildcard: K | undefined;
  for (const [term, def] of Object.entries(terms) as [K, KeywordTerm][]) {
    for (const v of def.source_values?.[authority] ?? []) {
      if (v === '*') wildcard ??= term;
      else if (v.toLowerCase() === wanted) return term;
    }
  }
  return wildcard;
}
