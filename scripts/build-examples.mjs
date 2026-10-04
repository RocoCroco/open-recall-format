// Writes examples/<source>.json: one real record per source, converted from the fixtures.
// Run after `npm run build`: npm run examples
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { convert } from '../dist/src/index.js';
import { validateRecord } from '../dist/src/validate.js';

const RETRIEVED = '2026-10-03T12:00:00Z';
const read = (path) => readFileSync(`fixtures/${path}`, 'utf8');
const sg = JSON.stringify(
  readdirSync('fixtures/eu-safety-gate')
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => JSON.parse(read(`eu-safety-gate/${f}`))),
);
const rc = JSON.stringify(
  ['food.json', 'food-allergen.json', 'non-food.json'].flatMap((f) => JSON.parse(read(`rappelconso/${f}`)).results),
);
const uk = JSON.stringify(['recall-baby-spinner.json'].map((f) => JSON.parse(read(`uk-opss/${f}`))));

const pick = (list, id) => list.find((r) => r.id === id) ?? list[0];
const examples = {
  'us-cpsc': pick(convert('cpsc', read('cpsc/sample.json'), RETRIEVED), 'us-cpsc:25140'),
  'us-nhtsa-vehicle': pick(convert('nhtsa-api', read('nhtsa/nhtsa-recalls-by-vehicle-camry-2020.json'), RETRIEVED), 'us-nhtsa:20V682000'),
  'us-nhtsa-child-seat': pick(convert('nhtsa-flat', read('nhtsa/nhtsa-flat-sample.txt'), RETRIEVED), 'us-nhtsa:10C005000'),
  'us-fda-food': convert('openfda', read('openfda/food-listeria.json'), RETRIEVED)[0],
  'us-fda-device': convert('openfda', read('openfda/device-enforcement.json'), RETRIEVED).find((r) => r.products[0].name === 'IDM-MICRO-R'),
  'ca-rsa': pick(convert('health-canada', read('health-canada/sample.json'), RETRIEVED), 'ca-rsa:82687'),
  'eu-safety-gate': pick(convert('safety-gate', sg, RETRIEVED), 'eu-safety-gate:SR/02783/26'),
  'fr-rappelconso': pick(convert('rappelconso', rc, RETRIEVED), 'fr-rappelconso:2026-10-0018'),
  'gb-opss': convert('uk-opss', uk, RETRIEVED)[0],
};

for (const [name, record] of Object.entries(examples)) {
  const { errors } = validateRecord(record);
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  writeFileSync(`examples/${name}.json`, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`examples/${name}.json  ${record.summary}`);
}
