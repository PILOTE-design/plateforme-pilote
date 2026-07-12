import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'PILOTE — Analyses comparatives pour votre commerce',
  description:
    'Recevez chaque semaine une analyse comparative automatisée pour piloter votre activité. Service dédié aux TPE : bouchers, boulangers, artisans.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
