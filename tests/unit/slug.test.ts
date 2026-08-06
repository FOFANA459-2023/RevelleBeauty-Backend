import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/lib/slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('High Shine Lip Oil')).toBe('high-shine-lip-oil');
  });

  it('expands ampersands', () => {
    expect(slugify('Lip Products & Oil')).toBe('lip-products-and-oil');
  });

  it('strips punctuation and collapses runs', () => {
    expect(slugify('Ultra Light Lip Oil (Square Tube)')).toBe('ultra-light-lip-oil-square-tube');
    expect(slugify('  a   b  ')).toBe('a-b');
  });

  it('never yields leading/trailing hyphens', () => {
    expect(slugify('!!Bold!!')).toBe('bold');
  });
});
