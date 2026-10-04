// Fails when a source file contains control characters (other than tab, newline and carriage return).
// They can sneak in when a shell eats a backslash ("\b" becomes a backspace). Run with --fix to turn a stray
// backspace back into the regex word boundary it was meant to be.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fix = process.argv.includes('--fix');
const roots = ['src', 'test', 'scripts', 'schema', 'vocab', 'spec', 'docs'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|mjs|js|json|md)$/.test(name)) files.push(path);
  }
};
for (const root of roots) {
  try {
    walk(root);
  } catch {
    // folder not present
  }
}

let bad = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    bad++;
    console.log(`control character in ${file}`);
    if (fix) writeFileSync(file, text.replaceAll('\u0008', '\\b'));
  }
}
process.exit(bad > 0 && !fix ? 1 : 0);
