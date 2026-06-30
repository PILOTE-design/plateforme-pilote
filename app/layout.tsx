import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'PILOTE — Analyses comparatives pour votre commerce',
  description:
    'Recevez chaque semaine une analyse comparative automatisée pour piloter votre activité. Service dédié aux TPE : bouchers, boulangers, artisans.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
