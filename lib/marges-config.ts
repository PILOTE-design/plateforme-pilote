// Configuration partagée des marges par groupe — importable côté SERVEUR et côté CLIENT.
// Ne surtout pas déplacer dans un composant 'use client' : la page serveur Marges
// appelle ces fonctions au rendu (les exports d'un module client deviennent des
// références client inutilisables côté serveur → crash « Une erreur est survenue »).

export type Groupe = 'boucherie' | 'charcuterie' | 'traiteur' | 'achat_revente'
export type MappingRow = { source_type: 'famille' | 'achat_categorie'; source_name: string; groupe: Groupe }

export const GROUPES: { key: Groupe; label: string; color: string; active: string }[] = [
  { key: 'boucherie',     label: 'Boucherie',     color: 'text-red-700 bg-red-50 hover:bg-red-100',          active: 'bg-red-600 text-white' },
  { key: 'charcuterie',   label: 'Charcuterie',   color: 'text-orange-700 bg-orange-50 hover:bg-orange-100', active: 'bg-orange-600 text-white' },
  { key: 'traiteur',      label: 'Traiteur',      color: 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100', active: 'bg-emerald-600 text-white' },
  { key: 'achat_revente', label: 'Achat-revente', color: 'text-sky-700 bg-sky-50 hover:bg-sky-100',          active: 'bg-sky-600 text-white' },
]

// Catégories d'achat à trier dans l'assistant : UNIQUEMENT les catégories métier
// définies en facturation. Les charges structurelles (frais généraux : loyer,
// énergie, assurance…) n'entrent pas dans le tri — elles pèsent sur la marge
// globale de la boutique, pas sur un groupe.
export const ACHAT_CATEGORIES: { key: string; label: string }[] = [
  { key: 'viande',      label: 'Viande (achats)' },
  { key: 'charcuterie', label: 'Charcuterie (achats)' },
  { key: 'epicerie',    label: 'Épicerie (achats)' },
  { key: 'emballage',   label: 'Emballage' },
  { key: 'autre',       label: 'Autre' },
]

// Catégories structurelles : jamais affectées à un groupe de marge.
export const CATEGORIES_STRUCTURELLES = new Set(['frais_generaux'])

/** Pré-remplissage intelligent — le client ajuste ensuite (c'est sa réflexion à la création) */
export function defaultGroupeForFamille(nom: string): Groupe {
  const n = nom.toUpperCase()
  if (/(CHARCUT|SALAISON|SAUCISS|JAMBON|PATE|PÂTÉ|TERRINE)/.test(n)) return 'charcuterie'
  if (/(TRAITEUR|PLAT|ROTISSERIE|RÔTISSERIE|SNACK|SANDWICH)/.test(n)) return 'traiteur'
  if (/(BOEUF|BŒUF|VEAU|AGNEAU|PORC|VOLAILLE|VIANDE|BOUCH|GIBIER|ABAT)/.test(n)) return 'boucherie'
  return 'achat_revente'
}
export function defaultGroupeForCategorie(cat: string): Groupe {
  if (cat === 'viande') return 'boucherie'
  if (cat === 'charcuterie') return 'charcuterie'
  return 'achat_revente'
}
