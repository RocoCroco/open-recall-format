import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { convert, type SourceName } from '../src/convert.js';
import type { RecallRecord } from '../src/types.js';

export const RETRIEVED = '2026-10-03T12:00:00Z';

export function fixture(path: string): string {
  return readFileSync(join('fixtures', path), 'utf8');
}

export function records(source: SourceName, path: string): RecallRecord[] {
  return convert(source, fixture(path), RETRIEVED);
}

/** Every Safety Gate notification fixture, as one array. */
export function safetyGateFixtures(): string {
  const dir = join('fixtures', 'eu-safety-gate');
  const all = readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
  return JSON.stringify(all);
}

/** Every RappelConso fixture, as one array of rows. */
export function rappelConsoFixtures(): string {
  const rows = ['food.json', 'food-allergen.json', 'non-food.json'].flatMap(
    (f) => (JSON.parse(fixture(join('rappelconso', f))) as { results: unknown[] }).results,
  );
  return JSON.stringify(rows);
}

export function ukFixtures(): string {
  return JSON.stringify(['recall-baby-spinner.json', 'report-e-bike.json'].map((f) => JSON.parse(fixture(join('uk-opss', f))) as unknown));
}

export function byId(list: RecallRecord[], id: string): RecallRecord {
  const found = list.find((r) => r.id === id);
  if (!found) throw new Error(`no record ${id} in ${list.map((r) => r.id).join(', ')}`);
  return found;
}
