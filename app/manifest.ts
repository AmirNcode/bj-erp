import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'سامانه منابع انسانی',
    short_name: 'HR System',
    description: 'HR Management System — سامانه منابع انسانی',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F8FB',
    theme_color: '#2E3C92',
    lang: 'fa',
    dir: 'rtl',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Same monogram, inset to the maskable safe zone, so Android can crop to a
      // circle or squircle without clipping the letters.
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
