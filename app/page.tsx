import Link from 'next/link'
import { CheckCircle, FileText, Shield, TrendingUp, TrendingDown, Percent, CalendarDays, Receipt, LineChart, ArrowRight, Euro } from 'lucide-react'

const TREND_BARS = [42, 55, 48, 62, 58, 71, 66, 82]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/85 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none">
            PILOTE<span className="text-pilote-orange">.</span>
          </span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Connexion
            </Link>
            <Link href="/signup" className="text-sm font-semibold bg-pilote hover:bg-pilote-hover text-white rounded-lg px-4 h-9 inline-flex items-center transition-colors">
              Démarrer
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-16 lg:pt-36 lg:pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-pilote-50 text-pilote rounded-full px-3.5 py-1.5 text-[13px] font-semibold mb-6">
              <TrendingUp className="w-3.5 h-3.5" />
              Rapport automatique chaque lundi matin
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-5 text-balance">
              Pilotez votre commerce, chiffres en main
            </h1>
            <p className="text-lg text-gray-500 mb-8 max-w-[46ch]">
              Chaque lundi, PILOTE transforme vos ventes et vos factures en un rapport clair : marge, masse salariale, tendances et alertes.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/signup" className="inline-flex items-center justify-center gap-2 bg-pilote hover:bg-pilote-hover active:scale-[0.98] text-white font-semibold rounded-xl px-6 h-12 transition-all">
                Démarrer à 149 €/mois
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how-it-works" className="inline-flex items-center justify-center border border-gray-200 hover:border-pilote hover:text-pilote text-gray-700 font-semibold rounded-xl px-6 h-12 transition-colors">
                Voir comment ça marche
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-400">Sans engagement · Résiliable en un clic</p>
          </div>

          {/* Aperçu produit — mini-version réelle du tableau de bord */}
          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-tr from-pilote-50 via-white to-orange-50/60 rounded-[2rem] -z-10" aria-hidden="true" />
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-card-hover p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Semaine 27 · 29 juin – 5 juil.</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">Boucherie du Marché</p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">+6,4 % vs S26</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border border-gray-100 p-3.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded-md bg-pilote-50 flex items-center justify-center"><Euro className="w-3 h-3 text-pilote" /></div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">CA · S27</p>
                  </div>
                  <p className="text-xl font-bold tracking-tight text-gray-900">12 480 €</p>
                </div>
                <div className="rounded-xl border border-gray-100 p-3.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-5 h-5 rounded-md bg-green-50 flex items-center justify-center"><TrendingUp className="w-3 h-3 text-green-600" /></div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Marge brute</p>
                  </div>
                  <p className="text-xl font-bold tracking-tight text-green-600">38,2 %</p>
                </div>
              </div>
              <div className="flex items-end gap-1.5 h-16 mb-4 px-1">
                {TREND_BARS.map((h, i) => (
                  <div key={i} className={`flex-1 rounded-t-md ${i === TREND_BARS.length - 1 ? 'bg-pilote' : 'bg-pilote-100'}`} style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700">Masse salariale à 31 % du CA · dans la cible</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Métiers */}
      <section className="py-10 bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center gap-3">
          <p className="text-sm text-gray-500 mr-2">Conçu pour les artisans :</p>
          {['Boucherie', 'Charcuterie', 'Traiteur', 'Boulangerie', 'Épicerie fine'].map(m => (
            <span key={m} className="text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-full px-4 py-1.5">{m}</span>
          ))}
        </div>
      </section>

      {/* Features — le produit réel */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-3">
            Tout le pilotage, sans tableur
          </h2>
          <p className="text-gray-500 mb-12 max-w-[55ch]">
            Vos données de caisse, vos factures et votre planning réunis au même endroit, analysés chaque semaine.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 rounded-2xl bg-pilote text-white p-7 flex flex-col justify-between min-h-[220px]">
              <FileText className="w-7 h-7 text-pilote-orange mb-6" />
              <div>
                <h3 className="text-xl font-bold tracking-tight mb-2">Rapport hebdomadaire automatique</h3>
                <p className="text-white/70 text-sm leading-relaxed max-w-[52ch]">Chaque lundi matin, 7 pages d'analyse dans votre boîte mail : chiffre d'affaires, marges, top et flop produits, synthèse de la semaine.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200/80 bg-white shadow-card p-7">
              <Percent className="w-6 h-6 text-pilote mb-5" />
              <h3 className="font-bold text-gray-900 mb-2">Marges par rayon</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Boucherie, charcuterie, traiteur : la marge matière réelle, lissée sur 4 semaines.</p>
            </div>
            <div className="rounded-2xl border border-gray-200/80 bg-white shadow-card p-7">
              <CalendarDays className="w-6 h-6 text-pilote mb-5" />
              <h3 className="font-bold text-gray-900 mb-2">Planning et coût CCN 992</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Heures sup, majorations dimanche et férié, alertes légales : la masse salariale au réel.</p>
            </div>
            <div className="rounded-2xl border border-gray-200/80 bg-white shadow-card p-7">
              <Receipt className="w-6 h-6 text-pilote mb-5" />
              <h3 className="font-bold text-gray-900 mb-2">Factures synchronisées</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Pennylane, Sage, Cegid, EBP : vos achats importés et catégorisés automatiquement.</p>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-7">
              <div className="flex items-center gap-3 mb-5">
                <LineChart className="w-6 h-6 text-pilote" />
                <TrendingDown className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="font-bold text-gray-900 mb-2">Tendances produits</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Ce qui monte, ce qui décroche, semaine après semaine, produit par produit.</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2.5 text-sm text-gray-400">
            <Shield className="w-4 h-4 flex-shrink-0" />
            Données chiffrées, hébergées en Europe, conformes RGPD.
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-12">Comment ça marche</h2>
          <div className="space-y-0">
            {[
              { icon: CheckCircle, title: 'Créez votre compte', desc: 'Paiement sécurisé Stripe, deux minutes, sans engagement.' },
              { icon: Receipt, title: 'Connectez vos outils', desc: 'Votre logiciel comptable pour les achats, votre CA hebdomadaire pour les ventes.' },
              { icon: FileText, title: 'Recevez vos analyses', desc: 'Le rapport arrive chaque lundi, le tableau de bord reste à jour toute la semaine.' },
            ].map((s, i, arr) => (
              <div key={s.title} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0">
                    <s.icon className="w-5 h-5 text-pilote" />
                  </div>
                  {i < arr.length - 1 && <div className="w-px flex-1 bg-gray-200 my-2" />}
                </div>
                <div className={i < arr.length - 1 ? 'pb-10' : ''}>
                  <h3 className="text-lg font-bold tracking-tight text-gray-900 mb-1">{s.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-3">Une offre simple</h2>
          <p className="text-gray-500 mb-12">Tout inclus, sans surprise.</p>
          <div className="rounded-2xl border-2 border-pilote bg-white shadow-card-hover p-8 relative text-left">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pilote-orange text-white text-xs font-bold px-3 py-1 rounded-full">
              Offre unique
            </div>
            <div className="text-center mb-8">
              <div className="text-5xl font-extrabold tracking-tight text-gray-900 tabular">149 €</div>
              <div className="text-gray-500 mt-1">par mois, HT</div>
            </div>
            <ul className="space-y-3 mb-8">
              {[
                'Rapport d’analyse chaque lundi matin',
                'Tableau de bord : marges, tendances, planning',
                'Synchronisation de vos factures d’achat',
                'Alertes légales CCN 992 incluses',
                'Support par email sous 24 h',
                'Résiliation sans engagement',
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-gray-700">
                  <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="flex items-center justify-center gap-2 w-full bg-pilote hover:bg-pilote-hover active:scale-[0.99] text-white font-semibold rounded-xl h-12 transition-all">
              Démarrer maintenant
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-100 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span className="text-[13px] font-extrabold tracking-[0.22em] text-pilote">PILOTE<span className="text-pilote-orange">.</span></span>
          <span>© {new Date().getFullYear()} PILOTE. Tous droits réservés.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-700 transition-colors">Mentions légales</a>
            <a href="#" className="hover:text-gray-700 transition-colors">CGV</a>
            <a href="mailto:nouvion.theo51@gmail.com" className="hover:text-gray-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
