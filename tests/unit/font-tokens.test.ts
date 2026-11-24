import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const NAMES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '10', '11', '13', '15'];

/** Body of the first `{ … }` block that follows `header`. */
function block(header: string): string {
  const start = css.indexOf(header);
  expect(start, `${header} missing`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--text-([a-z0-9]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe('scaled text tokens', () => {
  const theme = tokens(block('@theme static'));
  const scope = tokens(block('.font-scale-scope'));

  it('body text defaults to the scaled base size', () => {
    expect(css).toMatch(/\nbody \{[^}]*font-size:\s*var\(--text-base\)/);
  });
  it('every token scales by --font-scale in @theme', () => {
    for (const n of NAMES) expect(theme[n], n).toContain('var(--font-scale');
  });
  it('.font-scale-scope re-declares the same values', () => {
    for (const n of NAMES) expect(scope[n], n).toBe(theme[n]);
  });
  it('Farsi uses the same scale as English (no lang-specific --font-scale)', () => {
    expect(css).not.toMatch(/\[lang=['"]fa['"]\][^{]*\{[^}]*--font-scale/);
  });
  it('hand-written font-size declarations are scaled', () => {
    // Strip @media print blocks, then check every font-size line.
    let src = css;
    for (let at = src.indexOf('@media print'); at >= 0; at = src.indexOf('@media print')) {
      const open = src.indexOf('{', at);
      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        if (src[end] === '}' && --depth === 0) break;
      }
      src = src.slice(0, at) + src.slice(end + 1);
    }
    const bad = src
      .split('\n')
      .filter((l) => /font-size:\s*[^;]*\d(rem|px)\b/.test(l))
      .filter((l) => !l.includes('var(--font-scale') && !l.includes('max(16px'));
    expect(bad).toEqual([]);
  });
});
