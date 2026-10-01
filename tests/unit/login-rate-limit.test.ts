import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER } from '@/lib/supabase/constants';

/**
 * Login rate limiting spans four files that must agree on one header name, and
 * mistakes can fail silently: the pinned GoTrue skips its limiter if the header
 * is absent, while stamping an internal address combines unrelated users into
 * one shared bucket. These assertions check the configuration wiring; runtime
 * verification is still required when upgrading the gateway or Auth service.
 */
describe('login rate limiting wiring', () => {
  const caddyfile = readFileSync('deploy/caddy/Caddyfile', 'utf8');
  const compose = readFileSync('deploy/docker-compose.yml', 'utf8');

  it('names the same client-IP header in the gateway, GoTrue, and the app', () => {
    // HTTP header names are case-insensitive; compare on one casing.
    const headerInCompose = compose.match(/GOTRUE_RATE_LIMIT_HEADER:\s*(\S+)/)?.[1];
    expect(headerInCompose).toBeDefined();
    expect(headerInCompose!.toLowerCase()).toBe(CLIENT_IP_HEADER);

    // The gateway must stamp it on both the browser's direct login path and
    // the app path, since most refreshes are issued by the app on the user's
    // behalf and it can only forward a value it was given.
    const stamps = caddyfile.match(
      new RegExp(`header_up\\s+${CLIENT_IP_HEADER}\\s+\\{client_ip\\}`, 'gi')
    );
    expect(stamps).toHaveLength(2);
  });

  it('overwrites client identity without a conflicting delete operation', () => {
    // Caddy's set replaces all inbound values. Combining set and delete for the
    // same header removes the trusted value; pinned GoTrue then skips limiting.
    for (const path of ['deploy/caddy/Caddyfile', 'deploy/liara/Caddyfile']) {
      const config = readFileSync(path, 'utf8');
      expect(config).not.toMatch(/header_up\s+-X-BJ-Client-IP/i);
      expect(config.match(/header_up\s+X-BJ-Client-IP\s+\{client_ip\}/gi)).toHaveLength(2);
    }
  });

  it('never lets the internal listener overwrite the forwarded header', () => {
    // The unpublished :8080 listener's only caller is the app container. If it
    // stamped its own view, every employee's refresh would be rewritten to the
    // app's address — the exact single-bucket collapse this feature prevents.
    const internal = caddyfile.slice(caddyfile.indexOf('http://:8080'));
    expect(internal).not.toMatch(new RegExp(`header_up\\s+${CLIENT_IP_HEADER}`, 'i'));
  });

  it('defaults to trusting no upstream proxy', () => {
    // Anything trusted here can name any client IP it likes. 127.0.0.1/32 can
    // never be the source address of an inbound connection, so the default is
    // inert until an operator names the real gateway.
    expect(caddyfile).toMatch(/trusted_proxies static \{\$TRUSTED_PROXY_CIDRS:127\.0\.0\.1\/32\}/);
    expect(caddyfile).toContain('trusted_proxies_strict');
    expect(compose).toMatch(/TRUSTED_PROXY_CIDRS:\s*\$\{TRUSTED_PROXY_CIDRS:-127\.0\.0\.1\/32\}/);
  });

  it('budgets sustained office traffic in five-minute units', () => {
    // Pinned GoTrue v2.170.0 divides this value by 300 seconds, with burst 30.
    // 200 employees at up to 5 calls/hour need 1000/hour sustained behind NAT.
    // This checks average capacity, not simultaneous-login burst behavior.
    const ceiling = compose.match(
      /GOTRUE_RATE_LIMIT_TOKEN_REFRESH:\s*\$\{RATE_LIMIT_TOKEN_PER_IP_5_MINUTES:-\$\{RATE_LIMIT_TOKEN_PER_IP_HOUR:-(\d+)\}\}/
    )?.[1];
    expect(ceiling).toBeDefined();
    expect(Number(ceiling) * (60 / 5)).toBeGreaterThanOrEqual(200 * 5);
  });

  it('forwards the header from both server-side Supabase clients', () => {
    // proxy.ts is where refreshes actually happen; server.ts covers Server
    // Actions and Server Components that touch Auth.
    for (const file of ['proxy.ts', 'lib/supabase/server.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('CLIENT_IP_HEADER');
      expect(source).toContain('global: { headers: { [CLIENT_IP_HEADER]: clientIp } }');
    }
  });
});
