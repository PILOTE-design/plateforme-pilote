/**
 * VALORISATION CARCASSE — la nomenclature et le MOTEUR de répartition du coût.
 *
 * Sorti de `app/dashboard/valorisation/page.tsx` (un composant 'use client' de
 * 120 Ko) pour une raison simple : le coût d'un morceau de découpe doit pouvoir
 * être lu côté SERVEUR, par la chaîne des fiches recettes. Un morceau de
 * carcasse est un ingrédient comme un autre — il a juste une autre provenance
 * qu'une facture fournisseur.
 *
 * Module PUR, testable hors ligne. Aucune dépendance React, aucun accès base.
 *
 * ─── CE QUE LE MODULE CALCULE, ET POURQUOI ────────────────────────────────
 *
 * Une carcasse arrive avec UN coût global : le prix payé, plus les frais, plus
 * la main-d'œuvre de découpe. Ce coût doit se retrouver dans chaque morceau,
 * sinon une terrine de collier et un tartare de filet se calculent sur le même
 * prix au kilo — et l'un des deux ment.
 *
 * La règle retenue (arbitrée avec le client) : le coût se répartit AU PRORATA
 * DE LA VALEUR, morceau par morceau.
 *
 *     coût au kg d'un morceau = son prix de référence × coefficient
 *     coefficient             = coût total de la carcasse ÷ valeur marché
 *     valeur marché           = Σ (poids du morceau × son prix de référence)
 *
 * Dit en langage de boucher, c'est exactement la même chose : « mon kilo
 * commercial me revient à X €, et le filet, c'est ×2,4 de ce kilo-là ». Les
 * deux lectures sont fournies (`cout_moyen_kg_ht` et `coef` de chaque morceau)
 * parce que ce sont deux façons de regarder UN seul calcul — c'est démontré
 * par les tests, pas seulement affirmé.
 *
 * Pourquoi PAS un coefficient par catégorie (1er choix, 2e choix…) : mesuré sur
 * la nomenclature réelle, l'écart 1ʳᵉ/3ᵉ catégorie va de ×2,0 sur le bœuf à
 * ×3,7 sur le porc — un jeu de coefficients uniques ne conviendrait à aucun des
 * deux. Pire, en 1ʳᵉ catégorie de bœuf les prix vont de 7 € à 45 € : un
 * coefficient de catégorie ferait payer le filet au prix du gîte. La catégorie
 * ne sert donc qu'à regrouper à la lecture.
 *
 * ─── LES DEUX RÈGLES D'HONNÊTETÉ ──────────────────────────────────────────
 *
 * 1. Un morceau SANS prix de référence (les déchets animaux, à 0 €) ne porte
 *    AUCUN coût, et son poids sort du kilo commercial. On ne vend pas les
 *    déchets : leur part se reporte sur ce qui se vend. Le poids écarté est
 *    rendu dans `kg_hors_commerce`, pour être annoncé à l'écran.
 *
 * 2. Sans coût forcé, la somme (coût du morceau × son poids) retombe EXACTEMENT
 *    sur le coût de la carcasse. C'est l'invariant qui prouve le calcul, et il
 *    est testé. Dès que le boucher force un coût à la main, l'équilibre casse —
 *    par choix : forcer le filet ne doit jamais faire bouger le collier, ni donc
 *    le coût d'une fiche recette qu'on n'a pas touchée. L'écart est alors rendu
 *    dans `ecart_forcage_ht` et DOIT être écrit à l'écran. Règle de maison :
 *    jamais de chiffre faux en silence.
 */

export type CutCategory = 'premier' | 'deuxieme' | 'troisieme' | 'abat' | 'os'
export type AnimalType = 'boeuf' | 'veau' | 'agneau' | 'porc' | 'volaille'

/** Une pièce de découpe. `yieldPct` est resté à 0 partout : les poids sont
 *  SAISIS par le boucher, jamais déduits d'un rendement théorique.
 *  `marketPrice` est le prix de référence indicatif (€/kg), modifiable pièce
 *  par pièce depuis l'écran de valorisation. */
export interface Cut {
  id: string
  name: string
  category: CutCategory
  yieldPct: number
  marketPrice: number
  group?: string[]
}

// Découpe bœuf en arborescence (fournie par le boucher). Chaque pièce = une feuille avec son
// chemin `group` (catégorie → grosse pièce → sous-groupe). yieldPct non utilisé (poids manuel) ;
// marketPrice = prix de référence indicatif, modifiable par pièce.
export const BOEUF_CUTS: Cut[] = [
  // ── BCUH ──
  { id: 'jarret_avec_os',         name: 'Jarret avec os',          category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['ART8', 'BCUH', 'Jarret'] },
  { id: 'jarret_sans_os',         name: 'Jarret sans os',          category: 'troisieme', yieldPct: 0, marketPrice: 14, group: ['ART8', 'BCUH', 'Jarret'] },
  { id: 'araignee_b',             name: 'Araignée',                category: 'premier',   yieldPct: 0, marketPrice: 32, group: ['ART8', 'BCUH', 'Globe'] },
  { id: 'tranche_grasse_ronde',   name: 'Ronde tranche grasse',    category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['ART8', 'BCUH', 'Globe', 'Tranche grasse'] },
  { id: 'tranche_grasse_plat',    name: 'Plat de tranche grasse',  category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['ART8', 'BCUH', 'Globe', 'Tranche grasse'] },
  { id: 'tranche_grasse_mouvante', name: 'Mouvante tranche grasse', category: 'deuxieme', yieldPct: 0, marketPrice: 15, group: ['ART8', 'BCUH', 'Globe', 'Tranche grasse'] },
  // Tende de tranche : toutes les pièces en direct (Milieu = ex-cœur de tranche)
  { id: 'coeur_tranche',          name: 'Milieu',                  category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'fausse_araignee',        name: 'Fausse araignée',         category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'entame',                 name: 'Entame',                  category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'poire',                  name: 'Poire',                   category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'merlan',                 name: 'Merlan',                  category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'chapeau',                name: 'Chapeau',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'talon',                  name: 'Talon',                   category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'dessus_de_tranche',      name: 'Dessus de tranche',       category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['ART8', 'BCUH', 'Globe', 'Tende de tranche'] },
  { id: 'gite_noix',              name: 'Gîte à la noix',          category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'rond_de_gite',           name: 'Rond de gîte',            category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'nerveux',                name: 'Nerveux',                 category: 'troisieme', yieldPct: 0, marketPrice: 11, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'plat_de_nerveux',        name: 'Plat de nerveux',         category: 'troisieme', yieldPct: 0, marketPrice: 11, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'oreille_gite',           name: 'Oreille de gîte',         category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'jarret_semelle',         name: 'Jarret avec os',          category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['ART8', 'BCUH', 'Globe', 'Semelle'] },
  { id: 'filet_rtk',              name: 'Filet de rumsteck',       category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['ART8', 'BCUH', 'RTK'] },
  { id: 'coeur_rtk',              name: 'Cœur de rumsteck',        category: 'premier',   yieldPct: 0, marketPrice: 24, group: ['ART8', 'BCUH', 'RTK'] },
  { id: 'langue_de_chat',         name: 'Langue de chat',          category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['ART8', 'BCUH', 'RTK'] },
  { id: 'baronne',                name: 'Aiguillette baronne',     category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['ART8', 'BCUH', 'RTK'] },
  { id: 'aiguillette_rtk',        name: 'Aiguillette de rumsteck', category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['ART8', 'BCUH', 'RTK'] },
  // ── DEHMT ──
  { id: 'faux_filet_b',           name: 'Faux-filet',              category: 'premier',   yieldPct: 0, marketPrice: 29, group: ['ART8', 'DEHMT'] },
  { id: 'filet_b',                name: 'Filet',                   category: 'premier',   yieldPct: 0, marketPrice: 45, group: ['ART8', 'DEHMT'] },
  { id: 'onglet_b',               name: 'Onglet',                  category: 'premier',   yieldPct: 0, marketPrice: 28, group: ['ART8', 'DEHMT'] },
  { id: 'chainette_filet',        name: 'Chaînette de filet',      category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['ART8', 'DEHMT'] },
  // DEHMT : Dessus de côte et Carré de côte, pièces directes (non dépliables)
  { id: 'dessus_de_cote',         name: 'Dessus de côte',          category: 'premier',   yieldPct: 0, marketPrice: 18, group: ['ART8', 'DEHMT'] },
  { id: 'carre_de_cote',          name: 'Carré de côte',           category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['ART8', 'DEHMT'] },
  // ── BAVETTE ──
  { id: 'flanchet',               name: 'Flanchet',                category: 'deuxieme',  yieldPct: 0, marketPrice: 12, group: ['ART8', 'BAVETTE'] },
  { id: 'bavette_aloyau_b',       name: "Bavette d'aloyau",        category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['ART8', 'BAVETTE'] },
  { id: 'fausse_bavette',         name: 'Fausse bavette',          category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['ART8', 'BAVETTE'] },
  // ── DIVERS (viandes de fabrication et sous-produits, toute la bête) ──
  { id: 'boeuf_viande_hachee',       name: 'Viande hachée',        category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['Divers'] },
  { id: 'boeuf_viandes_fabrication', name: 'Viandes fabrication',  category: 'troisieme', yieldPct: 0, marketPrice: 8,  group: ['Divers'] },
  { id: 'boeuf_dechets_animaux',     name: 'Déchets animaux',      category: 'troisieme', yieldPct: 0, marketPrice: 0,  group: ['Divers'] },
  { id: 'boeuf_os_a_moelle',         name: 'Os à moelle',          category: 'os',        yieldPct: 0, marketPrice: 3,  group: ['Divers'] },
]

// Découpe B2 — nomenclature CEFIMEV (avant du bœuf : épaule + collier basse-côte).
// Arborescence : grande pièce → sous-pièce. Prix de référence indicatifs, modifiables.
export const BOEUF_B2_CUTS: Cut[] = [
  // ── ÉPAULE (B 4.1) ──
  { id: 'b2_jarret_avant',      name: 'Jarret (avant)',          category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['AVANTCAPA', 'Épaule'] },
  { id: 'b2_boite_a_moelle',    name: 'Boîte à moelle',          category: 'deuxieme',  yieldPct: 0, marketPrice: 12, group: ['AVANTCAPA', 'Épaule'] },
  { id: 'b2_dessus_macreuse',   name: 'Dessus de macreuse',      category: 'premier',   yieldPct: 0, marketPrice: 19, group: ['AVANTCAPA', 'Épaule', 'Macreuse à biftecks'] },
  { id: 'b2_macreuse_roti',     name: 'Macreuse (rôti)',         category: 'premier',   yieldPct: 0, marketPrice: 18, group: ['AVANTCAPA', 'Épaule', 'Macreuse à biftecks'] },
  { id: 'b2_paleron',           name: 'Paleron',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['AVANTCAPA', 'Épaule'] },
  { id: 'b2_dessus_palette',    name: 'Dessus de palette',       category: 'deuxieme',  yieldPct: 0, marketPrice: 13, group: ['AVANTCAPA', 'Épaule'] },
  { id: 'b2_jumeau',            name: 'Jumeau',                  category: 'premier',   yieldPct: 0, marketPrice: 16, group: ['AVANTCAPA', 'Épaule'] },
  // ── COLLIER BASSE-CÔTE (B 4.2) ──
  { id: 'b2_persille',          name: 'Persillé',                category: 'deuxieme',  yieldPct: 0, marketPrice: 15, group: ['AVANTCAPA', 'Collier basse-côte', 'Basse côte'] },
  { id: 'b2_basse_cote',        name: 'Basse côte (entrecôte minute)', category: 'premier', yieldPct: 0, marketPrice: 17, group: ['AVANTCAPA', 'Collier basse-côte', 'Basse côte'] },
  { id: 'b2_veine_maigre',      name: 'Veine maigre',            category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['AVANTCAPA', 'Collier basse-côte', 'Collier'] },
  { id: 'b2_saliere',           name: 'Salière',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 13, group: ['AVANTCAPA', 'Collier basse-côte', 'Collier'] },
  { id: 'b2_veine_grasse',      name: 'Veine grasse',            category: 'deuxieme',  yieldPct: 0, marketPrice: 11, group: ['AVANTCAPA', 'Collier basse-côte', 'Collier'] },
  { id: 'b2_filet_mignon_col',  name: 'Filet mignon (de collier)', category: 'premier', yieldPct: 0, marketPrice: 14, group: ['AVANTCAPA', 'Collier basse-côte', 'Collier'] },
  // ── CAPA ──
  { id: 'capa_gros_bout_poitrine', name: 'Gros bout de poitrine sans os', category: 'troisieme', yieldPct: 0, marketPrice: 10, group: ['AVANTCAPA', 'CAPA'] },
  { id: 'capa_plat_de_capa',       name: 'Plat de capa',                  category: 'deuxieme',  yieldPct: 0, marketPrice: 12, group: ['AVANTCAPA', 'CAPA'] },
  { id: 'capa_hampe',              name: 'Hampe',                         category: 'premier',   yieldPct: 0, marketPrice: 24, group: ['AVANTCAPA', 'CAPA'] },
  { id: 'capa_fausse_hampe',       name: 'Fausse hampe',                  category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['AVANTCAPA', 'CAPA'] },
  { id: 'capa_plat_de_cote',       name: 'Plat de côte',                  category: 'troisieme', yieldPct: 0, marketPrice: 9,  group: ['AVANTCAPA', 'CAPA'] },
]

// Découpe veau en arborescence (planche fournie par le boucher) : Le pan (cuisseau + carré
// de côtes) et La basse (épaule, poitrine, bas de carré). Même mécanique que le bœuf : poids
// saisi manuellement ; marketPrice = prix de référence indicatif €/kg, modifiable par pièce.
export const VEAU_CUTS: Cut[] = [
  // ── LE PAN ──
  { id: 'veau_noix',                name: 'Noix',                          category: 'premier',   yieldPct: 0, marketPrice: 30, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_noix_patissiere',     name: 'Noix pâtissière',               category: 'premier',   yieldPct: 0, marketPrice: 32, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_sous_noix',           name: 'Sous-noix',                     category: 'premier',   yieldPct: 0, marketPrice: 28, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_quasi',               name: 'Quasi',                         category: 'premier',   yieldPct: 0, marketPrice: 30, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_tete_filet',          name: 'Tête de filet',                 category: 'premier',   yieldPct: 0, marketPrice: 34, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_jarret_cuisseau',     name: 'Jarret',                        category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_aiguillette_baronne', name: 'Aiguillette baronne',           category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['Le pan', 'Le cuisseau'] },
  { id: 'veau_cotes_filets',        name: 'Côtes filets',                  category: 'premier',   yieldPct: 0, marketPrice: 30, group: ['Le pan', 'Carré de côtes'] },
  { id: 'veau_cotes_premieres',     name: 'Côtes premières',               category: 'premier',   yieldPct: 0, marketPrice: 24, group: ['Le pan', 'Carré de côtes'] },
  // ── LA BASSE ──
  { id: 'veau_epaule_boule',        name: "Boule d'épaule",                category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['La basse', 'Épaule'] },
  { id: 'veau_epaule_paleron',      name: 'Paleron',                       category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['La basse', 'Épaule'] },
  { id: 'veau_epaule_jumeau',       name: 'Jumeau',                        category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['La basse', 'Épaule'] },
  { id: 'veau_epaule_boite_moelle', name: 'Boîte à moelle',                category: 'troisieme', yieldPct: 0, marketPrice: 12, group: ['La basse', 'Épaule'] },
  { id: 'veau_epaule_jarret_os',    name: 'Jarret avec os',                category: 'deuxieme',  yieldPct: 0, marketPrice: 17, group: ['La basse', 'Épaule'] },
  { id: 'veau_epaule_jarret_sans',  name: 'Jarret sans os',                category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['La basse', 'Épaule'] },
  { id: 'veau_poitrine_sans_os',    name: 'Poitrine sans os',              category: 'troisieme', yieldPct: 0, marketPrice: 14, group: ['La basse', 'Poitrine'] },
  { id: 'veau_tendrons',            name: 'Tendrons',                      category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['La basse', 'Poitrine'] },
  { id: 'veau_piece_paupiette',     name: 'Pièce à paupiette',             category: 'deuxieme',  yieldPct: 0, marketPrice: 22, group: ['La basse', 'Poitrine'] },
  { id: 'veau_bas_carre_roti',      name: 'Rôti',                          category: 'deuxieme',  yieldPct: 0, marketPrice: 18, group: ['La basse', 'Bas de carré'] },
  { id: 'veau_bas_carre_saute',     name: 'Sauté',                         category: 'troisieme', yieldPct: 0, marketPrice: 15, group: ['La basse', 'Bas de carré'] },
]

// Découpe agneau en arborescence (planche fournie par le boucher) : gigot, côtes, épaule,
// poitrine, collet. Même mécanique que le bœuf : poids saisi manuellement ; marketPrice =
// prix de référence indicatif €/kg, modifiable par pièce.
export const AGNEAU_CUTS: Cut[] = [
  // ── LE GIGOT ──
  { id: 'agneau_gigot_entier',    name: 'Gigot entier',                   category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['Le gigot'] },
  { id: 'agneau_souris',          name: 'Souris',                         category: 'deuxieme',  yieldPct: 0, marketPrice: 22, group: ['Le gigot'] },
  { id: 'agneau_gigot_sans_os',   name: 'Gigot sans os',                  category: 'premier',   yieldPct: 0, marketPrice: 24, group: ['Le gigot'] },
  { id: 'agneau_selle',           name: 'Selle',                          category: 'premier',   yieldPct: 0, marketPrice: 22, group: ['Le gigot'] },
  { id: 'agneau_gigot_raccourci', name: 'Gigot raccourci',                category: 'premier',   yieldPct: 0, marketPrice: 21, group: ['Le gigot'] },
  // ── CÔTES ──
  { id: 'agneau_cotes_filet',     name: 'Filet',                          category: 'premier',   yieldPct: 0, marketPrice: 26, group: ['Côtes'] },
  { id: 'agneau_cotes_prem_dec',  name: 'Côtes premières et découvertes', category: 'premier',   yieldPct: 0, marketPrice: 18, group: ['Côtes'] },
  // ── ÉPAULE ──
  { id: 'agneau_epaule_avec_os',  name: 'Avec os',                        category: 'deuxieme',  yieldPct: 0, marketPrice: 14, group: ['Épaule'] },
  { id: 'agneau_epaule_sans_os',  name: 'Sans os',                        category: 'deuxieme',  yieldPct: 0, marketPrice: 16, group: ['Épaule'] },
  // ── POITRINE ──
  { id: 'agneau_poitrine_avec_os', name: 'Avec os',                       category: 'troisieme', yieldPct: 0, marketPrice: 8,  group: ['Poitrine'] },
  { id: 'agneau_poitrine_sans_os', name: 'Sans os',                       category: 'troisieme', yieldPct: 0, marketPrice: 10, group: ['Poitrine'] },
  // ── VIANDES FABRICATION (pièces sans grande catégorie) ──
  { id: 'agneau_collet_avec_os',  name: 'Collet avec os',                 category: 'troisieme', yieldPct: 0, marketPrice: 9,  group: ['Viandes fabrication'] },
]

// Découpe porc en arborescence (planche fournie par le boucher) : Arrière (jambon, poitrine,
// carré/filet) et Avant (épaule, échine, divers). Même mécanique que le bœuf : poids saisi
// manuellement ; marketPrice = prix de référence indicatif €/kg, modifiable par pièce.
export const PORC_CUTS: Cut[] = [
  // ── ARRIÈRE ──
  { id: 'porc_jambon_avec_os',     name: 'Jambon avec os',                 category: 'premier',   yieldPct: 0, marketPrice: 8,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_4d',          name: 'Jambon 4D',                      category: 'premier',   yieldPct: 0, marketPrice: 9,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_jb_blanc',    name: 'Jambon pour jambon blanc',       category: 'premier',   yieldPct: 0, marketPrice: 9,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_pointe',      name: 'Pointe',                         category: 'deuxieme',  yieldPct: 0, marketPrice: 8,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_parure',      name: 'Parure',                         category: 'troisieme', yieldPct: 0, marketPrice: 4,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_jarret',      name: 'Jarret avec os',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 6,  group: ['Arrière', 'Jambon'] },
  { id: 'porc_jambon_araignee',    name: 'Araignée',                       category: 'premier',   yieldPct: 0, marketPrice: 12, group: ['Arrière', 'Jambon'] },
  { id: 'porc_poitrine_4f',        name: 'Poitrine 4F sans os',            category: 'deuxieme',  yieldPct: 0, marketPrice: 8,  group: ['Arrière', 'Poitrine'] },
  { id: 'porc_poitrine_parure',    name: 'Parure',                         category: 'troisieme', yieldPct: 0, marketPrice: 4,  group: ['Arrière', 'Poitrine'] },
  { id: 'porc_poitrine_mouille',   name: 'Mouille',                        category: 'troisieme', yieldPct: 0, marketPrice: 3,  group: ['Arrière', 'Poitrine'] },
  { id: 'porc_carre_roti_filet',   name: 'Rôti filet',                     category: 'premier',   yieldPct: 0, marketPrice: 13, group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_cotes',        name: 'Côtes',                          category: 'premier',   yieldPct: 0, marketPrice: 10, group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_parure',       name: 'Parure',                         category: 'troisieme', yieldPct: 0, marketPrice: 4,  group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_gras_dur',     name: 'Gras dur',                       category: 'troisieme', yieldPct: 0, marketPrice: 2,  group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_filet_mignon', name: 'Filet mignon',                   category: 'premier',   yieldPct: 0, marketPrice: 20, group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_grillade',     name: 'Grillade',                       category: 'premier',   yieldPct: 0, marketPrice: 11, group: ['Arrière', 'Carré / Filet'] },
  { id: 'porc_carre_gras',         name: 'Gras',                           category: 'troisieme', yieldPct: 0, marketPrice: 2,  group: ['Arrière', 'Carré / Filet'] },
  // ── AVANT ──
  { id: 'porc_epaule_avec_os',     name: 'Épaule avec os',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 8,  group: ['Avant', 'Épaule'] },
  { id: 'porc_epaule_sans_os',     name: 'Épaule sans os',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 9,  group: ['Avant', 'Épaule'] },
  { id: 'porc_echine_avec_os',     name: 'Échine avec os',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 9,  group: ['Avant', 'Échine'] },
  { id: 'porc_echine_sans_os',     name: 'Échine sans os',                 category: 'deuxieme',  yieldPct: 0, marketPrice: 11, group: ['Avant', 'Échine'] },
  { id: 'porc_divers_gorge',       name: 'Gorge',                          category: 'troisieme', yieldPct: 0, marketPrice: 4,  group: ['Avant', 'Divers'] },
  { id: 'porc_divers_joues',       name: 'Joues',                          category: 'abat',      yieldPct: 0, marketPrice: 12, group: ['Avant', 'Divers'] },
  { id: 'porc_divers_gras_dur',    name: 'Gras dur',                       category: 'troisieme', yieldPct: 0, marketPrice: 2,  group: ['Avant', 'Divers'] },
  { id: 'porc_divers_gras',        name: 'Gras',                           category: 'troisieme', yieldPct: 0, marketPrice: 2,  group: ['Avant', 'Divers'] },
  { id: 'porc_divers_parure',      name: 'Parure',                         category: 'troisieme', yieldPct: 0, marketPrice: 4,  group: ['Avant', 'Divers'] },
  { id: 'porc_divers_pieds',       name: 'Pieds',                          category: 'abat',      yieldPct: 0, marketPrice: 3,  group: ['Avant', 'Divers'] },
]

export const VOLAILLE_CUTS: Cut[] = [
  { id: 'blanc_volaille',   name: 'Blanc / Suprême',          category: 'premier',   yieldPct: 28,  marketPrice: 18 },
  { id: 'cuisse_entiere',   name: 'Cuisse entière',           category: 'premier',   yieldPct: 22,  marketPrice: 10 },
  { id: 'haut_cuisse',      name: 'Haut de cuisse',           category: 'premier',   yieldPct: 13,  marketPrice: 9  },
  { id: 'pilon',            name: 'Pilon',                    category: 'premier',   yieldPct: 9,   marketPrice: 7  },
  { id: 'aile_volaille',    name: 'Aile',                     category: 'deuxieme',  yieldPct: 10,  marketPrice: 7  },
  { id: 'foie_volaille',    name: 'Foie (lot)',               category: 'abat',      yieldPct: 1.5, marketPrice: 6  },
  { id: 'gesier_volaille',  name: 'Gésier',                   category: 'abat',      yieldPct: 1.5, marketPrice: 5  },
  { id: 'carcasse_bouillon',name: 'Carcasse / Bouillon',      category: 'os',        yieldPct: 15,  marketPrice: 1.5},
]
/** L'arbre complet du bœuf : l'arrière (ART8) et l'avant (AVANTCAPA) sont deux
 *  entrées dépliables du détail par pièce — une seule et même bête. */
export const BOEUF_ALL_CUTS: Cut[] = [...BOEUF_CUTS, ...BOEUF_B2_CUTS]

/** Les pièces de chaque espèce, au même endroit — c'est cette table que lit la
 *  chaîne des fiches recettes, qui n'a pas à connaître les noms de variables. */
export const CUTS_BY_ANIMAL: Record<AnimalType, Cut[]> = {
  boeuf: BOEUF_ALL_CUTS,
  veau: VEAU_CUTS,
  agneau: AGNEAU_CUTS,
  porc: PORC_CUTS,
  volaille: VOLAILLE_CUTS,
}

export const ANIMAL_TYPES: AnimalType[] = ['boeuf', 'veau', 'agneau', 'porc', 'volaille']

export const ANIMAL_LABELS: Record<AnimalType, string> = {
  boeuf: 'Bœuf', veau: 'Veau', agneau: 'Agneau', porc: 'Porc', volaille: 'Volaille',
}

/** Retrouve une pièce par son identifiant, toutes espèces confondues. */
export function cutById(id: string): Cut | null {
  for (const t of ANIMAL_TYPES) {
    const c = CUTS_BY_ANIMAL[t].find(x => x.id === id)
    if (c) return c
  }
  return null
}

// ─── Le moteur de répartition ─────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Ce qu'un morceau coûte, une fois la carcasse répartie. */
export type CoutMorceau = {
  cut_id: string
  nom: string
  categorie: CutCategory
  /** Poids saisi par le boucher pour cette pièce, en kg */
  kg: number
  /** Prix de référence retenu (surcharge du client comprise), €/kg */
  prix_ref_ht: number
  /** Coût de revient au kg. null : pas de prix de référence, donc pas de part
   *  de coût — on n'invente pas une valeur pour un morceau qu'on ne vend pas. */
  cout_kg_ht: number | null
  /** Coût de revient de toute la pièce (coût au kg × poids) */
  cout_total_ht: number
  /** Le coût du morceau rapporté au coût moyen du kilo commercial — la lecture
   *  « ×2,4 » du boucher. null quand l'un des deux manque. */
  coef: number | null
  /** Coût saisi à la main plutôt que calculé */
  force: boolean
}

/** La carcasse entière, répartie. */
export type RepartitionCarcasse = {
  /** Achat + frais + main-d'œuvre de découpe — le coût qu'on répartit */
  cout_total_ht: number
  /** Poids des pièces QUI SE VENDENT (celles qui ont un prix de référence) */
  kg_commercial: number
  /** Poids écarté faute de prix de référence — à ANNONCER à l'écran */
  kg_hors_commerce: number
  /** Le point d'ancrage : ce que revient le kilo commercial, toutes pièces
   *  confondues. null quand rien n'est vendable. */
  cout_moyen_kg_ht: number | null
  /** Σ (poids × prix de référence) — le dénominateur du prorata */
  valeur_marche_ht: number
  /** coût total ÷ valeur marché. null si la carcasse n'a aucune valeur connue. */
  coefficient: number | null
  morceaux: CoutMorceau[]
  /** Somme des coûts − coût de la carcasse. Vaut 0 tant qu'aucun coût n'est
   *  forcé ; sinon DOIT être écrit à l'écran. */
  ecart_forcage_ht: number
  nb_forces: number
}

/**
 * Répartit le coût d'une carcasse sur ses morceaux.
 *
 * `poids` est le `cut_weights` de la valorisation ({ cutId: kg }), `prixRef`
 * les prix de référence du client (ils l'emportent sur le `marketPrice` de la
 * nomenclature), `coutsForces` les coûts qu'il a saisis à la main.
 *
 * Rien n'est stocké : tout se recalcule de ce qui est déjà en base — les poids,
 * les prix de référence et le coût total de la carcasse. Un prix de référence
 * corrigé, et toutes les fiches qui utilisent ce morceau suivent.
 */
export function repartitionCarcasse(args: {
  cuts: Cut[]
  poids: Record<string, number> | null | undefined
  coutTotalHT: number
  prixRef?: Record<string, number | string> | null
  coutsForces?: Record<string, number | string> | null
}): RepartitionCarcasse {
  const { cuts, poids, coutTotalHT } = args
  const nombre = (v: unknown): number => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const prixDe = (c: Cut): number => {
    const surcharge = args.prixRef ? nombre(args.prixRef[c.id]) : 0
    return surcharge > 0 ? surcharge : nombre(c.marketPrice)
  }

  const lignes = cuts
    .map(c => ({ cut: c, kg: nombre(poids?.[c.id]), prix: prixDe(c) }))
    .filter(l => l.kg > 0)

  // Le kilo COMMERCIAL : seules les pièces qui se vendent. Les déchets animaux
  // (prix de référence 0) ne portent aucun coût — leur part se reporte sur le
  // reste, et leur poids est annoncé à part.
  const vendables = lignes.filter(l => l.prix > 0)
  const kgCommercial = round4(vendables.reduce((s, l) => s + l.kg, 0))
  const kgHors = round4(lignes.reduce((s, l) => s + l.kg, 0) - kgCommercial)
  const valeurMarche = round2(vendables.reduce((s, l) => s + l.kg * l.prix, 0))

  const coutTotal = nombre(coutTotalHT)
  const coefficient = valeurMarche > 0 && coutTotal > 0 ? coutTotal / valeurMarche : null
  const coutMoyenKg = kgCommercial > 0 && coutTotal > 0 ? round4(coutTotal / kgCommercial) : null

  let ecart = 0
  let nbForces = 0

  const morceaux: CoutMorceau[] = lignes.map(l => {
    const forceBrut = args.coutsForces ? nombre(args.coutsForces[l.cut.id]) : 0
    const force = forceBrut > 0
    // Un morceau sans prix de référence ne reçoit rien — sauf si le boucher a
    // explicitement chiffré son coût, auquel cas c'est SA valeur qui fait foi.
    const calcule = l.prix > 0 && coefficient !== null ? round4(l.prix * coefficient) : null
    const coutKg = force ? round4(forceBrut) : calcule
    const coutLigne = coutKg !== null ? round2(coutKg * l.kg) : 0
    if (force) {
      nbForces++
      ecart += coutLigne - (calcule !== null ? round2(calcule * l.kg) : 0)
    }
    return {
      cut_id: l.cut.id,
      nom: l.cut.name,
      categorie: l.cut.category,
      kg: l.kg,
      prix_ref_ht: l.prix,
      cout_kg_ht: coutKg,
      cout_total_ht: coutLigne,
      coef: coutKg !== null && coutMoyenKg !== null && coutMoyenKg > 0 ? round2(coutKg / coutMoyenKg) : null,
      force,
    }
  })

  return {
    cout_total_ht: round2(coutTotal),
    kg_commercial: kgCommercial,
    kg_hors_commerce: kgHors,
    cout_moyen_kg_ht: coutMoyenKg,
    valeur_marche_ht: valeurMarche,
    coefficient: coefficient !== null ? round4(coefficient) : null,
    morceaux,
    ecart_forcage_ht: round2(ecart),
    nb_forces: nbForces,
  }
}
