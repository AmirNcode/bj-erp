import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  // Dev-only: let devices on the LAN (e.g. a phone on the same Wi-Fi) load the
  // dev server's HMR / _next assets. Next blocks cross-origin dev requests by
  // default. List the host(s) the phone uses to reach this machine.
  allowedDevOrigins: ['192.168.2.48'],
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
export default withNextIntl(nextConfig);

