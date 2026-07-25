// =============================================================================
// deploy/gen-keys.mjs — sign the anon + service_role API keys from JWT_SECRET.
//
// Self-hosted Supabase API keys are just long-lived JWTs signed with the
// stack's shared JWT secret (HS256). install.sh runs this inside the app
// image (node is guaranteed there) so the target server needs no extra tools:
//
//   docker run --rm --entrypoint node bj-erp-app /gen-keys.mjs "$JWT_SECRET"
//
// Prints JSON: {"anon":"…","service_role":"…"}
// =============================================================================

import { createHmac } from 'node:crypto';

const secret = process.argv[2];
if (!secret || secret.length < 32) {
  console.error('usage: node gen-keys.mjs <jwt-secret (min 32 chars)>');
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(role) {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ role, iss: 'supabase', iat, exp: iat + 10 * 365 * 24 * 3600 })
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

console.log(JSON.stringify({ anon: sign('anon'), service_role: sign('service_role') }));
