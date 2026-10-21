import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRAVELLER_FIELDS } from '@/lib/travel/fields';

describe('traveller fields (FR-70)', () => {
  it('TRAVELLER_FIELDS matches private.travel_traveller_fields() in schema.sql', () => {
    const sql = readFileSync('supabase/schema.sql', 'utf8');
    const header = 'CREATE FUNCTION private.travel_traveller_fields()';
    expect(sql.split(header)).toHaveLength(2);
    const body = sql.slice(sql.indexOf(header)).split('$$')[1];
    expect(body).toContain("'{full_name,national_id,birth_date,mobile,gender}'");
    expect([...TRAVELLER_FIELDS]).toEqual(['full_name', 'national_id', 'birth_date', 'mobile', 'gender']);
  });
});
