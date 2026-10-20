// Minimal .env.local loader shared by the Node scripts and the e2e global
// setup (no dotenv dependency). Run from the project root. Variables already in
// the environment win; a missing file is not an error.
import { readFileSync } from 'node:fs';

/** @param {string} [path] */
export function loadEnvLocal(path = '.env.local') {
  let txt;
  try {
    txt = readFileSync(path, 'utf8');
  } catch {
    return; // env may already be in the environment
  }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_.]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
