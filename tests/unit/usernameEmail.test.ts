import { describe, it, expect } from 'vitest';
import { codeToAuthEmail } from '@/lib/auth/usernameEmail';

describe('codeToAuthEmail', () => {
  it('lowercases the code and appends @bj-app.internal', () => {
    expect(codeToAuthEmail('A-100')).toBe('a-100@bj-app.internal');
  });

  it('trims whitespace before converting', () => {
    expect(codeToAuthEmail('  A-100  ')).toBe('a-100@bj-app.internal');
  });

  it('already-lowercase code passes through unchanged', () => {
    expect(codeToAuthEmail('admin')).toBe('admin@bj-app.internal');
  });

  it('handles codes with numbers and dashes', () => {
    expect(codeToAuthEmail('EMP-999')).toBe('emp-999@bj-app.internal');
  });
});
