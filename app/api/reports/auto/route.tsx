/**
 * Flash hebdo — SUPPRIMÉ (juillet 2026).
 *
 * Cette route générait automatiquement chaque lundi matin un PDF « Flash hebdo »
 * pour tous les clients, en plus du rapport hebdomadaire complet. La fonctionnalité
 * a été retirée : le rapport complet est désormais le seul livrable.
 *
 * Retiré en même temps :
 *   - le cron `/api/reports/auto` dans `vercel.json`
 *   - la mention « flash automatique le lundi matin » sur le tableau de bord
 *
 * Le fichier est conservé en coquille (plutôt que supprimé) pour qu'un appel
 * résiduel — cron oublié, tâche externe, favori — réponde explicitement au lieu
 * de tomber sur un 404 muet. Les rapports « Flash hebdo » déjà générés restent
 * dans la table `reports`, donc visibles dans « Mes rapports » : les retirer se
 * fait en base, pas ici.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GONE = {
  error: 'Fonctionnalite supprimee',
  detail: "La generation automatique du flash hebdo n'existe plus. Seul le rapport hebdomadaire complet est genere.",
}

export async function GET() {
  return NextResponse.json(GONE, { status: 410 })
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 })
}
