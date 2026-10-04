import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import schema from '../schema/orf-0.1.schema.json' with { type: 'json' };
import { validateRecord } from '../src/validate.js';
import { ACTION_ORDER, ACTIONS, ALLERGENS, AUTHORITIES, CATEGORIES, HAZARDS, REMEDIES, SEVERITY } from '../src/vocab.js';
import { records } from './helpers.js';

const defs = schema.$defs as Record<string, { enum?: string[] }>;
const enumOf = (name: string) => defs[name]!.enum!;

describe('vocabularies and schema agree', () => {
  it.each([
    ['category', CATEGORIES],
    ['hazardType', HAZARDS],
    ['allergen', ALLERGENS],
    ['action', ACTIONS],
    ['remedy', REMEDIES],
  ])('the %s enum lists exactly the vocabulary terms', (name, terms) => {
    expect([...enumOf(name)].sort()).toEqual(Object.keys(terms).sort());
  });

  it('severity levels match', () => {
    expect(Object.keys(SEVERITY).sort()).toEqual(['low', 'moderate', 'serious', 'unknown']);
  });

  it('every action has a spoken phrase and the urgency order starts with the vehicle and stop-using steps', () => {
    for (const a of ACTION_ORDER) expect(ACTIONS[a].spoken.length, a).toBeGreaterThan(0);
    expect(ACTION_ORDER.slice(0, 3)).toEqual(['do_not_drive', 'park_outside', 'stop_using']);
  });

  it('every authority has a licence and an attribution', () => {
    for (const [id, a] of Object.entries(AUTHORITIES)) {
      expect(id).toMatch(/^[A-Z]{2}-[A-Z0-9-]+$/);
      expect(a.licence.length).toBeGreaterThan(0);
      expect(a.attribution.length).toBeGreaterThan(0);
    }
  });

  it('every vocabulary file is valid JSON with a "terms" object', () => {
    for (const file of readdirSync('vocab')) {
      const data = JSON.parse(readFileSync(`vocab/${file}`, 'utf8')) as { terms?: unknown; orf_version?: string };
      expect(typeof data.terms, file).toBe('object');
      expect(data.orf_version, file).toBe('0.1');
    }
  });
});

describe('JSON-LD context and examples', () => {
  it('maps every property name the schema defines', () => {
    const context = (JSON.parse(readFileSync('schema/orf-0.1.context.jsonld', 'utf8')) as { '@context': Record<string, unknown> })['@context'];
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const props = (node as { properties?: Record<string, unknown> }).properties;
        if (props) Object.keys(props).forEach((k) => names.add(k));
        Object.values(node).forEach(walk);
      }
    };
    walk(schema);
    const missing = [...names].filter((n) => !(n in context));
    expect(missing).toEqual([]);
  });

  it('every example is a valid record', () => {
    for (const file of readdirSync('examples')) {
      const record = JSON.parse(readFileSync(`examples/${file}`, 'utf8')) as unknown;
      expect(validateRecord(record).errors, file).toEqual([]);
    }
  });
});

describe('the schema rejects what the format forbids', () => {
  const good = () => structuredClone(records('cpsc', 'cpsc/cpsc-space-heater.json')[0]!);

  it('accepts a converted record', () => {
    expect(validateRecord(good())).toEqual({ valid: true, errors: [] });
  });

  it('a summary must be speakable: no links, no markup', () => {
    const r = good();
    r.summary = 'See https://example.com for details.';
    expect(validateRecord(r).valid).toBe(false);
    r.summary = 'Stop <b>now</b>.';
    expect(validateRecord(r).valid).toBe(false);
  });

  it('"listed_units" needs at least one selector, and a selector needs at least one criterion', () => {
    const r = good();
    r.products[0]!.identification = [];
    expect(validateRecord(r).valid).toBe(false);
    const s = good();
    s.products[0]!.identification = [{ basis: 'text' }];
    expect(validateRecord(s).valid).toBe(false);
  });

  it('an allergen only goes with an undeclared-allergen hazard', () => {
    const r = good();
    r.hazards = [{ type: 'fire', allergen: 'milk' }];
    expect(validateRecord(r).valid).toBe(false);
  });

  it('dates, GTINs, countries and unknown fields are checked', () => {
    const bad = [
      (r: ReturnType<typeof good>) => (r.published = '2024-13-01'),
      (r: ReturnType<typeof good>) => (r.products[0]!.identification = [{ gtins: ['12345'], basis: 'structured' }]),
      (r: ReturnType<typeof good>) => (r.jurisdictions = ['usa']),
      (r: ReturnType<typeof good>) => Object.assign(r, { extra: true }),
      (r: ReturnType<typeof good>) => (r.products[0]!.images = [{ url: 'http://insecure.example/x.png' }]),
    ];
    for (const change of bad) {
      const r = good();
      change(r);
      expect(validateRecord(r).valid).toBe(false);
    }
  });
});
