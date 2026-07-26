import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * OBSOLÈTE — l'ancienne « catégorisation » (famille de vente / catégorie d'achat →
 * groupe de marge) a été remplacée par un réglage unique : les familles de marge du
 * client (clients.margin_families) + la ventilation fournisseur (supplier_rayon_splits),
 * tous deux réglés en page Facturation. Plus personne ne lit margin_mappings.
 * Ce fichier ne subsiste que pour répondre proprement à un onglet resté ouvert ;
 * il peut être supprimé du dépôt, ainsi que components/MargesWizard.tsx et
 * lib/marges-config.ts.
 */
const gone = () => NextResponse.json(
  { error: 'Réglage supprimé : familles de marge et ventilation fournisseur se règlent en Facturation.' },
  { status: 410 },
)

export async function GET() { return gone() }
export async function POST() { return gone() }
