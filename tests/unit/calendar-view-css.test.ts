import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CalendarView responsive grid CSS', () => {
  it('uses explicit seven-column tracks so mobile cannot collapse days into rows', () => {
    const source = readFileSync(
      'app/[locale]/(app)/calendar/CalendarView.tsx',
      'utf8'
    );

    expect(source).toContain("gridTemplateColumns: 'repeat(7, minmax(0, 1fr))'");
    expect(source).toContain('style={sevenColumnGridStyle}');
    expect(source).toContain('min-w-0');
  });
});
