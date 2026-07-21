import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata = { title: 'Mentions légales — PILOTE' }

/** Page légale statique — les champs entre crochets sont à compléter par l'éditeur. */
export default function MentionsLegalesPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none">
            PILOTE<span className="text-pilote-orange">.</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
            <ArrowLeft className="w-4 h-4" />Retour à l&apos;accueil
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-10">Mentions légales</h1>

        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Éditeur du site</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Le site PILOTE est édité par [Nom / forme juridique de la société], au capital de [capital social] €,
            immatriculée au RCS de [ville] sous le numéro [SIRET], dont le siège social est situé [adresse complète].
            <br />Directeur de la publication : [Nom du dirigeant].
            <br />Contact : <a href="mailto:nouvion.theo51@gmail.com" className="text-pilote underline">nouvion.theo51@gmail.com</a>
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Hébergement</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            L&apos;application est hébergée par Vercel Inc. (440 N Barranca Ave #4133, Covina, CA 91723, États-Unis —
            vercel.com). Les données sont stockées par Supabase (supabase.com) sur des serveurs situés dans
            l&apos;Union européenne (région eu-west-1, Irlande).
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Propriété intellectuelle</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            L&apos;ensemble des éléments du site (marque, textes, interfaces, logiciels) est protégé par le droit de la
            propriété intellectuelle. Toute reproduction, représentation ou exploitation, totale ou partielle, sans
            autorisation écrite préalable de l&apos;éditeur est interdite.
          </p>
        </section>

        <section className="mb-10" id="confidentialite">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Données personnelles (RGPD)</h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            PILOTE traite des données professionnelles pour le compte de ses clients (données de ventes, factures
            fournisseurs, plannings et informations des employés) dans le seul but de fournir le service : rapports
            d&apos;analyse hebdomadaires, tableau de bord, planning et envoi des plannings par email. Base légale :
            l&apos;exécution du contrat.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            Les données sont conservées pendant la durée de l&apos;abonnement, puis supprimées dans un délai de 90 jours
            après résiliation. Elles ne sont ni vendues ni transmises à des tiers en dehors des sous-traitants
            techniques nécessaires au service (hébergement, envoi d&apos;emails, extraction automatisée de factures),
            chacun lié par un accord de traitement des données.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d&apos;un droit d&apos;accès, de
            rectification, d&apos;effacement, de portabilité et d&apos;opposition sur vos données. Pour l&apos;exercer,
            écrivez à <a href="mailto:nouvion.theo51@gmail.com" className="text-pilote underline">nouvion.theo51@gmail.com</a>.
            Vous pouvez également saisir la CNIL (cnil.fr) si vous estimez que vos droits ne sont pas respectés.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Cookies</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            PILOTE n&apos;utilise que des cookies strictement nécessaires au fonctionnement du service
            (authentification de session). Aucun cookie publicitaire ou de suivi tiers n&apos;est déposé.
          </p>
        </section>

        <p className="text-xs text-gray-400 border-t border-gray-100 pt-6">
          Voir aussi : <Link href="/cgv" className="text-pilote underline">Conditions générales de vente</Link>
        </p>
      </main>
    </div>
  )
}
