// Development helper: one block per converted record, with validation errors.
// node scripts/overview.mjs <source> <file>
import { readFileSync } from 'node:fs';
import { convert } from '../dist/src/index.js';
import { validateRecord } from '../dist/src/validate.js';

const [source, file] = process.argv.slice(2);
for (const r of convert(source, readFileSync(file, 'utf8'), '2026-10-03T12:00:00Z')) {
  const { errors } = validateRecord(r);
  console.log(`== ${r.id} [${r.category}] ${r.severity.level}${errors.length ? `  INVALID ${errors.join('; ')}` : ''}`);
  for (const p of r.products) {
    console.log(`   product: ${p.name} | brands: ${JSON.stringify(p.brands)} | scope: ${p.scope}`);
    for (const s of p.identification) console.log(`     selector: ${JSON.stringify(s).slice(0, 300)}`);
    if (p.identification_hint) console.log(`     hint: ${p.identification_hint}`);
  }
  console.log(`   hazards: ${JSON.stringify(r.hazards)} | actions: ${r.actions} | remedies: ${r.remedies}`);
  console.log(`   summary: ${r.summary}`);
}
