// Skeleton affiché pendant le chargement des pages serveur du dashboard
// (dashboard, marges, tendances, rapports…) — évite l'impression de navigation figée
export default function DashboardLoading() {
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto animate-pulse" aria-busy="true" aria-label="Chargement">
      {/* En-tête */}
      <div className="mb-8">
        <div className="h-7 w-64 bg-gray-200 rounded-lg mb-2.5" />
        <div className="h-4 w-96 max-w-full bg-gray-100 rounded" />
      </div>

      {/* Rangée de KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
            <div className="h-3 w-20 bg-gray-100 rounded mb-4" />
            <div className="h-7 w-24 bg-gray-200 rounded" />
            <div className="h-3 w-16 bg-gray-100 rounded mt-2.5" />
          </div>
        ))}
      </div>

      {/* Bloc principal */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5 mb-6">
        <div className="h-4 w-44 bg-gray-100 rounded mb-5" />
        <div className="space-y-3">
          <div className="h-10 bg-gray-50 rounded-lg" />
          <div className="h-10 bg-gray-50 rounded-lg" />
          <div className="h-10 bg-gray-50 rounded-lg" />
          <div className="h-10 bg-gray-50 rounded-lg" />
        </div>
      </div>

      {/* Bloc secondaire */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
          <div className="h-4 w-36 bg-gray-100 rounded mb-5" />
          <div className="h-32 bg-gray-50 rounded-lg" />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
          <div className="h-4 w-36 bg-gray-100 rounded mb-5" />
          <div className="h-32 bg-gray-50 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
