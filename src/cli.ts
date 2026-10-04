#!/usr/bin/env node
// orf: convert, fetch, validate and check recall records from the command line. Records are written as NDJSON
// (one JSON record per line), so they stream into files, jq or a database.
import { readFileSync } from 'node:fs';
import { checkRecords, type OwnedItem } from './check.js';
import { convert, SOURCES, type SourceName } from './convert.js';
import {
  fetchCpsc,
  fetchHealthCanada,
  fetchNhtsaVehicle,
  fetchOpenFda,
  fetchRappelConso,
  fetchSafetyGate,
  fetchUkOpss,
} from './fetch.js';
import type { Category, RecallRecord } from './types.js';
import { validateRecord } from './validate.js';

const HELP = `orf - Open Recall Format 0.1

  orf sources
      List the sources and the input each converter expects.

  orf convert <source> <file|->
      Convert a source's own response (a file, or - for stdin) to ORF records (NDJSON on stdout).

  orf fetch <cpsc|openfda-food|openfda-drug|openfda-device|health-canada|rappelconso|uk-opss> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit N]
  orf fetch nhtsa --make Toyota --model Camry --year 2020
  orf fetch safety-gate --id 10119103 [--id ...]
      Read a public API and print ORF records (NDJSON).

  orf validate <file>
      Validate ORF records (NDJSON or a JSON array). Exit code 1 if any record is invalid.

  orf check <file> [--name ...] [--brand ...] [--model ...] [--gtin ...] [--lot ...] [--serial ...]
                   [--manufactured YYYY-MM] [--date-mark YYYY-MM-DD] [--category ...]
                   [--make ... --vehicle-model ... --year ...]
      Check one owned item against ORF records; prints every result that is not "unrelated".
`;

function args(argv: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const value = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
      flags.set(a.slice(2), [...(flags.get(a.slice(2)) ?? []), value]);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readInput(path: string): string {
  return readFileSync(path === '-' ? 0 : path, 'utf8');
}

function readRecords(path: string): RecallRecord[] {
  const text = readInput(path).trim();
  if (text.startsWith('[')) return JSON.parse(text) as RecallRecord[];
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RecallRecord);
}

function print(records: RecallRecord[]): void {
  for (const r of records) process.stdout.write(`${JSON.stringify(r)}\n`);
}

async function main(argv: string[]): Promise<number> {
  const { positional, flags } = args(argv);
  const flag = (name: string) => flags.get(name)?.[0];
  const [command, target, file] = positional;

  switch (command) {
    case 'sources':
      for (const [name, input] of Object.entries(SOURCES)) console.log(`${name.padEnd(14)} ${input}`);
      return 0;

    case 'convert': {
      if (!target || !file || !(target in SOURCES)) throw new Error(`usage: orf convert <${Object.keys(SOURCES).join('|')}> <file|->`);
      print(convert(target as SourceName, readInput(file), new Date().toISOString().replace(/\.\d+Z$/, 'Z')));
      return 0;
    }

    case 'fetch': {
      const options = { since: flag('since'), until: flag('until'), limit: flag('limit') ? Number(flag('limit')) : undefined };
      const fetchers: Record<string, () => Promise<RecallRecord[]>> = {
        cpsc: () => fetchCpsc(options),
        'openfda-food': () => fetchOpenFda('food', options),
        'openfda-drug': () => fetchOpenFda('drug', options),
        'openfda-device': () => fetchOpenFda('device', options),
        'health-canada': () => fetchHealthCanada(options),
        rappelconso: () => fetchRappelConso(options),
        'uk-opss': () => fetchUkOpss(options),
        nhtsa: () => fetchNhtsaVehicle(flag('make') ?? '', flag('model') ?? '', Number(flag('year'))),
        'safety-gate': () => fetchSafetyGate((flags.get('id') ?? []).map(Number)),
      };
      const run = target ? fetchers[target] : undefined;
      if (!run) throw new Error(`usage: orf fetch <${Object.keys(fetchers).join('|')}> (see orf help)`);
      print(await run());
      return 0;
    }

    case 'validate': {
      if (!target) throw new Error('usage: orf validate <file>');
      let invalid = 0;
      const list = readRecords(target);
      for (const r of list) {
        const { errors } = validateRecord(r);
        if (errors.length > 0) {
          invalid++;
          console.log(`${(r as { id?: string }).id ?? '(no id)'}: ${errors.join('; ')}`);
        }
      }
      console.log(`${list.length - invalid} valid, ${invalid} invalid`);
      return invalid > 0 ? 1 : 0;
    }

    case 'check': {
      if (!target) throw new Error('usage: orf check <file> --brand ... --name ...');
      const item: OwnedItem = {
        name: flag('name'),
        brand: flag('brand'),
        model: flag('model'),
        gtin: flag('gtin'),
        lot: flag('lot'),
        serial: flag('serial'),
        udi_di: flag('udi-di'),
        manufactured: flag('manufactured'),
        date_mark: flag('date-mark'),
        category: flag('category') as Category | undefined,
        vehicle: flag('make')
          ? { make: flag('make')!, model: flag('vehicle-model'), year: flag('year') ? Number(flag('year')) : undefined }
          : undefined,
      };
      console.log(JSON.stringify(checkRecords(readRecords(target), item), null, 2));
      return 0;
    }

    default:
      console.log(HELP);
      return command && command !== 'help' ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
