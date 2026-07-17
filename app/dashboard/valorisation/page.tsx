'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calculator, TrendingUp, Package, Info, AlertTriangle, CheckCircle, Save, Trash2, Clock, X, Loader2, Users, BarChart2, RotateCcw, ChevronRight } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CutCategory = 'premier' | 'deuxieme' | 'troisieme' | 'abat' | 'os'
type AnimalType  = 'boeuf' | 'veau' | 'agneau' | 'porc' | 'volaille'
type BoeufDecoupe = 'b1' | 'b2'

interface Breed { id: string; name: string; carcassYield: number; avgWeight: string; origin: string; description: string }
interface Cut   { id: string; name: string; category: CutCategory; yieldPct: number; marketPrice: number; group?: string[] }
interface CutResult { cut: Cut; weight: number; sellingPrice: number; revenue: number; active: boolean }
interface SavedValo {
  id: string; breed_id: string; breed_name: string; live_weight: number; quantity: number
  purchase_per_kg: number; overhead_cost: number; labor_cost: number; target_margin: number
  purchase_date: string; notes?: string; carcass_weight: number; total_cost: number
  total_revenue: number; margin_rate: number; coefficient: number; created_at: string
  animal_type?: string
}
interface WeekStats {
  key: string; label: string; week: number; year: number
  count: number; lots: number; totalCost: number; totalRevenue: number; marginRate: number; breeds: string[]
}
interface AnimalConfig {
  label: string; emoji: string; accent: string; breedLabel: string
  breeds: Breed[]; cuts: Cut[]
  defaultWeight: string; defaultPurchaseKg: string; defaultLabor: string
}
interface WeekLabor { hours: number; cost: number; rate: number; decoupeHours: number; decoupeCost: number; week: number; year: number }

// ─── Données Bœuf ─────────────────────────────────────────────────────────────────

const BOEUF_BREEDS: Breed[] = [
  { id: 'charolaise',       name: 'Charolaise',         carcassYield: 0.645, avgWeight: '750-950 kg',  origin: 'Bourgogne',        description: 'Race à viande n°1 en France. Masses musculaires très développées. Viande ferme, peu persillée, idéale pour pièces à griller et rôtir.' },
  { id: 'limousine',        name: 'Limousine',          carcassYield: 0.655, avgWeight: '650-850 kg',  origin: 'Limousin',         description: 'Meilleur rendement en muscles nobles toutes races confondues. Grain fin, couleur rouge vif. Conformation E.' },
  { id: 'blonde_aquitaine', name: "Blonde d'Aquitaine", carcassYield: 0.640, avgWeight: '750-950 kg',  origin: 'Sud-Ouest',        description: 'Viande maigre et tendre, bonne conformation E-U. Rendement élevé en pièces nobles.' },
  { id: 'salers',           name: 'Salers',             carcassYield: 0.600, avgWeight: '600-750 kg',  origin: 'Auvergne',         description: 'Race rustique de montagne. Viande goûteuse et légèrement persillée.' },
  { id: 'aubrac',           name: 'Aubrac',             carcassYield: 0.578, avgWeight: '550-700 kg',  origin: 'Aveyron-Lozère',   description: 'Viande bien persillée, saveur prononcée et fondante. Qualité gustative remarquable.' },
  { id: 'normande',         name: 'Normande',           carcassYield: 0.555, avgWeight: '600-750 kg',  origin: 'Normandie',        description: 'Race mixte lait et viande. Viande marbrée, persillage notable, saveur riche.' },
  { id: 'maine_anjou',      name: 'Maine-Anjou',        carcassYield: 0.625, avgWeight: '800-1000 kg', origin: 'Pays de la Loire', description: 'Grosse race mixte. Viande marbrée et savoureuse, très appréciée pour les grandes pièces.' },
  { id: 'angus',            name: 'Aberdeen Angus',     carcassYield: 0.578, avgWeight: '600-750 kg',  origin: 'Écosse/France',    description: 'Persillage exceptionnel dit marbré, viande fondante et savoureuse. Segment premium.' },
  { id: 'hereford',         name: 'Hereford',           carcassYield: 0.565, avgWeight: '550-700 kg',  origin: 'Angleterre/France', description: 'Viande bien persillée, tendre et goûteuse. Qualité constante, appréciée des bouchers exigeants.' },
]
// Découpe bœuf en arborescence (fournie par le boucher). Chaque pièce = une feuille avec son
// chemin `group` (catégorie → grosse pièce → sous-groupe). yieldPct non utilisé (poids manuel) ;
// marketPrice = prix de référence indicatif, modifiable par pièce.
const BOEUF_CUTS: Cut[] = [
  // ── BCUH ──
  { id: 'jarret_avec_os',         name: 'Jarret avec os',          category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['BCUH', 'Jarret'] },
  { id: 'jarret_sans_os',         name: 'Jarret sans os',          category: 'troisieme', yieldPct: 0, marketPrice: 14, group: ['BCUH', 'Jarret'] },
  { id: 'araignee_b',             name: 'Araignée',                category: 'premier',   yieldPct: 0, marketPrice: 32, group: ['BCUH', 'Globe'] },
  { id: 'tende_tranche',          name: 'Tende de tranche',        category: 'premier',   yieldPct: 0, marketPrice: 18, group: ['BCUH', 'Globe'] },
  { id: 'coeur_tranche',          name: 'Cœur de tranche',         category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['BCUH', 'Globe'] },
  { id: 'entame',                 name: 'Entame',                  category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['BCUH', 'Globe'] },
  { id: 'chapeau',                name: 'Chapeau',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['BCUH', 'Globe'] },
  { id: 'talon',                  name: 'Talon',                   category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['BCUH', 'Globe'] },
  { id: 'rond_tranche_grasse',    name: 'Rond de tranche grasse',  category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['BCUH', 'Globe', 'Tranche grasse'] },
  { id: 'plat_tranche_grasse',    name: 'Plat de tranche grasse',  category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['BCUH', 'Globe', 'Tranche grasse'] },
  { id: 'mouvant_tranche_grasse', name: 'Mouvant de tranche grasse', category: 'deuxieme', yieldPct: 0, marketPrice: 15, group: ['BCUH', 'Globe', 'Tranche grasse'] },
  { id: 'gite_noix',              name: 'Gîte à la noix',          category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['BCUH', 'Globe', 'Semelle'] },
  { id: 'rond_de_gite',           name: 'Rond de gîte',            category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['BCUH', 'Globe', 'Semelle'] },
  { id: 'nerveux',                name: 'Nerveux',                 category: 'troisieme', yieldPct: 0, marketPrice: 11, group: ['BCUH', 'Globe', 'Semelle'] },
  { id: 'oreille_gite',           name: 'Oreille de gîte',         category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['BCUH', 'Globe', 'Semelle'] },
  { id: 'filet_rtk',              name: 'Filet de rumsteck',       category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['BCUH', 'RTK', 'Rumsteck classique'] },
  { id: 'coeur_rtk',              name: 'Cœur de rumsteck',        category: 'premier',   yieldPct: 0, marketPrice: 24, group: ['BCUH', 'RTK', 'Rumsteck classique'] },
  { id: 'langue_de_chat',         name: 'Langue de chat',          category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['BCUH', 'RTK', 'Rumsteck classique'] },
  { id: 'baronne',                name: 'Baronne',                 category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['BCUH', 'RTK'] },
  { id: 'coeur_hanche',           name: 'Cœur de hanche',          category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['BCUH', 'Hanche'] },
  { id: 'fausse_araignee',        name: 'Fausse araignée',         category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['BCUH', 'Hanche'] },
  { id: 'dessus_hanche',          name: 'Dessus de hanche',        category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['BCUH', 'Hanche'] },
  { id: 'poire',                  name: 'Poire',                   category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['BCUH', 'Hanche'] },
  { id: 'merlan',                 name: 'Merlan',                  category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['BCUH', 'Hanche'] },
  // ── DEHMT ──
  { id: 'faux_filet_b',           name: 'Faux-filet',              category: 'premier',   yieldPct: 0, marketPrice: 29, group: ['DEHMT'] },
  { id: 'filet_b',                name: 'Filet',                   category: 'premier',   yieldPct: 0, marketPrice: 45, group: ['DEHMT'] },
  { id: 'dessus_de_cote',         name: 'Dessus de côté',          category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['DEHMT', 'Carré côté'] },
  // ── BAVETTE ──
  { id: 'flanchet',               name: 'Flanchet',                category: 'deuxieme',  yieldPct: 0, marketPrice: 12, group: ['BAVETTE'] },
  { id: 'bavette_aloyau_b',       name: "Bavette d'aloyau",        category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['BAVETTE'] },
  { id: 'fausse_bavette',         name: 'Fausse bavette',          category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['BAVETTE'] },
]
// Découpe B2 — nomenclature CEFIMEV (avant du bœuf : épaule + collier basse-côte).
// Arborescence : grande pièce → sous-pièce. Prix de référence indicatifs, modifiables.
const BOEUF_B2_CUTS: Cut[] = [
  // ── ÉPAULE (B 4.1) ──
  { id: 'b2_jarret_avant',      name: 'Jarret (avant)',          category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['Épaule'] },
  { id: 'b2_boite_a_moelle',    name: 'Boîte à moelle',          category: 'deuxieme',  yieldPct: 0, marketPrice: 12, group: ['Épaule'] },
  { id: 'b2_dessus_macreuse',   name: 'Dessus de macreuse',      category: 'premier',   yieldPct: 0, marketPrice: 19, group: ['Épaule', 'Macreuse à biftecks'] },
  { id: 'b2_macreuse_roti',     name: 'Macreuse (rôti)',         category: 'premier',   yieldPct: 0, marketPrice: 18, group: ['Épaule', 'Macreuse à biftecks'] },
  { id: 'b2_paleron',           name: 'Paleron',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['Épaule'] },
  { id: 'b2_dessus_palette',    name: 'Dessus de palette',       category: 'deuxieme',  yieldPct: 0, marketPrice: 13, group: ['Épaule'] },
  { id: 'b2_jumeau',            name: 'Jumeau',                  category: 'premier',   yieldPct: 0, marketPrice: 16, group: ['Épaule'] },
  // ── COLLIER BASSE-CÔTE (B 4.2) ──
  { id: 'b2_persille',          name: 'Persillé',                category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['Collier basse-côte', 'Basse côte'] },
  { id: 'b2_basse_cote',        name: 'Basse côte (entrecôte minute)', category: 'premier', yieldPct: 0, marketPrice: 17, group: ['Collier basse-côte', 'Basse côte'] },
  { id: 'b2_veine_maigre',      name: 'Veine maigre',            category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['Collier basse-côte', 'Collier'] },
  { id: 'b2_saliere',           name: 'Salière',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 13, group: ['Collier basse-côte', 'Collier'] },
  { id: 'b2_veine_grasse',      name: 'Veine grasse',            category: 'deuxieme',  yieldPct: 0, marketPrice: 11, group: ['Collier basse-côte', 'Collier'] },
  { id: 'b2_filet_mignon_col',  name: 'Filet mignon (de collier)', category: 'premier', yieldPct: 0, marketPrice: 14, group: ['Collier basse-côte', 'Collier'] },
]

// ── Arborescence de découpe (dérivée du champ `group`) ──
interface TreeNode { name: string; path: string; children: TreeNode[]; cut?: Cut }
function buildCutTree(cuts: Cut[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()
  for (const cut of cuts) {
    const names = cut.group ?? []
    let list = roots
    let acc = ''
    for (const nm of names) {
      acc = acc ? `${acc} / ${nm}` : nm
      let node = byPath.get(acc)
      if (!node) { node = { name: nm, path: acc, children: [] }; byPath.set(acc, node); list.push(node) }
      list = node.children
    }
    list.push({ name: cut.name, path: `${acc} / ${cut.name}`, children: [], cut })
  }
  return roots
}
function collectLeafCuts(node: TreeNode): Cut[] {
  return node.cut ? [node.cut] : node.children.flatMap(collectLeafCuts)
}

// ─── Données Veau ─────────────────────────────────────────────────────────────────

const VEAU_BREEDS: Breed[] = [
  { id: 'veau_lait_limousin', name: 'Veau de lait Limousin',   carcassYield: 0.62, avgWeight: '160-200 kg', origin: 'Limousin',  description: 'Label Rouge. Élevé sous la mère. Chair rose pâle, très tendre et fine. Le standard haut de gamme.' },
  { id: 'veau_grain',         name: 'Veau de grain (breton)',  carcassYield: 0.59, avgWeight: '180-240 kg', origin: 'Bretagne',  description: 'Nourri aux céréales. Viande rosée légèrement plus colorée. Excellent rapport qualité/prix.' },
  { id: 'veau_rose',          name: 'Veau rosé nature',        carcassYield: 0.57, avgWeight: '200-260 kg', origin: 'France',    description: 'Élevé en plein air. Bon équilibre entre tendreté et saveur. Viande rose.' },
  { id: 'veau_lourd',         name: 'Veau lourd finition',     carcassYield: 0.60, avgWeight: '250-300 kg', origin: 'France',    description: 'Animal plus âgé, viande légèrement plus ferme et goûteuse. Fort rendement.' },
  { id: 'veau_blanc_fermier', name: 'Veau blanc fermier IGP',  carcassYield: 0.63, avgWeight: '170-220 kg', origin: 'Aveyron',   description: 'IGP. Élevé sous la mère, lait fermier. Viande très blanche, extrêmement tendre. Produit premium.' },
]
const VEAU_CUTS: Cut[] = [
  { id: 'filet_veau',    name: 'Filet',                 category: 'premier',   yieldPct: 1.5,  marketPrice: 36 },
  { id: 'noix_veau',     name: 'Noix / Quasi',           category: 'premier',   yieldPct: 5.5,  marketPrice: 28 },
  { id: 'longe_veau',    name: 'Longe',                  category: 'premier',   yieldPct: 4.5,  marketPrice: 24 },
  { id: 'cote_veau',     name: 'Côte première',          category: 'premier',   yieldPct: 5.0,  marketPrice: 22 },
  { id: 'escalope_veau', name: 'Escalope (noix)',        category: 'premier',   yieldPct: 3.0,  marketPrice: 30 },
  { id: 'ris_veau',      name: 'Ris de veau',            category: 'abat',      yieldPct: 0.3,  marketPrice: 28 },
  { id: 'epaule_veau',   name: 'Épaule désossée',        category: 'deuxieme',  yieldPct: 7.0,  marketPrice: 16 },
  { id: 'jarret_veau',   name: 'Jarret (osso-buco)',     category: 'deuxieme',  yieldPct: 5.0,  marketPrice: 18 },
  { id: 'tendron_veau',  name: 'Tendron',                category: 'deuxieme',  yieldPct: 3.5,  marketPrice: 14 },
  { id: 'poitrine_veau', name: 'Poitrine',               category: 'troisieme', yieldPct: 4.0,  marketPrice: 10 },
  { id: 'collet_veau',   name: 'Collier',                category: 'troisieme', yieldPct: 3.0,  marketPrice: 9  },
  { id: 'foie_veau',     name: 'Foie de veau',           category: 'abat',      yieldPct: 1.2,  marketPrice: 16 },
  { id: 'rognons_veau',  name: 'Rognons',                category: 'abat',      yieldPct: 0.2,  marketPrice: 12 },
  { id: 'os_veau',       name: 'Os à moelle',            category: 'os',        yieldPct: 8.0,  marketPrice: 2  },
]

// ─── Données Agneau ────────────────────────────────────────────────────────────────

const AGNEAU_BREEDS: Breed[] = [
  { id: 'berrichon',         name: 'Berrichon du Cher',          carcassYield: 0.50, avgWeight: '35-45 kg', origin: 'Centre-Val de Loire', description: 'Race bouchère par excellence. Gigot charnu, viande tendre et rosée. Label Rouge Agneau du Berry.' },
  { id: 'ile_france_agneau', name: 'Île-de-France',              carcassYield: 0.48, avgWeight: '35-50 kg', origin: 'Bassin parisien',     description: 'Très bonne conformation. Viande fine et savoureuse, légèrement persillée.' },
  { id: 'suffolk',           name: 'Suffolk',                    carcassYield: 0.52, avgWeight: '40-55 kg', origin: 'Grande-Bretagne',     description: 'Excellente conformation bouchère. Viande ferme et goûteuse, bon rendement.' },
  { id: 'charollais_agneau', name: 'Charollais',                 carcassYield: 0.50, avgWeight: '38-48 kg', origin: 'Bourgogne',           description: 'Excellent qualité bouchère. Masse musculaire développée, viande tendre.' },
  { id: 'texel',             name: 'Texel',                      carcassYield: 0.53, avgWeight: '40-55 kg', origin: 'Pays-Bas/France',     description: 'Meilleur rendement en viande maigre. Pièces bien conformées.' },
  { id: 'lacaune',           name: 'Lacaune',                    carcassYield: 0.45, avgWeight: '30-40 kg', origin: 'Tarn-Aveyron',        description: 'Race mixte lait/viande. Viande plus maigre, qualité régulière.' },
  { id: 'agneau_lait',       name: 'Agneau de lait Pyrénées',    carcassYield: 0.56, avgWeight: '12-18 kg', origin: 'Pyrénées',            description: 'Très jeune animal, viande blanche rosée, texture fondante. Produit de fête, prix premium.' },
]
const AGNEAU_CUTS: Cut[] = [
  { id: 'gigot_agneau',      name: 'Gigot entier',            category: 'premier',   yieldPct: 30,  marketPrice: 18 },
  { id: 'carre_agneau',      name: 'Carré (côtes premières)', category: 'premier',   yieldPct: 12,  marketPrice: 22 },
  { id: 'selle_agneau',      name: 'Selle double',            category: 'premier',   yieldPct: 8,   marketPrice: 20 },
  { id: 'filet_agneau',      name: 'Filet / Noisette',        category: 'premier',   yieldPct: 3,   marketPrice: 28 },
  { id: 'cotes_secondes',    name: 'Côtes secondes',          category: 'premier',   yieldPct: 8,   marketPrice: 14 },
  { id: 'epaule_agneau',     name: 'Épaule',                  category: 'deuxieme',  yieldPct: 22,  marketPrice: 14 },
  { id: 'souris_agneau',     name: 'Souris',                  category: 'deuxieme',  yieldPct: 4,   marketPrice: 18 },
  { id: 'collier_agneau',    name: 'Collier',                 category: 'troisieme', yieldPct: 7,   marketPrice: 9  },
  { id: 'poitrine_agneau',   name: 'Poitrine',                category: 'troisieme', yieldPct: 5,   marketPrice: 8  },
  { id: 'foie_agneau',       name: 'Foie',                    category: 'abat',      yieldPct: 1.5, marketPrice: 8  },
  { id: 'rognons_agneau',    name: 'Rognons',                 category: 'abat',      yieldPct: 0.3, marketPrice: 6  },
]

// ─── Données Porc ──────────────────────────────────────────────────────────────────

const PORC_BREEDS: Breed[] = [
  { id: 'large_white',       name: 'Large White',          carcassYield: 0.77, avgWeight: '100-120 kg', origin: 'Bretagne/National', description: 'Race dominante en France. Très bon rendement. Viande maigre et tendre, idéale pour jambons et filets.' },
  { id: 'pietrain',          name: 'Piétrain',             carcassYield: 0.79, avgWeight: '95-115 kg',  origin: 'Belgique/France',  description: 'Rendement exceptionnel en longe et jambon. Viande très maigre, légèrement plus ferme.' },
  { id: 'duroc_porc',        name: 'Duroc',                carcassYield: 0.74, avgWeight: '100-125 kg', origin: 'USA/France',        description: 'Viande bien persillée et savoureuse. Couleur plus rosée. Appréciée pour la charcuterie artisanale.' },
  { id: 'cul_noir_limousin', name: 'Cul Noir du Limousin', carcassYield: 0.72, avgWeight: '90-120 kg',  origin: 'Limousin',         description: 'Race rustique. Viande très marbrée, saveur exceptionnelle. Idéal pour charcuteries fines.' },
  { id: 'noir_bigorre',      name: 'Noir de Bigorre AOP',  carcassYield: 0.72, avgWeight: '110-140 kg', origin: 'Pyrénées',         description: 'AOP. Élevage 12 mois min. Viande persillée, jambon sec exceptionnel. Haut de gamme.' },
  { id: 'cochon_bayeux',     name: 'Cochon de Bayeux',     carcassYield: 0.71, avgWeight: '100-130 kg', origin: 'Normandie',        description: 'Ancienne race normande. Lard abondant, viande goûteuse. Parfait pour rillettes et jambon braisé.' },
]
const PORC_CUTS: Cut[] = [
  { id: 'filet_mignon_porc', name: 'Filet mignon',             category: 'premier',   yieldPct: 2.5,  marketPrice: 22 },
  { id: 'cote_longe_porc',   name: 'Côte de longe',            category: 'premier',   yieldPct: 8,    marketPrice: 14 },
  { id: 'echine_porc',       name: 'Échine / Carré désossé',   category: 'premier',   yieldPct: 10,   marketPrice: 12 },
  { id: 'jambon_porc',       name: 'Jambon (cuisse entière)',  category: 'premier',   yieldPct: 25,   marketPrice: 11 },
  { id: 'epaule_porc',       name: 'Épaule désossée',          category: 'deuxieme',  yieldPct: 15,   marketPrice: 9  },
  { id: 'palette_porc',      name: 'Palette',                  category: 'deuxieme',  yieldPct: 7,    marketPrice: 9  },
  { id: 'poitrine_porc',     name: 'Poitrine fraîche',         category: 'deuxieme',  yieldPct: 10,   marketPrice: 8  },
  { id: 'gorge_porc',        name: 'Gorge / Gras de collier',  category: 'troisieme', yieldPct: 5,    marketPrice: 4  },
  { id: 'lard_gras_porc',    name: 'Lard gras / Bardière',     category: 'troisieme', yieldPct: 6,    marketPrice: 3  },
  { id: 'joue_porc',         name: 'Joue de porc',             category: 'abat',      yieldPct: 1.5,  marketPrice: 12 },
  { id: 'pied_porc',         name: 'Pied de porc',             category: 'abat',      yieldPct: 2,    marketPrice: 5  },
  { id: 'os_porc',           name: 'Os et crosse',             category: 'os',        yieldPct: 8,    marketPrice: 1  },
]

// ─── Données Volaille ──────────────────────────────────────────────────────────────

const VOLAILLE_BREEDS: Breed[] = [
  { id: 'poulet_fermier',  name: 'Poulet fermier Label Rouge', carcassYield: 0.75, avgWeight: '2-3 kg',   origin: 'France',    description: 'Label Rouge. Élevage 81 jours min. Chair ferme et goûteuse. Le standard de qualité en volaille artisanale.' },
  { id: 'poulet_bresse',   name: 'Poulet de Bresse AOC',       carcassYield: 0.72, avgWeight: '1.8-2.5 kg', origin: 'Ain/Bresse', description: 'Seule volaille AOC de France. Chair exceptionnellement tendre et persillée. Produit ultra premium.' },
  { id: 'pintade_fermiere', name: 'Pintade fermière',          carcassYield: 0.73, avgWeight: '1.5-2.2 kg', origin: 'France',    description: 'Chair ferme, saveur gibier légèrement marquée. Très appréciée pour les fêtes et la restauration.' },
  { id: 'canard_barbarie',  name: 'Canard de Barbarie',        carcassYield: 0.68, avgWeight: '2.5-4 kg',  origin: 'Sud-Ouest', description: 'Viande maigre et goûteuse. Magret charnu, cuisses moelleuses. Fort potentiel en valorisation.' },
  { id: 'chapon_fermier',   name: 'Chapon fermier',            carcassYield: 0.77, avgWeight: '3-4.5 kg',  origin: 'France',    description: 'Poulet castré, élevé 150 jours min. Chair fondante et persillée. Produit de fête, prix premium.' },
  { id: 'dinde_fermiere',   name: 'Dinde fermière',            carcassYield: 0.74, avgWeight: '4-8 kg',    origin: 'France',    description: 'Chair blanche abondante. Excellent découpe à la pièce. Fort volume fin d\'année.' },
]
const VOLAILLE_CUTS: Cut[] = [
  { id: 'blanc_volaille',   name: 'Blanc / Suprême',          category: 'premier',   yieldPct: 28,  marketPrice: 18 },
  { id: 'cuisse_entiere',   name: 'Cuisse entière',           category: 'premier',   yieldPct: 22,  marketPrice: 10 },
  { id: 'haut_cuisse',      name: 'Haut de cuisse',           category: 'premier',   yieldPct: 13,  marketPrice: 9  },
  { id: 'pilon',            name: 'Pilon',                    category: 'premier',   yieldPct: 9,   marketPrice: 7  },
  { id: 'aile_volaille',    name: 'Aile',                     category: 'deuxieme',  yieldPct: 10,  marketPrice: 7  },
  { id: 'foie_volaille',    name: 'Foie (lot)',               category: 'abat',      yieldPct: 1.5, marketPrice: 6  },
  { id: 'gesier_volaille',  name: 'Gésier',                   category: 'abat',      yieldPct: 1.5, marketPrice: 5  },
  { id: 'carcasse_bouillon',name: 'Carcasse / Bouillon',      category: 'os',        yieldPct: 15,  marketPrice: 1.5},
]

// ─── Config espèces ─── poids et prix par défaut exprimés en CARCASSE ───────────────

const ANIMALS: Record<AnimalType, AnimalConfig> = {
  boeuf:    { label: 'Bœuf',    emoji: '🐄', accent: 'red',    breedLabel: 'Race bovine',   breeds: BOEUF_BREEDS,    cuts: BOEUF_CUTS,    defaultWeight: '520', defaultPurchaseKg: '6.00',  defaultLabor: '150' },
  veau:     { label: 'Veau',    emoji: '🐮', accent: 'pink',   breedLabel: 'Type de veau',  breeds: VEAU_BREEDS,     cuts: VEAU_CUTS,     defaultWeight: '125', defaultPurchaseKg: '9.00',  defaultLabor: '80'  },
  agneau:   { label: 'Agneau',  emoji: '🐑', accent: 'green',  breedLabel: 'Race ovine',    breeds: AGNEAU_BREEDS,   cuts: AGNEAU_CUTS,   defaultWeight: '20',  defaultPurchaseKg: '10.00', defaultLabor: '30'  },
  porc:     { label: 'Porc',    emoji: '🐖', accent: 'orange', breedLabel: 'Race porcine',  breeds: PORC_BREEDS,     cuts: PORC_CUTS,     defaultWeight: '85',  defaultPurchaseKg: '2.90',  defaultLabor: '60'  },
  volaille: { label: 'Volaille',emoji: '🐔', accent: 'yellow', breedLabel: 'Variété',       breeds: VOLAILLE_BREEDS, cuts: VOLAILLE_CUTS, defaultWeight: '1.9', defaultPurchaseKg: '3.70',  defaultLabor: '5'   },
}

const ANIMAL_TYPES: AnimalType[] = ['boeuf', 'veau', 'agneau', 'porc', 'volaille']

// Deux découpes possibles pour le bœuf, au choix de l'artisan (bascule en haut du calculateur)
const BOEUF_DECOUPES: { id: BoeufDecoupe; label: string; hint: string; cuts: Cut[] }[] = [
  { id: 'b1', label: 'RT8',       hint: 'BCUH · DEHMT · Bavette', cuts: BOEUF_CUTS },
  { id: 'b2', label: 'AVANTCAPA', hint: 'CEFIMEV · épaule + collier', cuts: BOEUF_B2_CUTS },
]

// ─── Catégories ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<CutCategory, string> = {
  premier: '1er choix', deuxieme: '2e choix',
  troisieme: 'Divers', abat: 'Abats', os: 'Os valorisables',
}
const CATEGORY_COLORS: Record<CutCategory, string> = {
  premier: 'bg-pilote text-white border-transparent', deuxieme: 'bg-pilote-100 text-pilote-800 border-pilote-200',
  troisieme: 'bg-pilote-50 text-pilote-800 border-pilote-200', abat: 'bg-orange-50 text-orange-700 border-orange-200', os: 'bg-gray-100 text-gray-600 border-gray-200',
}
const CATEGORIES: CutCategory[] = ['premier', 'deuxieme', 'troisieme', 'abat', 'os']
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc']

function eur(n: number) { return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }) }
function kgStr(n: number) { return n.toFixed(1) + ' kg' }

function getISOWeek(dateStr: string): { week: number; year: number } {
  const d = new Date(dateStr)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week: weekNo, year: date.getUTCFullYear() }
}

function makeWeekLabel(week: number, year: number): string {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const weekStart = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000 + (week - 1) * 7 * 86400000)
  return `S${week} ${year}  ·  ${weekStart.getDate()} ${MONTHS_FR[weekStart.getMonth()]}`
}

// ─── Main d'œuvre boucherie depuis le planning ─────────────────────────────────

const JOURS_PLANNING = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function timeToHours(t?: string): number | null {
  if (!t) return null
  const trimmed = String(t).trim()
  const hIdx = trimmed.indexOf('h')
  if (hIdx === -1) {
    const n = parseFloat(trimmed)
    return isNaN(n) ? null : n
  }
  const h = parseInt(trimmed.slice(0, hIdx)) || 0
  const mStr = trimmed.slice(hIdx + 1)
  const m = mStr ? parseInt(mStr) || 0 : 0
  return h + m / 60
}

function slotHours(debut?: string, fin?: string): number {
  const s = timeToHours(debut)
  const e = timeToHours(fin)
  if (s === null || e === null || e <= s) return 0
  return e - s
}

/** Heures et coût CHARGÉ de la main d'œuvre "boucherie" du planning de la semaine.
 *  `decoupeHours` / `decoupeCost` : uniquement le temps de découpe saisi dans le planning
 *  (champ « Découpe » du poste boucherie) — c'est ce qui est imputé à la valorisation. */
function computeBoucherieLabor(entries: any[], emps: any[]): { hours: number; cost: number; decoupeHours: number; decoupeCost: number } {
  const empMap = new Map(emps.map((e: any) => [e.id, e]))
  let hours = 0, cost = 0, decoupeHours = 0, decoupeCost = 0
  for (const en of entries) {
    const emp: any = empMap.get(en.employee_id)
    if (!emp) continue
    const rate = (Number(emp.hourly_rate) || 0) * (1 + (Number(emp.charges_patronales ?? 45) / 100))
    const sds = en.schedule_details || {}
    for (const j of JOURS_PLANNING) {
      const t = en[`${j}_type`] || 'travail'
      if (t !== 'travail') continue
      const sd = sds[j] || {}
      const catM = sd.categorie_matin || sd.categorie
      const catA = sd.categorie_apmidi || sd.categorie
      const isBoucherie = catM === 'boucherie' || catA === 'boucherie' || sd.categorie === 'boucherie'
      const m = slotHours(sd.matin_debut, sd.matin_fin)
      const a = slotHours(sd.apmidi_debut, sd.apmidi_fin)
      let h = 0
      if (catM === 'boucherie') h += m
      if (catA === 'boucherie') h += a
      // Poste boucherie sur la journée sans horaires détaillés : on prend les heures du jour
      if (h === 0 && m === 0 && a === 0 && sd.categorie === 'boucherie') h = Number(en[j]) || 0
      hours += h
      cost  += h * rate
      // Temps de découpe explicite (champ dédié du planning)
      const dh = isBoucherie ? (parseFloat(sd.decoupe) || 0) : 0
      decoupeHours += dh
      decoupeCost  += dh * rate
    }
  }
  return { hours, cost, decoupeHours, decoupeCost }
}

// ─── Préférences par famille (catégories cochées + pièces retirées), persistées en localStorage ─

type CatsByAnimal = Record<AnimalType, CutCategory[]>
type CutsByAnimal = Record<AnimalType, string[]>

const DEFAULT_CATS = (): CatsByAnimal => ({
  boeuf: [...CATEGORIES], veau: [...CATEGORIES], agneau: [...CATEGORIES], porc: [...CATEGORIES], volaille: [...CATEGORIES],
})
const DEFAULT_EXCLUDED = (): CutsByAnimal => ({
  boeuf: [], veau: [], agneau: [], porc: [], volaille: [],
})
// Prix de référence personnalisés par pièce (surcharge le prix indicatif), mémorisés par famille
type PricesByAnimal = Record<AnimalType, Record<string, string>>
const DEFAULT_PRICES = (): PricesByAnimal => ({
  boeuf: {}, veau: {}, agneau: {}, porc: {}, volaille: {},
})

function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch { return fallback }
}

/** Supabase renvoie les colonnes numeric en chaînes — normalise une valorisation en nombres */
function normalizeValo(v: any): SavedValo {
  return {
    ...v,
    live_weight:     Number(v.live_weight)     || 0,
    quantity:        Number(v.quantity)        || 1,
    purchase_per_kg: Number(v.purchase_per_kg) || 0,
    overhead_cost:   Number(v.overhead_cost)   || 0,
    labor_cost:      Number(v.labor_cost)      || 0,
    target_margin:   Number(v.target_margin)   || 0,
    carcass_weight:  Number(v.carcass_weight)  || 0,
    total_cost:      Number(v.total_cost)      || 0,
    total_revenue:   Number(v.total_revenue)   || 0,
    margin_rate:     Number(v.margin_rate)     || 0,
    coefficient:     Number(v.coefficient)     || 1,
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ValorisationPage() {
  const params = useSearchParams()
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()

  const [animalType,    setAnimalType]    = useState<AnimalType>('boeuf')
  const [activeTab,     setActiveTab]     = useState<'calc' | 'suivi'>('calc')
  const [breedId,       setBreedId]       = useState('charolaise')
  // Poids CARCASSE par animal (kg) — le boucher achète au kg de carcasse
  const [carcassWeight, setCarcassWeight] = useState('520')
  const [quantity,      setQuantity]      = useState('1')
  // Prix d'achat en €/kg de CARCASSE
  const [purchasePerKg, setPurchasePerKg] = useState('6.00')
  const [overheadCost,  setOverheadCost]  = useState('0')
  const [laborCost,     setLaborCost]     = useState('150')
  const [decoupeHours,  setDecoupeHours]  = useState('')
  const [weekLabor,     setWeekLabor]     = useState<WeekLabor | null>(null)
  const [targetMargin,  setTargetMargin]  = useState(35)
  const [showBreedInfo, setShowBreedInfo] = useState(false)
  const [catsByAnimal,     setCatsByAnimal]     = useState<CatsByAnimal>(() => loadPref('valo_cats_v1', DEFAULT_CATS()))
  const [excludedByAnimal, setExcludedByAnimal] = useState<CutsByAnimal>(() => loadPref('valo_excluded_v1', DEFAULT_EXCLUDED()))
  const [cutPricesByAnimal, setCutPricesByAnimal] = useState<PricesByAnimal>(() => loadPref('valo_prices_v1', DEFAULT_PRICES()))
  const [purchaseDate,  setPurchaseDate]  = useState(new Date().toISOString().split('T')[0])
  const [notes,         setNotes]         = useState('')
  const [history,       setHistory]       = useState<SavedValo[]>([])
  const [historyError,  setHistoryError]  = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [selected,      setSelected]      = useState<SavedValo | null>(null)
  // Poids saisis manuellement par le boucher, pièce par pièce (clé = id de la pièce)
  const [cutWeights,    setCutWeights]    = useState<Record<string, string>>({})
  // Nœuds dépliés de l'arborescence de découpe (par chemin)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  // Découpe choisie pour le bœuf (uniquement pour l'espèce bœuf)
  const [boeufDecoupe, setBoeufDecoupe] = useState<BoeufDecoupe>('b1')

  const config = ANIMALS[animalType]
  const breeds = config.breeds
  // Pour le bœuf, les pièces dépendent de la découpe sélectionnée (RT8 / AVANTCAPA)
  const cuts   = animalType === 'boeuf'
    ? (BOEUF_DECOUPES.find(d => d.id === boeufDecoupe)?.cuts ?? BOEUF_CUTS)
    : config.cuts
  // Bœuf et veau s'achètent en demi-carcasse : le poids saisi est celui d'un demi, la quantité un nombre de demis
  const isHalf = animalType === 'boeuf' || animalType === 'veau'
  // Prix de référence par pièce : valeur saisie si présente, sinon prix indicatif de la pièce
  const cutPrices = cutPricesByAnimal[animalType] ?? {}
  const priceOf = (cut: Cut) => { const v = parseFloat(cutPrices[cut.id] ?? ''); return isNaN(v) ? cut.marketPrice : v }
  function setCutPrice(cutId: string, value: string) {
    setCutPricesByAnimal(prev => ({ ...prev, [animalType]: { ...(prev[animalType] ?? {}), [cutId]: value } }))
  }

  // Préférences par famille — persistées
  useEffect(() => {
    try { window.localStorage.setItem('valo_cats_v1', JSON.stringify(catsByAnimal)) } catch {}
  }, [catsByAnimal])
  useEffect(() => {
    try { window.localStorage.setItem('valo_excluded_v1', JSON.stringify(excludedByAnimal)) } catch {}
  }, [excludedByAnimal])
  useEffect(() => {
    try { window.localStorage.setItem('valo_prices_v1', JSON.stringify(cutPricesByAnimal)) } catch {}
  }, [cutPricesByAnimal])

  const includedCats = useMemo(() => new Set<CutCategory>(catsByAnimal[animalType] ?? CATEGORIES), [catsByAnimal, animalType])
  const excludedCuts = useMemo(() => new Set<string>(excludedByAnimal[animalType] ?? []), [excludedByAnimal, animalType])

  // Reset quand on change d'espèce (les catégories/pièces de chaque famille sont conservées)
  useEffect(() => {
    setBreedId(config.breeds[0].id)
    setCarcassWeight(config.defaultWeight)
    setPurchasePerKg(config.defaultPurchaseKg)
    setLaborCost(config.defaultLabor)
    setDecoupeHours('')
    setCutWeights({})
    setExpandedNodes(new Set())
    setShowBreedInfo(false)
    setBoeufDecoupe('b1')
  }, [animalType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset des poids saisis / nœuds dépliés quand on bascule de découpe bœuf
  useEffect(() => {
    setCutWeights({})
    setExpandedNodes(new Set())
  }, [boeufDecoupe])

  // Pré-remplissage depuis la facturation
  useEffect(() => {
    const date     = params.get('date')
    const supplier = params.get('supplier')
    if (date)     setPurchaseDate(date)
    if (supplier) setNotes(`Facture ${supplier}`)
  }, [params])

  // Main d'œuvre boucherie réelle de la semaine d'achat (depuis le planning)
  useEffect(() => {
    const { week: w, year: y } = getISOWeek(purchaseDate)
    if (!w || !y || isNaN(w)) { setWeekLabor(null); return }
    Promise.all([
      fetch(`/api/planning?week=${w}&year=${y}`).then(r => r.json()).catch(() => []),
      fetch('/api/employees').then(r => r.json()).catch(() => []),
    ]).then(([entries, emps]) => {
      if (!Array.isArray(entries) || !Array.isArray(emps)) { setWeekLabor(null); return }
      const { hours, cost, decoupeHours: dH, decoupeCost: dC } = computeBoucherieLabor(entries, emps)
      setWeekLabor({ hours, cost, rate: hours > 0 ? cost / hours : 0, decoupeHours: dH, decoupeCost: dC, week: w, year: y })
      // Le temps de découpe du planning devient la main d'œuvre imputée à la valorisation
      if (dH > 0) {
        setDecoupeHours(String(Math.round(dH * 100) / 100))
        setLaborCost(String(Math.round(dC * 100) / 100))
      }
    }).catch(() => setWeekLabor(null))
  }, [purchaseDate])

  /** Saisie du temps de découpe : impute automatiquement la main d'œuvre au taux réel du planning */
  function setDecoupe(h: string) {
    setDecoupeHours(h)
    const hours = parseFloat(h) || 0
    if (weekLabor && weekLabor.rate > 0 && hours > 0) {
      setLaborCost(String(Math.round(hours * weekLabor.rate * 100) / 100))
    }
  }

  const breed    = breeds.find(b => b.id === breedId) ?? breeds[0]
  const carcW    = parseFloat(carcassWeight) || 0
  const qty      = Math.max(1, parseInt(quantity) || 1)
  const ppkg     = parseFloat(purchasePerKg)  || 0
  const overhead = parseFloat(overheadCost)   || 0
  const labor    = parseFloat(laborCost)      || 0

  // Le poids saisi EST le poids carcasse ; le poids vif est estimé via le rendement (indicatif)
  const carcassW1       = carcW
  const liveEstimate    = breed.carcassYield > 0 ? carcW / breed.carcassYield : carcW
  const purchaseTotal1  = carcW * ppkg
  const totalCost1      = purchaseTotal1 + overhead + labor
  const purchaseTotalLot = purchaseTotal1 * qty
  const totalCostLot    = totalCost1 * qty

  const { results, coefficient, totalMarketRevenue1 } = useMemo(() => {
    if (carcW <= 0 || ppkg <= 0) return { results: [] as CutResult[], coefficient: 1, totalMarketRevenue1: 0 }
    const isActive    = (c: Cut) => includedCats.has(c.category) && !excludedCuts.has(c.id)
    // Poids saisi manuellement par pièce (0 tant que le boucher n'a rien renseigné)
    const cutWeight   = (c: Cut) => parseFloat(cutWeights[c.id] || '') || 0
    const activeCuts  = cuts.filter(isActive)
    const mktRevenue  = activeCuts.reduce((s, c) => s + cutWeight(c) * priceOf(c), 0)
    const targetRev   = targetMargin < 100 && totalCost1 > 0 ? totalCost1 / (1 - targetMargin / 100) : mktRevenue
    const coeff       = mktRevenue > 0 ? targetRev / mktRevenue : 1
    const res: CutResult[] = cuts.map(cut => {
      const weight       = cutWeight(cut)
      const active       = isActive(cut)
      const sellingPrice = active ? priceOf(cut) * coeff : 0
      return { cut, weight, sellingPrice, revenue: sellingPrice * weight, active }
    })
    return { results: res, coefficient: coeff, totalMarketRevenue1: mktRevenue }
  }, [animalType, breedId, carcW, ppkg, overhead, labor, targetMargin, includedCats, excludedCuts, totalCost1, cuts, cutWeights, cutPrices])

  const activeResults   = results.filter(r => r.active)
  const totalRevenue1   = activeResults.reduce((s, r) => s + r.revenue, 0)
  const totalSellable1  = activeResults.reduce((s, r) => s + r.weight, 0)
  const actualMargin1   = totalRevenue1 > 0 ? ((totalRevenue1 - totalCost1) / totalRevenue1) * 100 : 0
  const totalRevenueLot = totalRevenue1 * qty
  const coeffStatus     = coefficient < 0.95 ? 'under' : coefficient > 1.15 ? 'over' : 'ok'

  // Arborescence de découpe (uniquement pour les espèces dont les pièces ont un `group`, ex. bœuf)
  const cutTree = useMemo(() => buildCutTree(cuts), [cuts])
  const isTree  = cuts.some(c => c.group && c.group.length > 0)
  const resById = new Map(results.map(r => [r.cut.id, r]))

  function toggleNode(path: string) {
    setExpandedNodes(prev => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n })
  }

  /** Ligne d'une pièce (feuille de l'arbre) : nom + poids + prix éditables + prix conseillé + CA. */
  function leafRow(r: CutResult, depth = 0): JSX.Element {
    const isExcluded = excludedCuts.has(r.cut.id)
    const refPrice = priceOf(r.cut)
    const pctDiff = r.sellingPrice > 0 && refPrice > 0 ? ((r.sellingPrice - refPrice) / refPrice) * 100 : 0
    const priceColor = pctDiff < -5 ? 'text-green-600' : pctDiff > 15 ? 'text-orange-600' : 'text-gray-900'
    return (
      <tr key={r.cut.id} className={`group border-t border-gray-50 transition-colors ${r.active ? 'hover:bg-gray-50' : 'opacity-40 bg-gray-50/50'}`}>
        <td className="px-4 py-2.5 font-medium text-gray-800" style={depth ? { paddingLeft: 16 + depth * 18 } : undefined}>
          {r.cut.name}
          {isExcluded && <span className="ml-2 text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">retirée</span>}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <input type="number" min="0" step="0.1"
              value={cutWeights[r.cut.id] ?? ''}
              onChange={e => setCutWeights(prev => ({ ...prev, [r.cut.id]: e.target.value }))}
              disabled={isExcluded}
              placeholder="0"
              className="w-16 border border-gray-200 rounded-md px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
            <span className="text-xs text-gray-400">kg</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <input type="number" min="0" step="0.5"
              value={cutPrices[r.cut.id] ?? ''}
              onChange={e => setCutPrice(r.cut.id, e.target.value)}
              placeholder={String(r.cut.marketPrice)}
              className="w-14 border border-gray-200 rounded-md px-2 py-1 text-sm text-right tabular-nums text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            <span className="text-xs text-gray-400">€</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
          {r.active ? <span className={priceColor}>{eur(r.sellingPrice)}{Math.abs(pctDiff) > 1 && <span className={`ml-1 text-xs font-normal ${priceColor}`}>({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)</span>}</span> : '—'}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.active ? eur(r.revenue) : '—'}</td>
        <td className="px-2 py-2.5 text-center w-10">
          {isExcluded ? (
            <button onClick={() => toggleCut(r.cut.id)} title="Réintégrer cette pièce" className="p-1.5 rounded-lg text-pilote hover:bg-pilote-50 transition-colors"><RotateCcw className="w-3.5 h-3.5" /></button>
          ) : (
            <button onClick={() => toggleCut(r.cut.id)} title="Retirer cette pièce du calcul" className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </td>
      </tr>
    )
  }

  /** Rendu récursif : entêtes de pièces dépliables + feuilles (avec poids/prix). */
  function renderTree(nodes: TreeNode[], depth: number): JSX.Element[] {
    const out: JSX.Element[] = []
    for (const node of nodes) {
      if (node.cut) {
        const r = resById.get(node.cut.id)
        if (r) out.push(leafRow(r, depth))
        continue
      }
      const open = expandedNodes.has(node.path)
      const leaves = collectLeafCuts(node)
      let w = 0, rev = 0
      for (const c of leaves) { const rr = resById.get(c.id); if (rr && rr.active) { w += rr.weight; rev += rr.revenue } }
      out.push(
        <tr key={node.path} className="border-t border-gray-100 bg-gray-50/60 hover:bg-gray-100 cursor-pointer transition-colors" onClick={() => toggleNode(node.path)}>
          <td colSpan={6} className="px-4 py-2" style={{ paddingLeft: 12 + depth * 18 }}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-gray-700">
                <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                {node.name}
                <span className="text-[10px] font-normal text-gray-400 normal-case">({leaves.length})</span>
              </span>
              {w > 0 && <span className="text-xs text-gray-400 tabular-nums">{kgStr(w)} · {eur(rev)}</span>}
            </div>
          </td>
        </tr>
      )
      if (open) out.push(...renderTree(node.children, depth + 1))
    }
    return out
  }

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/valorisations')
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setHistoryError(err?.error || `Erreur ${res.status} au chargement de l'historique`)
        return
      }
      const raw = await res.json()
      if (!Array.isArray(raw)) { setHistoryError('Réponse inattendue du serveur'); return }
      setHistory(raw.map(normalizeValo))
      setHistoryError(null)
    } catch {
      setHistoryError('Erreur réseau au chargement de l\'historique')
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function toggleCat(cat: CutCategory) {
    setCatsByAnimal(prev => {
      const cur = new Set(prev[animalType] ?? CATEGORIES)
      if (cur.has(cat)) cur.delete(cat); else cur.add(cat)
      return { ...prev, [animalType]: Array.from(cur) }
    })
  }

  /** Retire ou réintègre une pièce individuelle du calcul (mémorisé par famille) */
  function toggleCut(cutId: string) {
    setExcludedByAnimal(prev => {
      const cur = new Set(prev[animalType] ?? [])
      if (cur.has(cutId)) cur.delete(cutId); else cur.add(cutId)
      return { ...prev, [animalType]: Array.from(cur) }
    })
  }

  function restoreAllCuts() {
    setExcludedByAnimal(prev => ({ ...prev, [animalType]: [] }))
  }

  async function saveValo() {
    if (!carcW || !ppkg) return
    setSaving(true)
    try {
      const res = await fetch('/api/valorisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animal_type: animalType,
          breed_id: breed.id, breed_name: breed.name,
          live_weight: Math.round(liveEstimate * 10) / 10,
          quantity: qty,
          purchase_per_kg: ppkg, overhead_cost: overhead, labor_cost: labor,
          target_margin: targetMargin, purchase_date: purchaseDate,
          notes: notes || null,
          carcass_weight: Math.round(carcassW1 * 10) / 10,
          total_cost: Math.round(totalCostLot * 100) / 100,
          total_revenue: Math.round(totalRevenueLot * 100) / 100,
          margin_rate: Math.round(actualMargin1 * 100) / 100,
          coefficient: Math.round(coefficient * 10000) / 10000,
          decoupe_hours: parseFloat(decoupeHours) || 0,
          cut_weights: activeResults.reduce((acc, r) => { acc[r.cut.id] = Math.round(r.weight * 100) / 100; return acc }, {} as Record<string, number>),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast({ variant: 'error', title: 'Enregistrement impossible', description: err?.error || `Erreur ${res.status}` })
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      loadHistory()
    } catch {
      toast({ variant: 'error', title: 'Erreur réseau', description: "La valorisation n'a pas été enregistrée." })
    } finally {
      setSaving(false)
    }
  }

  async function deleteValo(id: string) {
    const ok = await confirmAction({
      title: 'Supprimer cette valorisation ?',
      description: 'Elle sera retirée de l’historique et du suivi hebdomadaire. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/valorisations/${id}`, { method: 'DELETE' })
    setSelected(null); loadHistory()
    toast({ variant: 'success', title: 'Valorisation supprimée' })
  }

  const fromInvoice = params.get('supplier')

  const weekStats: WeekStats[] = useMemo(() => {
    const map = new Map<string, { week: number; year: number; count: number; lots: number; totalCost: number; totalRevenue: number; breeds: Set<string> }>()
    for (const v of history) {
      if (!v.purchase_date) continue
      const { week, year } = getISOWeek(v.purchase_date)
      if (!week || !year || isNaN(week)) continue
      const key = `${year}-W${String(week).padStart(2, '0')}`
      const q = v.quantity ?? 1
      if (!map.has(key)) map.set(key, { week, year, count: 0, lots: 0, totalCost: 0, totalRevenue: 0, breeds: new Set() })
      const entry = map.get(key)!
      entry.count += q; entry.lots += 1
      entry.totalCost += v.total_cost; entry.totalRevenue += v.total_revenue
      entry.breeds.add(`${ANIMALS[v.animal_type as AnimalType]?.emoji ?? ''}${v.breed_name}`)
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key, label: makeWeekLabel(v.week, v.year), week: v.week, year: v.year,
        count: v.count, lots: v.lots, totalCost: v.totalCost, totalRevenue: v.totalRevenue,
        marginRate: v.totalRevenue > 0 ? ((v.totalRevenue - v.totalCost) / v.totalRevenue) * 100 : 0,
        breeds: Array.from(v.breeds),
      }))
      .sort((a, b) => b.year !== a.year ? b.year - a.year : b.week - a.week)
  }, [history])

  const totalAnimals = weekStats.reduce((s, w) => s + w.count, 0)
  const totalCA      = weekStats.reduce((s, w) => s + w.totalRevenue, 0)
  const totalCostAll = weekStats.reduce((s, w) => s + w.totalCost, 0)
  const avgMarginAll = totalCA > 0 ? ((totalCA - totalCostAll) / totalCA) * 100 : 0
  const maxCA        = weekStats.length > 0 ? Math.max(...weekStats.map(w => w.totalRevenue)) : 1

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Bandeau invoice */}
      {fromInvoice && (
        <div className="mb-4 flex items-center gap-2 bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-2.5 text-sm text-pilote-800">
          <CheckCircle className="w-4 h-4 text-pilote flex-shrink-0" />
          Pré-rempli depuis la facture <strong>{fromInvoice}</strong> — ajoutez le poids carcasse pour calculer.
        </div>
      )}

      {historyError && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          {historyError}
          <button onClick={loadHistory} className="ml-auto text-xs font-semibold underline hover:no-underline">Réessayer</button>
        </div>
      )}

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-pilote-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Calculator className="w-5 h-5 text-pilote" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Valorisation Carcasse</h1>
            <p className="text-sm text-gray-500">Achat au kg de carcasse · Main d'œuvre réelle du planning · Coefficient · Suivi hebdo</p>
          </div>
        </div>
        {activeTab === 'calc' && totalRevenue1 > 0 && (
          <button onClick={saveValo} disabled={saving || saved}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-card transition-all ${
              saved ? 'bg-green-600' : 'bg-pilote hover:bg-pilote-hover'
            }`}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</>
              : saved ? <><CheckCircle className="w-4 h-4" />Sauvegardé !</>
              : <><Save className="w-4 h-4" />Sauvegarder le lot</>}
          </button>
        )}
      </div>

      {/* ── Sélecteur d'espèces ── */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {ANIMAL_TYPES.map(at => {
          const a = ANIMALS[at]
          const isActive = animalType === at
          const excludedCount = (excludedByAnimal[at] ?? []).length
          return (
            <button key={at} onClick={() => setAnimalType(at)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                isActive ? 'bg-pilote text-white shadow-card border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-pilote-200'
              }`}>
              <span className="text-base">{a.emoji}</span>
              {a.label}
              {excludedCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'}`} title={`${excludedCount} pièce(s) retirée(s) du calcul`}>
                  −{excludedCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Choix de la découpe (bœuf uniquement) ── */}
      {animalType === 'boeuf' && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Découpe</span>
          <div className="inline-flex bg-gray-100 p-1 rounded-xl">
            {BOEUF_DECOUPES.map(d => {
              const active = boeufDecoupe === d.id
              return (
                <button key={d.id} onClick={() => setBoeufDecoupe(d.id)}
                  className={`flex flex-col items-start px-4 py-1.5 rounded-lg transition-all ${
                    active ? 'bg-white shadow-sm' : 'hover:bg-white/50'
                  }`}>
                  <span className={`text-sm font-semibold leading-tight ${active ? 'text-gray-900' : 'text-gray-500'}`}>{d.label}</span>
                  <span className={`text-[10px] leading-tight ${active ? 'text-pilote' : 'text-gray-400'}`}>{d.hint}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Onglets Calculateur / Suivi ── */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setActiveTab('calc')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'calc' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <Calculator className="w-4 h-4" />Calculateur
        </button>
        <button onClick={() => setActiveTab('suivi')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'suivi' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <BarChart2 className="w-4 h-4" />Suivi semaines
          {weekStats.length > 0 && (
            <span className="ml-1 bg-pilote text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{weekStats.length}</span>
          )}
        </button>
      </div>

      {/* ══ SUIVI HEBDO ══ */}
      {activeTab === 'suivi' && (
        <div>
          {weekStats.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 shadow-card flex flex-col items-center justify-center text-center">
              <BarChart2 className="w-12 h-12 text-gray-200 mb-4" />
              <p className="text-gray-600 font-medium">Aucune donnée pour l&apos;instant</p>
              <p className="text-sm text-gray-400 mt-1">Sauvegardez vos premières valorisations pour voir le suivi</p>
              <button onClick={() => setActiveTab('calc')}
                className="mt-4 px-4 py-2 bg-pilote text-white rounded-xl text-sm font-semibold hover:bg-pilote-hover transition-colors">
                Aller au calculateur
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[{ label: 'Semaines enregistrées', value: String(weekStats.length), sub: 'depuis le début' },
                  { label: 'Animaux valorisés', value: String(totalAnimals), sub: 'au total' },
                  { label: 'CA total estimé', value: eur(totalCA), sub: 'toutes semaines' },
                ].map(k => (
                  <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-card">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{k.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                    <p className="text-xs text-gray-400">{k.sub}</p>
                  </div>
                ))}
                <div className={`rounded-2xl p-4 shadow-card ${
                  avgMarginAll >= 35 ? 'bg-green-600' : avgMarginAll >= 25 ? 'bg-amber-500' : 'bg-red-600'
                } text-white`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-0.5">Marge brute moy.</p>
                  <p className="text-2xl font-bold">{avgMarginAll.toFixed(1)}%</p>
                  <p className="text-xs opacity-70">{avgMarginAll >= 35 ? 'Bonne performance' : avgMarginAll >= 25 ? 'À surveiller' : 'Sous les seuils'}</p>
                </div>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-card">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><BarChart2 className="w-4 h-4 text-gray-400" />Détail par semaine</h2>
                  <span className="text-xs text-gray-400">Du plus récent au plus ancien</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        {['Semaine','Animaux','Coût total','CA estimé','Marge','vs sem. préc.','Animaux / Races'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weekStats.map((w, i) => {
                        const prev = weekStats[i + 1]
                        const caEvol = prev && prev.totalRevenue > 0 ? ((w.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100 : null
                        const marginEvol = prev ? w.marginRate - prev.marginRate : null
                        return (
                          <tr key={w.key} className={`border-t border-gray-50 hover:bg-gray-50 transition-colors ${i === 0 ? 'bg-pilote-50/40' : ''}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {i === 0 && <span className="text-[10px] font-bold bg-pilote-100 text-pilote-800 px-1.5 py-0.5 rounded-full">Récent</span>}
                                <span className="font-semibold text-gray-800">{w.label}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="font-medium">{w.count}</span>
                              {w.lots > 1 && <span className="text-xs text-gray-400 ml-1">({w.lots} lots)</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-500">{eur(w.totalCost)}</td>
                            <td className="px-4 py-3 text-right font-bold">
                              <div className="flex flex-col items-end">
                                <span>{eur(w.totalRevenue)}</span>
                                <div className="mt-1 h-1 bg-gray-100 rounded-full w-20 overflow-hidden">
                                  <div className="h-1 bg-pilote rounded-full" style={{ width: `${(w.totalRevenue / maxCA) * 100}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  w.marginRate >= 35 ? 'bg-green-100 text-green-700' : w.marginRate >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                                }`}>{w.marginRate.toFixed(1)}%</span>
                                {marginEvol !== null && Math.abs(marginEvol) >= 0.5 && (
                                  <span className={`text-[10px] font-medium ${marginEvol > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {marginEvol > 0 ? '+' : ''}{marginEvol.toFixed(1)} pts
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {caEvol !== null ? (
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-lg font-bold leading-none ${caEvol > 5 ? 'text-green-500' : caEvol < -5 ? 'text-red-400' : 'text-gray-400'}`}>
                                    {caEvol > 5 ? '▲' : caEvol < -5 ? '▼' : '–'}
                                  </span>
                                  <div>
                                    <p className={`text-xs font-bold ${caEvol > 5 ? 'text-green-600' : caEvol < -5 ? 'text-red-500' : 'text-gray-500'}`}>
                                      {caEvol > 0 ? '+' : ''}{caEvol.toFixed(0)}% CA
                                    </p>
                                    <p className="text-[10px] text-gray-400">vs S{prev!.week}</p>
                                  </div>
                                </div>
                              ) : <span className="text-xs text-gray-300">première semaine</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {w.breeds.map(b => (
                                  <span key={b} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">{b}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ CALCULATEUR ══ */}
      {activeTab === 'calc' && (
        <>
          {/* Historique */}
          {history.length > 0 && (
            <div className="mb-6 bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />Historique des valorisations
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {history.map(v => {
                  const emoji = ANIMALS[v.animal_type as AnimalType]?.emoji ?? ''
                  return (
                    <button key={v.id} onClick={() => setSelected(v)}
                      className="flex-shrink-0 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3 text-left transition-colors w-56">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-gray-800">{emoji} {v.breed_name}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          v.margin_rate >= 35 ? 'bg-green-100 text-green-700' : v.margin_rate >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        }`}>{v.margin_rate.toFixed(1)}%</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {(v.quantity ?? 1) > 1 ? <span className="font-semibold text-pilote">{v.quantity} animaux · </span> : ''}
                        {v.carcass_weight || v.live_weight} kg carc. · {new Date(v.purchase_date).toLocaleDateString('fr-FR')}
                      </p>
                      <p className="text-sm font-bold text-pilote mt-1">{eur(v.total_revenue)}</p>
                      <p className="text-[10px] text-gray-400">CA estim. total · coeff. x{v.coefficient?.toFixed(3)}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* ── FORMULAIRE ── */}
            <div className="xl:col-span-1 space-y-5">

              {/* 1 — Animal */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">1</span>
                  {config.label} {config.emoji}
                </h2>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{config.breedLabel}</label>
                  <select value={breedId} onChange={e => setBreedId(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200`}>
                    {breeds.map(b => <option key={b.id} value={b.id}>{b.name} — rendement {(b.carcassYield * 100).toFixed(1)}%</option>)}
                  </select>
                  <button onClick={() => setShowBreedInfo(v => !v)} className="mt-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <Info className="w-3 h-3" />{showBreedInfo ? 'Masquer' : 'Caractéristiques'}
                  </button>
                  {showBreedInfo && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-xs font-semibold text-gray-800">{breed.name} — {breed.origin}</p>
                      <p className="text-xs text-gray-600 leading-relaxed mt-1">{breed.description}</p>
                      <p className="text-xs text-gray-600 font-medium pt-1">Poids vif moyen : {breed.avgWeight}</p>
                    </div>
                  )}
                </div>

                {/* Quantité */}
                <div className="mb-4 p-3 bg-pilote-50 border border-pilote-100 rounded-xl">
                  <label className="block text-xs font-semibold text-pilote-800 mb-1.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />{isHalf ? 'Nombre de demis' : "Nombre d'animaux dans le lot"}
                  </label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setQuantity(q => String(Math.max(1, parseInt(q) - 1)))}
                      className="w-8 h-8 rounded-lg bg-white border border-pilote-200 text-pilote font-bold text-lg flex items-center justify-center hover:bg-pilote-100 transition-colors">−</button>
                    <span className="text-2xl font-extrabold text-pilote-800 w-8 text-center tabular-nums">{qty}</span>
                    <button onClick={() => setQuantity(q => String(parseInt(q) + 1))}
                      className="w-8 h-8 rounded-lg bg-white border border-pilote-200 text-pilote font-bold text-lg flex items-center justify-center hover:bg-pilote-100 transition-colors">+</button>
                    {qty > 1 && <span className="text-xs text-pilote font-medium">{isHalf ? 'Résultats par demi + total lot' : 'Résultats par animal + total lot'}</span>}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{isHalf ? "Poids d'un demi-carcasse (kg)" : 'Poids carcasse par animal (kg)'}</label>
                  <input type="number" value={carcassWeight} onChange={e => setCarcassWeight(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {carcW > 0 && !isHalf && <p className="text-xs text-gray-500 mt-1">Poids vif estimé : <strong>{liveEstimate.toFixed(0)} kg</strong> (rendement {(breed.carcassYield * 100).toFixed(1)}%)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Prix achat (€/kg carcasse)</label>
                  <input type="number" step="0.01" value={purchasePerKg} onChange={e => setPurchasePerKg(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {carcW > 0 && ppkg > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {qty > 1 ? <><strong>{eur(purchaseTotal1)}/animal</strong> · lot : <strong className="text-pilote-800">{eur(purchaseTotalLot)}</strong></> : <strong>{eur(purchaseTotal1)}</strong>}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Date d&apos;achat</label>
                  <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>
              </div>

              {/* 2 — Charges */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">2</span>
                  Charges <span className="text-xs font-normal text-gray-400">{isHalf ? '(par demi)' : '(par animal)'}</span>
                </h2>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Charges fixes pro-ratées (€)</label>
                  <input type="number" value={overheadCost} onChange={e => setOverheadCost(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>

                {/* Main d'œuvre = temps de découpe saisi dans le planning */}
                {weekLabor && weekLabor.decoupeHours > 0 ? (
                  <div className="mb-3 p-2.5 bg-pilote-50 border border-pilote-100 rounded-lg">
                    <p className="text-[11px] font-semibold text-pilote-800">
                      Découpe S{weekLabor.week} (planning) : {weekLabor.decoupeHours.toFixed(2)}h · {eur(weekLabor.decoupeCost)} chargé
                    </p>
                    <p className="text-[10px] text-pilote-800/70 mt-0.5">
                      Imputé automatiquement à la main d'œuvre ci-dessous — taux réel {eur(weekLabor.rate)}/h. Modifiable.
                    </p>
                  </div>
                ) : (
                  <p className="mb-3 text-[10px] text-gray-400">
                    Astuce : renseignez le <strong>temps de découpe</strong> dans les postes « Boucherie » du planning de la semaine — il s'impute ici automatiquement au taux réel.
                  </p>
                )}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Temps de découpe (h) <span className="text-gray-400 font-normal">— depuis le planning, modifiable</span></label>
                  <input type="number" step="0.25" min="0" value={decoupeHours} onChange={e => setDecoupe(e.target.value)}
                    placeholder="ex : 3.5"
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {decoupeHours && weekLabor && weekLabor.rate > 0 && (
                    <p className="text-xs text-pilote mt-1 font-medium">= {eur((parseFloat(decoupeHours) || 0) * weekLabor.rate)} imputés au taux réel du planning</p>
                  )}
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Main d'œuvre découpe (€) <span className="text-gray-400 font-normal">— auto, modifiable</span></label>
                  <input type="number" value={laborCost} onChange={e => setLaborCost(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>
                {totalCost1 > 0 && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Coût de revient {qty > 1 ? (isHalf ? 'par demi' : 'par animal') : 'total'}</p>
                    <p className="text-xl font-bold text-gray-900">{eur(totalCost1)}</p>
                    {qty > 1 && <p className="text-xs font-bold text-pilote-800 mt-0.5">Lot ({qty} {isHalf ? 'demis' : 'animaux'}) : {eur(totalCostLot)}</p>}
                  </div>
                )}
              </div>

              {/* 3 — Marge */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">3</span>
                  Marge souhaitée
                </h2>
                <div className="flex items-center gap-4 mb-2">
                  <input type="range" min={10} max={70} step={1} value={targetMargin} onChange={e => setTargetMargin(Number(e.target.value))}
                    className="flex-1 accent-pilote" />
                  <span className="text-2xl font-bold text-gray-800 w-14 text-right tabular-nums">{targetMargin}%</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400"><span>10%</span><span>40% (typique)</span><span>70%</span></div>
              </div>

              {/* 4 — Pièces (catégories) — masqué pour le bœuf, remplacé par l'arborescence dépliable */}
              {!isTree && (
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">4</span>
                  Pièces à valoriser
                </h2>
                <p className="text-[11px] text-gray-400 mb-3">Choix mémorisés pour {config.label.toLowerCase()} · retirez une pièce précise dans le tableau</p>
                <div className="space-y-2">
                  {CATEGORIES.map(cat => (
                    <label key={cat} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={includedCats.has(cat)} onChange={() => toggleCat(cat)} className="rounded" />
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                    </label>
                  ))}
                </div>
                {excludedCuts.size > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500">{excludedCuts.size} pièce{excludedCuts.size > 1 ? 's' : ''} retirée{excludedCuts.size > 1 ? 's' : ''} du calcul</span>
                    <button onClick={restoreAllCuts} className="flex items-center gap-1 text-xs text-pilote font-medium hover:underline">
                      <RotateCcw className="w-3 h-3" />Tout réactiver
                    </button>
                  </div>
                )}
              </div>
              )}

              {totalRevenue1 > 0 && (
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Notes</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="Qualité, conditions d'achat, fournisseur..."
                    rows={2} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 resize-none`} />
                </div>
              )}
            </div>

            {/* ── RÉSULTATS ── */}
            <div className="xl:col-span-2 space-y-5">

              {qty > 1 && totalRevenue1 > 0 && (
                <div className="bg-pilote rounded-2xl p-4 text-white shadow-card">
                  <p className="text-[11px] font-semibold text-pilote-200 mb-2 uppercase tracking-wider">Récapitulatif lot — {qty} {isHalf ? `demis (${config.label.toLowerCase()})` : `${config.label.toLowerCase()}x`}</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div><p className="text-xs text-pilote-200">Coût total lot</p><p className="text-xl font-extrabold">{eur(totalCostLot)}</p></div>
                    <div><p className="text-xs text-pilote-200">CA estimé total</p><p className="text-xl font-extrabold text-pilote-orange">{eur(totalRevenueLot)}</p></div>
                    <div><p className="text-xs text-pilote-200">Marge brute lot</p><p className="text-xl font-extrabold text-green-300">{eur(totalRevenueLot - totalCostLot)}</p><p className="text-xs text-pilote-200">{actualMargin1.toFixed(1)}%</p></div>
                  </div>
                </div>
              )}

              {totalRevenue1 > 0 && (
                <div className={`rounded-2xl p-4 border ${
                  coeffStatus === 'under' ? 'bg-green-50 border-green-200' : coeffStatus === 'over' ? 'bg-orange-50 border-orange-200' : 'bg-pilote-50 border-pilote-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {coeffStatus === 'under' && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />}
                    {coeffStatus === 'over'  && <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />}
                    {coeffStatus === 'ok'    && <TrendingUp className="w-5 h-5 text-pilote flex-shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className={`text-2xl font-bold ${
                          coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-pilote-800'
                        }`}>x{coefficient.toFixed(3)}</span>
                        <span className="text-sm font-semibold text-gray-700">Coefficient de valorisation</span>
                      </div>
                      <p className={`text-xs leading-relaxed ${
                        coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-pilote-800'
                      }`}>
                        {coeffStatus === 'under' && <>Coûts bas : <strong>{((1 - coefficient) * 100).toFixed(1)}% sous le marché</strong> pour {targetMargin}% de marge.</>}
                        {coeffStatus === 'over'  && <>Pour {targetMargin}% de marge : <strong>{((coefficient - 1) * 100).toFixed(1)}% au-dessus du marché</strong>. Positionnement premium.</> }
                        {coeffStatus === 'ok'    && <>Prix proches du marché ({coefficient > 1 ? '+' : ''}{((coefficient - 1) * 100).toFixed(1)}%). Bon équilibre pour {targetMargin}%.</> }
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-500">CA marché réf.</p>
                      <p className="text-sm font-bold text-gray-800">{eur(totalMarketRevenue1)}</p>
                      <p className="text-xs text-gray-500">CA cible/animal</p>
                      <p className="text-sm font-bold">{eur(totalRevenue1)}</p>
                    </div>
                  </div>
                </div>
              )}

              {totalRevenue1 > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{qty > 1 ? (isHalf ? 'Par demi' : 'Par animal') : 'Résultat'}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Poids vendable',  value: kgStr(totalSellable1), sub: `sur ${carcassW1.toFixed(1)} kg carcasse` },
                      { label: 'Coût de revient', value: eur(totalCost1),       sub: `${eur(totalCost1 / totalSellable1)}/kg` },
                      { label: 'CA conseillé',    value: eur(totalRevenue1),    sub: `coeff. x${coefficient.toFixed(3)}` },
                      { label: 'Marge brute',     value: eur(totalRevenue1 - totalCost1), sub: `${actualMargin1.toFixed(1)}% réel`, highlight: true },
                    ].map(kpi => (
                      <div key={kpi.label} className={`rounded-2xl p-4 border shadow-card ${'highlight' in kpi && kpi.highlight ? 'bg-pilote border-transparent' : 'bg-white border-gray-100'}`}>
                        <p className={`text-xs mb-1 ${'highlight' in kpi && kpi.highlight ? 'text-white/70' : 'text-gray-500'}`}>{kpi.label}</p>
                        <p className={`text-lg font-bold leading-tight ${'highlight' in kpi && kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                        <p className={`text-xs mt-0.5 ${'highlight' in kpi && kpi.highlight ? 'text-white/60' : 'text-gray-400'}`}>{kpi.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.length > 0 ? (
                <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-card">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-400" />Détail par pièce {qty > 1 && <span className="text-xs font-normal text-gray-400">{isHalf ? '(par demi)' : '(par animal)'}</span>}
                    </h2>
                    <span className="text-xs text-gray-400">{isTree ? 'Cliquez une pièce pour la déplier · poids et prix éditables' : 'Prix de référence modifiables · poids saisis'}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          {['Pièce','Poids','Réf. marché/kg','Prix conseillé/kg','CA pièce',''].map((h, hi) => (
                            <th key={hi} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {isTree ? renderTree(cutTree, 0) : CATEGORIES.map(cat => {
                          const catResults = results.filter(r => r.cut.category === cat)
                          if (catResults.length === 0) return null
                          const catActive  = catResults.filter(r => r.active)
                          const catRevenue = catActive.reduce((s, r) => s + r.revenue, 0)
                          const catWeight  = catActive.reduce((s, r) => s + r.weight, 0)
                          const catChecked = includedCats.has(cat)
                          return (
                            <React.Fragment key={cat}>
                              <tr className="border-t border-gray-100">
                                <td colSpan={6} className="px-4 py-2">
                                  <div className="flex items-center justify-between">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                                    {catChecked && catRevenue > 0 && <span className="text-xs text-gray-400">{kgStr(catWeight)} | {eur(catRevenue)}</span>}
                                  </div>
                                </td>
                              </tr>
                              {catResults.map(r => {
                                const isExcluded = excludedCuts.has(r.cut.id)
                                const refPrice = priceOf(r.cut)
                                const pctDiff = r.sellingPrice > 0 && refPrice > 0 ? ((r.sellingPrice - refPrice) / refPrice) * 100 : 0
                                const priceColor = pctDiff < -5 ? 'text-green-600' : pctDiff > 15 ? 'text-orange-600' : 'text-gray-900'
                                return (
                                  <tr key={r.cut.id} className={`group border-t border-gray-50 transition-colors ${r.active ? 'hover:bg-gray-50' : 'opacity-40 bg-gray-50/50'}`}>
                                    <td className="px-4 py-2.5 font-medium text-gray-800">
                                      {r.cut.name}
                                      {isExcluded && <span className="ml-2 text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">retirée</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <input type="number" min="0" step="0.1"
                                          value={cutWeights[r.cut.id] ?? ''}
                                          onChange={e => setCutWeights(prev => ({ ...prev, [r.cut.id]: e.target.value }))}
                                          disabled={isExcluded}
                                          placeholder="0"
                                          className="w-16 border border-gray-200 rounded-md px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
                                        <span className="text-xs text-gray-400">kg</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <input type="number" min="0" step="0.5"
                                          value={cutPrices[r.cut.id] ?? ''}
                                          onChange={e => setCutPrice(r.cut.id, e.target.value)}
                                          placeholder={String(r.cut.marketPrice)}
                                          className="w-14 border border-gray-200 rounded-md px-2 py-1 text-sm text-right tabular-nums text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                        <span className="text-xs text-gray-400">€</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                                      {r.active ? <span className={priceColor}>{eur(r.sellingPrice)}{Math.abs(pctDiff) > 1 && <span className={`ml-1 text-xs font-normal ${priceColor}`}>({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)</span>}</span> : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.active ? eur(r.revenue) : '—'}</td>
                                    <td className="px-2 py-2.5 text-center w-10">
                                      {isExcluded ? (
                                        <button onClick={() => toggleCut(r.cut.id)}
                                          title="Réintégrer cette pièce"
                                          className="p-1.5 rounded-lg text-pilote hover:bg-pilote-50 transition-colors">
                                          <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                      ) : (
                                        <button onClick={() => toggleCut(r.cut.id)}
                                          title="Retirer cette pièce du calcul"
                                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-pilote-800 bg-pilote text-white">
                          <td className="px-4 py-3 font-bold">TOTAL {qty > 1 ? (isHalf ? '/ demi' : '/ animal') : ''}</td>
                          <td className="px-4 py-3 text-right font-bold">{totalSellable1 > 0 ? kgStr(totalSellable1) : '—'}</td>
                          <td className="px-4 py-3 text-right text-pilote-200">{totalMarketRevenue1 > 0 ? eur(totalMarketRevenue1) : '—'}</td>
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3 text-right font-bold text-pilote-orange">{totalRevenue1 > 0 ? eur(totalRevenue1) : '—'}</td>
                          <td className="px-4 py-3" />
                        </tr>
                        {qty > 1 && totalRevenue1 > 0 && (
                          <tr className="bg-pilote-800 text-white">
                            <td className="px-4 py-2.5 font-bold text-sm">TOTAL LOT ({qty} {isHalf ? 'demis' : 'animaux'})</td>
                            <td className="px-4 py-2.5 text-right font-bold">{kgStr(totalSellable1 * qty)}</td>
                            <td className="px-4 py-2.5" /><td className="px-4 py-2.5" />
                            <td className="px-4 py-2.5 text-right font-bold text-pilote-orange">{eur(totalRevenueLot)}</td>
                            <td className="px-4 py-2.5" />
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                  <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                    <p className="text-xs text-gray-400">
                      Coefficient x{coefficient.toFixed(3)} appliqué aux prix de référence.
                      <span className="text-green-600 font-medium ml-1">Vert</span> = sous la référence.
                      <span className="text-orange-600 font-medium ml-1">Orange</span> = +15% au-dessus.
                      <span className="ml-1">Poids et prix de référence sont éditables ; les prix restent mémorisés par famille.</span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-gray-100 rounded-2xl p-16 shadow-card flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">{config.emoji}</span>
                  </div>
                  <p className="text-gray-600 font-medium">Renseignez les informations</p>
                  <p className="text-sm text-gray-400 mt-1">Le détail par pièce apparaîtra ici</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal historique */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold text-gray-900">
                  {ANIMALS[selected.animal_type as AnimalType]?.emoji} {selected.breed_name}
                  {(selected.quantity ?? 1) > 1 && <span className="ml-2 text-sm font-normal text-pilote">× {selected.quantity}</span>}
                </h2>
                <p className="text-xs text-gray-400">{new Date(selected.purchase_date).toLocaleDateString('fr-FR')} · {selected.carcass_weight || selected.live_weight} kg carcasse/animal</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => deleteValo(selected.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Coût total lot',  value: eur(selected.total_cost),                         highlight: false },
                { label: 'CA estimé total', value: eur(selected.total_revenue),                       highlight: true  },
                { label: 'Marge brute',     value: eur(selected.total_revenue - selected.total_cost), highlight: false },
                { label: 'Taux de marge',   value: `${selected.margin_rate.toFixed(1)} %`,            highlight: selected.margin_rate >= 35 },
                { label: 'Carcasse/animal', value: `${selected.carcass_weight} kg`,                   highlight: false },
                { label: 'Coefficient',     value: `x${selected.coefficient?.toFixed(3)}`,            highlight: false },
                { label: 'Prix achat/kg',   value: `${selected.purchase_per_kg} €/kg carcasse`,      highlight: false },
                { label: 'Main d\'œuvre',   value: eur(selected.labor_cost),                          highlight: false },
              ].map(kpi => (
                <div key={kpi.label} className={`rounded-xl p-3 ${kpi.highlight ? 'bg-pilote' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${kpi.highlight ? 'text-pilote-200' : 'text-gray-400'}`}>{kpi.label}</p>
                  <p className={`text-base font-bold ${kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
            {selected.notes && (
              <div className="mt-3 p-3 bg-pilote-50 border border-pilote-100 rounded-xl">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-pilote-800">Notes</p>
                <p className="text-sm text-gray-700 mt-0.5">{selected.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
