// Skeleton affiché pendant le chargement des pages serveur de l'espace admin
export default function AdminLoading() {
  return (
    <div className="p-8 max-w-5xl animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="mb-8">
        <div className="h-7 w-48 bg-gray-200 rounded-lg mb-2.5" />
        <div className="h-4 w-64 bg-gray-100 rounded" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="h-10 bg-gray-50 border-b border-gray-100" />
        <div className="divide-y divide-gray-100">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
              <div className="flex-1">
                <div className="h-4 w-40 bg-gray-100 rounded mb-2" />
                <div className="h-3 w-56 bg-gray-50 rounded" />
              </div>
              <div className="h-6 w-20 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
