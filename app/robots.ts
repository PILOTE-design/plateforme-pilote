import type { MetadataRoute } from 'next'

// URL publique du site — surchargée par NEXT_PUBLIC_SITE_URL si définie dans Vercel
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getpilote.app'

/** robots.txt généré par Next : la vitrine est indexable, l'application ne l'est pas. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/admin', '/api', '/onboarding'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
