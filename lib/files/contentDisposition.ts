/** `attachment` header with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '');
  const fallback = clean.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
