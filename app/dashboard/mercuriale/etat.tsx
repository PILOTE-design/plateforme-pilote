'use client'

// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   · les RÉFS FOURNISSEURS, créées automatiquement par la lecture des factures ;
//   · les ARTICLES GÉNÉRIQUES, qui regroupent les réfs (« FILET DE POULET SV »
//     + « FILET DE POULET LR » → « Filet de poulet ») et ramènent tout à une
//     unité de base (kg ou pièce).
//
// Une réf qui ne ressemble à rien est associée TOUTE SEULE (générique auto,
// côté API). Le reste se regroupe par SÉLECTION : cliquer « Associer » sur une
// réf la met dans l'association en cours, cliquer « Associer » sur d'autres les
// ajoute, puis tout part vers le même générique (existant ou créé). Une réf
// facturée dans une autre unité que la base du générique (pièce vs kg) exige
// son facteur de conversion — sans lui, son prix serait faux, donc il est
// IGNORÉ et signalé.
//
// TROIS ONGLETS, un par intention (refonte lisibilité 03/08) :
//   · PRIX DU JOUR — ce qu'on vient CONSULTER : le catalogue, les mouvements ;
//   · À TRAITER — tout ce qui attend un geste, au même endroit et compté :
//     factures à lire, classements à confirmer, produits à regrouper,
//     conversions à renseigner ;
//   · ORGANISER — le rangement du catalogue : chaque article avec ses réfs
//     (déplacer, dissocier, fusionner), le rapprochement intelligent.
// La lecture des factures se déclenche dans « À traiter » (une à la fois).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingBasket, FileSearch, Search, RefreshCw, Link2, ChevronDown, ChevronRight, X, Check, AlertTriangle, ChefHat, HelpCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { guessBaseUnit, unitKind } from '@/lib/mercuriale-auto'
import { matchFamilyId, type MarginFamily } from '@/lib/margin-families'
// Briques d'affichage de la mercuriale (formats, courbes, blocs de la fiche
// enrichie du lot 41) — voir ./ui.tsx : la page garde la logique, ui le dessin.
import {
  fmtEuro, fmtDate, nomFournisseur, unitLabel,
  Variation, VueRayons, BlocEcartsBloques,
  type FicheDetail, type EcartBloque,
} from './ui'

// Types de l'écran, fonctions pures d'appellation et grands tableaux
// d'affichage — sortis d'ici au lot 73 pour que la page reste publiable (voir
// ./catalogue et ./onglets) : la page garde les états, les appels API et les
// gestes, ces fichiers ne font que dessiner.
import {
  TableauCatalogue, titleize, commonLabel,
  type Ref, type Generic, type Move, type FournisseurDepense,
  type PendingInvoice, type DouteInvoice,
} from './catalogue'
import { VueOrganiser, VueFournisseurs } from './onglets'
import type { MotifSortie } from '@/lib/lecture-file'

/** Une facture SORTIE de la file de lecture (lot 80) : la facture telle que la
 *  file la connaît, plus la raison de sa sortie — motif technique, phrase en
 *  clair et pastille courte, toutes trois calculées côté API par
 *  lib/lecture-file. La page n'en rejuge aucune : elle affiche. */
type LectureAbandonnee = PendingInvoice & {
  motif: MotifSortie
  phrase: string
  libelle: string
}


// ─── L'ÉTAT DE LA MERCURIALE ────────────────────────────────────────────────
//
// La page pesait 108 718 octets. Au-delà d'environ cent kilo-octets, l'outil de
// publication ne peut plus réémettre un fichier d'un seul tenant : l'écran était
// devenu impossible à modifier, exactement comme le planning avant le lot 85 et
// la facturation avant le lot 91.
//
// Même méthode qu'à la facturation : on sort L'ÉTAT, pas l'affichage. Ce hook
// porte tout, les blocs d'écran reçoivent UN objet dont le type se déduit tout
// seul, et aucune liste de propriétés n'est maintenue en double.
//
// Rien n'est réécrit au passage : le corps est celui d'avant, ligne pour ligne.

export function useMercuriale() {
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const [generics, setGenerics] = useState<Generic[]>([])
  const [queue, setQueue] = useState<Ref[]>([])
  const [pending, setPending] = useState<PendingInvoice[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [movesTotal, setMovesTotal] = useState(0)
  const [movesOpen, setMovesOpen] = useState(false)
  // KPI « Prix en hausse » cliquable : restreint le catalogue aux génériques en hausse
  const [hausseFilter, setHausseFilter] = useState(false)
  // Revue des génériques créés tout seuls : filtre + validation une par une
  const [autoFilter, setAutoFilter] = useState(false)
  const [validant, setValidant] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Cinq onglets par intention : consulter (prix), par rayon, par maison
  // (fournisseurs), agir (traiter), ranger (organiser)
  const [view, setView] = useState<'prix' | 'traiter' | 'organiser' | 'fournisseurs' | 'rayons'>('prix')
  // Vue « Fournisseurs » : dépenses 12 mois par maison (API) + familles de la
  // boutique (référentiel des marges) pour classer chaque catalogue
  const [fournisseurs, setFournisseurs] = useState<FournisseurDepense[]>([])
  const [familles, setFamilles] = useState<MarginFamily[]>([])
  const [fournisseurSel, setFournisseurSel] = useState<string | null>(null)
  // Vue « Rayons » (lot 42) : rayon ouvert + dépense hors catalogue (réfs pas
  // encore rapprochées), annoncée sous les cartes plutôt que passée sous silence
  const [rayonSel, setRayonSel] = useState<string | null>(null)
  const [depenseHorsCatalogue, setDepenseHorsCatalogue] = useState(0)
  // Prix bloqués (lot 43) : écarts signalés par l'API + verrous en cours de pose
  const [ecartsBloques, setEcartsBloques] = useState<EcartBloque[]>([])
  const [ecartsBloquesTotal, setEcartsBloquesTotal] = useState(0)
  const [verrouDrafts, setVerrouDrafts] = useState<Record<string, string>>({})
  const [verrouillant, setVerrouillant] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })
  const stopRef = useRef(false)
  // Motifs d'échec / de lecture partielle (lot 1) : dépliables, relisibles un par un
  const [showMotifs, setShowMotifs] = useState(false)
  const [relisant, setRelisant] = useState<string | null>(null)
  // Lectures ABANDONNÉES (lot 80) : sorties de la file — à la main, après trois
  // échecs, ou faute de reprise depuis une semaine. Rangées, jamais supprimées :
  // leur montant reste compté dans les achats. Repliées, réessayables d'un clic.
  const [abandonnees, setAbandonnees] = useState<LectureAbandonnee[]>([])
  const [showAbandons, setShowAbandons] = useState(false)
  const [abandonnant, setAbandonnant] = useState<string | null>(null)
  // File de doute matière/charge (lot 29) : classements fragiles, un clic tranche
  const [doutes, setDoutes] = useState<DouteInvoice[]>([])
  const [tranchant, setTranchant] = useState<string | null>(null)
  // Rattrapage des PDF manquants (lot 2) : une facture sans PDF n'a ni lignes
  // ni prix — c'est le plus gros gisement de mercuriale inexploitée.
  const [sansPdf, setSansPdf] = useState(0)
  const [backfill, setBackfill] = useState(false)
  // Troncature de lecture annoncée par l'API (lot 8) : tant que ce message est
  // null, tout ce qui est affiché ici est COMPLET. Il ne s'agit pas d'un détail
  // technique — un catalogue amputé se lit comme un catalogue entier.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)

  // ── ASSOCIATION PAR SÉLECTION : « Associer » sur une réf l'ajoute au lot,
  // « Associer » sur une autre l'ajoute aussi ; tout part vers le même générique.
  const [selIds, setSelIds] = useState<string[]>([])
  // ANCRE : la dernière réf mise dans le lot. Le panneau d'association s'ouvre
  // SOUS sa ligne, dans la file — le boucher choisit le générique et valide à
  // l'endroit exact du produit qu'il regarde, sans remonter en haut de page.
  const [ancreSel, setAncreSel] = useState<string | null>(null)
  const [selTarget, setSelTarget] = useState({ choice: '', newName: '', newUnit: 'kg' as 'kg' | 'piece', newCat: 'ingredient' as 'ingredient' | 'emballage' })
  const [factors, setFactors] = useState<Record<string, string>>({})
  const [selSaving, setSelSaving] = useState(false)
  const nameTouchedRef = useRef(false)

  // Dossier des associations : brouillons de conversion à régler sur place
  const [fixDrafts, setFixDrafts] = useState<Record<string, string>>({})

  // Rapprochement intelligent : fusions d'appellations proposées par l'IA,
  // chacune VALIDÉE à la main ; « Fusionner dans… » par générique en manuel.
  const [smartLoading, setSmartLoading] = useState(false)
  const [smartSuggestions, setSmartSuggestions] = useState<{ name: string; ids: string[] }[] | null>(null)
  const [smartNames, setSmartNames] = useState<Record<string, string>>({})
  const [mergeSel, setMergeSel] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState(false)

  // Catalogue : générique déplié + édition + suppression en deux clics
  const [openId, setOpenId] = useState<string | null>(null)
  // Fiche enrichie (lot 41) : volumes mensuels, moyenne 3 mois et historique
  // facture par facture — chargés à l'OUVERTURE du produit et gardés en cache
  // (l'API du catalogue n'a pas à transporter ce détail pour tous les articles).
  const [fiches, setFiches] = useState<Record<string, FicheDetail>>({})
  const [ficheLoading, setFicheLoading] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', base_unit: 'kg' as 'kg' | 'piece', category: 'ingredient' as 'ingredient' | 'emballage', loss: '0' })
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  // Tri de la file « À rapprocher » et repli au-delà des dix premiers groupes
  const [queueSort, setQueueSort] = useState<'refs' | 'montant' | 'fournisseur' | 'anciennete'>('montant')
  const [queueAll, setQueueAll] = useState(false)
  const [showNonProduct, setShowNonProduct] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  const load = useCallback(async (opts?: { silencieux?: boolean }) => {
    // Un rafraîchissement SILENCIEUX garde les chiffres à l'écran pendant qu'il
    // travaille. Repasser par l'écran de chargement après chaque micro-action
    // faisait clignoter toute la page pour un facteur de conversion saisi.
    if (!opts?.silencieux) setLoading(true)
    const [data, fam] = await Promise.all([
      fetch('/api/mercuriale', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/margin-families', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    if (fam && Array.isArray(fam.families)) setFamilles(fam.families as MarginFamily[])
    if (data) {
      setGenerics(Array.isArray(data.generics) ? data.generics : [])
      setQueue(Array.isArray(data.queue) ? data.queue : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
      setAbandonnees(Array.isArray(data.lectures_abandonnees) ? data.lectures_abandonnees : [])
      setDoutes(Array.isArray(data.doutes) ? data.doutes : [])
      setMoves(Array.isArray(data.moves) ? data.moves : [])
      setMovesTotal(Number(data.moves_total) || 0)
      setFournisseurs(Array.isArray(data.fournisseurs) ? data.fournisseurs : [])
      setDepenseHorsCatalogue(Number(data.depense_hors_catalogue_12m) || 0)
      setEcartsBloques(Array.isArray(data.ecarts_bloques) ? data.ecarts_bloques : [])
      setEcartsBloquesTotal(Number(data.ecarts_bloques_total) || 0)
      setSansPdf(Number(data.sans_pdf) || 0)
      setLectureIncomplete(typeof data.lecture_incomplete === 'string' ? data.lecture_incomplete : null)
      // Les fiches enrichies décrivent l'état d'AVANT ce rafraîchissement :
      // on les oublie, elles se rechargeront à la prochaine ouverture.
      setFiches({})
    }
    if (!opts?.silencieux) setLoading(false)
  }, [])

  // Un GET /api/mercuriale rejoue l'association automatique, lit quatre tables
  // paginées et reconstruit l'historique douze mois de chaque générique. Le
  // déclencher après CHAQUE micro-action, c'était neuf rechargements complets
  // pour neuf conversions réglées à la suite, et trente-six pour écarter
  // trente-six réfs une par une. Les demandes rapprochées sont désormais fondues
  // en un seul rafraîchissement, silencieux : l'écran reste lisible pendant.
  const differeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafraichirBientot = useCallback(() => {
    if (differeRef.current) clearTimeout(differeRef.current)
    differeRef.current = setTimeout(() => { differeRef.current = null; load({ silencieux: true }) }, 1200)
  }, [load])
  useEffect(() => () => { if (differeRef.current) clearTimeout(differeRef.current) }, [])

  useEffect(() => { load() }, [load])

  // La fiche enrichie du produit OUVERT (lot 41) : un seul générique à la fois,
  // en cache jusqu'au prochain rafraîchissement du catalogue. Une réponse qui
  // n'a pas la forme attendue est ignorée — les blocs restent simplement absents.
  useEffect(() => {
    if (!openId || fiches[openId]) return
    let annule = false
    setFicheLoading(openId)
    fetch(`/api/mercuriale/fiche?generic=${openId}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d: FicheDetail | null) => {
        if (annule) return
        if (d && Array.isArray(d.lignes) && Array.isArray(d.mois)) setFiches(prev => ({ ...prev, [openId]: d }))
        setFicheLoading(cur => (cur === openId ? null : cur))
      })
    return () => { annule = true }
  }, [openId, fiches])

  // Lien profond ?generic=<id> : ouvre directement la fiche de l'article visé
  // et l'amène sous les yeux. C'est ce qui permet à une fiche recette de dire
  // « Pilon de poulet n'a pas de prix » et d'y conduire en un clic, au lieu de
  // renvoyer vers un catalogue de 125 lignes. Consommé une seule fois.
  const generiqueVuRef = useRef(false)
  useEffect(() => {
    if (loading || generics.length === 0 || generiqueVuRef.current) return
    const id = new URLSearchParams(window.location.search).get('generic')
    if (!id) return
    generiqueVuRef.current = true
    if (!generics.some(g => g.id === id)) {
      toast({ variant: 'error', title: 'Article introuvable', description: 'Il a pu être supprimé ou fusionné depuis.' })
      return
    }
    setView('prix')
    setSearch('')
    setHausseFilter(false)
    setAutoFilter(false)
    setOpenId(id)
    // Le laisser-passer au rendu avant de faire défiler jusqu'à la ligne
    setTimeout(() => document.getElementById(`generic-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, generics])

  /** Lit les factures en attente UNE PAR UNE (extraction PDF + IA par appel) ;
   *  interruptible, reprend où elle en était. */
  async function processQueue() {
    if (processing || pending.length === 0) return
    setProcessing(true)
    stopRef.current = false
    let done = 0, ecartees = 0, errors = 0
    const total = pending.length
    setProgress({ done: 0, total, errors: 0 })
    for (const inv of pending) {
      if (stopRef.current) break
      const res = await fetch('/api/invoices/extract-lines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (res?.ok && data?.status === 'hors_matiere') ecartees++
      else if (res?.ok) done++
      else errors++
      setProgress({ done: done + ecartees + errors, total, errors })
    }
    setProcessing(false)
    const detail = [`${done} lue${done > 1 ? 's' : ''}`]
    if (ecartees > 0) detail.push(`${ecartees} hors matière (écartée${ecartees > 1 ? 's' : ''})`)
    if (errors > 0) detail.push(`${errors} en échec`)
    toast(errors === 0
      ? { variant: 'success', title: detail.join(' · '), description: 'Les réfs sans ressemblance s’associent toutes seules ; les autres arrivent dans « À rapprocher ».' }
      : { variant: 'error', title: detail.join(' · '), description: 'Les factures en échec peuvent être relancées.' })
    load()
  }

  /** Redemande à Pennylane les PDF des factures qui n'en ont pas. Par lots :
   *  la fenêtre d'exécution est courte, et la route dit combien il en reste. */
  async function rattraperPdf() {
    if (backfill) return
    setBackfill(true)
    const res = await fetch('/api/billing-integrations/backfill-pdf', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBackfill(false)
    if (res?.ok) {
      toast(Number(data?.recuperes) > 0
        ? { variant: 'success', title: data?.message, description: 'Les factures récupérées sont revenues dans la file de lecture.' }
        : { variant: 'info', title: data?.message || 'Aucun PDF récupéré', description: Array.isArray(data?.echecs) && data.echecs.length > 0 ? `${data.echecs[0].facture} : ${data.echecs[0].motif}` : undefined })
    } else {
      toast({ variant: 'error', title: data?.error || 'Rattrapage impossible' })
    }
    load()
  }

  /** Relit UNE facture — sans motif enregistré, une facture en échec était une
   *  impasse : on ne pouvait ni comprendre, ni réessayer sans tout relancer. */
  async function relire(inv: PendingInvoice) {
    if (relisant || processing) return
    setRelisant(inv.id)
    const res = await fetch('/api/invoices/extract-lines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setRelisant(null)
    if (res?.ok) {
      toast(data?.status === 'done'
        ? { variant: 'success', title: `${inv.supplier_name} : lecture complète`, description: `${data?.prix_promus ?? 0} prix retenus.` }
        : { variant: 'info', title: `${inv.supplier_name} : ${data?.status === 'hors_matiere' ? 'écartée (hors matière)' : 'lecture encore incomplète'}`, description: data?.motif || data?.reason || undefined })
    } else {
      toast({ variant: 'error', title: `${inv.supplier_name} : lecture en échec`, description: data?.error || 'Réessayez.' })
    }
    rafraichirBientot()
  }

  /** Sort une facture de la file de lecture, ou l'y remet (lot 80).
   *
   *  L'abandon est CONFIRMÉ, parce qu'il faut dire noir sur blanc ce qui ne
   *  bouge pas : le montant de la facture reste dans les achats, la marge et le
   *  résultat de sa semaine. Seules ses LIGNES manquent à la mercuriale. Et le
   *  geste est réversible d'un clic — c'est ce qui permet de l'oser. */
  async function changerLecture(inv: { id: string; supplier_name: string }, abandon: boolean) {
    if (abandonnant || relisant || processing) return
    if (abandon) {
      const ok = await confirmAction({
        title: `Ne plus essayer de lire cette facture ?`,
        description: `${nomFournisseur(inv.supplier_name) || 'Cette facture'} sortira de la file de lecture et ne sera plus repassée au lecteur. Son montant reste compté dans vos achats, votre marge et le résultat de sa semaine — seules ses lignes manqueront à la mercuriale. Réversible d’un clic.`,
        confirmLabel: 'Ne plus essayer',
        variant: 'default',
      })
      if (!ok) return
    }
    setAbandonnant(inv.id)
    const res = await fetch(`/api/invoices/${inv.id}/lecture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abandon }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setAbandonnant(null)
    if (res?.ok) {
      toast(abandon
        ? { variant: 'info', title: `${nomFournisseur(inv.supplier_name) || 'Facture'} : lecture abandonnée`, description: 'Rangée dans « Lectures abandonnées », en bas de la file. Son montant reste compté dans vos achats.' }
        : { variant: 'success', title: `${nomFournisseur(inv.supplier_name) || 'Facture'} : de retour dans la file`, description: 'Elle sera relue au prochain « Lire les factures ».' })
    } else {
      toast({ variant: 'error', title: data?.error || 'Geste impossible', description: 'Réessayez.' })
    }
    load({ silencieux: true })
  }

  /** Tranche un doute matière/charge d'un clic (lot 29). « Charge » retire les
   *  lignes éventuelles et classe hors matière ; « Matière » lève le doute —
   *  et si la facture avait été écartée, enchaîne la relecture du document
   *  avec le verdict humain (qui l'emporte sur le classement automatique,
   *  jamais sur les garde-fous de chiffres). */
  async function trancherNature(inv: DouteInvoice, nature: 'matiere' | 'hors_matiere') {
    if (tranchant) return
    setTranchant(inv.id)
    const res = await fetch('/api/invoices/confirm-nature', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, nature }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      setTranchant(null)
      toast({ variant: 'error', title: `${nomFournisseur(inv.supplier_name)} : verdict non enregistré`, description: data?.error || 'Réessayez.' })
      return
    }
    if (data?.relire_requise) {
      // La facture avait été écartée : ses lignes n'existent pas encore. On
      // relit le document en portant le verdict — même geste que « Relire ».
      const rl = await fetch('/api/invoices/extract-lines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id, relire: true, nature: 'matiere' }),
      }).catch(() => null)
      const rd = rl ? await rl.json().catch(() => null) : null
      setTranchant(null)
      toast(rl?.ok
        ? { variant: 'success', title: `${nomFournisseur(inv.supplier_name)} : relue comme matière`, description: `${rd?.prix_promus ?? 0} prix retenu${(rd?.prix_promus ?? 0) > 1 ? 's' : ''}.` }
        : { variant: 'error', title: `${nomFournisseur(inv.supplier_name)} : relecture en échec`, description: rd?.error || 'Réessayez.' })
    } else {
      setTranchant(null)
      toast({
        variant: 'success',
        title: `${nomFournisseur(inv.supplier_name)} : ${nature === 'hors_matiere' ? 'confirmée charge' : 'confirmée matière'}`,
        description: nature === 'hors_matiere' ? 'Ses lignes éventuelles sont retirées de la mercuriale.' : undefined,
      })
    }
    load({ silencieux: true })
  }

  // ── Sélection ──────────────────────────────────────

  const selRefs = useMemo(() => {
    const byId = new Map(queue.map(r => [r.id, r]))
    return selIds.map(id => byId.get(id)).filter((r): r is Ref => !!r)
  }, [selIds, queue])

  const targetBase: 'kg' | 'piece' | null = selTarget.choice === 'new'
    ? selTarget.newUnit
    : selTarget.choice
      ? generics.find(g => g.id === selTarget.choice)?.base_unit ?? null
      : null

  /** « Associer » = ajouter/retirer la réf de l'association en cours */
  function toggleSel(r: Ref) {
    const adding = !selIds.includes(r.id)
    setSelIds(prev => adding ? [...prev, r.id] : prev.filter(x => x !== r.id))
    // L'ancre suit le dernier clic : on AJOUTE → le panneau descend sous cette
    // réf ; on RETIRE → il retombe sur la dernière réf encore sélectionnée, et
    // disparaît quand le lot se vide.
    setAncreSel(prev => {
      if (adding) return r.id
      const reste = selIds.filter(x => x !== r.id)
      if (prev && prev !== r.id && reste.includes(prev)) return prev
      return reste[reste.length - 1] ?? null
    })
    if (adding && selIds.length === 0) {
      // Première réf du lot : suggestion si un générique partage sa clé
      nameTouchedRef.current = false
      const sugg = r.suggested_generic_id && generics.some(g => g.id === r.suggested_generic_id) ? r.suggested_generic_id : ''
      setSelTarget({
        choice: sugg || (generics.length > 0 ? '' : 'new'),
        newName: titleize(r.name),
        newUnit: guessBaseUnit(r.unit),
        newCat: 'ingredient',
      })
      setFactors({})
    } else if (adding && !nameTouchedRef.current) {
      setSelTarget(t => ({ ...t, newName: commonLabel([...selRefs.map(x => x.name), r.name]) }))
    }
  }

  function clearSel() {
    setSelIds([])
    setAncreSel(null)
    setFactors({})
    nameTouchedRef.current = false
    // La CIBLE aussi : sans ça, le lot suivant repartait avec le générique
    // précédent déjà présélectionné, et une réf de bœuf pouvait atterrir sous
    // « Ficelle à rôti » d'un simple clic sur « Associer ».
    setSelTarget({ choice: '', newName: '', newUnit: 'kg', newCat: 'ingredient' })
  }

  /** Charge un groupe entier dans l'association en cours (préréglée) */
  function groupToPanel(refs: Ref[], choice: string, name?: string) {
    setSelIds(refs.map(r => r.id))
    nameTouchedRef.current = false
    setFactors({})
    setSelTarget({
      choice,
      newName: name ?? commonLabel(refs.map(r => r.name)),
      newUnit: guessBaseUnit(refs[0]?.unit ?? null),
      newCat: 'ingredient',
    })
  }

  /** Envoie un lot de réfs vers /api/articles/bulk et rend compte NOMMÉMENT.
   *  Un échec anonyme ne se rattrape pas : les réfs réussies quittent la file,
   *  et plus rien ne dit lesquelles restent à faire. Ici, celles qui échouent
   *  restent sélectionnées, prêtes pour un second essai. */
  async function envoyerLot(
    demandes: { id: string; conversion_factor?: number | null }[],
    corps: Record<string, unknown>,
    libelle: (n: number) => string,
    resélectionnerLesÉchecs = true,
  ): Promise<boolean> {
    const res = await fetch('/api/articles/bulk', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corps, refs: demandes }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      toast({ variant: 'error', title: data?.error || 'Enregistrement impossible', description: 'Aucune réf n’a été modifiée.' })
      return false
    }
    const echecs: { id: string; name: string; motif: string }[] = Array.isArray(data?.echecs) ? data.echecs : []
    const traitees = Number(data?.traitees) || 0
    if (echecs.length === 0) {
      toast({ variant: 'success', title: libelle(traitees) })
      return true
    }
    // Les échecs redeviennent la sélection en cours : le second essai ne demande
    // ni tri ni mémoire. C'est la seule façon de rendre « relancez sur les réfs
    // restantes » exécutable — les réussies, elles, ont quitté la file.
    if (resélectionnerLesÉchecs) setSelIds(echecs.map(e => e.id))
    const noms = echecs.map(e => e.name || e.id).slice(0, 4).join(', ')
    toast({
      variant: 'error',
      title: `${libelle(traitees)} · ${echecs.length} en échec`,
      description: `${noms}${echecs.length > 4 ? ` et ${echecs.length - 4} autre${echecs.length - 4 > 1 ? 's' : ''}` : ''} — ${echecs[0].motif}. Ces réfs restent sélectionnées.`,
    })
    return false
  }

  /** Associe directement des réfs à un générique (toutes compatibles, facteur 1) */
  async function assocDirect(refs: Ref[], genericId: string, genericName: string) {
    if (selSaving) return
    setSelSaving(true)
    await envoyerLot(
      refs.map(r => ({ id: r.id })),
      { generic_id: genericId },
      n => `${n} réf${n > 1 ? 's' : ''} associée${n > 1 ? 's' : ''} à « ${genericName} »`,
    )
    setSelSaving(false)
    rafraichirBientot()
  }

  /** Bouton de groupe « Tout associer à X » : direct si toutes les unités sont
   *  compatibles, sinon passage par l'association en cours (facteurs exigés). */
  function assocSuggested(grp: { refs: Ref[]; suggested: Generic | null }) {
    const g = grp.suggested
    if (!g) return
    const incompatible = grp.refs.some(r => { const k = unitKind(r.unit); return k !== null && k !== g.base_unit })
    if (incompatible) { groupToPanel(grp.refs, g.id); return }
    assocDirect(grp.refs, g.id, g.name)
  }

  /** Valide l'association en cours : générique existant ou créé, facteurs par réf */
  async function submitSelection() {
    if (selSaving || selRefs.length === 0) return
    let genericId = selTarget.choice
    if (!genericId) { toast({ variant: 'error', title: 'Choisissez un article générique ou créez-en un' }); return }
    // Les réfs facturées dans une AUTRE unité que la base doivent porter leur conversion
    if (targetBase !== null) {
      for (const r of selRefs) {
        const kind = unitKind(r.unit)
        if (kind !== null && kind !== targetBase) {
          const v = parseFloat((factors[r.id] ?? '').replace(',', '.'))
          if (!(v > 0)) {
            toast({
              variant: 'error', title: `« ${r.name.slice(0, 40)} » : conversion requise`,
              description: `Cette réf est facturée en ${r.unit || '?'} pour un générique ${targetBase === 'kg' ? 'au kg' : 'à la pièce'} : indiquez combien de ${unitLabel(targetBase)} vaut 1 ${r.unit || 'unité'} (ex. 1,5). Sans ça, son prix serait faux.`,
            })
            return
          }
        }
      }
    }
    setSelSaving(true)
    let genericName = ''
    if (genericId === 'new') {
      const name = selTarget.newName.trim()
      if (!name) { toast({ variant: 'error', title: 'Nom du générique requis' }); setSelSaving(false); return }
      const res = await fetch('/api/generic-articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, base_unit: selTarget.newUnit, category: selTarget.newCat }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (!res?.ok || !data?.generic?.id) {
        toast({ variant: 'error', title: data?.error || 'Création du générique impossible' })
        setSelSaving(false)
        return
      }
      genericId = data.generic.id
      genericName = name
      // La cible bascule sur le générique QUI VIENT D'ÊTRE CRÉÉ. Sans ça, un
      // second essai après un échec partiel repartait sur « nouveau » et créait
      // un doublon du même article.
      setSelTarget(t => ({ ...t, choice: String(genericId) }))
    } else {
      genericName = generics.find(g => g.id === genericId)?.name ?? ''
    }
    const tout = await envoyerLot(
      selRefs.map(r => {
        const v = parseFloat((factors[r.id] ?? '').replace(',', '.'))
        return { id: r.id, conversion_factor: v > 0 ? v : null }
      }),
      { generic_id: genericId },
      n => `${n} réf${n > 1 ? 's' : ''} associée${n > 1 ? 's' : ''} à « ${genericName} »`,
    )
    setSelSaving(false)
    // La sélection n'est vidée que si TOUT est passé : sinon `envoyerLot` y a
    // laissé les réfs en échec, et les effacer reviendrait à les perdre.
    if (tout) clearSel()
    rafraichirBientot()
  }

  // ── Dossier des associations : réglages sur les réfs rattachées ──

  async function dissociate(refId: string, refName: string) {
    const res = await fetch(`/api/articles/${refId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: null }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${refName} » renvoyée dans la file « À rapprocher »` }); rafraichirBientot() }
    else toast({ variant: 'error', title: 'Dissociation impossible' })
  }

  /** Pose le facteur de conversion manquant d'une réf (prix à nouveau utilisable) */
  async function fixConversion(r: Ref, genericId: string) {
    const v = parseFloat((fixDrafts[r.id] ?? '').replace(',', '.'))
    if (!(v > 0)) { toast({ variant: 'error', title: 'Indiquez la conversion', description: 'Ex. « 1 pièce = 1,5 kg » → tapez 1,5.' }); return }
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: genericId, conversion_factor: v }),
    }).catch(() => null)
    if (res?.ok) {
      toast({ variant: 'success', title: 'Conversion enregistrée — prix pris en compte' })
      // La réf cesse tout de suite d'être signalée « conversion manquante » :
      // régler neuf conversions à la suite ne doit pas coûter neuf attentes.
      setGenerics(prev => prev.map(g => g.id !== genericId ? g : {
        ...g,
        refs: g.refs.map(x => x.id === r.id ? { ...x, conversion_factor: v, needs_conversion: false } : x),
      }))
      setFixDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n })
      rafraichirBientot()
    }
    else toast({ variant: 'error', title: 'Enregistrement impossible' })
  }

  /** La lecture intelligente (même IA que l'extraction des factures) propose
   *  les génériques en doublon d'appellation — cervelas acheté chez trois
   *  fournisseurs sous trois noms. Rien n'est fusionné sans validation. */
  async function runSmart() {
    if (smartLoading) return
    setSmartLoading(true)
    setSmartSuggestions(null)
    const res = await fetch('/api/mercuriale/smart-groups', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSmartLoading(false)
    if (!res?.ok) { toast({ variant: 'error', title: data?.error || 'Lecture intelligente indisponible' }); return }
    const sugg = Array.isArray(data?.suggestions) ? data.suggestions : []
    setSmartSuggestions(sugg)
    setSmartNames({})
    if (sugg.length === 0) toast({ variant: 'info', title: 'Aucun doublon d’appellation détecté', description: 'La lecture intelligente n’a rien trouvé à fusionner dans le catalogue.' })
  }

  /** Cible d'une fusion : le générique du groupe qui a le plus de réfs (kg favorisé à égalité) */
  function pickTarget(ids: string[]): Generic | null {
    const members = ids.map(id => generics.find(g => g.id === id)).filter((g): g is Generic => !!g)
    if (members.length < 2) return null
    return [...members].sort((a, b) =>
      b.refs_count - a.refs_count
      || (a.base_unit === 'kg' ? 0 : 1) - (b.base_unit === 'kg' ? 0 : 1)
      || a.name.localeCompare(b.name, 'fr'))[0]
  }

  /** Fusionne des génériques (réfs + fiches vers la cible, sources désactivées) */
  async function doMerge(targetId: string, sourceIds: string[], newName?: string): Promise<boolean> {
    if (merging) return false
    setMerging(true)
    const res = await fetch('/api/generic-articles/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: targetId, source_ids: sourceIds }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      setMerging(false)
      toast({ variant: 'error', title: 'Fusion impossible', description: data?.error || 'Réessayez.' })
      return false
    }
    // Renommage éventuel de la cible — non bloquant (nom déjà pris → conservé)
    if (newName && newName.trim()) {
      const cur = generics.find(g => g.id === targetId)
      if (cur && cur.name.trim().toLowerCase() !== newName.trim().toLowerCase()) {
        const r2 = await fetch(`/api/generic-articles/${targetId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        }).catch(() => null)
        if (!r2?.ok) toast({ variant: 'info', title: 'Fusion faite, nom conservé', description: `« ${newName.trim()} » n'a pas pu être appliqué (déjà pris ?).` })
      }
    }
    setMerging(false)
    const n = Number(data?.moved_refs) || 0
    toast({ variant: 'success', title: `Fusion faite${n > 0 ? ` — ${n} réf${n > 1 ? 's' : ''} regroupée${n > 1 ? 's' : ''}` : ''}` })
    load()
    return true
  }

  /** Valide une suggestion de la lecture intelligente */
  async function applySuggestion(key: string, s: { name: string; ids: string[] }) {
    const target = pickTarget(s.ids)
    if (!target) { toast({ variant: 'error', title: 'Suggestion périmée', description: 'Relancez le rapprochement intelligent.' }); return }
    const sources = s.ids.filter(id => id !== target.id)
    const ok = await doMerge(target.id, sources, smartNames[key] ?? s.name)
    if (ok) setSmartSuggestions(prev => prev ? prev.filter(x => x.ids.join(',') !== key) : prev)
  }

  /** Écarte une réf de la file (le gérant ne veut pas la rapprocher) ou la restaure */
  async function setIgnored(r: Ref, ignored: boolean) {
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignored }),
    }).catch(() => null)
    if (res?.ok) {
      toast(ignored
        ? { variant: 'info', title: `« ${r.name} » écartée`, description: 'Restaurable depuis « Réfs écartées » en bas de file.' }
        : { variant: 'success', title: `« ${r.name} » remise dans la file` })
      if (ignored) setSelIds(prev => prev.filter(x => x !== r.id))
      // Bascule immédiate dans la file : écarter trente-six réfs une par une ne
      // doit pas déclencher trente-six reconstructions de l'historique.
      setQueue(prev => prev.map(x => x.id === r.id ? { ...x, ignored } : x))
      rafraichirBientot()
    } else toast({ variant: 'error', title: 'Action impossible' })
  }

  /** Écarte tout un groupe de réfs d'un coup */
  async function ignoreGroup(refs: Ref[]) {
    setSelIds(prev => prev.filter(id => !refs.some(r => r.id === id)))
    await envoyerLot(
      refs.map(r => ({ id: r.id })),
      { ignored: true },
      n => `${n} réf${n > 1 ? 's' : ''} écartée${n > 1 ? 's' : ''} — restaurables en bas de file`,
      false,
    )
    rafraichirBientot()
  }

  /** Pose ou retire le PRIX BLOQUÉ d'une réf (lot 43, modèle Otami) — le prix
   *  négocié avec le fournisseur ; toute facture postérieure payée au-dessus
   *  sera signalée dans « À traiter ». null = déverrouiller. */
  async function poserVerrou(refId: string, prix: number | null) {
    if (verrouillant) return
    setVerrouillant(refId)
    const res = await fetch(`/api/articles/${refId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked_price_ht: prix }),
    }).catch(() => null)
    setVerrouillant(null)
    if (!res?.ok) { toast({ variant: 'error', title: 'Verrou non enregistré', description: 'Réessayez.' }); return }
    toast(prix !== null
      ? { variant: 'success', title: `Prix bloqué à ${fmtEuro(prix)}`, description: 'Toute facture au-dessus sera signalée dans « À traiter ».' }
      : { variant: 'success', title: 'Prix débloqué — la surveillance est retirée' })
    setVerrouDrafts(prev => { const n = { ...prev }; delete n[refId]; return n })
    load({ silencieux: true })
  }

  /** Déplace une réf vers un autre générique (conversion remise à zéro) */
  async function moveRef(r: Ref, genericId: string) {
    const g = generics.find(x => x.id === genericId)
    if (!g) return
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: genericId, conversion_factor: null }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${r.name} » déplacée vers « ${g.name} »` }); rafraichirBientot() }
    else toast({ variant: 'error', title: 'Déplacement impossible' })
  }

  function startEdit(g: Generic) {
    setEditId(g.id)
    setEdit({ name: g.name, base_unit: g.base_unit, category: g.category, loss: String(g.default_loss_pct ?? 0) })
  }

  const [saving, setSaving] = useState(false)
  async function submitEdit(g: Generic) {
    if (saving) return
    setSaving(true)
    const res = await fetch(`/api/generic-articles/${g.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: edit.name, base_unit: edit.base_unit, category: edit.category, default_loss_pct: Number(edit.loss.replace(',', '.')) || 0 }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok) { toast({ variant: 'error', title: data?.error || 'Modification impossible' }); return }
    setEditId(null)
    // Le nom corrigé s'affiche sans attendre — et le badge « Auto » tombe, la
    // route le pose dès qu'une modification aboutit.
    setGenerics(prev => prev.map(x => x.id !== g.id ? x : {
      ...x,
      name: edit.name.trim() || x.name,
      base_unit: edit.base_unit,
      category: edit.category,
      default_loss_pct: Number(edit.loss.replace(',', '.')) || 0,
      auto_created: false,
    }))
    rafraichirBientot()
  }

  /** « Vu, c'est bon » sur un générique créé automatiquement : le badge tombe.
   *  Sans ce geste, `auto_created` restait vrai à vie et la revue n'avançait
   *  jamais — 125 génériques marqués « à vérifier » indéfiniment. */
  async function validerAuto(g: Generic) {
    if (validant) return
    setValidant(g.id)
    const res = await fetch(`/api/generic-articles/${g.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_created: false }),
    }).catch(() => null)
    setValidant(null)
    if (!res?.ok) { toast({ variant: 'error', title: 'Validation impossible' }); return }
    // Mise à jour locale : la revue enchaîne sans recharger toute la page.
    setGenerics(prev => prev.map(x => (x.id === g.id ? { ...x, auto_created: false } : x)))
  }

  // Suppression en deux temps (jamais de dialogue natif) : premier clic arme,
  // second clic exécute. Les réfs retournent dans la file d'attente.
  async function removeGeneric(g: Generic) {
    if (confirmDelId !== g.id) { setConfirmDelId(g.id); return }
    setConfirmDelId(null)
    const res = await fetch(`/api/generic-articles/${g.id}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${g.name} » supprimé — ses réfs retournent dans la file d'attente` }); setOpenId(null); load() }
    else toast({ variant: 'error', title: 'Suppression impossible' })
  }

  // ── Dérivés ──────────────────────────────────────

  const filteredGenerics = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = generics
    if (hausseFilter) list = list.filter(g => (g.variation_pct ?? 0) > 0)
    if (autoFilter) list = list.filter(g => g.auto_created)
    if (!q) return list
    return list.filter(g =>
      g.name.toLowerCase().includes(q)
      || g.refs.some(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q)))
  }, [generics, search, hausseFilter, autoFilter])

  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return queue
    return queue.filter(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q) || (r.article_code || '').toLowerCase().includes(q))
  }, [queue, search])

  // Groupes de ressemblance : les réfs à la même clé de rapprochement, avec le
  // générique suggéré s'il existe et un nom proposé (début commun des libellés).
  // Les lignes non-produit et les réfs ÉCARTÉES par le gérant vivent à part.
  const visibleQueue = useMemo(() => filteredQueue.filter(r => !r.ignored), [filteredQueue])
  const ignoredRefs = useMemo(() => filteredQueue.filter(r => r.ignored), [filteredQueue])
  /** Poids en euros d'un groupe : le plus gros dernier prix de ses réfs. Le
   *  gérant traite d'abord ce qui pèse. */
  const montantGroupe = (grp: { refs: Ref[] }) =>
    grp.refs.reduce((mx, r) => Math.max(mx, r.last_price_ht !== null ? Number(r.last_price_ht) : 0), 0)
  /** Date du prix le plus ANCIEN du groupe — ce qui traîne remonte en premier. */
  const dateGroupe = (grp: { refs: Ref[] }) =>
    grp.refs.reduce((mn, r) => {
      const d = String(r.last_seen || r.last_price_date || '9999-99-99')
      return d < mn ? d : mn
    }, '9999-99-99')

  const queueGroups = useMemo(() => {
    const m = new Map<string, Ref[]>()
    for (const r of visibleQueue) {
      if (r.non_product) continue
      const key = r.stem || r.name.toLowerCase()
      const arr = m.get(key) || []
      arr.push(r)
      m.set(key, arr)
    }
    return [...m.entries()]
      .map(([stem, refs]) => ({
        stem,
        refs,
        label: commonLabel(refs.map(r => r.name)),
        suggested: refs[0].suggested_generic_id ? generics.find(g => g.id === refs[0].suggested_generic_id) ?? null : null,
      }))
      .sort((a, b) => {
        // Le seul tri possible était le NOMBRE de réfs : la réf de bœuf à
        // 14 €/kg passait derrière trois groupes de ficelle à rôti. Le gérant
        // choisit maintenant ce qui compte pour lui — l'argent, le fournisseur,
        // ou ce qui traîne depuis le plus longtemps.
        if (queueSort === 'montant') return montantGroupe(b) - montantGroupe(a) || a.label.localeCompare(b.label, 'fr')
        if (queueSort === 'fournisseur') return (a.refs[0].supplier_name || 'zzz').localeCompare(b.refs[0].supplier_name || 'zzz', 'fr') || a.label.localeCompare(b.label, 'fr')
        if (queueSort === 'anciennete') return dateGroupe(a).localeCompare(dateGroupe(b)) || a.label.localeCompare(b.label, 'fr')
        return b.refs.length - a.refs.length || a.label.localeCompare(b.label, 'fr')
      })
  }, [visibleQueue, generics, queueSort])

  const nonProductRefs = useMemo(() => visibleQueue.filter(r => r.non_product), [visibleQueue])
  const productRefCount = visibleQueue.length - nonProductRefs.length

  /** Les réfs RÉELLEMENT dessinées dans la file en ce moment — la file est
   *  repliée aux dix premiers groupes, filtrée par la recherche, et les lignes
   *  non-produit sont pliées. Sans cette liste, le panneau pourrait s'ancrer à
   *  une ligne absente de l'écran : plus rien pour valider le lot. */
  const refsAffichees = useMemo(() => {
    const ids = new Set<string>()
    if (view !== 'traiter') return ids
    for (const grp of queueAll ? queueGroups : queueGroups.slice(0, 10)) for (const r of grp.refs) ids.add(r.id)
    if (showNonProduct) for (const r of nonProductRefs) ids.add(r.id)
    return ids
  }, [view, queueAll, queueGroups, showNonProduct, nonProductRefs])

  /** Sous QUELLE ligne ouvrir le panneau. `null` = aucune ligne du lot n'est à
   *  l'écran (onglet changé, recherche filtrante) : repli en bandeau collant. */
  const ancreAffichee = useMemo(() => {
    if (selIds.length === 0) return null
    if (ancreSel && selIds.includes(ancreSel) && refsAffichees.has(ancreSel)) return ancreSel
    let dernier: string | null = null
    for (const id of selIds) if (refsAffichees.has(id)) dernier = id
    return dernier
  }, [ancreSel, selIds, refsAffichees])
  // Décompte du KPI, sur la file ENTIÈRE (jamais sur le filtre de recherche) et
  // avec la même définition que la liste : un « produit à rapprocher » n'est ni
  // écarté ni non-produit. Le KPI affichait `queue.length`, tout compris.
  const queueCounts = useMemo(() => {
    let produits = 0, ecartees = 0, nonProduit = 0
    for (const r of queue) {
      if (r.ignored) ecartees++
      else if (r.non_product) nonProduit++
      else produits++
    }
    return { produits, ecartees, nonProduit }
  }, [queue])
  const hausses = useMemo(() => generics.filter(g => (g.variation_pct ?? 0) > 0).length, [generics])
  const autoAVerifier = useMemo(() => generics.filter(g => g.auto_created).length, [generics])
  const conversionsManquantes = useMemo(() => generics.reduce((s, g) => s + g.refs.filter(r => r.needs_conversion).length, 0), [generics])
  // Dossier des associations : les génériques à conversion manquante d'abord —
  // c'est ce que le gérant vient régler.
  const assocGenerics = useMemo(() =>
    [...filteredGenerics].sort((a, b) =>
      (b.refs.some(r => r.needs_conversion) ? 1 : 0) - (a.refs.some(r => r.needs_conversion) ? 1 : 0)),
  [filteredGenerics])

  /** Dernier prix utilisable PAR FOURNISSEUR d'un générique, du moins cher au
   *  plus cher — la matière de la comparaison fournisseurs. Une réf sans prix
   *  ramené à la base (quarantaine, conversion manquante) n'y entre pas. */
  const supplierRows = (g: Generic) => {
    const bySupplier = new Map<string, { sup: string; price: number; date: string | null }>()
    for (const r of g.refs) {
      if (r.price_base === null) continue
      const sup = (r.supplier_name || 'Fournisseur inconnu').trim()
      const cur = bySupplier.get(sup)
      if (!cur || String(r.last_price_date || '') > String(cur.date || '')) {
        bySupplier.set(sup, { sup, price: r.price_base, date: r.last_price_date })
      }
    }
    return [...bySupplier.values()].sort((a, b) => a.price - b.price)
  }

  /** Fournisseur moins cher que celui du prix du jour (badge au catalogue) —
   *  écart d'au moins 0,5 % pour ne pas signaler du bruit d'arrondi. */
  const cheaperAlt = (g: Generic) => {
    if (g.price_ht === null || g.price_ht <= 0) return null
    const rows = supplierRows(g)
    if (rows.length < 2) return null
    const cheapest = rows[0]
    if (cheapest.sup === (g.price_supplier || 'Fournisseur inconnu').trim()) return null
    if (cheapest.price >= g.price_ht * 0.995) return null
    return {
      sup: cheapest.sup,
      pct: Math.round(((g.price_ht - cheapest.price) / g.price_ht) * 1000) / 10,
      price: cheapest.price,
      date: cheapest.date,
    }
  }
  const refsAssociees = useMemo(() => generics.reduce((s, g) => s + g.refs.length, 0), [generics])
  const recipesCountByGeneric = useMemo(() => new Map(generics.map(g => [g.id, g.recipes_count])), [generics])

  /** Réfs facturées dans une autre unité que la base de leur article, SANS
   *  conversion : leur prix est ignoré. Liste à plat pour l'onglet « À
   *  traiter » — les régler ne doit pas demander de fouiller le catalogue. */
  const refsSansConversion = useMemo(() =>
    generics.flatMap(g => g.refs.filter(r => r.needs_conversion).map(r => ({ r, g }))),
  [generics])
  /** Réfs dont le prix bloqué est dépassé (lot 43) — une réf = un geste */
  const refsEnEcart = useMemo(() => new Set(ecartsBloques.map(e => e.article_id)).size, [ecartsBloques])
  /** Total de l'onglet « À traiter » : tout ce qui attend un geste. C'est LE
   *  chiffre qui dit si la mercuriale a besoin de vous aujourd'hui. */
  const aTraiterTotal = pending.length + doutes.length + queueCounts.produits + refsSansConversion.length + sansPdf + refsEnEcart

  // ── VUE PAR FOURNISSEUR (lot 40, modèle Otami) : la mercuriale de chaque
  // maison — ses réfs, leurs derniers prix et tendances, classées par familles
  // de la boutique, avec la dépense réelle 12 mois en tête de carte. ──
  /** Toutes les réfs (rattachées + en file), avec leur générique éventuel */
  const toutesRefs = useMemo(() => [
    ...generics.flatMap(g => g.refs.map(r => ({ r, g: g as Generic | null }))),
    ...queue.map(r => ({ r, g: null as Generic | null })),
  ], [generics, queue])
  /** Réfs groupées par maison (nom nettoyé) + date du dernier achat connu */
  const refsParFournisseur = useMemo(() => {
    const m = new Map<string, { refs: { r: Ref; g: Generic | null }[]; dernier: string | null }>()
    for (const x of toutesRefs) {
      const nom = nomFournisseur(x.r.supplier_name) || 'Fournisseur inconnu'
      const cur = m.get(nom) || { refs: [], dernier: null }
      cur.refs.push(x)
      const d = String(x.r.last_seen || x.r.last_price_date || '')
      if (d && (!cur.dernier || d > cur.dernier)) cur.dernier = d
      m.set(nom, cur)
    }
    return m
  }, [toutesRefs])
  /** Cartes fournisseurs : réfs + dépense 12 mois (les variantes d'un même nom
   *  brut fusionnent après nettoyage), triées par dépense — l'argent d'abord. */
  const cartesFournisseurs = useMemo(() => {
    const dep = new Map<string, { depense: number; factures: number; derniere: string | null }>()
    for (const f of fournisseurs) {
      const nom = nomFournisseur(f.nom) || 'Fournisseur inconnu'
      const cur = dep.get(nom) || { depense: 0, factures: 0, derniere: null }
      cur.depense += f.depense_12m
      cur.factures += f.factures_12m
      if (f.derniere_facture && (!cur.derniere || f.derniere_facture > cur.derniere)) cur.derniere = f.derniere_facture
      dep.set(nom, cur)
    }
    const noms = new Set([...refsParFournisseur.keys(), ...dep.keys()])
    return [...noms].map(nom => ({
      nom,
      nbRefs: refsParFournisseur.get(nom)?.refs.length ?? 0,
      dernier: refsParFournisseur.get(nom)?.dernier ?? dep.get(nom)?.derniere ?? null,
      depense: Math.round((dep.get(nom)?.depense ?? 0) * 100) / 100,
      factures: dep.get(nom)?.factures ?? 0,
    })).sort((a, b) => b.depense - a.depense || b.nbRefs - a.nbRefs || a.nom.localeCompare(b.nom, 'fr'))
  }, [refsParFournisseur, fournisseurs])
  /** Catalogue du fournisseur ouvert : réfs classées par famille de la boutique
   *  (référentiel des marges, sous-familles ramenées à leur racine), filtrées
   *  par la recherche. « Autres » ramasse ce qu'aucune famille ne reconnaît. */
  const catalogueFournisseur = useMemo(() => {
    if (!fournisseurSel) return null
    const entree = refsParFournisseur.get(fournisseurSel)
    if (!entree) return null
    const q = search.trim().toLowerCase()
    const famById = new Map(familles.map(f => [f.id, f]))
    const sections = new Map<string, { r: Ref; g: Generic | null }[]>()
    for (const x of entree.refs) {
      if (q && !x.r.name.toLowerCase().includes(q) && !(x.g && x.g.name.toLowerCase().includes(q))) continue
      const libelle = x.g ? x.g.name : x.r.name
      const fid = matchFamilyId(libelle, familles)
      const fam = fid ? famById.get(fid) ?? null : null
      const racine = fam ? (fam.parent_id ? famById.get(fam.parent_id)?.name ?? fam.name : fam.name) : 'Autres'
      const arr = sections.get(racine) || []
      arr.push(x)
      sections.set(racine, arr)
    }
    return [...sections.entries()]
      .map(([titre, refs]) => ({ titre, refs: [...refs].sort((a, b) => a.r.name.localeCompare(b.r.name, 'fr')) }))
      .sort((a, b) => b.refs.length - a.refs.length || a.titre.localeCompare(b.titre, 'fr'))
  }, [fournisseurSel, refsParFournisseur, familles, search])

  /** Ligne d'une réf en file : « Associer » l'ajoute à l'association en cours */
  const renderRef = (r: Ref) => {
    const isSel = selIds.includes(r.id)
    return (
      <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold text-gray-900">{r.name}</p>
          <p className="text-[11px] text-gray-400">{nomFournisseur(r.supplier_name) || '—'}{r.article_code ? ` · ${r.article_code}` : ''}</p>
        </div>
        <span className="text-xs text-gray-500 tabular text-right">
          {r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}
          {/* Depuis QUAND, et sur QUELLE facture : c'est ce qui permet de dire
              « est-ce le même produit ? » sans quitter l'écran. */}
          {(r.last_seen || r.last_price_date) && (
            <span className="block text-[10px] text-gray-400">{fmtDate(String(r.last_seen || r.last_price_date))}</span>
          )}
        </span>
        {r.last_invoice_id && (
          <button onClick={e => { e.stopPropagation(); window.open(`/api/invoices/${r.last_invoice_id}/file`, '_blank') }}
            title="Ouvrir la facture d'où vient ce prix"
            className="text-[11px] font-semibold text-pilote hover:underline flex-shrink-0">voir la facture</button>
        )}
        <button onClick={() => toggleSel(r)}
          className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 transition-all ${isSel ? 'text-white bg-green-600 hover:bg-green-700 shadow-card' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card active:scale-[0.98]'}`}>
          {isSel ? <><Check className="w-3.5 h-3.5" />Sélectionnée</> : <><Link2 className="w-3.5 h-3.5" />Associer</>}
        </button>
        <button onClick={() => setIgnored(r, true)} title="Écarter — ne pas rapprocher cette réf"
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  /** Le PANNEAU d'association : recherche du générique, réfs du lot, facteurs
   *  de conversion, « Associer N réfs ». Un seul contenu, deux emplacements —
   *  sous la ligne cliquée (cas normal), ou en bandeau collant (repli). */
  const carteAssociation = selRefs.length === 0 ? null : (
    <div className="bg-white rounded-2xl border-2 border-pilote-200 shadow-card-hover p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-sm font-bold text-gray-900">
          Association en cours
          <span className="ml-2 text-[11px] font-bold text-pilote bg-pilote-50 rounded-full px-2 py-0.5 tabular">{selRefs.length} réf{selRefs.length > 1 ? 's' : ''}</span>
        </p>
        <p className="text-[11px] text-gray-400">Cliquez « Associer » sur d&apos;autres réfs pour les ajouter — tout partira vers le même générique.</p>
      </div>
      <div className="space-y-1.5 mb-3 max-h-56 overflow-y-auto">
        {selRefs.map(r => {
          const kind = unitKind(r.unit)
          const needFactor = targetBase !== null && kind !== null && kind !== targetBase
          return (
            <div key={r.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 flex-1 min-w-[150px]">{r.name}</span>
              <span className="text-[11px] text-gray-400">{nomFournisseur(r.supplier_name) || '—'}</span>
              <span className="text-xs text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
              {targetBase !== null && (
                <span className={`flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 tabular ${needFactor ? 'text-amber-700 bg-amber-50 ring-1 ring-amber-200' : 'text-gray-400'}`}>
                  1 {r.unit || 'unité'} =
                  <input value={factors[r.id] ?? ''} inputMode="decimal" placeholder={needFactor ? '?' : '1'}
                    onChange={e => setFactors(p => ({ ...p, [r.id]: e.target.value }))}
                    className={`w-14 border rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200 ${needFactor ? 'border-amber-300' : 'border-gray-200'}`} />
                  {unitLabel(targetBase)}{needFactor ? ' (requis)' : ''}
                </span>
              )}
              <button onClick={() => toggleSel(r)} className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Retirer de la sélection">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className={selTarget.choice === 'new' ? '' : 'md:col-span-2'}>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Vers l&apos;article générique</label>
          <select value={selTarget.choice}
            onChange={e => {
              const v = e.target.value
              setSelTarget(t => ({ ...t, choice: v, newName: v === 'new' && !t.newName ? commonLabel(selRefs.map(x => x.name)) : t.newName }))
            }}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
            <option value="">— Choisir —</option>
            <option value="new">Créer un nouvel article générique</option>
            {generics.map(g => <option key={g.id} value={g.id}>{g.name} (/ {unitLabel(g.base_unit)})</option>)}
          </select>
        </div>
        {selTarget.choice === 'new' && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom</label>
              <input value={selTarget.newName}
                onChange={e => { nameTouchedRef.current = true; setSelTarget(t => ({ ...t, newName: e.target.value })) }}
                placeholder="Filet de poulet"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité de base</label>
              <select value={selTarget.newUnit} onChange={e => setSelTarget(t => ({ ...t, newUnit: e.target.value as 'kg' | 'piece' }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                <option value="kg">au kg</option>
                <option value="piece">à la pièce</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
              <select value={selTarget.newCat} onChange={e => setSelTarget(t => ({ ...t, newCat: e.target.value as 'ingredient' | 'emballage' }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                <option value="ingredient">Ingrédient</option>
                <option value="emballage">Emballage</option>
              </select>
            </div>
          </>
        )}
        <div className={`flex items-end justify-end gap-2 ${selTarget.choice === 'new' ? 'md:col-span-4' : 'md:col-span-2'}`}>
          <button onClick={clearSel} className="text-xs font-semibold text-gray-500 rounded-xl px-3.5 py-2 hover:bg-gray-100 transition-colors">Tout annuler</button>
          <button onClick={submitSelection} disabled={selSaving}
            className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
            {selSaving ? 'Association…' : `Associer ${selRefs.length} réf${selRefs.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )

  /** Une ligne de la file, suivie du panneau si c'est ELLE qui l'ancre. Le
   *  panneau s'ouvre là où le boucher regarde déjà : encadré, décalé, sur fond
   *  navy clair, il se lit comme un tiroir de la ligne, pas comme une réf de
   *  plus. Aucun défilement n'est provoqué — l'écran ne bouge pas. */
  const renderRefAncree = (r: Ref) => (
    <div key={r.id}>
      {renderRef(r)}
      {ancreAffichee === r.id && (
        <div className="border-l-[3px] border-pilote bg-pilote-50/70 pl-4 pr-3 pb-3 pt-2">
          {carteAssociation}
        </div>
      )}
    </div>
  )


  return {
    toast, confirmAction, generics, setGenerics, queue, setQueue,
    pending, setPending, moves, setMoves, movesTotal, setMovesTotal,
    movesOpen, setMovesOpen, hausseFilter, setHausseFilter, autoFilter, setAutoFilter,
    validant, setValidant, loading, setLoading, search, setSearch,
    view, setView, fournisseurs, setFournisseurs, familles, setFamilles,
    fournisseurSel, setFournisseurSel, rayonSel, setRayonSel, depenseHorsCatalogue, setDepenseHorsCatalogue,
    ecartsBloques, setEcartsBloques, ecartsBloquesTotal, setEcartsBloquesTotal, verrouDrafts, setVerrouDrafts,
    verrouillant, setVerrouillant, processing, setProcessing, progress, setProgress,
    stopRef, showMotifs, setShowMotifs, relisant, setRelisant, abandonnees,
    setAbandonnees, showAbandons, setShowAbandons, abandonnant, setAbandonnant, doutes,
    setDoutes, tranchant, setTranchant, sansPdf, setSansPdf, backfill,
    setBackfill, lectureIncomplete, setLectureIncomplete, selIds, setSelIds, ancreSel,
    setAncreSel, selTarget, setSelTarget, factors, setFactors, selSaving,
    setSelSaving, nameTouchedRef, fixDrafts, setFixDrafts, smartLoading, setSmartLoading,
    smartSuggestions, setSmartSuggestions, smartNames, setSmartNames, mergeSel, setMergeSel,
    merging, setMerging, openId, setOpenId, fiches, setFiches,
    ficheLoading, setFicheLoading, editId, setEditId, edit, setEdit,
    confirmDelId, setConfirmDelId, queueSort, setQueueSort, queueAll, setQueueAll,
    showNonProduct, setShowNonProduct, showIgnored, setShowIgnored, load, differeRef,
    rafraichirBientot, generiqueVuRef, processQueue, rattraperPdf, relire, changerLecture,
    trancherNature, selRefs, targetBase, toggleSel, clearSel, groupToPanel,
    envoyerLot, assocDirect, assocSuggested, submitSelection, dissociate, fixConversion,
    runSmart, pickTarget, doMerge, applySuggestion, setIgnored, ignoreGroup,
    poserVerrou, moveRef, startEdit, saving, setSaving, submitEdit,
    validerAuto, removeGeneric, filteredGenerics, filteredQueue, visibleQueue, ignoredRefs,
    montantGroupe, dateGroupe, queueGroups, nonProductRefs, productRefCount, refsAffichees,
    ancreAffichee, queueCounts, hausses, autoAVerifier, conversionsManquantes, assocGenerics,
    supplierRows, cheaperAlt, refsAssociees, recipesCountByGeneric, refsSansConversion, refsEnEcart,
    aTraiterTotal, toutesRefs, refsParFournisseur, cartesFournisseurs, catalogueFournisseur, renderRef,
    carteAssociation, renderRefAncree,
  }
}

export type Mercuriale = ReturnType<typeof useMercuriale>
