import { describe, expect, it } from 'vitest';
import { checkItem, checkRecords } from '../src/check.js';
import { convert } from '../src/convert.js';
import { byId, rappelConsoFixtures, records, RETRIEVED, safetyGateFixtures } from './helpers.js';

const govee = () => records('cpsc', 'cpsc/cpsc-space-heater.json')[0]!;
const mowers = () => byId(records('cpsc', 'cpsc/sample.json'), 'us-cpsc:25140');
const flat = () => records('nhtsa-flat', 'nhtsa/nhtsa-flat-sample.txt');
const camry = () => byId(records('nhtsa-api', 'nhtsa/nhtsa-recalls-by-vehicle-camry-2020.json'), 'us-nhtsa:20V682000');
const veal = () => byId(convert('rappelconso', rappelConsoFixtures(), RETRIEVED), 'fr-rappelconso:2026-10-0018');

describe('checkItem: identifiers listed by the recall', () => {
  it('a listed model is affected; a variation or a missing model means "ask", with where to look', () => {
    expect(checkItem(govee(), { brand: 'Govee', name: 'space heater', model: 'H7131' }).status).toBe('affected');

    const noModel = checkItem(govee(), { brand: 'Govee', name: 'space heater' });
    expect(noModel).toMatchObject({ status: 'possibly_affected', ask: ['model'] });
    expect(noModel.hint).toMatch(/underside/);

    // "H7130-1" is close to H7130 but is not a listed code: ask for the full number, never say yes.
    expect(checkItem(govee(), { brand: 'Govee', name: 'heater', model: 'H71301' })).toMatchObject({
      status: 'possibly_affected',
      ask: ['model'],
    });
  });

  it('a model the recall does not list is not affected, because the list is complete', () => {
    expect(checkItem(govee(), { brand: 'GoveeLife', name: 'space heater', model: 'H7140' }).status).toBe('not_affected');
  });

  it('another product of the same brand, or another brand, is unrelated', () => {
    expect(checkItem(govee(), { brand: 'Govee', name: 'LED strip lights' }).status).toBe('unrelated');
    expect(checkItem(govee(), { brand: 'Dyson', name: 'space heater', model: 'H7131' }).status).toBe('unrelated');
  });

  it('model and serial tables: every restriction of the row must hold', () => {
    const base = { brand: 'DR', name: 'brush mower', model: 'TB23244BEN' };
    expect(checkItem(mowers(), { ...base, serial: '3015000000', manufactured: '2024-06-12' }).status).toBe('affected');
    expect(checkItem(mowers(), { ...base, serial: '3016000000', manufactured: '2024-06-12' }).status).toBe('not_affected');
    expect(checkItem(mowers(), { ...base, serial: '3015000000', manufactured: '2023-12-01' }).status).toBe('not_affected');
    expect(checkItem(mowers(), base)).toMatchObject({ status: 'possibly_affected', ask: ['serial', 'manufactured'] });
    // A month that straddles the production window is not enough to decide.
    expect(checkItem(mowers(), { ...base, serial: '3015000000', manufactured: '2024-08' })).toMatchObject({
      status: 'possibly_affected',
      ask: ['manufactured'],
    });
  });

  it('model prefixes ("beginning with CANY") match the models they start', () => {
    const kits = byId(records('cpsc', 'cpsc/sample.json'), 'us-cpsc:25231');
    expect(checkItem(kits, { brand: 'Canyon Furniture', name: 'dresser', model: 'CANY-4410' }).status).toBe('affected');
    expect(checkItem(kits, { brand: 'Canyon Furniture', name: 'dresser', model: 'RTG-4410' }).status).toBe('not_affected');
  });
});

describe('checkItem: vehicles, seats and tires', () => {
  it('make, model and model year', () => {
    expect(checkItem(camry(), { vehicle: { make: 'TOYOTA', model: 'Camry', year: 2020 } }).status).toBe('affected');
    expect(checkItem(camry(), { vehicle: { make: 'Toyota', model: 'Camry', year: 2016 } }).status).toBe('not_affected');
    expect(checkItem(camry(), { vehicle: { make: 'Toyota', model: 'Corolla', year: 2020 } }).status).toBe('unrelated');
    expect(checkItem(camry(), { vehicle: { make: 'Toyota', model: 'Camry' } })).toMatchObject({
      status: 'possibly_affected',
      ask: ['vehicle'],
    });
  });

  it('a car seat family name covers the models named after it', () => {
    const graco = byId(flat(), 'us-nhtsa:14C004000');
    expect(checkItem(graco, { brand: 'Graco', name: 'car seat', model: 'SnugRide 35' }).status).toBe('affected');
  });

  it('a tire model that the source wrote with the brand inside, and its production window', () => {
    const tires = byId(flat(), 'us-nhtsa:10T015000');
    expect(checkItem(tires, { brand: 'Bridgestone', name: 'tire', model: 'R192' })).toMatchObject({
      status: 'possibly_affected',
      ask: ['manufactured'],
    });
    expect(checkItem(tires, { brand: 'Bridgestone', name: 'tires', model: 'R192', manufactured: '2009-09' }).status).toBe('affected');
  });
});

describe('checkItem: food by barcode, lot and date', () => {
  it('a GTIN identifies the product on its own, in any language; lot and date settle the units', () => {
    // An English-speaking owner, a French record: the barcode is the common language.
    expect(checkItem(veal(), { name: 'ground veal', gtin: '3245414264410', lot: '73728848', date_mark: '2026-10-08' }).status).toBe('affected');
    expect(checkItem(veal(), { gtin: '3245414264410' })).toMatchObject({ status: 'possibly_affected', ask: ['lot', 'date_mark'] });
    expect(checkItem(veal(), { gtin: '3245414264410', lot: '73728848', date_mark: '2026-10-20' }).status).toBe('not_affected');
    // UPC-A and EAN-13 spellings of the same number are the same GTIN.
    expect(checkItem(veal(), { gtin: '03245414264410', lot: '73728848', date_mark: '2026-10-07' }).status).toBe('affected');
  });

  it('lot codes printed with a prefix still match', () => {
    const sardines = byId(convert('rappelconso', rappelConsoFixtures(), RETRIEVED), 'fr-rappelconso:2026-09-0236');
    expect(checkItem(sardines, { gtin: '3245412542831', lot: 'L26/2194', date_mark: '2031-06-30' }).status).toBe('affected');
  });

  it('identifiers read from free text never prove "not affected"', () => {
    const elixir = records('openfda', 'openfda/drug-enforcement.json').find((r) => r.products[0]!.name.startsWith('Fluphenazine'))!;
    expect(checkItem(elixir, { name: 'fluphenazine elixir', lot: '26080483' }).status).toBe('possibly_affected'); // no brand to confirm
    expect(checkItem(elixir, { name: 'fluphenazine elixir', lot: '99999999' })).toMatchObject({ status: 'possibly_affected' });
    expect(checkItem(elixir, { name: 'fluphenazine elixir', lot: '99999999' }).status).not.toBe('not_affected');
  });
});

describe('checkItem: thin records', () => {
  it('a recall without identifiers is "possibly" for the same product, with nothing invented', () => {
    const warmers = byId(records('health-canada', 'health-canada/sample.json'), 'ca-rsa:82661');
    // The open file has no brand field; the brand is found in the product name.
    expect(checkItem(warmers, { brand: 'Gobi Heat', name: 'hand warmers' }).status).toBe('possibly_affected');
    // Another brand cannot be ruled out when the record has no brand field: "possibly", and it says why.
    const other = checkItem(warmers, { brand: 'Zippo', name: 'hand warmer' });
    expect(other.status).toBe('possibly_affected');
    expect(other.reasons.join(' ')).toMatch(/does not name a brand/);
    expect(checkItem(warmers, { brand: 'Zippo', name: 'lighter' }).status).toBe('unrelated');
  });

  it('without a brand on either side, a model match is only "possibly"; a barcode match is proof', () => {
    const bear = byId(convert('safety-gate', safetyGateFixtures(), RETRIEVED), 'eu-safety-gate:SR/02785/26');
    expect(checkItem(bear, { name: 'soft toy bear', model: '299' }).status).toBe('possibly_affected');
    expect(checkItem(bear, { gtin: '1980041352995' }).status).toBe('affected');
    // Another toy with another barcode is not "not affected" by this recall: it is simply unrelated.
    expect(checkItem(bear, { brand: 'Magnetix', name: 'magnet toy', gtin: '8710124155013' }).status).toBe('unrelated');
  });

  it('a different category is unrelated', () => {
    expect(checkItem(govee(), { brand: 'Govee', name: 'heater', category: 'food' }).status).toBe('unrelated');
  });
});

describe('checkRecords', () => {
  it('returns what concerns the item, most serious first', () => {
    const all = [govee(), mowers(), camry(), veal()];
    const results = checkRecords(all, { brand: 'Govee', name: 'space heater', model: 'H7133' });
    expect(results.map((r) => [r.record_id, r.status])).toEqual([['us-cpsc:25036', 'affected']]);
  });
});
