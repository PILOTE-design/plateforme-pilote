import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata = { title: 'Conditions générales de vente — PILOTE' }

/** CGV de l'abonnement SaaS — les champs entre crochets sont à compléter par l'éditeur. */
export default function CgvPage() {
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
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-3">Conditions générales de vente</h1>
        <p className="text-sm text-gray-400 mb-10">Applicables à compter du 21 juillet 2026.</p>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">1. Objet</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Les présentes conditions régissent l&apos;abonnement au service PILOTE, plateforme d&apos;analyse et de
            pilotage destinée aux commerces artisanaux (boucheries, charcuteries, traiteurs…), édité par
            [Nom / forme juridique de la société]. Le service comprend notamment : rapport d&apos;analyse hebdomadaire,
            tableau de bord (marges, tendances), gestion du planning et suivi des achats. Le service s&apos;adresse
            exclusivement à des professionnels.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">2. Prix et facturation</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            L&apos;abonnement est facturé 149 € HT par mois, payable mensuellement d&apos;avance par carte bancaire via
            notre prestataire de paiement sécurisé. Les prix peuvent être révisés ; tout changement est notifié au
            moins 30 jours avant son application et n&apos;affecte pas la période déjà réglée.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">3. Durée et résiliation</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            L&apos;abonnement est sans engagement, reconduit tacitement chaque mois. Le client peut résilier à tout
            moment depuis son espace ou par email ; la résiliation prend effet à la fin de la période mensuelle en
            cours, sans remboursement prorata. Les données du client restent exportables pendant 90 jours après la
            résiliation, puis sont supprimées.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">4. Obligations et disponibilité</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            PILOTE s&apos;engage à fournir le service avec diligence et à répondre aux demandes de support par email
            sous 24 h ouvrées. Le service est fourni « en l&apos;état » ; des interruptions ponctuelles de maintenance
            peuvent survenir. Les analyses produites sont des aides à la décision établies à partir des données
            transmises par le client : elles ne constituent ni un conseil comptable, ni un conseil juridique, et ne se
            substituent pas à l&apos;expert-comptable du client. Le client reste responsable de l&apos;exactitude des
            données qu&apos;il fournit ou connecte.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">5. Responsabilité</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            La responsabilité de l&apos;éditeur, toutes causes confondues, est limitée au montant des sommes versées par
            le client au titre des douze derniers mois d&apos;abonnement. L&apos;éditeur ne saurait être tenu responsable
            des décisions de gestion prises par le client sur la base des analyses fournies, ni des dommages indirects.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">6. Données</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Les données transmises restent la propriété du client. Leur traitement est décrit dans les{' '}
            <Link href="/mentions-legales#confidentialite" className="text-pilote underline">mentions légales
            (section Données personnelles)</Link>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">7. Droit applicable</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Les présentes conditions sont soumises au droit français. À défaut d&apos;accord amiable, tout litige sera
            porté devant le tribunal de commerce de [ville du siège].
          </p>
        </section>

        <p className="text-xs text-gray-400 border-t border-gray-100 pt-6">
          Voir aussi : <Link href="/mentions-legales" className="text-pilote underline">Mentions légales</Link>
        </p>
      </main>
    </div>
  )
}
