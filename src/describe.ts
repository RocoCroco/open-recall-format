// Vocabulary terms from text, and the one-sentence spoken summary every record carries.
import type { Action, Allergen, Hazard, HazardType, Product, RecallRecord, Remedy } from './types.js';
import { ACTION_ORDER, ACTIONS, ALLERGENS, HAZARDS, REMEDIES, termsInText, type Language } from './vocab.js';

/** Allergens named in a recall reason, only when the reason is about an undeclared or unlabelled ingredient. */
export function allergensInText(text: string, language: Language = 'en'): Allergen[] {
  const aboutLabelling =
    language === 'fr'
      ? /allerg|non (?:déclaré|mentionné|étiqueté)|absence d'étiquetage|erreur d'étiquetage/i
      : /undeclared|not declared|allergen|unlabeled|unlabelled|not listed on the label|mislabel/i;
  if (!aboutLabelling.test(text)) return [];
  return termsInText(ALLERGENS, text, language);
}

const AGENTS: [RegExp, string][] = [
  [/listeria/i, 'Listeria monocytogenes'],
  [/salmonell/i, 'Salmonella'],
  [/e\.\s?coli|stec\b|shiga/i, 'Escherichia coli'],
  [/botuli|clostridium/i, 'Clostridium botulinum'],
  [/cronobacter/i, 'Cronobacter'],
];

/** Hazards named in a hazard description. Allergens get one hazard each, microbes carry their name. */
export function hazardsInText(text: string, language: Language = 'en'): Hazard[] {
  const out: Hazard[] = [];
  const allergens = allergensInText(text, language);
  for (const type of termsInText(HAZARDS, text, language) as HazardType[]) {
    if (type === 'undeclared_allergen') continue; // added per allergen below
    if (type === 'microbiological') {
      const agent = AGENTS.find(([re]) => re.test(text))?.[1];
      out.push(agent ? { type, agent } : { type });
    } else {
      out.push({ type });
    }
  }
  for (const allergen of allergens) out.push({ type: 'undeclared_allergen', allergen });
  if (allergens.length === 0 && /undeclared|non déclaré/i.test(text) && /allerg/i.test(text)) {
    out.push({ type: 'undeclared_allergen' });
  }
  return out;
}

/** Actions named in instructions, in urgency order. */
export function actionsInText(text: string, language: Language = 'en'): Action[] {
  return sortActions(termsInText(ACTIONS, text, language));
}

export function sortActions(actions: Iterable<Action>): Action[] {
  const set = new Set(actions);
  return ACTION_ORDER.filter((a) => set.has(a));
}

export function remediesInText(text: string, language: Language = 'en'): Remedy[] {
  return termsInText(REMEDIES, text, language);
}

/** Unique values, first occurrence kept. */
export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** Hazards without duplicates (same type, allergen and agent). */
export function uniqueHazards(hazards: Hazard[]): Hazard[] {
  const seen = new Set<string>();
  return hazards.filter((h) => {
    const key = `${h.type}|${h.allergen ?? ''}|${h.agent ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const HAZARD_WORDS: Partial<Record<HazardType, string>> = {
  fire: 'fire',
  burns: 'burns',
  electric_shock: 'electric shock',
  explosion: 'explosion',
  choking: 'choking',
  suffocation: 'suffocation',
  strangulation: 'strangulation',
  entrapment: 'entrapment',
  drowning: 'drowning',
  fall: 'falls',
  tip_over: 'tip-over',
  laceration: 'cuts',
  injuries: 'injury',
  crash: 'crash',
  chemical: 'harmful chemicals',
  poisoning: 'poisoning',
  damage_to_sight: 'eye injury',
  damage_to_hearing: 'hearing damage',
};

function hazardPhrase(hazards: Hazard[], plural: boolean): string {
  const [it, contains] = plural ? ['they', 'contain'] : ['it', 'contains'];
  const allergens = hazards.filter((h) => h.allergen).map((h) => ALLERGENS[h.allergen as Allergen].label.toLowerCase());
  if (allergens.length > 0) return `${it} ${contains} undeclared ${listWords(allergens)}`;
  const microbe = hazards.find((h) => h.type === 'microbiological');
  if (microbe) return microbe.agent ? `${it} may be contaminated with ${microbe.agent}` : `${it} may be contaminated`;
  if (hazards.some((h) => h.type === 'undeclared_allergen')) return `${it} ${contains} an undeclared allergen`;
  const words = unique(hazards.map((h) => HAZARD_WORDS[h.type]).filter((w): w is string => Boolean(w)));
  if (words.length === 0) {
    if (hazards.some((h) => h.type === 'foreign_material')) return `${it} may contain foreign material`;
    if (hazards.some((h) => h.type === 'health_risk')) return 'of a health risk';
    return plural ? 'they are a safety risk' : 'it is a safety risk';
  }
  return `of a risk of ${listWords(words.slice(0, 2))}`;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function productPhrase(product: Product | undefined, fallback: string): string {
  if (!product) return fallback;
  const brand = product.brands[0];
  const name = product.name.replace(/\s+/g, ' ').trim();
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}

/**
 * The spoken summary: "<Product> is recalled because <hazard>. <First action> and <second action>, for a refund."
 * Plain words only (no URLs, no markup), so any assistant can read it aloud.
 */
export function summarize(record: Pick<RecallRecord, 'products' | 'hazards' | 'actions' | 'remedies' | 'title'>): string {
  const product = productPhrase(record.products[0], record.title);
  const more = record.products.length > 1 ? ' and related products' : '';
  // "Heaters" and "Kits" are plurals; "DYNAPRO AS" and "Glass" are not.
  const plural = record.products.length > 1 || /\b[A-Za-z][a-z]{2,}(?<!s)s$/.test(product.trim());
  const hazard = hazardPhrase(record.hazards, plural);
  let text = `${product}${more} ${plural ? 'are' : 'is'} recalled because ${hazard}.`;
  const actions = record.actions.slice(0, 2);
  const steps = actions.map((a) => ACTIONS[a].spoken.replace(/\bit\b/g, plural ? 'them' : 'it'));
  let remedy = record.remedies.find((r) => r !== 'none' && r !== 'other');
  if (remedy === 'repair' && actions.includes('get_repair')) remedy = undefined; // already said
  if (steps.length > 0) {
    const sentence = listWords(steps);
    const contact = /^contact_|return_to_store/.test(actions.at(-1) ?? '');
    const tail = remedy ? (contact ? ` to get ${REMEDIES[remedy].spoken}` : `. The remedy is ${REMEDIES[remedy].spoken}`) : '';
    text += ` ${sentence[0]!.toUpperCase()}${sentence.slice(1)}${tail}.`;
  } else if (remedy) {
    text += ` The remedy is ${REMEDIES[remedy].spoken}.`;
  }
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 400)
    .trim();
}
