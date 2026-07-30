import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// React's development build uses eval() for debugging features (owner stacks,
// reconstructing callstacks). Production never does, so the allowance is scoped
// to `next dev` and never reaches a built image.
const isDev = process.env.NODE_ENV === 'development';

const publicSupabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Self-host packaging (deploy/): emit a minimal standalone server bundle so
  // the Docker image ships only what it runs. No effect on Vercel deploys.
  output: 'standalone',

  // Dev-only: let devices on the LAN (e.g. a phone on the same Wi-Fi) load the
  // dev server's HMR / _next assets. Next blocks cross-origin dev requests by
  // default. List the host(s) the phone uses to reach this machine.
  allowedDevOrigins: ['192.168.2.48'],

  experimental: {
    // Client router cache: reuse a visited (dynamic) page for 5 minutes, so
    // switching back to a recent tab renders instantly instead of re-running
    // the full server render. Safe here: leave data changes rarely, the user's
    // own mutations revalidate their paths, and every page has an explicit
    // refresh pill (router.refresh() bypasses this cache).
    staleTimes: {
      dynamic: 300,
    },
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // App is never embedded — block clickjacking.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // The app uses none of these — deny by default.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
              `connect-src 'self'${publicSupabaseOrigin ? ` ${publicSupabaseOrigin}` : ''}`,
              "worker-src 'self' blob:",
              "manifest-src 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
export default withNextIntl(nextConfig);
