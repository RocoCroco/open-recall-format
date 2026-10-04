import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert.js';
import type { RecallRecord } from '../src/types.js';
import { validateRecord } from '../src/validate.js';
import { byId, fixture, rappelConsoFixtures, records, RETRIEVED, safetyGateFixtures, ukFixtures } from './helpers.js';

const ALL: [string, () => RecallRecord[]][] = [
  ['cpsc heater', () => records('cpsc', 'cpsc/cpsc-space-heater.json')],
  ['cpsc sample', () => records('cpsc', 'cpsc/sample.json')],
  ['nhtsa api', () => records('nhtsa-api', 'nhtsa/nhtsa-recalls-by-vehicle-camry-2020.json')],
  ['nhtsa flat file', () => records('nhtsa-flat', 'nhtsa/nhtsa-flat-sample.txt')],
  ['openfda food', () => records('openfda', 'openfda/food-undeclared.json')],
  ['openfda listeria', () => records('openfda', 'openfda/food-listeria.json')],
  ['openfda drugs', () => records('openfda', 'openfda/drug-enforcement.json')],
  ['openfda devices', () => records('openfda', 'openfda/device-enforcement.json')],
  ['health canada', () => records('health-canada', 'health-canada/sample.json')],
  ['safety gate', () => convert('safety-gate', safetyGateFixtures(), RETRIEVED)],
  ['rappelconso', () => convert('rappelconso', rappelConsoFixtures(), RETRIEVED)],
  ['uk opss', () => convert('uk-opss', ukFixtures(), RETRIEVED)],
];

describe('every converter, on real records', () => {
  it.each(ALL)('%s: every record is valid ORF 0.1 with a plain spoken summary', (_, load) => {
    const list = load();
    expect(list.length).toBeGreaterThan(0);
    for (const record of list) {
      expect(validateRecord(record).errors, record.id).toEqual([]);
      expect(record.summary).not.toMatch(/https?:|<|>/);
      expect(record.source.retrieved).toBe(RETRIEVED);
    }
  });
});

describe('US CPSC', () => {
  it('reads the model numbers, the variation and where to find them from the prose (the Model field is empty)', () => {
    const r = records('cpsc', 'cpsc/cpsc-space-heater.json')[0]!;
    const p = r.products[0]!;
    expect(p.brands).toEqual(['GoveeLife', 'Govee']);
    expect(p.scope).toBe('listed_units');
    expect(p.identification).toEqual([
      { models: ['H7130', 'H7130101', 'H7131', 'H7132', 'H7133', 'H7134', 'H7135'], basis: 'text' },
    ]);
    expect(p.identification_hint).toBe(
      "The model number is located on the manufacturer's label on the underside of each unit.",
    );
    expect(p.units).toEqual([
      { count: 512500, approximate: true, country: 'US' },
      { count: 48600, approximate: true, country: 'CA' },
    ]);
    expect(r.hazards).toEqual([{ type: 'fire' }, { type: 'burns' }]);
    expect(r.actions).toEqual(['stop_using', 'contact_firm']);
    expect(r.remedies).toEqual(['refund']);
    expect(r.contact?.phone).toBe('+1-833-772-5360');
    expect(r.contact?.url).toBe('https://recall.goveelife.com/heater-recall');
    expect(r.summary).toBe(
      'GoveeLife and Govee Smart Electric Space Heaters are recalled because of a risk of fire and burns. Stop using them and contact the company to get a refund.',
    );
  });

  it('turns a flattened model and serial-number table into one selector per row, with the production window', () => {
    const r = byId(records('cpsc', 'cpsc/sample.json'), 'us-cpsc:25140');
    const p = r.products[0]!;
    expect(p.scope).toBe('listed_units');
    expect(p.identification).toHaveLength(4);
    expect(p.identification[1]).toEqual({
      models: ['TB23244BEN'],
      serials: [{ from: '3014860338', to: '3015403241' }],
      manufactured: { from: '2024-04-01', to: '2024-08-20' },
      basis: 'text',
    });
  });

  it('keeps model prefixes as prefixes, not brands, and finds the brand on the label', () => {
    const p = byId(records('cpsc', 'cpsc/sample.json'), 'us-cpsc:25231').products[0]!;
    expect(p.identification[0]!.models).toEqual([{ prefix: 'CANY' }]);
    expect(p.brands).toEqual(['Canyon Furniture Co']);
  });

  it('combines the UPC field with model numbers in the text', () => {
    const p = byId(records('cpsc', 'cpsc/sample.json'), 'us-cpsc:25203').products[0]!;
    expect(p.identification[0]).toMatchObject({ models: ['DXH70CFAVX'], gtins: ['089301008588'] });
    expect(p.identification_hint).toBe('The model number is located on the hang tag.');
  });

  it('a notice with no identifiers and no subset recalls every unit; "certain models" stays unknown', () => {
    const list = records('cpsc', 'cpsc/sample.json');
    expect(byId(list, 'us-cpsc:25205').products[0]!.scope).toBe('all_units'); // baby bath seats
    expect(byId(list, 'us-cpsc:25124').products[0]!.scope).toBe('unknown'); // "certain ... models"
    // SKUs that are "not included physically on the product" are not identifiers an owner can check.
    expect(byId(records('cpsc', 'cpsc/cpsc-space-heater.json'), 'us-cpsc:22723').products[0]!.scope).toBe('unknown');
  });

  it('reads item numbers and explicit numeric model lists', () => {
    const list = records('cpsc', 'cpsc/sample.json');
    expect(byId(list, 'us-cpsc:25139').products[0]!.identification[0]!.models).toEqual(['PG1045']);
    expect(byId(list, 'us-cpsc:25111').products[0]!.identification[0]!.models).toEqual([
      '0480', '0455', '0456', '0458', '0473', '0479', '0481', '0747', '0748', '0749', '0751', '0752', '0754',
    ]);
  });
});

describe('US NHTSA', () => {
  it('reads the API date day first and groups model years into ranges', () => {
    const r = byId(records('nhtsa-api', 'nhtsa/nhtsa-recalls-by-vehicle-camry-2020.json'), 'us-nhtsa:20V682000');
    expect(r.published).toBe('2020-11-04'); // "04/11/2020"
    expect(r.products[0]!.identification[0]!.vehicle).toEqual({ make: 'Toyota', model: 'CAMRY', years: { from: 2020, to: 2020 } });
    expect(r.category).toBe('vehicle');
  });

  it('maps the bulk file record types to categories and keeps the production window', () => {
    const list = records('nhtsa-flat', 'nhtsa/nhtsa-flat-sample.txt');
    expect(byId(list, 'us-nhtsa:10C005000').category).toBe('child_restraint');
    expect(byId(list, 'us-nhtsa:10T015000').category).toBe('tire');
    expect(byId(list, 'us-nhtsa:10E058000').category).toBe('vehicle_equipment');
    expect(byId(list, 'us-nhtsa:10T015000').products[0]!.identification[0]!.manufactured).toEqual({
      from: '2009-05-03',
      to: '2010-06-26',
    });
    // "model numbers beginning with 310" in the prose becomes a prefix.
    expect(byId(list, 'us-nhtsa:10C005000').products[0]!.identification[0]!.models).toContainEqual({ prefix: '310' });
  });
});

describe('U.S. FDA (openFDA)', () => {
  it('names each undeclared allergen and the organism of a contamination', () => {
    const food = records('openfda', 'openfda/food-undeclared.json');
    expect(food.every((r) => r.category === 'food')).toBe(true);
    expect(food.flatMap((r) => r.hazards).some((h) => h.type === 'undeclared_allergen' && h.allergen)).toBe(true);
    const listeria = records('openfda', 'openfda/food-listeria.json');
    expect(listeria[0]!.hazards).toContainEqual({ type: 'microbiological', agent: 'Listeria monocytogenes' });
    expect(listeria[0]!.severity.level).toBe('serious'); // Class I
  });

  it('reads UDI-DIs, model numbers and serial ranges of devices, and never claims a full list from free text', () => {
    const devices = records('openfda', 'openfda/device-enforcement.json');
    const wheelchair = devices.find((r) => r.products[0]!.name === 'IDM-MICRO-R')!;
    expect(wheelchair.products[0]!.identification[0]).toMatchObject({
      udi_di: ['05407008320836'],
      serials: [{ from: '1000', to: '1690' }],
    });
    expect(devices.every((r) => r.products.every((p) => p.scope === 'unknown'))).toBe(true);
  });

  it('turns lot lists into lot selectors and drug product names stop before the strength', () => {
    const drugs = records('openfda', 'openfda/drug-enforcement.json');
    const elixir = drugs.find((r) => r.products[0]!.name.startsWith('Fluphenazine'))!;
    expect(elixir.products[0]!.name).toBe('Fluphenazine HCl Elixir, USP');
    expect(elixir.products[0]!.identification[0]!.lots).toContain('26080483');
  });
});

describe('Canada Recalls and Safety Alerts', () => {
  it('maps agencies, classes and brands, and says "unknown" because the open file has no identifiers', () => {
    const list = records('health-canada', 'health-canada/sample.json');
    const snacks = byId(list, 'ca-rsa:82687');
    expect(snacks.source.agency).toBe('CFIA');
    expect(snacks.category).toBe('food');
    expect(snacks.severity).toEqual({ level: 'serious', source_value: 'Class 1' });
    expect(snacks.products[0]!.brands).toEqual(['Smarter Snacks']);
    expect(snacks.hazards).toContainEqual({ type: 'undeclared_allergen', allergen: 'milk' });
    const bus = byId(list, 'ca-rsa:82705');
    expect(bus.products[0]).toMatchObject({ name: 'School Bus', brands: ['MICRO BIRD'], scope: 'unknown' });
    expect(byId(list, 'ca-rsa:82661').actions).toEqual(['stop_using', 'dispose', 'contact_firm']);
  });
});

describe('EU Safety Gate', () => {
  const list = () => convert('safety-gate', safetyGateFixtures(), RETRIEVED);

  it('keeps barcodes, models and batches as structured identifiers and maps risk types', () => {
    const magnets = byId(list(), 'eu-safety-gate:SR/02783/26');
    expect(magnets.products[0]!.identification).toEqual([
      { models: ['601-1004'], gtins: ['8710124155013'], lots: ['I0-2501515'], basis: 'structured' },
    ]);
    expect(magnets.hazards.map((h) => h.type)).toEqual(['choking', 'injuries']);
    expect(magnets.severity).toEqual({ level: 'serious', source_value: 'A12' });
    expect(magnets.actions).toEqual(['stop_using']); // recall from consumers
  });

  it('drops "no brand" placeholders in the notifying country\'s language', () => {
    const chain = byId(list(), 'eu-safety-gate:SR/02788/26');
    expect(chain.products[0]!.brands).toEqual([]); // the record says "nincs" (Hungarian for "none")
    expect(chain.source.agency).toBe('HU');
  });
});

describe('RappelConso (France)', () => {
  const list = () => convert('rappelconso', rappelConsoFixtures(), RETRIEVED);

  it('turns each barcode, lot and use-by date into a selector', () => {
    const veal = byId(list(), 'fr-rappelconso:2026-10-0018');
    expect(veal.language).toBe('fr');
    expect(veal.products[0]!.scope).toBe('listed_units');
    expect(veal.products[0]!.identification[0]).toEqual({
      gtins: ['3245414264410'],
      lots: ['73728848'],
      date_mark: { kind: 'use_by', from: '2026-10-07', to: '2026-10-07' },
      basis: 'structured',
    });
    expect(veal.hazards).toEqual([{ type: 'microbiological', agent: 'Salmonella' }]);
    expect(veal.actions).toEqual(['do_not_eat', 'dispose', 'return_to_store', 'contact_firm']);
    expect(veal.remedies).toEqual(['refund']);
  });

  it('splits "26265 et 26266" into two lots and keeps the date range', () => {
    const sausages = byId(list(), 'fr-rappelconso:2026-10-0019');
    expect(sausages.products[0]!.identification[0]).toMatchObject({
      lots: ['26265', '26266'],
      date_mark: { kind: 'use_by', from: '2026-10-08', to: '2026-10-09' },
    });
  });

  it('treats "tous les lots" as every lot, and free text or sizes in the lot field as unreliable', () => {
    const cornhole = byId(list(), 'fr-rappelconso:2026-10-0003');
    expect(cornhole.products[0]!.identification).toEqual([{ gtins: ['5390946117845'], basis: 'structured' }]);
    const railing = byId(list(), 'fr-rappelconso:2026-09-0234');
    expect(railing.products[0]!.scope).toBe('unknown'); // "siehe bei meiner produktliste"
    const battery = byId(list(), 'fr-rappelconso:2026-10-0007');
    expect(battery.products[0]!.scope).toBe('unknown'); // placeholder GTIN "000000000", capacities as "lot"
    expect(battery.products[0]!.identification).toEqual([]);
  });
});

describe('UK OPSS', () => {
  const list = () => convert('uk-opss', ukFixtures(), RETRIEVED);

  it('reads the product table, ignores "(All batches)" and maps the official risk level', () => {
    const spinner = byId(list(), 'gb-opss:2609-0229');
    expect(spinner.products[0]).toMatchObject({
      name: 'My First Baby Spinner',
      brands: ['Playworks'],
      identification: [{ gtins: ['5052089365995'], basis: 'structured' }],
    });
    expect(spinner.severity).toEqual({ level: 'moderate', source_value: 'medium' });
    expect(spinner.actions).toEqual(['stop_using']);
    const bike = byId(list(), 'gb-opss:2609-0156');
    expect(bike.products[0]!.brands).toEqual(['Allegro', 'Allegrouk']);
    expect(bike.severity.level).toBe('serious');
  });
});

describe('convert', () => {
  it('rejects an unknown source by name', () => {
    expect(() => convert('nope' as never, '[]')).toThrow(/Unknown source/);
  });

  it('accepts a single object where sources usually send arrays', () => {
    const one = JSON.stringify(JSON.parse(fixture('cpsc/cpsc-space-heater.json'))[0]);
    expect(convert('cpsc', one)).toHaveLength(1);
  });
});
