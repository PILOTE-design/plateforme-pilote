import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, PAYROLL_ENTRY_COLUMNS, type PayrollEmployee, type PayrollEntry } from '@/lib/payroll'
import { rapportDuMois, semainesDuMois, versCsv, nomFichier } from '@/lib/rapport-comptable'
import type { VerrouSemaine } from '@/lib/planning-lock'

export const dynamic = 'force-dynamic'

// ─── Le rapport comptable d'un mois ─────────────────────────────────────────
//
// Tout le raisonnement — ventilation jour par jour, seuil hebdomadaire des
// heures supplémentaires, semaines à cheval, réserves — vit dans
// lib/rapport-comptable. Cette route ne fait que rassembler les trois sources
// (employés, planning, verrous) et rendre le résultat, en JSON ou en CSV.
//
// `?format=csv` renvoie le fichier. Le contenu du CSV est produit par le même
// module que l'écran : un export qui diverge de ce qu'on voit serait un
// troisième chiffre.

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const mois = parseInt(searchParams.get('mois') || '0')
  const annee = parseInt(searchParams.get('annee') || '0')
  const csv = searchParams.get('format') === 'csv'
  if (!mois || !annee || mois < 1 || mois > 12) {
    return NextResponse.json({ error: 'Mois invalide' }, { status: 400 })
  }

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: employes } = await serviceSupabase
    .from('employees')
    .select(`${PAYROLL_EMPLOYEE_COLUMNS}, contract_type`)
    .eq('client_id', clientId)
    .order('name')

  const liste = (employes || []) as unknown as PayrollEmployee[]

  // Les semaines à charger. Une semaine de bascule porte l'année SUIVANTE
  // (S1/2026 court du 29/12/2025 au 04/01/2026) : on interroge donc sur les
  // couples (semaine, année) réellement listés, pas sur l'année du mois.
  const semaines = semainesDuMois(mois, annee)
  const numeros = Array.from(new Set(semaines.map(s => s.week)))
  const annees = Array.from(new Set(semaines.map(s => s.year)))

  const parSemaine = new Map<string, PayrollEntry[]>()
  if (liste.length > 0 && numeros.length > 0) {
    const ids = liste.map(e => String(e.id))
    const { data: entries } = await serviceSupabase
      .from('planning_entries')
      .select(`${PAYROLL_ENTRY_COLUMNS},week_number,year`)
      .in('employee_id', ids)
      .in('week_number', numeros)
      .in('year', annees)

    for (const e of (entries || []) as Record<string, unknown>[]) {
      const cle = `${e.year}-${e.week_number}`
      const seau = parSemaine.get(cle)
      if (seau) seau.push(e as PayrollEntry)
      else parSemaine.set(cle, [e as PayrollEntry])
    }
  }

  const { data: verrous } = await serviceSupabase
    .from('planning_locks')
    .select('week_number, year, locked_at, locked_by, note')
    .eq('client_id', clientId)
    .in('year', annees)

  const rapport = rapportDuMois(mois, annee, liste, parSemaine, (verrous || []) as VerrouSemaine[])

  if (!csv) return NextResponse.json(rapport)

  return new NextResponse(versCsv(rapport), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomFichier(rapport)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
