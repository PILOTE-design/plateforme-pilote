import type { MetadataRoute } from 'next'

// URL publique du site — surchargée par NEXT_PUBLIC_SITE_URL si définie dans Vercel
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getpilote.app'

/** Sitemap des pages publiques uniquement (l'application est hors indexation). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: '',                  priority: 1.0 },
    { path: '/signup',           priority: 0.8 },
    { path: '/login',            priority: 0.3 },
    { path: '/mentions-legales', priority: 0.2 },
    { path: '/cgv',              priority: 0.2 },
  ]
  return pages.map(({ path, priority }) => ({
    url: `${BASE_URL}${path}`,
    changeFrequency: 'monthly' as const,
    priority,
  }))
}
