import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
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
          // The app uses none of these — deny by default.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
export default withNextIntl(nextConfig);
