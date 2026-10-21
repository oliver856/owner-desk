import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Apex Owner Desk',
    short_name: 'Apex Desk',
    start_url: '/phone',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f5c56',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
