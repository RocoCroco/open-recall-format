/**
 * Open Recall Format (ORF) 0.1: the record types.
 * The normative definition is spec/open-recall-format-0.1.md and schema/orf-0.1.schema.json; these types mirror them.
 */

export const ORF_VERSION = '0.1';

/** Top-level kind of product. Coarse on purpose; `Product.source_category` keeps the authority's own category. */
export type Category =
  | 'food'
  | 'drug'
  | 'medical_device'
  | 'cosmetic'
  | 'vehicle'
  | 'vehicle_equipment'
  | 'child_restraint'
  | 'tire'
  | 'consumer_product'
  | 'other';

export type HazardType =
  | 'fire'
  | 'burns'
  | 'electric_shock'
  | 'explosion'
  | 'choking'
  | 'suffocation'
  | 'strangulation'
  | 'entrapment'
  | 'drowning'
  | 'fall'
  | 'tip_over'
  | 'laceration'
  | 'injuries'
  | 'crash'
  | 'chemical'
  | 'poisoning'
  | 'microbiological'
  | 'undeclared_allergen'
  | 'foreign_material'
  | 'damage_to_sight'
  | 'damage_to_hearing'
  | 'environment'
  | 'health_risk'
  | 'other';

export type Allergen =
  | 'milk'
  | 'egg'
  | 'fish'
  | 'crustacean_shellfish'
  | 'molluscs'
  | 'tree_nuts'
  | 'peanuts'
  | 'wheat'
  | 'gluten'
  | 'soy'
  | 'sesame'
  | 'celery'
  | 'mustard'
  | 'lupin'
  | 'sulphites';

export interface Hazard {
  type: HazardType;
  /** Only with `undeclared_allergen`. */
  allergen?: Allergen;
  /** Only with `microbiological`: the organism, e.g. "Salmonella", "Listeria monocytogenes". */
  agent?: string;
  /** The authority's own value, when it had one (e.g. "riskType.electric.shock"). */
  source_value?: string;
}

export type SeverityLevel = 'serious' | 'moderate' | 'low' | 'unknown';

export interface Severity {
  level: SeverityLevel;
  /** The authority's own value: "Class I", "Type II", "serious", "A12" ... */
  source_value?: string;
}

/** What the owner should do, most urgent first. */
export type Action =
  | 'stop_using'
  | 'do_not_eat'
  | 'do_not_drive'
  | 'park_outside'
  | 'keep_away_from_children'
  | 'contact_firm'
  | 'contact_retailer'
  | 'contact_dealer'
  | 'return_to_store'
  | 'dispose'
  | 'get_repair'
  | 'check_with_doctor';

export type Remedy = 'refund' | 'replacement' | 'repair' | 'instructions_or_label' | 'other' | 'none';

/** An exact code, a prefix ("model numbers beginning with CANY") or an inclusive range ("3014835626 to 3015507481"). */
export type CodeMatch = string | { prefix: string } | { from: string; to: string };

/** Inclusive range of dates; each bound is YYYY, YYYY-MM or YYYY-MM-DD. Either bound may be missing. */
export interface DateRange {
  from?: string;
  to?: string;
}

export type DateMarkKind = 'best_before' | 'use_by' | 'expiry' | 'other';

/**
 * One way to recognise affected units. Identity criteria (models, gtins, udi_di, vehicle) say which variant: any one
 * of them that the owner can check identifies it. Restrictions (lots, serials, manufactured, date_mark) narrow it
 * down: every restriction listed must hold. A product's selectors are alternatives (OR).
 */
export interface UnitSelector {
  models?: CodeMatch[];
  /** GTIN-8, -12 (UPC-A), -13 (EAN) or -14, digits only. Compared after padding to 14 digits. */
  gtins?: string[];
  /** Medical devices: UDI device identifiers. */
  udi_di?: string[];
  vehicle?: VehicleMatch;
  lots?: CodeMatch[];
  serials?: CodeMatch[];
  manufactured?: DateRange;
  date_mark?: DateRange & { kind: DateMarkKind };
  /** Where the converter found these criteria: in structured fields, or parsed from the authority's text. */
  basis: 'structured' | 'text';
  /** Anything that does not fit the fields above, in the authority's words. */
  note?: string;
}

export interface VehicleMatch {
  make: string;
  model?: string;
  /** Inclusive model years. */
  years?: { from: number; to: number };
}

/**
 * all_units     every unit of this product (brand + product) is affected
 * listed_units  only units matching one of `identification`
 * unknown       the source does not say clearly; a checker must never answer "not affected" on identifiers alone
 */
export type Scope = 'all_units' | 'listed_units' | 'unknown';

export interface UnitCount {
  count: number;
  approximate: boolean;
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

export interface Image {
  url: string;
  caption?: string;
}

export interface Product {
  name: string;
  /** Brands the product is sold under (as printed on it). Empty when unbranded or unknown. */
  brands: string[];
  description?: string;
  /** The authority's own category label. */
  source_category?: string;
  /** GS1 Global Product Classification brick code, when known. */
  gpc_brick?: string;
  units?: UnitCount[];
  scope: Scope;
  identification: UnitSelector[];
  /** Where the owner finds the identifier: "The model number is on the label on the underside of the unit." */
  identification_hint?: string;
  sold?: { where?: string; from?: string; to?: string; price?: string };
  images?: Image[];
}

export type Authority =
  | 'US-CPSC'
  | 'US-NHTSA'
  | 'US-FDA'
  | 'CA-RSA'
  | 'EU-SAFETY-GATE'
  | 'FR-RAPPELCONSO'
  | 'GB-OPSS'
  | (string & {});

export interface Source {
  /** Who published the recall. See vocab/authorities.json. */
  authority: Authority;
  /** Sub-agency, when the authority is a portal for several (Health Canada portal: "CFIA", "TC", ...). */
  agency?: string;
  /** The authority's identifier for this recall. */
  id: string;
  url: string;
  /** SPDX-style identifier of the data licence, see vocab/authorities.json. */
  licence: string;
  attribution: string;
  /** When the converter read the source (ISO date-time). */
  retrieved?: string;
}

export type FirmRole = 'recalling_firm' | 'manufacturer' | 'importer' | 'distributor' | 'retailer';

export interface Firm {
  name: string;
  role: FirmRole;
}

export interface Contact {
  /** Who to contact, in the authority's words. */
  text?: string;
  phone?: string;
  email?: string;
  url?: string;
}

export interface RecallRecord {
  orf_version: typeof ORF_VERSION;
  /** `<authority in lower case>:<source id>`, e.g. "us-cpsc:25036". */
  id: string;
  source: Source;
  /** ISO 3166-1 alpha-2 codes, or "EU". */
  jurisdictions: string[];
  /** BCP 47 language of the free-text fields. */
  language: string;
  /** YYYY-MM-DD. */
  published: string;
  updated?: string;
  category: Category;
  /** The authority's headline. */
  title: string;
  /** One plain sentence an assistant can read aloud: no URLs, no markup. */
  summary: string;
  products: Product[];
  hazards: Hazard[];
  /** The authority's description of the hazard. */
  hazard_text?: string;
  severity: Severity;
  actions: Action[];
  remedies: Remedy[];
  /** The authority's own instructions to owners. */
  instructions?: string;
  contact?: Contact;
  firms?: Firm[];
  incidents?: { text?: string; injuries?: number; deaths?: number };
  /** Ids of related ORF records (joint recalls, earlier versions). */
  related?: string[];
}
