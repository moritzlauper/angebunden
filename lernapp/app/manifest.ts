import type { MetadataRoute } from 'next'

/** Damit sich die App auf dem Handy als Icon auf den Home-Bildschirm legen lässt. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Klicker',
    short_name: 'Klicker',
    description: 'Klickerfragen mit eigenem Lernstand',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c0a09',
    theme_color: '#0c0a09',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
