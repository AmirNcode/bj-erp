import { describe, expect, it } from 'vitest';
import { fitRect, inkBoundingBox, padBox, percentile, quantize, toGray } from '@/lib/signature/process';

/** A w×h grey image filled with `paper`, with ink pixels set to `ink`. */
function image(w: number, h: number, paper: number, inkPixels: [number, number][], ink = 30) {
  const gray = new Uint8ClampedArray(w * h).fill(paper);
  for (const [x, y] of inkPixels) gray[y * w + x] = ink;
  return gray;
}

describe('toGray', () => {
  it('reads transparent pixels as white paper', () => {
    const rgba = [0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255];
    expect(Array.from(toGray(rgba, 3))).toEqual([255, 0, 255]);
  });
});

describe('percentile', () => {
  it('finds the paper level', () => {
    const gray = image(10, 10, 200, [[1, 1], [2, 2]]);
    expect(percentile(gray, 0.9)).toBe(200);
  });
});

/** Paints a filled rectangle of ink (a stroke) into a grey image. */
function stroke(gray: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, ink = 30) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gray[y * w + x] = ink;
}

describe('inkBoundingBox', () => {
  it('crops white paper to the strokes', () => {
    const gray = image(200, 100, 255, []);
    stroke(gray, 200, 40, 30, 120, 33);
    stroke(gray, 200, 60, 34, 63, 70);
    expect(inkBoundingBox(gray, 200, 100)).toEqual({ x: 40, y: 30, width: 81, height: 41 });
  });

  it('still crops grey, shadowed paper', () => {
    const gray = image(200, 100, 170, [], 60);
    stroke(gray, 200, 50, 40, 140, 43, 60);
    // A shadow band slightly darker than the paper must not count as ink.
    for (let y = 0; y < 100; y++) gray[y * 200 + 190] = 150;
    expect(inkBoundingBox(gray, 200, 100)).toEqual({ x: 50, y: 40, width: 91, height: 4 });
  });

  it('ignores dust specks and scanner-edge marks on a scan', () => {
    // 800×600 scan: a signature in the middle, specks everywhere, a dark smear
    // on the top edge (the case Amir uploaded on 2026-10-07).
    const w = 800;
    const h = 600;
    const gray = image(w, h, 250, []);
    stroke(gray, w, 480, 270, 620, 273);
    stroke(gray, w, 480, 274, 483, 350);
    stroke(gray, w, 484, 347, 600, 350);
    for (let i = 0; i < 300; i++) {
      const x = (i * 97) % w;
      const y = (i * 61) % h;
      gray[y * w + x] = 20; // one-pixel dust
    }
    stroke(gray, w, 400, 0, 560, 15, 120); // scanner edge smear, more ink than the signature
    expect(inkBoundingBox(gray, w, h)).toEqual({ x: 480, y: 270, width: 141, height: 81 });
  });

  it('returns null for a blank image or dust only', () => {
    expect(inkBoundingBox(image(20, 20, 255, []), 20, 20)).toBeNull();
    expect(inkBoundingBox(image(400, 400, 255, [[10, 10], [200, 300]]), 400, 400)).toBeNull();
  });
});

describe('padBox / fitRect', () => {
  it('pads and clamps to the image', () => {
    expect(padBox({ x: 2, y: 2, width: 50, height: 10 }, 0.1, 100, 20)).toEqual({ x: 0, y: 0, width: 57, height: 17 });
  });

  it('scales a crop up to fill the 3:1 box, centred', () => {
    expect(fitRect(100, 50, 900, 300)).toEqual({ x: 150, y: 0, width: 600, height: 300 });
    expect(fitRect(600, 100, 900, 300)).toEqual({ x: 0, y: 75, width: 900, height: 150 });
  });
});

describe('quantize', () => {
  it('snaps to 16 levels and keeps white and black exact', () => {
    const out = quantize(new Uint8ClampedArray([0, 255, 128, 9]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
    expect(new Set(Array.from(quantize(new Uint8ClampedArray(256).map((_, i) => i)))).size).toBe(16);
  });
});
