import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('globals.css theme', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  it('does not hardcode Arial on body', () => {
    expect(css).not.toMatch(/font-family:\s*Arial/i);
  });
  it('defines the brand primary token', () => {
    expect(css).toMatch(/--primary:\s*oklch\(0\.3983/);
  });
  it('has no dark-mode block (light-only v1)', () => {
    expect(css).not.toMatch(/prefers-color-scheme|\.dark\s*\{/);
  });
});
