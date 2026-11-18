#!/usr/bin/env node
/**
 * CI audit gate: `npm audit --omit=dev`, failing on every advisory except the ones listed in
 * IGNORED below. Each exception needs a reason and is removed once a fixed version ships
 * (docs/TASKS.md tracks them). Exit 0 = clean, 1 = an advisory not on the list, 2 = audit broke.
 */
import { execFileSync } from 'node:child_process';

const IGNORED = new Map([
  // picomatch ReDoS (all versions <= 4.0.7, no patch yet, 2026-11-18). Reached only through
  // next-intl → @parcel/watcher (the message-extractor file watcher); the app never passes
  // user input to a glob.
  ['GHSA-fc5q-39xc-vjpf', 'picomatch ReDoS via next-intl → @parcel/watcher; no fixed version yet'],
]);

let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // npm audit exits 1 when it finds anything; the JSON is still on stdout.
  raw = err.stdout;
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('audit-gate: npm audit did not return JSON');
  process.exit(2);
}
if (report.error) {
  console.error(`audit-gate: npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(2);
}

const found = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !via.url) continue;
    const id = via.url.split('/').pop();
    found.set(id, `${via.name}: ${via.title} (${via.severity}) ${via.url}`);
  }
}

const blocking = [...found].filter(([id]) => !IGNORED.has(id));
for (const [id] of found) if (IGNORED.has(id)) console.log(`audit-gate: ignored ${id} — ${IGNORED.get(id)}`);
for (const id of IGNORED.keys()) if (!found.has(id)) console.log(`audit-gate: ${id} no longer reported — remove it from IGNORED`);

if (blocking.length > 0) {
  console.error('audit-gate: advisories not on the ignore list:');
  for (const [, line] of blocking) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`audit-gate: ok (${found.size} advisory found, ${found.size - blocking.length} ignored)`);
