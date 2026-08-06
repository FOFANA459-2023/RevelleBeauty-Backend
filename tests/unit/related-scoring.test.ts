import { describe, expect, it } from 'vitest';
import { colorDistance, paletteSimilarity } from '../../src/modules/catalog/related.service.js';

describe('colorDistance (redmean)', () => {
  it('is zero for identical colors', () => {
    expect(colorDistance('#b31b2c', '#b31b2c')).toBe(0);
  });

  it('is symmetric', () => {
    const ab = colorDistance('#b31b2c', '#f6ece4');
    const ba = colorDistance('#f6ece4', '#b31b2c');
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('ranks near shades closer than far shades', () => {
    // Classic Red vs Velvet Red (both reds) vs Bare Ivory (pale nude)
    const redToRed = colorDistance('#b31b2c', '#a01423');
    const redToIvory = colorDistance('#b31b2c', '#f2e6da');
    expect(redToRed).toBeLessThan(redToIvory);
  });
});

describe('paletteSimilarity', () => {
  it('is 1 for identical palettes', () => {
    expect(paletteSimilarity(['#b31b2c', '#a55340'], ['#b31b2c', '#a55340'])).toBeCloseTo(1, 5);
  });

  it('is 0 when either palette is empty (non-shade products)', () => {
    expect(paletteSimilarity([], ['#b31b2c'])).toBe(0);
    expect(paletteSimilarity(['#b31b2c'], [])).toBe(0);
  });

  it('scores matte-red palettes closer to each other than to pale nudes', () => {
    const reds = ['#b31b2c', '#a01423', '#9b1b28'];
    const berries = ['#6d2740', '#7a3448', '#8e3a5a'];
    const nudes = ['#f6ece4', '#f2e6da', '#f3ebe6'];
    expect(paletteSimilarity(reds, berries)).toBeGreaterThan(paletteSimilarity(reds, nudes));
  });

  it('stays within [0, 1]', () => {
    const s = paletteSimilarity(['#000000'], ['#ffffff']);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
