'use client'

// Le CONTENU de la fiche recette, en composant réutilisable :
//   · dans la LISTE (/dashboard/recettes) : encadré ouvert SUR PLACE au clic
//     d'une carte — zéro navigation, fermeture à la croix ou au re-clic ;
//   · dans la page /dashboard/recettes/[id] : la même fiche en pleine page
//     (liens directs, partage d'URL).
//
// TOUT SUR UNE SEULE PAGE (plus d'onglets ni d'argumentaire de vente) :
//   · bandeau de chiffres-clés — prix de vente TTC et COEFFICIENT modifiables
//     sur place (saisir l'un recalcule et enregistre l'autre : un seul chiffre
//     stocké, le PV TTC) ;
//   · paliers de quantité — « pour 20, temps ×1,8 » — enregistrés sur la fiche ;
//   · double tableau : à gauche les ÉTAPES (durée en minutes par étape, temps
//     total = leur somme), à droite les INGRÉDIENTS aux quantités du palier choisi.

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Pencil, Plus, X, Check, Clock, ShoppingBasket, Package, AlertTriangle, Users, Printer, Copy } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { facteurPerte, parseStoredSteps, parseStoredTiers } from '@/lib/recipes'
import {
  GrapheCouts, TableauIngredients, TrendSpark,
  ageJours, fmtDateFr, fmtEuro, fmtMin, fmtQty, ligneKg, num, round2, unitFr,
  venteEnClair, UNITES_VENTE,
  type FicheEmployee, type FicheFormat, type FicheGeneric, type FicheRecipe, type JalonCout, type SerieCout,
} from './fiche-ui'

// Les TYPES de la fiche vivent dans ./fiche-ui — ils restent ré-exportés ici,
// c'est de ce module que la liste et la page pleine les importent depuis
// toujours.
export type {
  FicheIngredient, FicheGeneric, FicheCost, FicheFormat, FicheRecipe, FicheEmployee,
} from './fiche-ui'

/** Brouillons de saisie — ils ne quittent jamais ce composant : le serveur
 *  reçoit des nombres, l'écran manipule des chaînes (virgule décimale, champ
 *  vidé le temps d'une frappe). */
type StepDraft = { text: string; minutes: string }
type TierDraft = { qty: string; mult: string }

/** Les cinq écrans de la fiche. Même découpe que chez Otami — c'est celle qui
 *  correspond aux moments du métier : ce qu'on met dedans, comment on le fait,
 *  à combien on le vend, comment ça évolue, et le reste. « Ingrédients » ouvre
 *  par défaut : c'est là qu'on passe son temps. */
type Onglet = 'infos' | 'ingredients' | 'fabrication' | 'vente' | 'stats'
const ONGLETS: { id: Onglet; label: string }[] = [
  { id: 'infos', label: 'Infos' },
  { id: 'ingredients', label: 'Ingrédients' },
  { id: 'fabrication', label: 'Fabrication' },
  { id: 'vente', label: 'Vente' },
  { id: 'stats', label: 'Statistiques' },
]

export default function FichePanel({
  recipe, employees, generics, target = null, historiqueIncomplet = false, initialFormatId = null, onEditFull, onSaved, onClose,
}: {
  recipe: FicheRecipe
  /** Format à ouvrir d'emblée. La liste étant à une ligne par FORMAT (lot 50),
   *  cliquer la ligne « au kg » doit ouvrir la fiche sur « au kg » — pas sur le
   *  format par défaut. Absent ou introuvable : le format par défaut. */
  initialFormatId?: string | null
  employees: FicheEmployee[]
  /** L'historique de prix a été tronqué côté serveur : la courbe ci-dessous ne
   *  porte que sur ce qui a pu être lu. Une courbe qui rétrécit ressemble en
   *  tout point à un prix qui n'a pas bougé — il faut donc le dire. */
  historiqueIncomplet?: boolean
  /** Articles génériques de la mercuriale — pour l'ajout d'ingrédient sur place */
  generics: FicheGeneric[]
  /** Cible de marge de la catégorie de la fiche (R-A) — null : pas de cible posée */
  target?: number | null
  /** Ouvre l'édition complète (modale sur la liste, ?edit= en pleine page) */
  onEditFull: () => void
  /** Appelé après un enregistrement réussi (étapes, paliers, prix, ingrédients) */
  onSaved: () => void
  /** Absent en pleine page ; présent dans l'encadré de la liste */
  onClose?: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    parseStoredSteps(recipe.fabrication_steps).map(s => ({ text: s.text, minutes: s.minutes !== null ? String(s.minutes) : '' })))
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    parseStoredTiers(recipe.time_tiers).map(t => ({ qty: String(t.qty), mult: String(t.mult) })))
  const [selTier, setSelTier] = useState<number | null>(null)
  const [newTier, setNewTier] = useState<TierDraft | null>(null)
  // Édition sur place du PV TTC / du coefficient (un seul champ à la fois)
  const [editKpi, setEditKpi] = useState<{ field: 'pv' | 'coef'; value: string } | null>(null)
  const kpiCancelRef = useRef(false)
  // Format de vente affiché — null tant qu'on n'a pas choisi : c'est le premier
  // (le format par défaut) qui s'ouvre, comme chez Otami.
  const [formatId, setFormatId] = useState<string | null>(initialFormatId)
  // Création d'un format (« + Format ») — nom, unité de vente, quantité vendable
  const [editFormat, setEditFormat] = useState<{ mode: 'creer'; nom: string; unite: string; qty: string } | null>(null)
  const [confirmFormat, setConfirmFormat] = useState(false)
  // Ajout d'ingrédient directement depuis le tableau (comme les étapes).
  // `emballage` : la recherche ne propose alors que des CONTENANTS — c'est le
  // bouton « Ajouter » de la carte Contenants qui l'ouvre dans ce mode.
  const [newIng, setNewIng] = useState<{ query: string; generic: FicheGeneric | null; qty: string; unit: 'kg' | 'g' | 'piece'; loss: string; emballage?: boolean } | null>(null)
  // Édition de la perte de fabrication (null = pas en cours d'édition)
  const [editPerte, setEditPerte] = useState<string | null>(null)
  // Retrait d'ingrédient en deux clics (jamais de confirm() natif)
  const [confirmIng, setConfirmIng] = useState<number | null>(null)
  // Sous-onglet affiché — « Ingrédients » d'abord, c'est là qu'on travaille
  const [onglet, setOnglet] = useState<Onglet>('ingredients')
  // Séries visibles du graphe de l'onglet Statistiques
  const [series, setSeries] = useState<Record<SerieCout, boolean>>({ cout: true, pv: true, marge: false })

  const c = recipe.cost
  const employeeName = useMemo(() =>
    recipe.employee_id ? (employees.find(e => e.id === recipe.employee_id)?.name ?? null) : null,
  [recipe, employees])

  // ── Temps : somme LIVE des étapes chronométrées, repli labor_minutes ──
  const stepMins = steps.map(s => num(s.minutes))
  const hasTimed = stepMins.some(m => m > 0)
  const baseMinutes = hasTimed ? Math.round(stepMins.reduce((a, b) => a + b, 0) * 10) / 10 : (Number(recipe.labor_minutes) || 0)

  // ── Palier sélectionné : quantités ×ratio, temps ×multiple ──
  const baseQty = Number(recipe.yield_qty) || 0
  const sel = selTier !== null && tiers[selTier] ? { qty: num(tiers[selTier].qty), mult: num(tiers[selTier].mult) } : null
  const active = sel && sel.qty > 0 && sel.mult > 0 ? sel : null
  const ratio = active && baseQty > 0 ? active.qty / baseQty : 1
  const timeMult = active ? active.mult : 1
  const scaledMinutes = baseMinutes * timeMult

  // Poids total des lignes en g/kg (les pièces sont hors assiette de poids).
  // NET *et* BRUT : chaque ligne du tableau affiche sa quantité BRUTE — ce qu'on
  // sort du frigo, perte comprise — alors que le pied ne sommait que le NET,
  // dans la même colonne. Sur une fiche à 15 % de perte l'écart saute aux yeux
  // et jette le doute sur le reste des chiffres. Les deux sont affichés.
  //
  // `horsAssiette` compte les lignes SANS poids connu : elles ne peuvent pas
  // recevoir de « % de poids », et leur nombre est affiché sous le tableau —
  // une colonne dont on ignore ce qui manque est une colonne qui ment.
  const poids = useMemo(() => recipe.ingredients.reduce((acc, i) => {
    const kg = ligneKg(i)
    if (kg === null) return { ...acc, horsAssiette: acc.horsAssiette + 1 }
    return { net: acc.net + kg.net, brut: acc.brut + kg.brut, horsAssiette: acc.horsAssiette }
  }, { net: 0, brut: 0, horsAssiette: 0 }), [recipe])

  // `coutMatiere` reste la somme des LIGNES (matière + emballage) : c'est le
  // dénominateur des parts de coût du tableau, et son pied affiche 100 %. La
  // perte de fabrication n'est PAS une ligne — l'ajouter ici ferait des
  // pourcentages qui ne totalisent plus ce que le pied annonce. Elle est donc
  // comptée à part, et affichée sur sa propre ligne sous le tableau.
  const pertePct = Number(c?.perte_pct ?? recipe.loss_pct ?? 0) || 0
  const perteHt = Number(c?.perte_ht ?? 0) || 0
  const coutMatiere = (c?.matiere_ht ?? 0) + (c?.emballage_ht ?? 0)
  /** Les CONTENANTS de la fiche : ses lignes d'ingrédient de catégorie
   *  « emballage ». Pas de table dédiée — un contenant est un article générique
   *  comme un autre, c'est sa catégorie qui le désigne. */
  const contenants = useMemo(() => recipe.ingredients.filter(i => i.categorie === 'emballage'), [recipe.ingredients])

  // ── Le FORMAT affiché ──────────────────────────────────────────────────
  // La fabrication est commune à tous les formats (ingrédients, étapes, temps,
  // coût du batch) ; ce qui change d'un onglet à l'autre, c'est la quantité
  // vendable, le prix, et donc la marge. Tout ce bloc ne touche QUE la vente.
  const formats = useMemo(
    () => [...(recipe.formats ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr')),
    [recipe.formats],
  )
  const actif = formats.find(f => f.id === formatId) ?? formats[0] ?? null

  // Base du PV et du coefficient : le coût PAR UNITÉ DE VENTE du format choisi
  // (pièces fabriquées, kg vendus). Sans format — cas qui ne devrait plus
  // exister depuis la reprise —, on retombe sur le coût de la fiche.
  const coutUnite = actif ? actif.cout_unite_ht : (c ? (c.par_unite_vente_ht ?? c.par_unite_ht ?? c.total_ht) : null)
  const uniteVente = (actif ? actif.sell_unit : recipe.sell_unit) || recipe.yield_unit || 'unité'
  // Quantité VENDABLE du batch (en unités de vente), repli : la production
  const venteQty = actif ? actif.vente_qty : (Number(recipe.yield_qty) || 0)
  const pvTTCActif = actif ? actif.selling_price_ttc : recipe.selling_price_ttc
  const pvHTActif = actif ? actif.pv_unitaire_ht : (c?.pv_unitaire_ht ?? null)
  const margeActive = actif ? actif.marge_pct : (c?.marge_pct ?? null)
  const coefActif = actif ? actif.coefficient : (c?.coefficient ?? null)
  const tvaActive = actif ? actif.tva_rate : (Number(recipe.tva_rate) || 0)
  // Ingrédients comptés pour ZÉRO dans le coût, nommés. Le moteur refuse déjà de
  // publier marge et coefficient quand il en reste (lib/recipes.ts) ; la
  // conversion coefficient → prix de vente, elle, passait quand même : le coût
  // sous-évalué produisait un prix trop bas, enregistré et affiché en boutique.
  // Chaque ingrédient sans prix porte de quoi ALLER LE CORRIGER : l'article
  // générique visé, ou la sous-fiche fautive. Le bandeau renvoyait jusqu'ici
  // vers la page Mercuriale entière — un catalogue de 125 lignes à fouiller
  // pour retrouver l'article dont on venait de lire le nom.
  const sansPrix = useMemo(
    () => recipe.ingredients
      .filter(i => i.price_source === 'aucun' || i.sub_incomplete === true)
      .map(i => ({
        nom: (i.label || '').trim() || 'ingrédient sans nom',
        href: i.sub_recipe_id
          ? `/dashboard/recettes/${i.sub_recipe_id}`
          : i.generic_id ? `/dashboard/mercuriale?generic=${i.generic_id}` : null,
      })),
    [recipe.ingredients],
  )
  const nomsSansPrix = sansPrix.slice(0, 3).map(x => x.nom).join(', ') + (sansPrix.length > 3 ? `, +${sansPrix.length - 3}` : '')
  /** Le prix mercuriale le PLUS ANCIEN de la fiche — le niveau de confiance du
   *  coût de revient tient à lui. Signalé seulement au-delà de 30 jours : en
   *  deçà, « prix du jour » reste une description honnête. */
  const prixLePlusAncien = useMemo(() => {
    let pire: { date: string; jours: number; nom: string } | null = null
    for (const i of recipe.ingredients) {
      if (i.price_source !== 'mercuriale' || !i.price_date) continue
      const j = ageJours(i.price_date)
      if (j === null || j <= 30) continue
      if (!pire || j > pire.jours) pire = { date: String(i.price_date).slice(0, 10), jours: j, nom: (i.label || '').trim() || 'un ingrédient' }
    }
    return pire
  }, [recipe.ingredients])
  const coutIncomplet = (c?.prix_manquants ?? 0) > 0
  // Coût matière (« food cost ») : part de la matière SEULE dans le PV HT d'une
  // unité — calculable uniquement quand rendement et prix de vente sont connus.
  const foodCostPct = c && pvHTActif !== null && pvHTActif > 0 && venteQty > 0
    ? Math.round(((c.matiere_ht / venteQty) / pvHTActif) * 100)
    : null
  // Couleur de la marge : contre la CIBLE de la catégorie si elle existe,
  // sinon les repères historiques 50/30.
  // ── Les deux marges du métier, PAR UNITÉ DE VENTE (onglet « Vente ») ──
  // Marge BRUTE = PV HT − matière (emballage compris) : ce que la vente laisse
  // avant d'avoir payé le temps de fabrication. Marge NETTE = marge brute −
  // main-d'œuvre : ce qu'il en reste vraiment. La distinction est celle
  // d'Otami, et c'est celle que fait un boucher quand il compare un produit
  // fabriqué maison à un produit acheté tout fait.
  //
  // Rien n'est publié tant qu'un prix d'ingrédient manque : le coût serait
  // sous-évalué, donc les deux marges flattées — même règle que le moteur.
  // La perte de fabrication est un coût de MATIÈRE (il faut en sortir plus pour
  // le même rendement) : elle entre dans la marge brute, pas dans la nette.
  const matiereUnite = c && venteQty > 0 ? round2((c.matiere_ht + perteHt + c.emballage_ht) / venteQty) : null
  const moUnite = c && venteQty > 0 ? round2(c.main_oeuvre_ht / venteQty) : null
  const margeBrute = !coutIncomplet && pvHTActif !== null && matiereUnite !== null ? round2(pvHTActif - matiereUnite) : null
  const margeNette = margeBrute !== null && moUnite !== null ? round2(margeBrute - moUnite) : null

  /** Les jalons du graphe. Le serveur renvoie le coût MATIÈRE du batch relu aux
   *  prix de chaque date ; on y ajoute la main-d'œuvre (constante — le temps ne
   *  dépend pas des prix d'achat) et on ramène le tout à l'UNITÉ DE VENTE, la
   *  même base que le prix de vente. Superposer un coût de batch et un prix au
   *  kilo donnerait deux courbes qui ne se parlent pas.
   *
   *  Le prix de vente est celui d'AUJOURD'HUI sur toute la période : PILOTE ne
   *  garde pas l'historique des prix de vente. La note sous le graphe le dit. */
  const jalonsGraphe = useMemo<JalonCout[]>(() => {
    const s = c?.matiere_series
    if (!Array.isArray(s) || s.length < 2) return []
    const q = venteQty > 0 ? venteQty : 1
    const mo = c?.main_oeuvre_ht ?? 0
    return s.map(pt => {
      const cout = round2((pt.v + mo) / q)
      const pv = pvHTActif
      // Même règle d'honnêteté que partout : pas de marge tant qu'il manque un
      // prix d'ingrédient — la courbe serait flatteuse et fausse.
      const marge = pv !== null && pv > 0 && !coutIncomplet ? Math.round(((pv - cout) / pv) * 10) / 10 : null
      return { d: pt.d, cout, pv, marge }
    })
  }, [c, venteQty, pvHTActif, coutIncomplet])

  const margeColor = margeActive === null
    ? 'text-gray-900'
    : target != null
      ? (margeActive >= target ? 'text-green-600' : margeActive >= target - 10 ? 'text-orange-500' : 'text-red-600')
      : (margeActive >= 50 ? 'text-green-600' : margeActive >= 30 ? 'text-orange-500' : 'text-red-600')
  // Coût du palier : matière ×ratio (linéaire), MO ×multiple (économie d'échelle)
  const moScaled = c?.labor_rate_ht != null ? round2(scaledMinutes / 60 * c.labor_rate_ht) : 0
  const coutScaled = round2(coutMatiere * ratio + moScaled)

  /** Lignes d'ingrédients ACTUELLES au format d'écriture de l'API (PUT = remplacement
   *  complet) — sub_recipe_id DOIT voyager, sinon un enregistrement d'étapes ou de
   *  paliers déferait les sous-recettes de la fiche. */
  const ingPayload = () => recipe.ingredients.map(i => ({
    generic_id: i.generic_id, article_id: i.article_id, sub_recipe_id: i.sub_recipe_id ?? null, label: i.label,
    quantity: i.quantity, qty_unit: i.qty_unit, unit: i.unit,
    loss_pct: i.loss_pct, manual_price_ht: i.manual_price_ht ?? null,
  }))

  async function saveAll(extra?: { selling_price_ttc?: number | null; loss_pct?: number; ingredients?: ReturnType<typeof ingPayload> }) {
    if (saving) return
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: recipe.name, category: recipe.category,
        yield_qty: recipe.yield_qty, yield_unit: recipe.yield_unit,
        // L'unité de vente DOIT voyager (le PUT remplace les champs) : sans elle,
        // enregistrer une étape rebasculerait une fiche « vendue au kg » sur
        // l'unité produite, et sa marge changerait en silence.
        sell_unit: recipe.sell_unit ?? null, sell_qty: recipe.sell_qty ?? null,
        labor_minutes: recipe.labor_minutes,
        // La perte de fabrication DOIT voyager elle aussi : le serveur la laisse
        // inchangée quand elle est absente, mais l'envoyer explicitement évite
        // que la règle change un jour sans qu'on s'en aperçoive ici.
        loss_pct: extra && 'loss_pct' in extra ? extra.loss_pct : (Number(recipe.loss_pct) || 0),
        selling_price_ttc: extra && 'selling_price_ttc' in extra ? extra.selling_price_ttc : recipe.selling_price_ttc,
        tva_rate: recipe.tva_rate, notes: recipe.notes, employee_id: recipe.employee_id,
        fabrication_steps: steps
          .filter(s => s.text.trim())
          .map(s => ({ text: s.text.trim(), minutes: num(s.minutes) > 0 ? num(s.minutes) : null })),
        time_tiers: tiers
          .map(t => ({ qty: num(t.qty), mult: num(t.mult) }))
          .filter(t => t.qty > 0 && t.mult > 0),
        ...(extra?.ingredients ? { ingredients: extra.ingredients } : {}),
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { toast({ variant: 'success', title: 'Fiche enregistrée' }); setDirty(false); onSaved() }
    else toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
  }

  /** Duplique la fiche entière — champs, étapes chronométrées, paliers et
   *  ingrédients — sous « (copie) », puis ouvre la copie.
   *
   *  Les cinq fiches vont devenir cinquante, dont une bonne moitié de variantes
   *  (saucisse nature / herbes / piment, terrine 500 g / 1 kg). Sans ce bouton,
   *  chaque variante se ressaisit intégralement : douze ingrédients, les pertes,
   *  les étapes minutées, les paliers. La route POST accepte déjà tout — c'est
   *  de la réutilisation, pas du nouveau code serveur. */
  async function dupliquer() {
    if (saving) return
    setSaving(true)
    const res = await fetch('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 80 caractères maximum côté serveur : on rogne le nom, pas le suffixe,
        // sinon dupliquer une fiche au nom long échouerait sur un 400 obscur.
        name: `${recipe.name.slice(0, 72).trim()} (copie)`,
        category: recipe.category,
        yield_qty: recipe.yield_qty, yield_unit: recipe.yield_unit,
        sell_unit: recipe.sell_unit ?? null, sell_qty: recipe.sell_qty ?? null,
        labor_minutes: recipe.labor_minutes,
        loss_pct: Number(recipe.loss_pct) || 0,
        // Le PV n'est PAS repris : une variante n'a aucune raison de se vendre
        // au même prix, et un prix hérité en silence est un prix qu'on oublie.
        selling_price_ttc: null,
        tva_rate: recipe.tva_rate, notes: recipe.notes, employee_id: recipe.employee_id,
        fabrication_steps: parseStoredSteps(recipe.fabrication_steps),
        time_tiers: parseStoredTiers(recipe.time_tiers),
        ingredients: ingPayload(),
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok || !data?.id) {
      toast({ variant: 'error', title: 'Duplication impossible', description: data?.error || 'Réessayez.' })
      return
    }
    toast({ variant: 'success', title: 'Copie créée', description: 'Le prix de vente est à poser sur la copie.' })
    window.location.href = `/dashboard/recettes/${data.id}`
  }

  /** Ajoute l'ingrédient choisi et enregistre aussitôt (la liste est REMPLACÉE côté API) */
  function addIngredient() {
    if (!newIng?.generic || num(newIng.qty) <= 0) return
    const g = newIng.generic
    saveAll({
      ingredients: [...ingPayload(), {
        generic_id: g.id, article_id: null, sub_recipe_id: null, label: g.name,
        quantity: num(newIng.qty),
        qty_unit: g.base_unit === 'kg' ? (newIng.unit === 'g' ? 'g' : 'kg') : 'piece',
        unit: null, loss_pct: num(newIng.loss), manual_price_ht: null,
      }],
    })
    setNewIng(null)
  }

  /** Retire une ligne (2e clic) — au moins un ingrédient doit rester */
  function removeIngredient(idx: number) {
    if (confirmIng !== idx) { setConfirmIng(idx); return }
    setConfirmIng(null)
    if (recipe.ingredients.length <= 1) {
      toast({ variant: 'error', title: 'Une recette garde au moins un ingrédient' })
      return
    }
    saveAll({ ingredients: ingPayload().filter((_, i) => i !== idx) })
  }

  // ── Écriture des formats de vente ────────────────────────────────────────
  // Un format ne porte que des décisions du boucher (nom, unité, quantité
  // vendable, prix, TVA). Rien de calculé n'est envoyé : le serveur relit coût,
  // marge et coefficient à chaque lecture.

  /** Envoie l'état COMPLET d'un format (le PUT remplace ses champs), en
   *  repartant du format actif et en n'écrasant que ce qu'on modifie. */
  async function saveFormat(patch: Partial<Pick<FicheFormat, 'name' | 'sell_unit' | 'sell_qty' | 'selling_price_ttc' | 'tva_rate' | 'validated'>>) {
    if (saving || !actif) return
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}/formats`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format_id: actif.id,
        name: actif.name, sell_unit: actif.sell_unit, sell_qty: actif.sell_qty,
        selling_price_ttc: actif.selling_price_ttc, tva_rate: actif.tva_rate, validated: actif.validated,
        ...patch,
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { toast({ variant: 'success', title: 'Format enregistré' }); onSaved() }
    else toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
  }

  /** Crée un format de plus sur la même fabrication — sans prix : une variante
   *  n'a aucune raison de se vendre au même prix, et un prix hérité en silence
   *  est un prix qu'on oublie. */
  async function creerFormat(nom: string, unite: string, qty: string) {
    if (saving) return
    const name = nom.trim()
    if (name.length < 2) return
    if (unite && !(num(qty) > 0)) {
      toast({
        variant: 'error', title: 'Quantité vendable manquante',
        description: `Vendu en ${unite} : indiquez ce que le batch représente dans cette unité (ex. 6 pièces de 400 g → 2,4).`,
      })
      return
    }
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}/formats`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, sell_unit: unite || null, sell_qty: unite ? num(qty) : null,
        selling_price_ttc: null, tva_rate: actif?.tva_rate ?? 5.5,
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok) {
      toast({ variant: 'error', title: 'Format non créé', description: data?.error || 'Réessayez.' })
      return
    }
    setEditFormat(null)
    if (data?.id) setFormatId(String(data.id))
    toast({ variant: 'success', title: `Format « ${name} » ajouté`, description: 'Le prix de vente est à poser sur ce format.' })
    onSaved()
  }

  /** Retire le format affiché (jamais le dernier — la route le refuse aussi) */
  async function retirerFormat() {
    if (saving || !actif) return
    if (!confirmFormat) { setConfirmFormat(true); return }
    setConfirmFormat(false)
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}/formats?format_id=${encodeURIComponent(actif.id)}`, { method: 'DELETE' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { setFormatId(null); toast({ variant: 'info', title: 'Format retiré' }); onSaved() }
    else toast({ variant: 'error', title: 'Retrait impossible', description: data?.error || 'Réessayez.' })
  }

  /** Enregistre la perte de fabrication (champ vide = aucune perte) */
  function savePerte() {
    if (saving || editPerte === null) return
    const brut = editPerte.trim()
    const v = brut === '' ? 0 : num(editPerte)
    setEditPerte(null)
    if (!(v >= 0 && v < 100)) {
      toast({ variant: 'error', title: 'Perte invalide', description: 'Indiquez un pourcentage entre 0 et 99.' })
      return
    }
    if (Math.abs(v - pertePct) < 0.005) return
    saveAll({ loss_pct: v })
  }

  /** Valide l'édition sur place du PV ou du coef → recalcule et enregistre le PV TTC */
  function commitKpi() {
    if (kpiCancelRef.current) { kpiCancelRef.current = false; setEditKpi(null); return }
    if (!editKpi) return
    const brut = editKpi.value.trim()
    const v = num(editKpi.value)
    setEditKpi(null)
    // Champ VIDÉ sur le prix de vente = effacement voulu. Auparavant un champ
    // vide ne faisait rien : retirer un prix posé par erreur imposait de rouvrir
    // la modale complète, et tant qu'il restait, marge et coefficient affichaient
    // un verdict calculé sur un chiffre que le boucher venait de désavouer.
    if (editKpi.field === 'pv' && brut === '') {
      if (pvTTCActif === null) return
      saveFormat({ selling_price_ttc: null })
      return
    }
    if (v <= 0) return
    if (editKpi.field === 'pv') {
      if (pvTTCActif !== null && Math.abs(v - pvTTCActif) < 0.005) return
      saveFormat({ selling_price_ttc: round2(v) })
      return
    }
    // Coefficient saisi → PV TTC = coût de revient × coef, remis en TTC
    if (coutUnite === null || coutUnite <= 0) {
      toast({ variant: 'error', title: 'Coût de revient inconnu', description: 'Renseignez d’abord les ingrédients (et leurs prix) pour calculer un prix depuis le coefficient.' })
      return
    }
    // Un coût dont il manque un prix est SOUS-ESTIMÉ : le multiplier par un coef
    // donnerait un prix de vente trop bas, enregistré tel quel et affiché en
    // boutique. On refuse, en nommant ce qui manque.
    if (coutIncomplet) {
      toast({
        variant: 'error', title: 'Coût incomplet — prix non calculable',
        description: `${nomsSansPrix} sans prix : ${sansPrix.length > 1 ? 'ils comptent' : 'il compte'} pour 0 €, le coût est sous-estimé et le prix obtenu serait trop bas. Renseignez le prix depuis la Mercuriale, ou saisissez le prix de vente directement.`,
      })
      return
    }
    const pvTTC = round2(coutUnite * v * (1 + tvaActive / 100))
    saveFormat({ selling_price_ttc: pvTTC })
  }

  function kpiInput() {
    if (!editKpi) return null
    return (
      <input
        autoFocus inputMode="decimal" value={editKpi.value}
        onChange={e => setEditKpi(p => (p ? { ...p, value: e.target.value } : p))}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { kpiCancelRef.current = true; e.currentTarget.blur() }
        }}
        onBlur={commitKpi}
        className="w-full bg-transparent text-xl font-extrabold tracking-tight text-gray-900 tabular border-b-2 border-pilote-orange focus:outline-none mt-1"
      />
    )
  }

  const uniteLabel = recipe.yield_unit || 'unités'

  return (
    <div className="bg-white rounded-2xl border border-pilote-100 shadow-card-hover overflow-hidden">
      {/* Bandeau d'identité de l'encadré */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap bg-pilote-50/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-extrabold tracking-tight text-gray-900 truncate">{recipe.name}</h2>
            {recipe.category && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2.5 py-1">{recipe.category}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {recipe.yield_qty ? `Base : ${fmtQty(recipe.yield_qty)} ${uniteLabel} par batch` : 'Rendement non renseigné'}
            {actif?.sell_unit && Number(actif.sell_qty) > 0 ? <>{' · '}vendu {venteEnClair(actif.sell_unit)} — le batch fait {fmtQty(Number(actif.sell_qty))} {actif.sell_unit} vendables</> : null}
            {/* « Prix du jour » sans nuance était une promesse que les données
                ne tiennent pas toujours : le plus ancien prix de la fiche peut
                dater de plusieurs mois. On dit lequel, et depuis quand. */}
            {prixLePlusAncien
              ? <>{' · '}coûts aux prix de la mercuriale — le plus ancien remonte au {fmtDateFr(prixLePlusAncien.date)} ({prixLePlusAncien.jours} j, {prixLePlusAncien.nom})</>
              : <>{' · '}coûts au prix du jour de la mercuriale</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dirty && (
            <button onClick={() => saveAll()} disabled={saving}
              className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          )}
          <button onClick={() => window.open(`/api/recipes/${recipe.id}/pdf`, '_blank')}
            title="Fiche atelier à imprimer pour le classeur — sans coûts, prix ni marges"
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors">
            <Printer className="w-3.5 h-3.5" />Imprimer
          </button>
          <button onClick={dupliquer} disabled={saving}
            title="Créer une variante : mêmes ingrédients, mêmes étapes et paliers, sans le prix de vente"
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors disabled:opacity-50">
            <Copy className="w-3.5 h-3.5" />Dupliquer
          </button>
          <button onClick={onEditFull}
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors">
            <Pencil className="w-3.5 h-3.5" />Modifier la fiche
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-700 transition-colors" title="Fermer la fiche">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── FORMATS DE VENTE ────────────────────────────────────────────────
          Une recette mère, plusieurs formats : « SAUCISSE MONTAGNARDE » et
          « SAUCISSE MONTAGNARDE AU KG ». Même fabrication, même coût de batch —
          seuls la quantité vendable, le prix et donc la marge changent. Sans
          ces onglets, vendre le même produit à la pièce ET au kilo imposait de
          dupliquer la fiche entière, ingrédients compris : deux fiches qui
          divergent au premier changement de recette. */}
      {formats.length > 0 && (
        <div className="px-5 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-1">Format de vente</span>
          {formats.map(f => {
            const sel = actif?.id === f.id
            return (
              <button key={f.id} onClick={() => { setFormatId(f.id); setEditFormat(null); setConfirmFormat(false) }}
                title={f.sell_unit && f.sell_qty ? `Vendu en ${f.sell_unit} — le batch en fait ${fmtQty(Number(f.sell_qty))}` : 'Vendu à l’unité produite'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${sel ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
                {f.validated && <Check className={`w-3 h-3 ${sel ? 'text-white/70' : 'text-green-600'}`} />}
                <span className="max-w-[16rem] truncate">{f.name}</span>
                {f.marge_pct !== null && (
                  <span className={`text-[10px] font-bold tabular ${sel ? 'text-white/70' : 'text-gray-400'}`}>{Math.round(f.marge_pct)} %</span>
                )}
              </button>
            )
          })}

          {editFormat?.mode === 'creer' ? (
            <span className="inline-flex items-center gap-1.5 bg-white border border-pilote-200 rounded-full pl-3 pr-1.5 py-1">
              <input autoFocus value={editFormat.nom} placeholder="Nom du format"
                onChange={e => setEditFormat(p => (p ? { ...p, nom: e.target.value } : p))}
                className="w-40 text-xs focus:outline-none" />
              <select value={editFormat.unite}
                onChange={e => setEditFormat(p => (p ? { ...p, unite: e.target.value } : p))}
                className="text-[11px] bg-transparent focus:outline-none text-gray-500">
                <option value="">à l&apos;unité produite</option>
                {UNITES_VENTE.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              {editFormat.unite && (
                <input inputMode="decimal" value={editFormat.qty} placeholder="batch"
                  title={`Ce que le batch représente en ${editFormat.unite}`}
                  onChange={e => setEditFormat(p => (p ? { ...p, qty: e.target.value } : p))}
                  className="w-12 text-xs tabular focus:outline-none" />
              )}
              <button onClick={() => creerFormat(editFormat.nom, editFormat.unite, editFormat.qty)} disabled={saving}
                className="w-6 h-6 rounded-full bg-pilote text-white flex items-center justify-center disabled:opacity-50" title="Ajouter ce format">
                <Plus className="w-3 h-3" />
              </button>
              <button onClick={() => setEditFormat(null)} className="w-6 h-6 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <button onClick={() => setEditFormat({ mode: 'creer', nom: `${recipe.name} `, unite: '', qty: '' })}
              title="Même fabrication, autre conditionnement — le coût du batch est partagé, seule la vente change"
              className="inline-flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-pilote-200 rounded-full px-3 py-1.5 hover:bg-pilote-50 transition-colors">
              <Plus className="w-3 h-3" />Format
            </button>
          )}

          {/* Gestes sur le format AFFICHÉ — validé, retiré. Le dernier format ne
              se retire pas : une fiche sans format n'aurait ni prix ni marge. */}
          {actif && (
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => saveFormat({ validated: !actif.validated })} disabled={saving}
                title={actif.validated ? 'Format relu et validé — cliquer pour retirer la validation' : 'Marquer ce format comme relu et validé'}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 ${actif.validated ? 'text-green-700 bg-green-50 ring-1 ring-green-100' : 'text-gray-400 hover:bg-gray-100'}`}>
                <Check className="w-3 h-3" />{actif.validated ? 'Validé' : 'Valider'}
              </button>
              {formats.length > 1 && (
                confirmFormat ? (
                  <button onClick={retirerFormat} onBlur={() => setConfirmFormat(false)} disabled={saving}
                    className="text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-full px-2.5 py-1 disabled:opacity-50">
                    Retirer « {actif.name.slice(0, 24)} » ?
                  </button>
                ) : (
                  <button onClick={retirerFormat} disabled={saving}
                    title="Retirer ce format de vente (la fabrication et les autres formats sont conservés)"
                    className="p-1 rounded-full text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )
              )}
            </span>
          )}
        </div>
      )}

      <div className="p-5">
        {/* Chiffres-clés — PV TTC et coefficient MODIFIABLES sur place */}
        {c && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <div className="rounded-2xl bg-pilote p-4 shadow-card">
              <p className="text-[10px] font-semibold text-pilote-200 uppercase tracking-wider">Coût de revient</p>
              <p className="text-xl font-extrabold tracking-tight text-white tabular mt-1">
                {coutUnite !== null ? fmtEuro(coutUnite) : fmtEuro(c.total_ht)}
              </p>
              {/* « Matière » désignait deux montants différents à quelques
                  centimètres l'un de l'autre : le total du tableau inclut
                  l'emballage, ce pourcentage l'exclut. Le food cost du métier
                  exclut l'emballage — c'est donc le libellé qui est précisé.
                  Vendu dans une autre unité : le coût affiché est PAR UNITÉ DE
                  VENTE (la base du PV), l'unité produite reste rappelée. */}
              <p className="text-[11px] text-pilote-200 mt-0.5 tabular">
                {coutUnite !== null && venteQty > 0 ? `/ ${uniteVente}` : '/ batch'}
                {actif?.sell_unit && c.par_unite_ht !== null && coutUnite !== null && Math.abs(c.par_unite_ht - coutUnite) >= 0.005 ? ` · ${fmtEuro(c.par_unite_ht)} / ${unitFr(recipe.yield_unit)}` : ''}
                {foodCostPct !== null ? ` · matière seule ${foodCostPct} % du PV HT` : ''}
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4 group cursor-pointer hover:border-pilote-200 transition-colors"
              onClick={() => !editKpi && setEditKpi({ field: 'pv', value: pvTTCActif != null ? String(pvTTCActif).replace('.', ',') : '' })}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Prix de vente TTC <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-pilote transition-colors" />
              </p>
              {editKpi?.field === 'pv' ? kpiInput() : (
                <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{pvTTCActif != null ? fmtEuro(pvTTCActif) : '—'}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">{pvHTActif !== null ? `${fmtEuro(pvHTActif)} HT / ${uniteVente}` : `cliquer pour saisir — / ${uniteVente}`}</p>
            </div>

            <div className={`rounded-2xl bg-white border border-gray-100 shadow-card p-4 group transition-colors ${coutIncomplet ? 'cursor-not-allowed' : 'cursor-pointer hover:border-pilote-200'}`}
              onClick={() => {
                if (editKpi) return
                if (coutIncomplet) {
                  toast({
                    variant: 'error', title: 'Coût incomplet — coefficient inutilisable',
                    description: `${nomsSansPrix} sans prix : le coût est sous-estimé, un prix calculé dessus serait trop bas.`,
                  })
                  return
                }
                setEditKpi({ field: 'coef', value: coefActif !== null ? String(coefActif).replace('.', ',') : '' })
              }}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Coef multiplicateur {!coutIncomplet && <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-pilote transition-colors" />}
              </p>
              {editKpi?.field === 'coef' ? kpiInput() : (
                <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{coefActif !== null ? `×${coefActif.toLocaleString('fr-FR')}` : '—'}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">{coutIncomplet ? 'coût incomplet — prix non calculable' : 'saisir un coef fixe le PV'}</p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Taux de marge</p>
              <p className={`text-xl font-extrabold tracking-tight tabular mt-1 ${margeColor}`}>
                {margeActive !== null ? `${margeActive.toLocaleString('fr-FR')} %` : '—'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">
                {pvHTActif !== null && coutUnite !== null ? `marge ${fmtEuro(pvHTActif - coutUnite)} / ${uniteVente}` : 'du PV HT'}
                {target != null ? ` · cible ${target.toLocaleString('fr-FR')} %` : ''}
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Temps de fabrication</p>
              <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{fmtMin(baseMinutes)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">MO {fmtEuro(c.main_oeuvre_ht)}{c.labor_rate_ht != null ? ` · ${fmtEuro(c.labor_rate_ht)}/h` : ''}</p>
            </div>
          </div>
        )}

        {/* ── Sous-onglets ────────────────────────────────────────────────
            Une fiche longue devient cinq écrans courts — exactement le remède
            appliqué à la mercuriale au lot 38, et la structure d'Otami
            (Infos · Ingrédients · Fabrication · Vente · Statistiques).
            Le bandeau de chiffres-clés ci-dessus, lui, reste TOUJOURS visible :
            le coût de revient est le chiffre pour lequel on ouvre la fiche, il
            n'a pas à disparaître parce qu'on regarde les étapes. */}
        <div className="mb-4 inline-flex items-center gap-1 bg-gray-50 rounded-xl p-1">
          {ONGLETS.map(o => (
            <button key={o.id} onClick={() => setOnglet(o.id)}
              className={`text-xs font-semibold rounded-lg px-3.5 py-2 transition-colors ${onglet === o.id ? 'bg-white text-pilote shadow-card' : 'text-gray-500 hover:text-gray-800'}`}>
              {o.label}
              {o.id === 'ingredients' && recipe.ingredients.length > 0 && (
                <span className={`ml-1.5 tabular ${onglet === o.id ? 'text-pilote-200' : 'text-gray-300'}`}>{recipe.ingredients.length}</span>
              )}
              {o.id === 'ingredients' && (c?.prix_manquants ?? 0) > 0 && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500 inline-block align-middle" title="Des prix manquent" />
              )}
            </button>
          ))}
        </div>

        {onglet === 'infos' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <h3 className="px-4 py-2.5 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Ce que produit le batch</h3>
              <dl className="p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Production</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{baseQty > 0 ? `${fmtQty(baseQty)} ${uniteLabel}` : <span className="text-gray-300">non renseignée</span>}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Poids à sortir &middot; net</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">
                    {poids.brut > 0
                      ? <>{fmtQty(round2(poids.brut * facteurPerte(pertePct) * 1000) / 1000)} kg <span className="font-normal text-gray-400">&middot; {fmtQty(poids.net)} kg net</span></>
                      : <span className="text-gray-300">aucune ligne pesable</span>}
                  </dd>
                </div>
                {pertePct > 0 && poids.brut > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">dont perte de fabrication</dt>
                    <dd className="font-semibold text-amber-600 tabular text-right">{pertePct.toLocaleString('fr-FR')} % &middot; {fmtEuro(perteHt)}</dd>
                  </div>
                )}
                {/* Le coût AU KILO se rapporte au poids NET — ce qui sort de
                    l'atelier, pas ce qu'on a sorti du frigo. Il n'existe que si
                    la fiche a des lignes pesables : sinon, tiret. */}
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Coût au kg <span className="text-gray-400">(net)</span></dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{c && poids.net > 0 ? fmtEuro(round2(c.total_ht / poids.net)) : <span className="text-gray-300">&mdash;</span>}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Formats de vente</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{formats.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Catégorie</dt>
                  <dd className="text-right">
                    {recipe.category
                      ? <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2.5 py-1">{recipe.category}</span>
                      : <span className="text-gray-300 text-sm">sans catégorie</span>}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <h3 className="px-4 py-2.5 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Qui fabrique, et notes</h3>
              <div className="p-4 space-y-3 text-sm">
                <p className="flex items-center gap-1.5 text-gray-600">
                  <Users className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  Fabriqué par <span className="font-semibold text-gray-900">{employeeName ?? 'taux moyen de l&rsquo;équipe'}</span>
                  {c?.labor_rate_ht != null && <span className="tabular text-gray-400">&middot; {fmtEuro(c.labor_rate_ht)}/h productif</span>}
                </p>
                <p className="text-[11px] text-gray-400">
                  Le taux productif est celui de l&rsquo;heure réellement TRAVAILLÉE (congés, RCR et fériés déduits) — pas de l&rsquo;heure payée.
                </p>
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{recipe.notes || <span className="text-gray-300">aucune note</span>}</p>
                </div>
                <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">
                  Nom, production, TVA, employé et ingrédients se modifient via &laquo;&nbsp;Modifier la fiche&nbsp;&raquo;.
                </p>
              </div>
            </div>
          </div>
        )}

        {onglet === 'ingredients' && (
          <>
        {/* ── Contenants et perte de fabrication ──────────────────────────────
            Les deux cartes qu'Otami met en tête de son onglet Ingrédients.
            · CONTENANTS : PILOTE n'a pas de table dédiée et n'en a pas besoin —
              un contenant est déjà un article générique de catégorie
              « emballage », posé en ligne d'ingrédient. La carte ne fait que
              les rassembler et compter ce qu'ils coûtent.
            · PERTE DE FABRICATION : celle de l'atelier (évaporation, chutes de
              mêlée, fond de cuve), distincte de la perte d'une LIGNE (le parage
              d'un morceau). Sans elle, une fiche qui perd 5 % à la cuisson
              affiche un coût sous-évalué de 5 % et une marge d'autant flattée. */}
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Contenants</p>
              <p className="text-sm text-gray-700 mt-0.5">
                {contenants.length === 0
                  ? <span className="text-gray-400">aucun emballage sur cette fiche</span>
                  : <span className="tabular"><span className="font-bold text-gray-900">{contenants.length}</span> — {fmtEuro(c?.emballage_ht ?? 0)} le batch</span>}
              </p>
              {contenants.length > 0 && (
                <p className="text-[11px] text-gray-400 truncate mt-0.5">{contenants.map(i => i.label).join(' · ')}</p>
              )}
            </div>
            <button onClick={() => setNewIng({ query: '', generic: null, qty: '', unit: 'piece', loss: '0', emballage: true })}
              title="Ajouter un contenant — un article générique de catégorie « emballage » de votre mercuriale"
              className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors flex-shrink-0">
              <Plus className="w-3.5 h-3.5" />Ajouter
            </button>
          </div>

          <div className="rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Perte de fabrication</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Ce que l&rsquo;atelier perd sur l&rsquo;ensemble — cuisson, chutes de mêlée, fond de cuve. Le parage d&rsquo;un ingrédient, lui, se règle sur sa ligne.
              </p>
            </div>
            {editPerte !== null ? (
              <span className="inline-flex items-center gap-1 bg-white border border-pilote-200 rounded-full pl-3 pr-1 py-1 flex-shrink-0">
                <input autoFocus inputMode="decimal" value={editPerte}
                  onChange={e => setEditPerte(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePerte(); if (e.key === 'Escape') setEditPerte(null) }}
                  placeholder="5" className="w-10 text-sm tabular focus:outline-none" />
                <span className="text-[11px] text-gray-400">%</span>
                <button onClick={savePerte} disabled={saving}
                  className="w-6 h-6 rounded-full bg-pilote text-white flex items-center justify-center disabled:opacity-50" title="Enregistrer (champ vide = aucune perte)">
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => setEditPerte(null)}
                  className="w-6 h-6 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"><X className="w-3 h-3" /></button>
              </span>
            ) : (
              <button onClick={() => setEditPerte(pertePct > 0 ? String(pertePct).replace('.', ',') : '')}
                title="Modifier la perte de fabrication"
                className={`text-sm font-bold tabular rounded-full px-3 py-1.5 transition-colors flex-shrink-0 ${pertePct > 0 ? 'text-pilote bg-pilote-50 ring-1 ring-pilote-100 hover:bg-pilote-100' : 'text-gray-400 bg-gray-50 hover:bg-gray-100'}`}>
                {pertePct > 0 ? `${pertePct.toLocaleString('fr-FR')} %` : 'aucune'}
              </button>
            )}
          </div>
        </div>

        {c && c.prix_manquants > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {c.prix_manquants} ingrédient{c.prix_manquants > 1 ? 's' : ''} sans prix
              {sansPrix.length > 0 && (
                <> — {sansPrix.map((x, i) => (
                  <span key={`${x.nom}-${i}`}>
                    {i > 0 ? ', ' : ''}
                    {x.href
                      ? <Link href={x.href} className="font-bold underline hover:text-amber-950">{x.nom}</Link>
                      : <span className="font-bold">{x.nom}</span>}
                  </span>
                ))}</>
              )}
              {' '}: {c.prix_manquants > 1 ? 'ils comptent' : 'il compte'} pour 0 €, le coût affiché est donc <span className="font-semibold">sous-estimé</span> et la marge ne peut pas être calculée. Cliquez un nom pour aller lui donner un prix.
            </span>
          </div>
        )}
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <TableauIngredients
              ingredients={recipe.ingredients}
              ratio={ratio}
              palierActif={active !== null}
              coutMatiere={coutMatiere}
              poids={poids}
              avecEmballage={Boolean(c && c.emballage_ht > 0)}
              confirmIng={confirmIng}
              saving={saving}
              onRemove={removeIngredient}
              onCancelConfirm={() => setConfirmIng(null)}
            />
            {/* Ajout d'ingrédient sur place — comme les étapes, enregistré aussitôt */}
            <div className="px-3 py-2 border-t border-gray-100">
              {newIng ? (
                <div className="relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    {newIng.generic ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full pl-3 pr-1.5 py-1.5">
                        {newIng.generic.name}
                        <button onClick={() => setNewIng(p => (p ? { ...p, generic: null, query: '' } : p))}
                          className="w-4 h-4 rounded-full hover:bg-white/70 flex items-center justify-center"><X className="w-3 h-3" /></button>
                      </span>
                    ) : (
                      <input autoFocus value={newIng.query}
                        onChange={e => setNewIng(p => (p ? { ...p, query: e.target.value } : p))}
                        placeholder={newIng.emballage ? 'Chercher un contenant…' : 'Chercher un article générique…'}
                        className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    )}
                    <input inputMode="decimal" value={newIng.qty} placeholder="Qté"
                      onChange={e => setNewIng(p => (p ? { ...p, qty: e.target.value } : p))}
                      onKeyDown={e => { if (e.key === 'Enter') addIngredient() }}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    {newIng.generic?.base_unit === 'kg' ? (
                      <select value={newIng.unit === 'g' ? 'g' : 'kg'}
                        onChange={e => setNewIng(p => (p ? { ...p, unit: e.target.value as 'kg' | 'g' } : p))}
                        className="border border-gray-200 rounded-lg px-1.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                      </select>
                    ) : (
                      <span className="text-[11px] text-gray-400">{newIng.generic ? 'pièce' : ''}</span>
                    )}
                    <div className="relative">
                      <input inputMode="decimal" value={newIng.loss} title="Perte / rendement (%)"
                        onChange={e => setNewIng(p => (p ? { ...p, loss: e.target.value } : p))}
                        className="w-14 border border-gray-200 rounded-lg pl-2 pr-5 py-1.5 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                    </div>
                    <button onClick={addIngredient} disabled={saving || !newIng.generic || num(newIng.qty) <= 0}
                      className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3 py-1.5 shadow-card active:scale-[0.98] transition-all disabled:opacity-40">
                      Ajouter
                    </button>
                    <button onClick={() => setNewIng(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {!newIng.generic && newIng.query.trim().length >= 2 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-card-hover overflow-hidden">
                      {generics.filter(g => (newIng.emballage ? g.category === 'emballage' : true) && g.name.toLowerCase().includes(newIng.query.trim().toLowerCase())).slice(0, 6).map(g => (
                        <button key={g.id}
                          onClick={() => setNewIng(p => (p ? { ...p, generic: g, query: g.name, unit: g.base_unit === 'kg' ? 'kg' : 'piece', loss: String(g.default_loss_pct || 0) } : p))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                          <span className="truncate">{g.name}
                            {g.category === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1 py-0.5">Emballage</span>}
                          </span>
                          <span className="text-xs text-gray-500 tabular flex-shrink-0">
                            {g.price_ht !== null ? `${fmtEuro(g.price_ht)} / ${unitFr(g.base_unit)}` : 'pas encore de prix'}
                          </span>
                        </button>
                      ))}
                      {generics.filter(g => (newIng.emballage ? g.category === 'emballage' : true) && g.name.toLowerCase().includes(newIng.query.trim().toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">Aucun {newIng.emballage ? 'contenant' : 'article générique'} — créez-le d&apos;abord dans la Mercuriale{newIng.emballage ? ', avec la catégorie « emballage »' : ''}.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => setNewIng({ query: '', generic: null, qty: '', unit: 'kg', loss: '0' })}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-2 hover:border-pilote-200 hover:text-pilote transition-colors">
                  <Plus className="w-3.5 h-3.5" />Ajouter un ingrédient
                </button>
              )}
            </div>
            <div className="px-3.5 py-2.5 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500 tabular">
              <span><ShoppingBasket className="w-3 h-3 inline mr-1 text-gray-400" />Matière {c ? fmtEuro(c.matiere_ht * ratio) : '—'}</span>
              {perteHt > 0 && (
                <span title={`Perte de fabrication de ${pertePct.toLocaleString('fr-FR')} % : il faut sortir d'autant plus de matière pour le même rendement`}>
                  <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-500" />Perte de fabrication {pertePct.toLocaleString('fr-FR')} % — {fmtEuro(perteHt * ratio)}
                </span>
              )}
              {c && c.emballage_ht > 0 && <span><Package className="w-3 h-3 inline mr-1 text-gray-400" />Emballage {fmtEuro(c.emballage_ht * ratio)}</span>}
              <span><Clock className="w-3 h-3 inline mr-1 text-gray-400" />Main-d&apos;œuvre {active ? fmtEuro(moScaled) : (c ? fmtEuro(c.main_oeuvre_ht) : '—')}</span>
              <span className="font-bold text-gray-700">Coût {active ? `pour ${fmtQty(active.qty)} ${uniteLabel}` : 'du batch'} : {active ? fmtEuro(coutScaled) : (c ? fmtEuro(c.total_ht) : '—')}</span>
            </div>
            </div>
          </>
        )}

        {onglet === 'fabrication' && (
          <>
        {/* ── Paliers de quantité : pour N produits, temps ×multiple ── */}
        <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-1">Quantité produite</span>
            <button onClick={() => setSelTier(null)}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-colors tabular ${selTier === null ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
              Base{baseQty > 0 ? ` · ${fmtQty(baseQty)} ${uniteLabel}` : ''} · {fmtMin(baseMinutes)}
            </button>
            {tiers.map((t, i) => (
              <span key={i} className={`inline-flex items-center gap-1 rounded-full transition-colors tabular ${selTier === i ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
                <button onClick={() => setSelTier(prev => prev === i ? null : i)} className="text-xs font-semibold pl-3 py-1.5">
                  {fmtQty(num(t.qty))} {uniteLabel} · ×{num(t.mult).toLocaleString('fr-FR')}
                </button>
                <button onClick={() => { setTiers(prev => prev.filter((_, j) => j !== i)); setSelTier(p => (p === i ? null : p !== null && p > i ? p - 1 : p)); setDirty(true) }}
                  className={`pr-2 py-1.5 ${selTier === i ? 'text-white/60 hover:text-white' : 'text-gray-300 hover:text-gray-600'}`} title="Retirer ce palier">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {newTier ? (
              <span className="inline-flex items-center gap-1.5 bg-white border border-pilote-200 rounded-full pl-3 pr-1.5 py-1">
                <input autoFocus inputMode="decimal" value={newTier.qty} placeholder="Qté"
                  onChange={e => setNewTier(p => (p ? { ...p, qty: e.target.value } : p))}
                  className="w-12 text-xs tabular focus:outline-none" />
                <span className="text-[11px] text-gray-400">{uniteLabel} → ×</span>
                <input inputMode="decimal" value={newTier.mult} placeholder="1,8"
                  onChange={e => setNewTier(p => (p ? { ...p, mult: e.target.value } : p))}
                  onKeyDown={e => { if (e.key === 'Enter' && num(newTier.qty) > 0 && num(newTier.mult) > 0) { setTiers(prev => [...prev, newTier]); setNewTier(null); setDirty(true) } }}
                  className="w-10 text-xs tabular focus:outline-none" />
                <button onClick={() => { if (num(newTier.qty) > 0 && num(newTier.mult) > 0) { setTiers(prev => [...prev, newTier]); setNewTier(null); setDirty(true) } }}
                  className="w-6 h-6 rounded-full bg-pilote text-white flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                <button onClick={() => setNewTier(null)} className="w-6 h-6 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"><X className="w-3 h-3" /></button>
              </span>
            ) : (
              <button onClick={() => setNewTier({ qty: '', mult: '' })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-pilote-200 rounded-full px-3 py-1.5 hover:bg-pilote-50 transition-colors">
                <Plus className="w-3 h-3" />Palier
              </button>
            )}
          </div>
          {active ? (
            <p className="text-xs text-gray-600 mt-2 tabular">
              Pour <span className="font-bold">{fmtQty(active.qty)} {uniteLabel}</span> : temps <span className="font-bold">{fmtMin(scaledMinutes)}</span> (×{active.mult.toLocaleString('fr-FR')})
              {baseQty > 0 && c ? <> · matière {fmtEuro(round2(coutMatiere * ratio))} · MO {fmtEuro(moScaled)} · coût total <span className="font-bold">{fmtEuro(coutScaled)}</span>{active.qty > 0 ? <> soit {fmtEuro(round2(coutScaled / active.qty))} / {unitFr(recipe.yield_unit)}</> : null}</> : null}
              {baseQty <= 0 && <> · renseignez la production par batch (« Modifier la fiche ») pour multiplier aussi les ingrédients</>}
            </p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-2">Un palier = « pour tant de {uniteLabel}, le temps de base est multiplié par tant » — ex. 20 → ×1,8. Cliquez un palier pour lire temps, quantités et coûts correspondants.</p>
          )}
        </div>
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Étapes de fabrication</h3>
              <span className="text-[11px] text-gray-400 tabular">durées en min</span>
            </div>
            <div className="p-3 space-y-2">
              {steps.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-5">Ajoutez les étapes du procédé — chaque étape porte sa durée, le temps total est leur somme.</p>
              )}
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-pilote-50 text-pilote text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-1.5">{i + 1}</span>
                  <textarea value={s.text} rows={2}
                    onChange={e => { setSteps(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x)); setDirty(true) }}
                    placeholder={`Étape ${i + 1}…`}
                    className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 resize-y min-w-0" />
                  <div className="relative flex-shrink-0 mt-1">
                    <input inputMode="decimal" value={s.minutes} title="Durée de l'étape (minutes)"
                      onChange={e => { setSteps(prev => prev.map((x, j) => j === i ? { ...x, minutes: e.target.value } : x)); setDirty(true) }}
                      placeholder="—"
                      className="w-16 border border-gray-200 rounded-lg pl-2 pr-7 py-1.5 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">min</span>
                  </div>
                  {active && num(s.minutes) > 0 && (
                    <span className="text-[11px] text-pilote font-semibold tabular flex-shrink-0 mt-2.5 w-12 text-right" title={`Durée pour ${fmtQty(active.qty)} ${uniteLabel}`}>
                      {(Math.round(num(s.minutes) * timeMult * 10) / 10).toLocaleString('fr-FR')}
                    </span>
                  )}
                  <button onClick={() => { setSteps(prev => prev.filter((_, j) => j !== i)); setDirty(true) }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0 mt-1"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={() => { setSteps(prev => [...prev, { text: '', minutes: '' }]); setDirty(true) }}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-2 hover:border-pilote-200 hover:text-pilote transition-colors">
                <Plus className="w-3.5 h-3.5" />Ajouter une étape
              </button>
            </div>
            <div className="px-4 py-2.5 bg-pilote text-white flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60 flex items-center gap-1.5"><Clock className="w-3 h-3" />Temps total</span>
              <span className="font-bold tabular text-sm">
                {active ? <>{fmtMin(scaledMinutes)} <span className="text-white/60 font-semibold">(base {fmtMin(baseMinutes)})</span></> : fmtMin(baseMinutes)}
              </span>
            </div>
            {!hasTimed && (Number(recipe.labor_minutes) || 0) > 0 && (
              <p className="px-4 py-2 text-[11px] text-amber-600 border-t border-gray-100">Étapes non chronométrées — temps repris du champ « minutes » de la fiche ({recipe.labor_minutes} min). Renseignez les durées pour un temps calculé.</p>
            )}
          </div>
          </>
        )}

        {onglet === 'vente' && (
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Ce que rapporte {actif ? `le format « ${actif.name} »` : 'la fiche'}
              </h3>
              <span className="text-[11px] text-gray-400 tabular">
                {venteQty > 0 ? `${fmtQty(venteQty)} ${uniteVente} vendables par batch` : 'quantité vendable non renseignée'}
              </span>
            </div>
            {/* Les deux marges du métier, PAR UNITÉ DE VENTE :
                  · marge BRUTE  = PV HT − matière (emballage compris) ;
                  · marge NETTE  = marge brute − main-d'œuvre.
                Elles ne sont PAS publiées tant qu'il manque un prix
                d'ingrédient : le coût serait sous-évalué et les deux marges
                flattées — même règle que le moteur. */}
            <dl className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Prix de vente HT</dt>
                <dd className="font-semibold text-gray-900 tabular">{pvHTActif !== null ? fmtEuro(pvHTActif) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">TVA appliquée</dt>
                <dd className="font-semibold text-gray-900 tabular">{tvaActive.toLocaleString('fr-FR')} %</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Matière {c && c.emballage_ht > 0 ? '+ emballage' : ''}{pertePct > 0 ? ', perte comprise' : ''}</dt>
                <dd className="font-semibold text-gray-900 tabular">{matiereUnite !== null ? fmtEuro(matiereUnite) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              {pertePct > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">dont perte de fabrication <span className="text-gray-400">({pertePct.toLocaleString('fr-FR')} %)</span></dt>
                  <dd className="font-semibold text-amber-600 tabular">{venteQty > 0 ? fmtEuro(round2(perteHt / venteQty)) : fmtEuro(perteHt)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Main-d&rsquo;œuvre</dt>
                <dd className="font-semibold text-gray-900 tabular">{moUnite !== null ? fmtEuro(moUnite) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-2 border-t border-gray-100">
                <dt className="text-gray-500">Marge brute <span className="text-gray-400">(hors main-d&rsquo;œuvre)</span></dt>
                <dd className="font-bold text-gray-900 tabular">{margeBrute !== null ? fmtEuro(margeBrute) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-2 border-t border-gray-100">
                <dt className="text-gray-500">Marge nette <span className="text-gray-400">(main-d&rsquo;œuvre déduite)</span></dt>
                <dd className={`font-bold tabular ${margeNette !== null && margeNette < 0 ? 'text-red-600' : 'text-gray-900'}`}>{margeNette !== null ? fmtEuro(margeNette) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Coût matière dans le PV HT</dt>
                <dd className="font-semibold text-gray-900 tabular">{foodCostPct !== null ? `${foodCostPct} %` : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Coût de revient complet</dt>
                <dd className="font-semibold text-gray-900 tabular">{coutUnite !== null ? `${fmtEuro(coutUnite)} / ${uniteVente}` : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
            </dl>
            {coutIncomplet && (
              <p className="px-4 py-2.5 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                {nomsSansPrix} sans prix : les marges ne sont pas calculées tant que le coût est sous-évalué — elles paraîtraient meilleures qu&rsquo;elles ne le sont.
              </p>
            )}
            {formats.length > 1 && (
              <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
                Cette fiche a {formats.length} formats de vente : les chiffres ci-dessus sont ceux du format choisi en haut. La fabrication, elle, est commune.
              </p>
            )}
          </div>
        )}

        {onglet === 'stats' && (
          <>
        {/* ── Coût matière dans le temps : la fiche relue aux prix d'hier ── */}
        {c && Array.isArray(c.matiere_series) && c.matiere_series.length >= 2 && (() => {
          const s = c.matiere_series
          const first = s[0], last = s[s.length - 1]
          const delta = round2(last.v - first.v)
          const stable = Math.abs(delta) < 0.005
          const deltaUnit = baseQty > 0 ? round2(delta / baseQty) : null
          // Marge qu'aurait la fiche au coût du début de période, à PV inchangé —
          // sur la base de VENTE (celle du PV), pas forcément l'unité produite.
          const coutVente = coutUnite
          const deltaVente = venteQty > 0 ? round2(delta / venteQty) : null
          let margeAvant: number | null = null
          if (!stable && pvHTActif !== null && pvHTActif > 0 && coutVente != null && deltaVente !== null) {
            margeAvant = Math.round(((pvHTActif - (coutVente - deltaVente)) / pvHTActif) * 1000) / 10
          }
          return (
            <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="min-w-[240px] flex-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût matière — 8 dernières semaines</p>
                <p className="text-xs text-gray-600 mt-1 tabular">
                  {stable ? (
                    <>Stable depuis le {fmtDateFr(first.d)} — {fmtEuro(last.v)} le batch, aux prix mercuriale relus à chaque date.</>
                  ) : (
                    <>
                      {fmtEuro(first.v)} le {fmtDateFr(first.d)} → {fmtEuro(last.v)} aujourd&apos;hui :{' '}
                      <span className={`font-bold ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {delta > 0 ? '+' : '−'}{fmtEuro(Math.abs(delta))} / batch
                        {deltaUnit !== null && Math.abs(deltaUnit) >= 0.005 ? ` (${delta > 0 ? '+' : '−'}${fmtEuro(Math.abs(deltaUnit))} / ${unitFr(recipe.yield_unit)})` : ''}
                      </span>
                      {margeAvant !== null && margeActive !== null && (
                        <> · à PV inchangé, marge <span className="font-bold tabular">{margeAvant.toLocaleString('fr-FR')} %</span> → <span className={`font-bold tabular ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>{margeActive.toLocaleString('fr-FR')} %</span></>
                      )}
                    </>
                  )}
                </p>
              </div>
              <TrendSpark points={s} />
            </div>
          )
        })()}

        {/* ── Le graphe : coût, prix de vente et marge superposés ──────────────
            Otami superpose les trois et annote chaque point. C'est ce qui
            transforme une courbe en réponse à « la rentabilité de ce produit
            se dégrade-t-elle ? » : un coût qui monte pendant qu'un prix reste
            plat se lit d'un coup d'œil. */}
        {jalonsGraphe.length >= 2 && (
          <div className="mb-4 rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Évolution du coût de revient</h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { id: 'cout' as const, label: `Coût / ${uniteVente}`, actif: 'bg-pilote text-white' },
                  { id: 'pv' as const, label: 'Prix de vente HT', actif: 'bg-gray-600 text-white' },
                  { id: 'marge' as const, label: 'Taux de marge', actif: 'bg-pilote-orange text-white' },
                ]).map(s => {
                  const dispo = s.id === 'cout' || jalonsGraphe.some(j => (s.id === 'pv' ? j.pv : j.marge) !== null)
                  return (
                    <button key={s.id} disabled={!dispo}
                      onClick={() => setSeries(p => ({ ...p, [s.id]: !p[s.id] }))}
                      title={dispo ? undefined : 'Posez un prix de vente sur ce format pour lire cette courbe'}
                      className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${series[s.id] && dispo ? s.actif : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="px-2 pt-2">
              <GrapheCouts points={jalonsGraphe} series={series} uniteVente={uniteVente} />
            </div>
            {/* Ce que le graphe N'EST PAS. Otami date son axe des jours où un
                prix a changé ; ici ce sont des lundis. Le dire évite de lire
                « le prix a bougé ce jour-là » là où il n'y a qu'un jalon. */}
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Un point par lundi des huit dernières semaines, plus aujourd&apos;hui — ce sont des jalons de lecture, pas les dates auxquelles un prix a changé.
              Le coût est relu aux prix mercuriale de chaque date ; le prix de vente et la main-d&apos;œuvre, eux, sont ceux d&apos;aujourd&apos;hui.
            </p>
          </div>
        )}

        {/* Courbe impossible à tracer : DIRE POURQUOI. Un bloc simplement absent
            se lit « le coût matière n'a pas bougé » — c'est l'inverse du sens. */}
        {c && (!Array.isArray(c.matiere_series) || c.matiere_series.length < 2) && c.matiere_series_motif && (
          <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût matière — 8 dernières semaines</p>
            <p className="text-xs text-gray-500 mt-1">{c.matiere_series_motif}</p>
          </div>
        )}

        {/* Historique tronqué : la courbe est partielle, ou absente faute de
            points. Le silence donnerait à lire « le prix n'a pas bougé ». */}
        {historiqueIncomplet && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>L&apos;historique des prix n&apos;a pas pu être lu en entier : la courbe du coût matière ci-dessus est partielle. Actualisez ; si le message persiste, signalez-le.</span>
          </div>
        )}
          </>
        )}

      </div>
    </div>
  )
}
