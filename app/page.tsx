import Link from 'next/link'
import { CheckCircle, FileText, Shield, TrendingUp, TrendingDown, Percent, CalendarDays, Receipt, LineChart, ArrowUpRight, Euro } from 'lucide-react'

const TREND_BARS = [42, 55, 48, 62, 58, 71, 66, 82]
const METIERS = ['Boucherie', 'Charcuterie', 'Traiteur', 'Boulangerie', 'Épicerie fine']

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-white overflow-x-hidden">
      {/* Nav — îlot flottant détaché */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 pt-4">
        <div className="max-w-5xl mx-auto h-14 pl-5 pr-3 flex items-center justify-between rounded-full bg-white/80 backdrop-blur-xl border border-gray-100 shadow-card">
          <span className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none">
            PILOTE<span className="text-pilote-orange">.</span>
          </span>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-3 py-2">
              Connexion
            </Link>
            <Link href="/signup" className="group inline-flex items-center gap-2 text-sm font-semibold bg-pilote hover:bg-pilote-hover text-white rounded-full pl-4 pr-1.5 h-10 transition-all active:scale-[0.98]">
              Démarrer
              <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — split éditorial */}
      <section className="relative pt-32 pb-20 lg:pt-44 lg:pb-28 px-4 sm:px-6 lg:px-8">
        {/* voile de fond très subtil, navy diffus */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] -z-10 bg-[radial-gradient(60%_80%_at_70%_0%,rgba(30,58,95,0.06),transparent_70%)]" aria-hidden="true" />
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-16 items-center">
          <div>
            <div className="reveal-up inline-flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 bg-pilote-50 border border-pilote-100 mb-7" style={{ animationDelay: '40ms' }}>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white shadow-card">
                <TrendingUp className="w-3.5 h-3.5 text-pilote" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-pilote">Chaque lundi, 8 h</span>
            </div>
            <h1 className="reveal-up text-[2.6rem] sm:text-6xl font-extrabold tracking-[-0.03em] text-pilote-800 leading-[1.02] mb-6 text-balance" style={{ animationDelay: '120ms' }}>
              Pilotez votre commerce,<br className="hidden sm:block" /> <span className="text-pilote">chiffres en main.</span>
            </h1>
            <p className="reveal-up text-lg text-gray-500 mb-9 max-w-[44ch] leading-relaxed" style={{ animationDelay: '200ms' }}>
              PILOTE transforme vos ventes et vos factures en une analyse claire : marge, masse salariale, tendances et alertes. Sans tableur, sans y penser.
            </p>
            <div className="reveal-up flex flex-col sm:flex-row gap-3" style={{ animationDelay: '280ms' }}>
              <Link href="/signup" className="group inline-flex items-center gap-3 bg-pilote hover:bg-pilote-hover text-white font-semibold rounded-full pl-6 pr-2 h-12 transition-all active:scale-[0.98] shadow-card">
                Démarrer à 149 €/mois
                <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </Link>
              <a href="#how-it-works" className="inline-flex items-center justify-center border border-gray-200 hover:border-pilote hover:text-pilote text-gray-700 font-semibold rounded-full px-6 h-12 transition-colors">
                Comment ça marche
              </a>
            </div>
            <p className="reveal-up mt-5 text-sm text-gray-400" style={{ animationDelay: '340ms' }}>Sans engagement · Résiliable en un clic</p>
          </div>

          {/* Aperçu produit — double-bezel (plaque dans son support) */}
          <div className="reveal-up relative" style={{ animationDelay: '260ms' }}>
            <div className="rounded-[28px] bg-pilote-50/70 ring-1 ring-pilote-100 p-2 shadow-card-hover">
              <div className="bg-white rounded-[20px] border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Semaine 27 · 29 juin – 5 juil.</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">Boucherie du Marché</p>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-700 tabular">+6,4 % vs S26</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-2xl bg-pilote p-3.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center"><Euro className="w-3 h-3 text-white" /></div>
                      <p className="text-[10px] font-semibold text-pilote-200 uppercase tracking-wider">CA · S27</p>
                    </div>
                    <p className="text-xl font-extrabold tracking-tight text-white tabular">12 480 €</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 p-3.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-5 h-5 rounded-md bg-green-50 flex items-center justify-center"><TrendingUp className="w-3 h-3 text-green-600" /></div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Marge brute</p>
                    </div>
                    <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular">38,2 %</p>
                  </div>
                </div>
                <div className="flex items-end gap-1.5 h-16 mb-4 px-1">
                  {TREND_BARS.map((h, i) => (
                    <div key={i} className={`flex-1 rounded-t-md ${i === TREND_BARS.length - 1 ? 'bg-pilote-orange' : 'bg-pilote-100'}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">Masse salariale à 31 % du CA · dans la cible</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Métiers */}
      <section className="py-10 border-y border-gray-100 bg-gray-50/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center gap-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 mr-2">Conçu pour les artisans</p>
          {METIERS.map(m => (
            <span key={m} className="text-sm font-semibold text-gray-700 bg-white border border-gray-100 shadow-card rounded-full px-4 py-1.5">{m}</span>
          ))}
        </div>
      </section>

      {/* Features — bento éditorial */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <span className="inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-pilote bg-pilote-50 mb-5">Le produit</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.02em] text-pilote-800 mb-4 max-w-[18ch] text-balance">
            Tout le pilotage, sans le tableur
          </h2>
          <p className="text-gray-500 mb-12 max-w-[55ch] text-lg leading-relaxed">
            Vos données de caisse, vos factures et votre planning réunis au même endroit, analysés chaque semaine.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
            <div className="md:col-span-2 rounded-[26px] bg-pilote text-white p-8 flex flex-col justify-between min-h-[240px] shadow-card-hover">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-pilote-orange" />
              </div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight mb-2.5">Rapport hebdomadaire automatique</h3>
                <p className="text-pilote-200 text-sm leading-relaxed max-w-[52ch]">Chaque lundi matin, 7 pages d'analyse dans votre boîte mail : chiffre d'affaires, marges, top et flop produits, synthèse de la semaine.</p>
              </div>
            </div>
            <div className="rounded-[26px] border border-gray-100 bg-white shadow-card p-7 hover:shadow-card-hover transition-shadow">
              <div className="w-11 h-11 rounded-2xl bg-pilote-50 flex items-center justify-center mb-6"><Percent className="w-5 h-5 text-pilote" /></div>
              <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Marges par rayon</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Boucherie, charcuterie, traiteur : la marge matière réelle, lissée sur 4 semaines.</p>
            </div>
            <div className="rounded-[26px] border border-gray-100 bg-white shadow-card p-7 hover:shadow-card-hover transition-shadow">
              <div className="w-11 h-11 rounded-2xl bg-pilote-50 flex items-center justify-center mb-6"><CalendarDays className="w-5 h-5 text-pilote" /></div>
              <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Planning &amp; coût CCN 992</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Heures sup, majorations dimanche et férié, alertes légales : la masse salariale au réel.</p>
            </div>
            <div className="rounded-[26px] border border-gray-100 bg-white shadow-card p-7 hover:shadow-card-hover transition-shadow">
              <div className="w-11 h-11 rounded-2xl bg-pilote-50 flex items-center justify-center mb-6"><Receipt className="w-5 h-5 text-pilote" /></div>
              <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Factures synchronisées</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Pennylane, Sage, Cegid, EBP : vos achats importés et catégorisés automatiquement.</p>
            </div>
            <div className="md:col-span-2 rounded-[26px] bg-gray-50 border border-gray-100 p-7 flex items-center gap-6">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-11 h-11 rounded-2xl bg-white shadow-card flex items-center justify-center"><LineChart className="w-5 h-5 text-pilote" /></div>
                <TrendingDown className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Tendances produits</h3>
                <p className="text-gray-500 text-sm leading-relaxed max-w-[52ch]">Ce qui monte, ce qui décroche, semaine après semaine, produit par produit — avec l'analyse 20/80 par famille.</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2.5 text-sm text-gray-400">
            <Shield className="w-4 h-4 flex-shrink-0 text-pilote" />
            Données chiffrées, hébergées en Europe, conformes RGPD.
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8 bg-gray-50/60 border-y border-gray-100">
        <div className="max-w-3xl mx-auto">
          <span className="inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-pilote bg-white shadow-card mb-5">3 étapes</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.02em] text-pilote-800 mb-12">Comment ça marche</h2>
          <div className="space-y-0">
            {[
              { icon: CheckCircle, title: 'Créez votre compte', desc: 'Paiement sécurisé Stripe, deux minutes, sans engagement.' },
              { icon: Receipt, title: 'Connectez vos outils', desc: 'Votre logiciel comptable pour les achats, votre CA hebdomadaire pour les ventes.' },
              { icon: FileText, title: 'Recevez vos analyses', desc: 'Le rapport arrive chaque lundi, le tableau de bord reste à jour toute la semaine.' },
            ].map((s, i, arr) => (
              <div key={s.title} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="w-11 h-11 rounded-2xl bg-white shadow-card flex items-center justify-center flex-shrink-0">
                    <s.icon className="w-5 h-5 text-pilote" />
                  </div>
                  {i < arr.length - 1 && <div className="w-px flex-1 bg-gray-200 my-2" />}
                </div>
                <div className={i < arr.length - 1 ? 'pb-10' : ''}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-bold text-pilote-200 tabular">0{i + 1}</span>
                    <h3 className="text-lg font-bold tracking-tight text-gray-900">{s.title}</h3>
                  </div>
                  <p className="text-gray-500 text-sm leading-relaxed mt-1">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-lg mx-auto text-center">
          <span className="inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-pilote bg-pilote-50 mb-5">Tarif</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.02em] text-pilote-800 mb-3">Une offre simple</h2>
          <p className="text-gray-500 mb-12 text-lg">Tout inclus, sans surprise.</p>
          <div className="rounded-[28px] bg-pilote-50/70 ring-1 ring-pilote-100 p-2 shadow-card-hover">
            <div className="rounded-[20px] border border-gray-100 bg-white p-8 relative text-left">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-pilote-orange text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-card">
                Offre unique
              </div>
              <div className="text-center mb-8">
                <div className="text-6xl font-extrabold tracking-[-0.03em] text-pilote-800 tabular">149 €</div>
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
                    <span className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0"><CheckCircle className="w-3.5 h-3.5 text-green-600" /></span>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="group flex items-center justify-center gap-3 w-full bg-pilote hover:bg-pilote-hover active:scale-[0.99] text-white font-semibold rounded-full h-12 transition-all shadow-card">
                Démarrer maintenant
                <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-100 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span className="text-[13px] font-extrabold tracking-[0.22em] text-pilote">PILOTE<span className="text-pilote-orange">.</span></span>
          <span>© {new Date().getFullYear()} PILOTE. Tous droits réservés.</span>
          <div className="flex gap-6">
            <Link href="/mentions-legales" className="hover:text-gray-700 transition-colors">Mentions légales</Link>
            <Link href="/cgv" className="hover:text-gray-700 transition-colors">CGV</Link>
            <a href="mailto:nouvion.theo51@gmail.com" className="hover:text-gray-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
