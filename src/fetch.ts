// Live fetchers: read a source's public API and convert what it returns. Each one is a thin, polite client
// (one request at a time, a timeout, an identifying User-Agent). Responses are converted with the same code as files.
import { fromCpsc, type CpscRecall } from './sources/cpsc.js';
import { fromHealthCanada, type HealthCanadaRecall } from './sources/health-canada.js';
import { fromNhtsaVehicleResults, type NhtsaVehicleResult } from './sources/nhtsa.js';
import { fromOpenFda, type OpenFdaEnforcement } from './sources/openfda.js';
import { fromRappelConso, type RappelConsoRecord } from './sources/rappelconso.js';
import { fromSafetyGate, type SafetyGateNotification } from './sources/safety-gate.js';
import { fromUkOpss, type GovUkContentItem } from './sources/uk-opss.js';
import type { RecallRecord } from './types.js';

const USER_AGENT = 'open-recall-format/0.1 (open-source recall data converter)';
const TIMEOUT_MS = 60_000;

async function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export interface FetchOptions {
  /** YYYY-MM-DD, inclusive. */
  since?: string;
  until?: string;
  /** Maximum number of source records to read. */
  limit?: number;
}

/** U.S. CPSC recalls by recall date. */
export async function fetchCpsc({ since = today(), until = today() }: FetchOptions = {}): Promise<RecallRecord[]> {
  const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${since}&RecallDateEnd=${until}`;
  const retrieved = now();
  return (await getJson<CpscRecall[]>(url)).map((r) => fromCpsc(r, retrieved));
}

/** openFDA enforcement reports by report date. `kind`: food, drug or device. */
export async function fetchOpenFda(
  kind: 'food' | 'drug' | 'device',
  { since = today(), until = today(), limit = 100 }: FetchOptions = {},
): Promise<RecallRecord[]> {
  const compact = (d: string) => d.replace(/-/g, '');
  const results: OpenFdaEnforcement[] = [];
  for (let skip = 0; skip < limit; skip += 100) {
    const url =
      `https://api.fda.gov/${kind}/enforcement.json?search=report_date:[${compact(since)}+TO+${compact(until)}]` +
      `&limit=${Math.min(100, limit - skip)}&skip=${skip}`;
    try {
      const page = await getJson<{ results?: OpenFdaEnforcement[] }>(url);
      results.push(...(page.results ?? []));
      if ((page.results ?? []).length < 100) break;
    } catch (error) {
      if (String(error).startsWith('Error: 404')) break; // openFDA answers 404 when nothing matches
      throw error;
    }
  }
  return fromOpenFda(results, now());
}

/** U.S. NHTSA recalls for one vehicle. */
export async function fetchNhtsaVehicle(make: string, model: string, year: number): Promise<RecallRecord[]> {
  const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const page = await getJson<{ results?: NhtsaVehicleResult[] }>(url);
  return fromNhtsaVehicleResults(page.results ?? [], now());
}

/** Canada Recalls and Safety Alerts (the whole open file, about 15 MB), filtered by "Last updated". */
export async function fetchHealthCanada({ since, until, limit }: FetchOptions = {}): Promise<RecallRecord[]> {
  const url = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';
  const retrieved = now();
  const rows = (await getJson<HealthCanadaRecall[]>(url, 300_000)).filter((r) => {
    const updated = r['Last updated'] ?? '';
    return (!since || updated >= since) && (!until || updated <= until);
  });
  return rows.slice(0, limit ?? rows.length).map((r) => fromHealthCanada(r, retrieved));
}

/** RappelConso v2 by publication date. */
export async function fetchRappelConso({ since = today(), until, limit = 100 }: FetchOptions = {}): Promise<RecallRecord[]> {
  const base = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-trie/records';
  const where = [`date_publication >= date'${since}'`, until ? `date_publication <= date'${until}'` : '']
    .filter(Boolean)
    .join(' and ');
  const rows: RappelConsoRecord[] = [];
  for (let offset = 0; offset < limit; offset += 100) {
    const url = `${base}?where=${encodeURIComponent(where)}&order_by=date_publication&limit=${Math.min(100, limit - offset)}&offset=${offset}`;
    const page = await getJson<{ results?: RappelConsoRecord[] }>(url);
    rows.push(...(page.results ?? []));
    if ((page.results ?? []).length < 100) break;
  }
  return fromRappelConso(rows, now());
}

/** UK OPSS alerts, reports and recalls: newest first through the GOV.UK search API, then each content item. */
export async function fetchUkOpss({ since, limit = 20 }: FetchOptions = {}): Promise<RecallRecord[]> {
  const search =
    `https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=${limit}` +
    `&order=-public_timestamp&fields=link,public_timestamp`;
  const hits = (await getJson<{ results: { link: string; public_timestamp?: string }[] }>(search)).results.filter(
    (h) => !since || (h.public_timestamp ?? '') >= since,
  );
  const out: RecallRecord[] = [];
  for (const hit of hits) {
    const item = await getJson<GovUkContentItem>(`https://www.gov.uk/api/content${hit.link}`);
    out.push(fromUkOpss(item, now()));
  }
  return out;
}

/**
 * EU Safety Gate notifications by internal id (the number in an alert's address,
 * .../alertDetail/<id>). The public site's API is not documented; use it gently.
 */
export async function fetchSafetyGate(ids: number[]): Promise<RecallRecord[]> {
  const out: RecallRecord[] = [];
  for (const id of ids) {
    const n = await getJson<SafetyGateNotification>(
      `https://ec.europa.eu/safety-gate-alerts/public/api/notification/${id}?language=en`,
    );
    out.push(fromSafetyGate(n, now()));
  }
  return out;
}
