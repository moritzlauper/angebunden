import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite bringt WebAssembly mit, pg native Optionen: beide nicht bündeln.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // Die Migrationen liest drizzle zur Laufzeit von der Platte.
  outputFileTracingIncludes: { '/**': ['./drizzle/**/*'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
