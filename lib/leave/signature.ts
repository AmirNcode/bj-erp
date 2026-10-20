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
  /** Shown instead of `instructions` while the saved signature (FR-52) fills the box. */
  savedNote: string;
  useSaved: string;
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

/**
 * The first reason a signed submission is refused before it reaches the
 * database, as the raw message `dbErr` localizes, or null. Order matters: the
 * authorization box is reported before a missing drawing.
 */
export function signatureProblem(input: {
  signatureData: string;
  signatureAuthorized: boolean;
}): string | null {
  if (!input.signatureAuthorized) return 'signature authorization is required';
  if (!input.signatureData) return 'signature is required';
  if (!isValidSignatureData(input.signatureData)) return 'signature data is invalid';
  return null;
}

/** A per diem (FR-61) is absent, or whole Rials of 0 or more. */
export function perDiemProblem(rials: number | null | undefined): string | null {
  if (rials === null || rials === undefined) return null;
  return Number.isSafeInteger(rials) && rials >= 0 ? null : 'per diem must be 0 or more';
}
