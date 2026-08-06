/**
 * LA DIRECTION ARTISTIQUE, EN COMPOSANTS.
 *
 * ─── POURQUOI UNE COUCHE, ET PAS UNE CONSIGNE ─────────────────────────────
 *
 * La charte PILOTE exigeait déjà « au moins un chiffre-héros contrasté » et
 * « une seule famille d'accent ». Le produit ne le faisait nulle part : sept
 * écrans sur sept alignaient des tuiles jumelles, et l'orange de marque
 * n'apparaissait que dix-sept fois dans tout le tableau de bord.
 *
 * Une charte qu'on doit se rappeler d'appliquer finit toujours par ne plus
 * l'être. Ces composants la portent : on ne peut plus dessiner une tuile sans
 * dire laquelle est la principale, ni afficher un rayon sans sa couleur.
 *
 * ─── LES CINQ RÈGLES, RENDUES INÉVITABLES ─────────────────────────────────
 *
 * 1. UN chiffre-roi par écran, en navy plein — `<TuileRoi>`. Le regard doit
 *    savoir où se poser en une seconde.
 * 2. L'orange ne sort que pour ce qui attend un geste — `<TuileAlerte>`. Un
 *    seul par écran. S'il n'y a rien à faire, il n'y a pas d'orange : cette
 *    absence est une information.
 * 3. Chaque rayon porte sa couleur, partout — `<PastilleRayon>`, via
 *    `lib/rayons`.
 * 4. Une donnée absente porte un nom — `<Absent>`. Un tiret gris ne dit pas si
 *    le chiffre est nul, non calculé, ou en attente.
 * 5. Le gris ne porte que le secondaire — acquis au lot 98, la palette elle-même
 *    l'impose.
 *
 * Aucune animation, aucun dégradé, aucune ombre portée ajoutée : PILOTE est un
 * outil de travail, pas une vitrine.
 */

import { type ReactNode } from 'react'
import Link from 'next/link'
import { rayon as trouverRayon, pastilleRayon } from '@/lib/rayons'

/** Le format des nombres du projet : espace fine, virgule, tabulaire. */
export const euros = (n: number, decimales = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + ' €'

/**
 * LE CHIFFRE-ROI. Un seul par écran.
 *
 * Fond navy plein : c'est le contraste de FOND, pas une police plus grosse, qui
 * fait qu'on le trouve sans chercher.
 *
 * Il y avait un halo orange en coin. À 15 % d'opacité sur du navy, il ne rendait
 * pas orange mais gris-mauve, avec un bord franc : ça se lisait comme un défaut
 * d'affichage, pas comme un motif. Retiré. Le navy plein suffit à faire la
 * hiérarchie — une décoration qu'on doit expliquer n'en est pas une.
 */
export function TuileRoi({
  label, valeur, detail, className = '',
}: { label: string; valeur: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-pilote p-5 shadow-card ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-pilote-200">{label}</p>
      {/* LE MONTANT NE SE COUPE JAMAIS DE SON UNITÉ. « −28 573,00 » sur une
          ligne et « € » sur la suivante : c'est le défaut du lot 102, revu à
          l'écran de trésorerie, où un solde négatif à cinq chiffres dépasse la
          largeur de la tuile. `nowrap` interdit le repli, et la taille fluide
          rétrécit le chiffre plutôt que de le laisser déborder. */}
      <p className="mt-0.5 whitespace-nowrap text-[clamp(1.5rem,2.4vw,1.875rem)] font-extrabold leading-tight tracking-tight text-white tabular">{valeur}</p>
      {detail && <p className="mt-1 text-[11px] text-pilote-200">{detail}</p>}
    </div>
  )
}

/** Une tuile ordinaire. Le filet du haut peut porter la couleur d'un rayon. */
export function Tuile({
  label, valeur, detail, filet, className = '',
}: { label: string; valeur: ReactNode; detail?: ReactNode; filet?: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-card ${filet ? `border-t-[3px] ${filet}` : ''} ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-encre-faible">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-[clamp(1.25rem,2vw,1.5rem)] font-extrabold leading-tight tracking-tight text-encre-fort tabular">{valeur}</p>
      {detail && <p className="mt-1 text-[11px] text-encre-faible">{detail}</p>}
    </div>
  )
}

/**
 * LA SEULE CHOSE QUI ATTEND UN GESTE.
 *
 * Un seul par écran, et seulement s'il y a vraiment quelque chose à faire —
 * `action` est obligatoire, car une alerte sans geste possible n'est pas une
 * alerte, c'est du bruit.
 */
export function TuileAlerte({
  label, valeur, action, href, className = '',
}: { label: string; valeur: ReactNode; action: string; href?: string; className?: string }) {
  const contenu = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9A4A00]">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-[clamp(1.25rem,2vw,1.5rem)] font-extrabold leading-tight tracking-tight text-[#9A4A00] tabular">{valeur}</p>
      {/* La flèche ne part JAMAIS seule à la ligne : « 14 facture(s) à pointer »
          puis « → » sur la ligne suivante, vu à l'écran de trésorerie. Le mot
          et la flèche qui le suit sont soudés par une espace insécable. */}
      <p className="mt-1 text-[11px] font-semibold text-[#9A4A00]">{action}&nbsp;→</p>
    </>
  )
  const classes = `block rounded-2xl border-t-[3px] border-pilote-orange bg-pilote-orange/[0.07] p-5 text-left shadow-card ${className}`
  // Un LIEN, pas un gestionnaire de clic : ces composants doivent rester
  // utilisables depuis un écran rendu côté serveur (les Marges en sont un), et
  // un vrai lien s'ouvre dans un onglet, se copie, et se parcourt au clavier.
  return href
    ? <Link href={href} className={`${classes} transition-colors hover:bg-pilote-orange/[0.12]`}>{contenu}</Link>
    : <div className={classes}>{contenu}</div>
}

/** La pastille d'un rayon — même teinte partout, via lib/rayons. */
export function PastilleRayon({ cle, libelle }: { cle: unknown; libelle?: string }) {
  const r = trouverRayon(cle)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${pastilleRayon(cle)}`}>
      {libelle ?? r?.label ?? String(cle ?? '—')}
    </span>
  )
}

/** Le filet vertical de couleur, en tête de ligne de tableau. */
export function FiletRayon({ cle }: { cle: unknown }) {
  const r = trouverRayon(cle)
  return (
    <span
      aria-hidden
      className={`mr-2 inline-block h-3.5 w-[3px] rounded-sm align-[-2px] ${r ? r.aplat : 'bg-trait'}`}
    />
  )
}

/**
 * UNE DONNÉE ABSENTE PORTE UN NOM.
 *
 * Un tiret gris ne dit pas si le chiffre est nul, non calculé, ou en attente
 * d'un geste. Trois causes opposées, un seul signe — et le boucher qui voit
 * « — » ne sait pas s'il doit s'inquiéter ou agir.
 *
 * `raison` est obligatoire. C'est tout l'objet du composant : on ne peut plus
 * afficher un silence.
 */
export function Absent({
  raison, explication,
}: { raison: string; explication?: string }) {
  return (
    /* `rounded-md` et non `rounded-full`, et surtout `whitespace-nowrap` : dans
       une colonne étroite, « à ventiler » se repliait sur deux lignes et la
       pastille ronde devenait un ovale gris illisible. Un état nommé qu'on ne
       lit pas ne vaut pas mieux que le tiret qu'il remplace. */
    <span
      className="inline-flex whitespace-nowrap items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-encre-doux"
      title={explication}
    >
      {raison}
    </span>
  )
}

/** L'en-tête discret d'une carte — un label, jamais un gros titre. */
export function TitreCarte({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-encre-faible">{children}</h3>
      {action}
    </div>
  )
}

/**
 * Un écart chiffré : la couleur ET le signe.
 *
 * Huit hommes sur cent ne distinguent pas le rouge du vert, et la boucherie est
 * un métier d'hommes. La flèche et le signe portent l'information ; la couleur
 * ne fait que la souligner.
 *
 * `bon` dit quel sens est favorable : une hausse de prix d'achat est mauvaise,
 * une hausse de marge est bonne. Sans ce réglage, le composant peindrait en
 * vert des nouvelles désagréables.
 */
export function Ecart({
  valeur, suffixe = ' %', bon = 'hausse', decimales = 1,
}: { valeur: number | null; suffixe?: string; bon?: 'hausse' | 'baisse'; decimales?: number }) {
  if (valeur === null || !Number.isFinite(valeur)) return <span className="text-trait">—</span>
  if (Math.abs(valeur) < 0.05) return <span className="text-encre-faible tabular">±0{suffixe}</span>
  const monte = valeur > 0
  const favorable = bon === 'hausse' ? monte : !monte
  const n = Math.abs(valeur).toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return (
    <span className={`font-bold tabular ${favorable ? 'text-etat-gain' : 'text-etat-perte'}`}>
      {monte ? '▲ +' : '▼ −'}{n}{suffixe}
    </span>
  )
}
