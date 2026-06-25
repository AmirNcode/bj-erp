import { describe, it, expect } from 'vitest';
import { add } from '@/lib/_smoke';
describe('smoke', () => { it('adds', () => expect(add(2,3)).toBe(5)); });
