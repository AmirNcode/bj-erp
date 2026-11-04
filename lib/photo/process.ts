/**
 * Profile photo pipeline (FR-82), browser only.
 *
 * A phone selfie can be 48 megapixels and 10–25 MB. Two steps keep that out of the database and
 * keep low-end phones from running out of memory:
 *  1. `prepareForCrop` scales the picked file down to at most PREVIEW_MAX_SIDE on its long side
 *     before the cropper ever sees it (a 48 MP image decoded at full size is ~190 MB of pixels;
 *     the preview is ~16 MB).
 *  2. `cropToJpeg` draws only the chosen square to a 256×256 canvas and encodes JPEG, stepping the
 *     quality down until the data URL fits PHOTO_MAX_LENGTH (the database CHECK caps it at 80 000).
 * Re-encoding through a canvas also drops all EXIF metadata, GPS location included.
 */

export const PHOTO_SIDE = 256;
/** Data-URL length the client aims for; the database refuses anything over 80 000. */
export const PHOTO_MAX_LENGTH = 60_000;
/** Long side of the image handed to the cropper. Enough detail to zoom in on a face. */
export const PREVIEW_MAX_SIDE = 2048;
/** Files bigger than this are refused before decoding (no real photo needs more). */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

const PHOTO_RE = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/;

export type Area = { x: number; y: number; width: number; height: number };
export type PhotoProblem = 'unsupported' | 'tooBig' | 'tooLarge';
export type PhotoResult<T> = { ok: true; value: T } | { ok: false; reason: PhotoProblem };

/** Same shape the database CHECK enforces (`profile_photos_shape`). */
export function isValidPhotoData(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 1000 || value.length > 80_000) return false;
  if ((value.length - 'data:image/jpeg;base64,'.length) % 4 !== 0) return false;
  return PHOTO_RE.test(value);
}

/** Size that fits `maxSide` on the long side, never upscaling. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Clamps a crop area (from react-easy-crop, in image pixels) into the image. */
export function clampArea(area: Area, width: number, height: number): Area {
  const x = Math.max(0, Math.min(Math.round(area.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(area.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(area.width), width - x)),
    height: Math.max(1, Math.min(Math.round(area.height), height - y)),
  };
}

/** Tries each quality until the encoded result is small enough. */
export function encodeWithinLimit(
  encode: (quality: number) => string,
  maxLength = PHOTO_MAX_LENGTH
): PhotoResult<string> {
  for (const quality of QUALITY_STEPS) {
    const dataUrl = encode(quality);
    if (!dataUrl.startsWith('data:image/jpeg;')) return { ok: false, reason: 'unsupported' };
    if (dataUrl.length <= maxLength && isValidPhotoData(dataUrl)) return { ok: true, value: dataUrl };
  }
  return { ok: false, reason: 'tooLarge' };
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unsupported image'));
    image.src = src;
  });
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('encode failed'))),
      'image/jpeg',
      0.9
    );
  });
}

/**
 * Decodes the picked file and returns an object URL of a downscaled copy for the cropper, plus
 * its size. The caller revokes the URL. Browsers apply EXIF orientation when drawing an <img>.
 */
export async function prepareForCrop(
  file: File
): Promise<PhotoResult<{ url: string; width: number; height: number }>> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'tooBig' };
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'unsupported' };
  const original = URL.createObjectURL(file);
  try {
    const image = await decode(original);
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, PREVIEW_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unsupported' };
    // JPEG has no transparency: paint white first so transparent PNGs do not turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const url = await canvasToBlobUrl(canvas);
    // Release the big canvas backing store now (iOS keeps it until GC otherwise).
    canvas.width = 0;
    canvas.height = 0;
    return { ok: true, value: { url, width, height } };
  } catch {
    return { ok: false, reason: 'unsupported' };
  } finally {
    URL.revokeObjectURL(original);
  }
}

/** Draws the chosen square of the preview to 256×256 and encodes it within the size limit. */
export async function cropToJpeg(previewUrl: string, area: Area): Promise<PhotoResult<string>> {
  try {
    const image = await decode(previewUrl);
    const a = clampArea(area, image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIDE;
    canvas.height = PHOTO_SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unsupported' };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, a.x, a.y, a.width, a.height, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
    return encodeWithinLimit((q) => canvas.toDataURL('image/jpeg', q));
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}
