/** @type {import('next').NextConfig} */
// Last deploy: 2026-07-07
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
    ]
  },
}

export default nextConfig
