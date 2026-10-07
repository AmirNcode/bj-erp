/**
 * Saved-signature image processing (FR-52), run in the browser.
 *
 * Takes a drawn canvas or an uploaded photo and returns a PNG data URL that:
 *  - is cropped to the ink, so the signature fills the box when printed;
 *  - is a fixed 3:1 shape, centred on white;
 *  - is greyscale with 16 levels, which PNG compresses well;
 *  - fits the 350 000-character limit shared with request signatures
 *    (target 300 000, shrinking until it fits).
 * No background removal: a photo keeps its paper tone (Amir, 2026-10-07).
 *
 * The pixel maths are pure functions on plain arrays and are unit-tested; only
 * `processSignature` touches the DOM.
 */

import { isValidSignatureData } from '@/lib/leave/signature';

export const OUTPUT_WIDTH = 900;
export const OUTPUT_HEIGHT = 300;
export const TARGET_MAX_LENGTH = 300_000;
const MIN_OUTPUT_WIDTH = 300;
const MAX_SOURCE_SIDE = 1600;

/** RGBA → one luminance byte per pixel, transparent pixels read as white paper. */
export function toGray(rgba: ArrayLike<number>, pixelCount: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = Math.round(lum * a + 255 * (1 - a));
  }
  return gray;
}

/** Brightness at the given percentile (0..1): the paper level of a photo. */
export function percentile(gray: ArrayLike<number>, p: number): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const target = Math.max(1, Math.ceil(gray.length * p));
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Bounding box of the signature in a photo or scan.
 *
 * "Ink" is any pixel clearly darker than the paper (the 90th-percentile
 * brightness, so grey or shadowed paper still works). A scan also carries dust
 * specks, smudges and dark marks along the scanner edge, so the box is not
 * simply every ink pixel: ink is binned into small cells, cells close enough to
 * belong to one signature are merged (a dilation of ~3% of the image), and the
 * cluster holding the most ink wins. Clusters touching the image border (scanner
 * edges) only win when nothing else has ink. Returns null when nothing looks
 * like ink.
 */
export function inkBoundingBox(gray: ArrayLike<number>, width: number, height: number): Box | null {
  const paper = percentile(gray, 0.9);
  const threshold = paper - Math.max(40, paper * 0.25);
  if (threshold <= 0) return null;

  // 1. Bin ink into cells.
  const cell = Math.max(2, Math.round(Math.max(width, height) / 200));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const counts = new Uint32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * gw;
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) counts[row + Math.floor(x / cell)]++;
    }
  }
  // A cell is ink when a stroke crosses it; one or two dark pixels are dust.
  const minCount = Math.max(2, Math.ceil(cell * cell * 0.1));
  const inkCell = new Uint8Array(gw * gh);
  let any = false;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= minCount) {
      inkCell[i] = 1;
      any = true;
    }
  }
  if (!any) return null;

  // 2. Merge nearby ink cells: label connected regions of the dilated mask.
  const radius = Math.max(1, Math.ceil(Math.max(gw, gh) * 0.03));
  const dilated = new Uint8Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      if (!inkCell[cy * gw + cx]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= gh) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = cx + dx;
          if (nx >= 0 && nx < gw) dilated[ny * gw + nx] = 1;
        }
      }
    }
  }
  const label = new Int32Array(gw * gh).fill(-1);
  type Cluster = { mass: number; border: boolean; x0: number; y0: number; x1: number; y1: number };
  const clusters: Cluster[] = [];
  const stack: number[] = [];
  for (let start = 0; start < dilated.length; start++) {
    if (!dilated[start] || label[start] !== -1) continue;
    const id = clusters.length;
    const c: Cluster = { mass: 0, border: false, x0: gw, y0: gh, x1: -1, y1: -1 };
    clusters.push(c);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % gw;
      const cy = (i - cx) / gw;
      if (inkCell[i]) {
        c.mass += counts[i];
        c.x0 = Math.min(c.x0, cx);
        c.y0 = Math.min(c.y0, cy);
        c.x1 = Math.max(c.x1, cx);
        c.y1 = Math.max(c.y1, cy);
        if (cx === 0 || cy === 0 || cx === gw - 1 || cy === gh - 1) c.border = true;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (dilated[j] && label[j] === -1) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
  }

  // 3. The cluster with the most ink, preferring ones off the scanner edge.
  const inner = clusters.filter((c) => !c.border && c.mass > 0);
  const pool = inner.length ? inner : clusters.filter((c) => c.mass > 0);
  const best = pool.reduce((a, b) => (b.mass > a.mass ? b : a));

  // 4. Pixel-exact box of the ink inside that cluster's cells.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const id = clusters.indexOf(best);
  for (let y = best.y0 * cell; y < Math.min(height, (best.y1 + 1) * cell); y++) {
    for (let x = best.x0 * cell; x < Math.min(width, (best.x1 + 1) * cell); x++) {
      const ci = Math.floor(y / cell) * gw + Math.floor(x / cell);
      if (!inkCell[ci] || label[ci] !== id || gray[y * width + x] >= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Grows a box by `ratio` of its larger side on every edge, clamped to the image. */
export function padBox(box: Box, ratio: number, width: number, height: number): Box {
  const pad = Math.round(Math.max(box.width, box.height) * ratio);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width + pad) - x,
    height: Math.min(height, box.y + box.height + pad) - y,
  };
}

/** Where a `w×h` crop lands, aspect kept, scaled to fill and centred in `outW×outH`. */
export function fitRect(w: number, h: number, outW: number, outH: number): Box {
  const scale = Math.min(outW / w, outH / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return { x: Math.round((outW - width) / 2), y: Math.round((outH - height) / 2), width, height };
}

/** Snaps every grey value to one of `levels` evenly spaced steps (keeps pure white white). */
export function quantize(gray: Uint8ClampedArray, levels = 16): Uint8ClampedArray {
  const step = 255 / (levels - 1);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.round(Math.round(gray[i] / step) * step);
  return out;
}

export type ProcessResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'empty' | 'tooLarge' | 'unsupported' };

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, context };
}

/**
 * Crops, fits, greys and compresses a signature image. `source` is a drawn canvas
 * or a decoded upload; `width`/`height` are its natural size.
 */
export function processSignature(source: CanvasImageSource, width: number, height: number): ProcessResult {
  if (!width || !height) return { ok: false, reason: 'unsupported' };

  // 1. Work copy, long side ≤ 1600 px, on white (a drawn canvas is transparent).
  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const work = canvas2d(w, h);
  if (!work.context) return { ok: false, reason: 'unsupported' };
  work.context.fillStyle = '#ffffff';
  work.context.fillRect(0, 0, w, h);
  work.context.drawImage(source, 0, 0, w, h);
  const gray = toGray(work.context.getImageData(0, 0, w, h).data, w * h);

  // 2. Crop to the ink.
  const ink = inkBoundingBox(gray, w, h);
  if (!ink) return { ok: false, reason: 'empty' };
  const crop = padBox(ink, 0.04, w, h);

  // 3–4. Fit into the 3:1 box, grey + quantise, shrink until the PNG fits.
  for (let outW = OUTPUT_WIDTH; outW >= MIN_OUTPUT_WIDTH; outW = Math.round(outW * 0.8)) {
    const outH = Math.round(outW / 3);
    const out = canvas2d(outW, outH);
    if (!out.context) return { ok: false, reason: 'unsupported' };
    out.context.fillStyle = '#ffffff';
    out.context.fillRect(0, 0, outW, outH);
    out.context.imageSmoothingQuality = 'high';
    const dest = fitRect(crop.width, crop.height, outW, outH);
    out.context.drawImage(work.canvas, crop.x, crop.y, crop.width, crop.height, dest.x, dest.y, dest.width, dest.height);

    const image = out.context.getImageData(0, 0, outW, outH);
    const q = quantize(toGray(image.data, outW * outH));
    for (let i = 0; i < q.length; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = q[i];
      image.data[i * 4 + 3] = 255;
    }
    out.context.putImageData(image, 0, 0);
    const dataUrl = out.canvas.toDataURL('image/png');
    if (dataUrl.length <= TARGET_MAX_LENGTH && isValidSignatureData(dataUrl)) return { ok: true, dataUrl };
  }
  return { ok: false, reason: 'tooLarge' };
}

/** Decodes an uploaded image file (any format the browser can show). */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unsupported image'));
    };
    image.src = url;
  });
}
