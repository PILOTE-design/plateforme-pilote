// Types du rapport hebdomadaire — extraits de route.tsx, aucun changement.
import type { WeekEconomics } from '@/lib/week-economics'

// ─── Types ────────────────────────────────────────────────────────
export interface Produit { plu: string; designation: string; ventes: number; montant: number }
export interface Famille { id: string; nom: string; total_montant: number; produits: Produit[] }
export interface FinancierData { ca_net: number; nb_tickets: number; moyenne_ticket: number }
export interface ReportData {
  period_n: string; period_n1: string; week_number: number; year: number
  financier_n: FinancierData; financier_n1: FinancierData
  ventes_n: { total: number; familles: Famille[] }
  ventes_n1: { total: number; familles: Famille[] }
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
}
// Données extraites complètes : ReportData + CA par produit (pour l'historisation)
export interface ExtractedData extends ReportData {
  prodN: Map<string, number>
  prodN1: Map<string, number>
  prodFamN: Map<string, string>
  prodFamN1: Map<string, string>
  /** Corrections appliquées PENDANT l'extraction (total reconcilié, décimale
   *  perdue corrigée, famille écartée…). Plus jamais un simple console.warn :
   *  ces notes alimentent le contrôle `corrections_extraction` (lib/report-checks)
   *  qui met l'extraction en statut « à valider ». */
  notes: string[]
}
export interface Insights { resume: string; insights: string[]; recommendations: string[]; vigilance: string[] }
export interface FamRow { nom: string; caN: number; caN1: number | null; ecart: number }
export interface WeekStatus { label: string; color: string; light: string; desc: string }
export interface ComputedReport {
  data: ReportData
  clientName: string | null
  insights: Insights
  /** null quand QuickChart n'a pas répondu — le tableau de la page 4 prend le relais */
  pieBuffer: Buffer | null
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
  famRows: FamRow[]
  caVar: number
  status: WeekStatus
  execSummary: string
  /** Économie de la semaine (achats, salaires, charges) — null si aucun client rattaché */
  economics: WeekEconomics | null
  /** Lecture métier de la marge : alertes puis recommandation prioritaire */
  margeRead: { alerts: string[]; action: string | null }
}
