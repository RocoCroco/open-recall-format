// One entry point for every source: the source's own response (as text) in, ORF records out.
import { fromCpsc, type CpscRecall } from './sources/cpsc.js';
import { fromHealthCanada, type HealthCanadaRecall } from './sources/health-canada.js';
import { fromNhtsaFlatFile, fromNhtsaVehicleResults, type NhtsaVehicleResult } from './sources/nhtsa.js';
import { fromOpenFda, type OpenFdaEnforcement } from './sources/openfda.js';
import { fromRappelConso, type RappelConsoRecord } from './sources/rappelconso.js';
import { fromSafetyGate, type SafetyGateNotification } from './sources/safety-gate.js';
import { fromUkOpss, type GovUkContentItem } from './sources/uk-opss.js';
import type { RecallRecord } from './types.js';

export const SOURCES = {
  cpsc: 'U.S. CPSC Recalls API response (a JSON array)',
  'nhtsa-api': 'U.S. NHTSA recallsByVehicle response ({ results: [...] })',
  'nhtsa-flat': 'U.S. NHTSA FLAT_RCL bulk file (tab-separated text, unzipped)',
  openfda: 'openFDA food, drug or device enforcement response ({ results: [...] })',
  'health-canada': 'Canada Recalls and Safety Alerts open data file (HCRSAMOpenData.json, a JSON array)',
  'safety-gate': 'EU Safety Gate notification(s) (one object or an array)',
  rappelconso: 'RappelConso v2 records ({ results: [...] } from the Explore API, or an array)',
  'uk-opss': 'GOV.UK content item(s) for product safety alerts (one object or an array)',
} as const;

export type SourceName = keyof typeof SOURCES;

const asArray = <T>(value: unknown, key = 'results'): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key])) {
    return (value as Record<string, T[]>)[key]!;
  }
  return [value as T];
};

/** Converts a source response to ORF records. `retrieved` (ISO date-time) is recorded as provenance. */
export function convert(source: SourceName, input: string, retrieved?: string): RecallRecord[] {
  if (source === 'nhtsa-flat') return fromNhtsaFlatFile(input.split(/\r?\n/), retrieved);
  const data: unknown = JSON.parse(input);
  switch (source) {
    case 'cpsc':
      return asArray<CpscRecall>(data).map((r) => fromCpsc(r, retrieved));
    case 'nhtsa-api':
      return fromNhtsaVehicleResults(asArray<NhtsaVehicleResult>(data), retrieved);
    case 'openfda':
      return fromOpenFda(asArray<OpenFdaEnforcement>(data), retrieved);
    case 'health-canada':
      return asArray<HealthCanadaRecall>(data).map((r) => fromHealthCanada(r, retrieved));
    case 'safety-gate':
      return asArray<SafetyGateNotification>(data, 'content').map((n) => fromSafetyGate(n, retrieved));
    case 'rappelconso':
      return fromRappelConso(asArray<RappelConsoRecord>(data), retrieved);
    case 'uk-opss':
      return asArray<GovUkContentItem>(data).map((i) => fromUkOpss(i, retrieved));
    default:
      throw new Error(`Unknown source "${String(source)}". Known: ${Object.keys(SOURCES).join(', ')}`);
  }
}
