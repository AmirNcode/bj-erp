import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

/** Text of the balanced `{ … }` block that starts at the first `{` at or after `from`. */
function block(text: string, from: number): { start: number; end: number; body: string } {
  const start = text.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { start, end: i, body: text.slice(start + 1, i) };
  }
  throw new Error('unbalanced braces');
}

describe('touch screens keep form fields at 16px (no iPhone zoom)', () => {
  const at = css.indexOf('@media (pointer: coarse)');

  it('has a coarse-pointer media block', () => {
    expect(at).toBeGreaterThanOrEqual(0);
  });

  it('sizes input, select and textarea with max(16px, var(--text-base))', () => {
    const media = block(css, at);
    const rule = block(media.body, 0);
    const selector = media.body.slice(0, rule.start);
    expect(selector).toMatch(/\binput:not\(/);
    expect(selector).toMatch(/(^|,)\s*select\s*(,|$)/m);
    expect(selector).toMatch(/\btextarea\b/);
    expect(rule.body.replace(/\s+/g, ' ').trim()).toBe('font-size: max(16px, var(--text-base));');
  });

  it('is not inside any @layer block', () => {
    const layers = [...css.matchAll(/@layer\b[^{;]*\{/g)];
    for (const m of layers) {
      const b = block(css, m.index!);
      expect(at < b.start || at > b.end).toBe(true);
    }
  });

  it('never disables pinch zoom in the viewport', () => {
    const layout = readFileSync(join(root, 'app/[locale]/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/maximumScale/);
    expect(layout).not.toMatch(/userScalable/);
  });
});
