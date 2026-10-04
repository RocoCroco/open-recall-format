import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../schema/orf-0.1.schema.json' with { type: 'json' };
import type { RecallRecord } from './types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
// "date-time" is the only format the schema uses; checked loosely so the validator needs no extra package.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const check = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  /** "path: message" for every problem found. */
  errors: string[];
}

/** Validates one record against schema/orf-0.1.schema.json. */
export function validateRecord(record: unknown): ValidationResult {
  const valid = check(record) as boolean;
  const errors = valid
    ? []
    : (check.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message ?? 'invalid'}`);
  return { valid, errors };
}

export function isRecallRecord(record: unknown): record is RecallRecord {
  return validateRecord(record).valid;
}
