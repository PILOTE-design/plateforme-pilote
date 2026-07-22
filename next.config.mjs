/** @type {import('next').NextConfig} */
// Last deploy: 2026-07-22 — redeploiement (arborescence porc + corrections boeuf)
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["exceljs", "pdf-parse", "@react-pdf/renderer"] },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Stripe webhook needs raw body
  webpack: (config, { isServer }) => {
    if (isServer) {
      if (!Array.isArray(config.externals)) config.externals = []
      config.externals.push('exceljs', 'pdf-parse', 'canvas', '@react-pdf/renderer')
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/api/stripe/webhook',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        // En-têtes de sécurité globaux — hygiène standard d'un SaaS :
        // pas d'iframe tiers (anti-clickjacking), pas de sniffing MIME,
        // referrer limité, capteurs désactivés, HTTPS forcé 2 ans.
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default nextConfig
