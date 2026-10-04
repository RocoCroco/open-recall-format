import { describe, expect, it } from 'vitest';
import { allergensInText, hazardsInText, summarize } from '../src/describe.js';
import {
  brandsBeforeWordBrand,
  gtin14,
  isoDate,
  manufacturedRange,
  modelCodes,
  modelPrefixes,
  normalizeName,
  phoneNumber,
  serialTable,
  unitCounts,
} from '../src/text.js';

describe('dates', () => {
  it('reads slash dates in the order the source uses, and rejects impossible dates', () => {
    expect(isoDate('28/05/2020')).toBe('2020-05-28'); // NHTSA: day first
    expect(isoDate('05/28/2020', 'mdy')).toBe('2020-05-28');
    expect(isoDate('20240614')).toBe('2024-06-14');
    expect(isoDate('2024-11-07T00:00:00')).toBe('2024-11-07');
    expect(isoDate('05/28/2020')).toBe(''); // no 28th month
    expect(isoDate('2023-02-30')).toBe('');
  });

  it('takes production windows, not sale periods', () => {
    expect(manufacturedRange('Only mowers manufactured between April 1, 2024, and August 20, 2024, are included.')).toEqual({
      from: '2024-04-01',
      to: '2024-08-20',
    });
    expect(manufacturedRange('made from July 2010 through May 2013')).toEqual({ from: '2010-07-01', to: '2013-05-31' });
    expect(manufacturedRange('Sold at Target from May 2024 through January 2025.')).toBeUndefined();
  });
});

describe('codes', () => {
  it('finds model codes in model clauses, never years or quantities', () => {
    expect(modelCodes('This recall involves 70,000 BTU heaters model number DXH70CFAVX made in 2024.')).toEqual(['DXH70CFAVX']);
    expect(modelPrefixes('a model number beginning with "CANY" and the date')).toEqual(['CANY']);
  });

  it('pairs serial ranges with the model of their row', () => {
    const text =
      'Model Description Serial No. Range TB21044BEN DR BRUSH MOWER 44T 10.5 HP 3014835626 to 3015507481 TB23244BEN DR BRUSH MOWER PRO 3014860338 to 3015403241';
    expect(serialTable(text, [])).toEqual([
      { model: 'TB21044BEN', serials: { from: '3014835626', to: '3015507481' } },
      { model: 'TB23244BEN', serials: { from: '3014860338', to: '3015403241' } },
    ]);
  });

  it('compares GTINs as 14 digits', () => {
    expect(gtin14('089301008588')).toBe('00089301008588');
    expect(gtin14('0 89301 00858 8')).toBe('00089301008588');
  });
});

describe('names, counts, contacts', () => {
  it('normalizes company names', () => {
    expect(normalizeName('Govee, Inc.')).toBe('govee');
    expect(normalizeName('Renée Blanche')).toBe('renee blanche');
    expect(normalizeName('American Bolt & Screw MFG CO.')).toBe('american bolt and screw mfg');
  });

  it('finds brands written as "X brand"', () => {
    expect(brandsBeforeWordBrand('Dorsey brand, MVP brand, and Riga Farms brand Onions recalled')).toEqual([
      'Dorsey',
      'MVP',
      'Riga Farms',
    ]);
    expect(brandsBeforeWordBrand('Various brands of sandwiches recalled')).toEqual([]);
  });

  it('reads unit counts per country', () => {
    expect(unitCounts('About 21,250 (In addition, about 500 were sold in Canada)', 'US')).toEqual([
      { count: 21250, approximate: true, country: 'US' },
      { count: 500, approximate: true, country: 'CA' },
    ]);
  });

  it('formats US phone numbers', () => {
    expect(phoneNumber('toll-free at 833-772-5360 from 9 a.m.')).toBe('+1-833-772-5360');
    expect(phoneNumber('by telephone at 1-888-462-4743, from')).toBe('+1-888-462-4743');
  });
});

describe('hazards and summaries', () => {
  it('names allergens only when the text is about labelling', () => {
    expect(allergensInText('Product contains undeclared milk and soy')).toEqual(['milk', 'soy']);
    expect(allergensInText('Milk chocolate bars may contain metal fragments')).toEqual([]);
    expect(allergensInText('erreur d\'étiquetage du produit et allergène lait non déclaré', 'fr')).toEqual(['milk']);
  });

  it('does not take "can lead to" for lead', () => {
    expect(hazardsInText('The latch can fail, which can lead to falls.').map((h) => h.type)).toEqual(['fall']);
  });

  it('writes one plain sentence an assistant can read aloud', () => {
    expect(
      summarize({
        title: 'x',
        products: [{ name: 'Car Seat', brands: ['Acme'], scope: 'all_units', identification: [] }],
        hazards: [{ type: 'injuries' }],
        actions: ['stop_using', 'contact_firm'],
        remedies: ['replacement'],
      }),
    ).toBe('Acme Car Seat is recalled because of a risk of injury. Stop using it and contact the company to get a free replacement.');
  });
});
