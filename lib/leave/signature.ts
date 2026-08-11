/** Maximum persisted PNG data-URL length (roughly 260 KiB of decoded image data). */
export const MAX_SIGNATURE_DATA_LENGTH = 350_000;
export const MIN_SIGNATURE_DATA_LENGTH = 100;

export type SignatureLabels = {
  title: string;
  instructions: string;
  clear: string;
  authorization: string;
  validationSignature: string;
  validationAuthorization: string;
  canvasLabel: string;
  view: string;
  hide: string;
  loading: string;
  authorizedAt: string;
};

const PNG_DATA_URL_RE = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;

/**
 * Accept only the bounded PNG shape produced by the in-app canvas.
 * The database repeats this validation because client/server checks are UX,
 * while the request writer is the trust boundary.
 */
export function isValidSignatureData(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_SIGNATURE_DATA_LENGTH &&
    value.length <= MAX_SIGNATURE_DATA_LENGTH &&
    value.length % 4 === 2 &&
    PNG_DATA_URL_RE.test(value)
  );
}
