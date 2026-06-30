import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BarChart3, CheckCircle, Clock, FileText, Shield, TrendingUp } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-blue-600">PILOTE</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
              Connexion
            </Link>
            <Button asChild size="sm">
              <Link href="/signup">Démarrer</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 rounded-full px-4 py-1.5 text-sm font-medium mb-6">
            <TrendingUp className="w-4 h-4" />
            Analyses automatisées chaque semaine
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 leading-tight mb-6">
            Pilotez votre commerce
            <span className="text-blue-600"> avec les données</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 max-w-2xl mx-auto">
            PILOTE génère chaque semaine une analyse comparative de votre activité.
            Comprenez vos tendances, comparez vos performances, prenez de meilleures décisions.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg">
              <Link href="/signup">Commencer à 149€/mois</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a href="#how-it-works">Voir comment ça marche</a>
            </Button>
          </div>
          <p className="mt-4 text-sm text-gray-400">Sans engagement · Résiliable en un clic</p>
        </div>
      </section>

      {/* Social proof */}
      <section className="py-12 bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500 mb-8">Ils pilotent leur activité avec PILOTE</p>
          <div className="flex flex-wrap justify-center gap-8 text-gray-400 font-medium text-sm">
            <span>Boucherie Dupont — Lyon</span>
            <span>Boulangerie Martin — Bordeaux</span>
            <span>Poissonnerie Leblanc — Nantes</span>
            <span>Epicerie Moreau — Lille</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Tout ce dont vous avez besoin pour piloter
          </h2>
          <p className="text-center text-gray-500 mb-16 max-w-xl mx-auto">
            Une seule plateforme, des insights actionnables chaque semaine.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: BarChart3,
                title: 'Analyse comparative',
                desc: "Comparez vos performances avec les tendances du secteur. Identifiez vos points forts et axes d'amélioration.",
              },
              {
                icon: Clock,
                title: 'Livraison automatique',
                desc: 'Chaque lundi matin, votre rapport est dans votre boite mail. Zéro effort, 100% actionnable.',
              },
              {
                icon: FileText,
                title: 'Rapports clairs',
                desc: 'Des tableaux de bord visuels conçus pour les non-experts. Pas de jargon, des décisions éclairées.',
              },
              {
                icon: TrendingUp,
                title: 'Suivi des tendances',
                desc: 'Visualisez votre évolution semaine après semaine. Détectez les anomalies avant quelles deviennent des problèmes.',
              },
              {
                icon: Shield,
                title: 'Données sécurisées',
                desc: 'Vos données sont chiffrées et stockées en Europe. Conformité RGPD garantie.',
              },
              {
                icon: CheckCircle,
                title: 'Sans engagement',
                desc: 'Résiliez quand vous voulez depuis votre espace client en un seul clic. Aucune pénalité.',
              },
            ].map((f) => (
              <Card key={f.title} className="p-6">
                <CardContent className="p-0">
                  <f.icon className="w-8 h-8 text-blue-600 mb-4" />
                  <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-gray-500 text-sm">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-16">Comment ca marche</h2>
          <div className="space-y-12">
            {[
              {
                step: '01',
                title: 'Souscrivez en ligne',
                desc: 'Créez votre compte et activez votre abonnement via notre paiement sécurisé Stripe.',
              },
              {
                step: '02',
                title: 'Configurez votre profil',
                desc: 'Renseignez votre commerce (nom, ville, email) et connectez votre dossier Google Drive.',
              },
              {
                step: '03',
                title: 'Recevez vos analyses',
                desc: 'Chaque semaine, votre rapport arrive automatiquement. Consultez-le en ligne ou téléchargez-le.',
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-8 items-start">
                <span className="text-4xl font-bold text-blue-100 shrink-0 w-16">{s.step}</span>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Une offre simple</h2>
          <p className="text-gray-500 mb-12">Tout inclus, sans surprise.</p>
          <Card className="p-8 border-2 border-blue-600 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-medium px-3 py-1 rounded-full">
              Offre unique
            </div>
            <CardContent className="p-0">
              <div className="text-5xl font-bold text-gray-900 mb-1">149€</div>
              <div className="text-gray-500 mb-8">par mois, HT</div>
              <ul className="space-y-3 text-left mb-8">
                {[
                  'Analyse comparative hebdomadaire',
                  'Livraison par email chaque lundi',
                  'Acces a tous vos rapports en ligne',
                  'Support par email sous 24h',
                  'Resiliation sans engagement',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-gray-700">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="w-full">
                <Link href="/signup">Demarrer maintenant</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-100 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span className="font-semibold text-blue-600">PILOTE</span>
          <span>© {new Date().getFullYear()} PILOTE. Tous droits reserves.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-700">Mentions légales</a>
            <a href="#" className="hover:text-gray-700">CGV</a>
            <a href="#" className="hover:text-gray-700">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
