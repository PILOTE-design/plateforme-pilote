/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stripe webhook needs raw body
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
