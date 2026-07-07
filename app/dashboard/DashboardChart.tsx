'use client'

type Segment = { label: string; value: number; color: string }

export function DonutChart({ segments, total }: { segments: Segment[]; total: number }) {
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Aucune donnée cette semaine
      </div>
    )
  }

  const r = 68
  const cx = 100
  const cy = 95
  const strokeWidth = 28
  const circumference = 2 * Math.PI * r

  const activeSegments = segments.filter((s) => s.value > 0)
  let accumulated = 0
  const slices = activeSegments.map((seg) => {
    const pct = seg.value / total
    const dash = pct * circumference
    const slice = { ...seg, dash, offset: accumulated, pct }
    accumulated += dash
    return slice
  })

  const fmt = (n: number) =>
    n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width="200" height="190" viewBox="0 0 200 190">
        {slices.map((s, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fontSize="10"
          fill="#9ca3af"
        >
          CA semaine
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="18"
          fontWeight="bold"
          fill="#111827"
        >
          {fmt(total)} €
        </text>
      </svg>

      <div className="w-full grid grid-cols-2 gap-x-4 gap-y-2">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-gray-600 flex-1">{s.label}</span>
            <span className="text-xs font-semibold text-gray-900">
              {Math.round(s.pct * 100)} %
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
