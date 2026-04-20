import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type TicketMonthlyAnalyticsPayload } from '@/lib/api'
import { useMemo } from 'react'

interface MonthlyAnalyticsProps {
  analytics?: TicketMonthlyAnalyticsPayload
  isLoading?: boolean
}

interface MetricCardProps {
  label: string
  value: number
  tone: string
}

interface MonthlyChartPoint {
  month: string
  label: string
  opened: number
  resolved: number
  breached: number
  resolved_on_time: number
  resolved_late: number
}

type MonthlyMetricKey =
  | 'opened'
  | 'resolved'
  | 'breached'
  | 'resolved_on_time'
  | 'resolved_late'

interface SeriesDefinition {
  key: MonthlyMetricKey
  label: string
  color: string
}

const CHART_SERIES: SeriesDefinition[] = [
  { key: 'opened', label: 'Abertos', color: '#22d3ee' },
  { key: 'resolved', label: 'Resolvidos', color: '#38bdf8' },
  { key: 'breached', label: 'Venceram SLA', color: '#fb7185' },
  { key: 'resolved_on_time', label: 'No prazo', color: '#34d399' },
  { key: 'resolved_late', label: 'Fora do prazo', color: '#fbbf24' },
]

function MetricCard({ label, value, tone }: MetricCardProps) {
  return (
    <article className={`rounded-2xl border p-4 ${tone}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
    </article>
  )
}

function toChartPoint(raw: TicketMonthlyAnalyticsPayload['months'][number]): MonthlyChartPoint | null {
  if (!raw) return null

  return {
    month: String(raw.month),
    label: raw.label,
    opened: Number(raw.opened),
    resolved: Number(raw.resolved),
    breached: Number(raw.breached),
    resolved_on_time: Number(raw.resolved_on_time),
    resolved_late: Number(raw.resolved_late),
  }
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function formatAxisValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function MonthlyLineChart({ months }: { months: MonthlyChartPoint[] }) {
  const width = 960
  const height = 320
  const padding = { top: 24, right: 24, bottom: 48, left: 44 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const { yTicks, plottedSeries } = useMemo(() => {
    const allValues = months.flatMap((month) =>
      CHART_SERIES.map((series) => month[series.key]),
    )
    const maxValue = Math.max(0, ...allValues)
    const yMax = maxValue === 0 ? 1 : maxValue
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4
      return yMax - yMax * ratio
    })

    const xStep = months.length > 1 ? plotWidth / (months.length - 1) : 0

    const series = CHART_SERIES.map((definition) => {
      const points = months.map((month, index) => {
        const value = month[definition.key]
        const x = padding.left + xStep * index
        const y = padding.top + plotHeight - (value / yMax) * plotHeight
        return { month, value, x, y }
      })

      return {
        ...definition,
        points,
        path: buildLinePath(points.map(({ x, y }) => ({ x, y }))),
      }
    })

    return { yTicks: ticks, plottedSeries: series }
  }, [months, plotHeight, plotWidth, padding.left, padding.top])

  return (
    <div className="rounded-2xl border border-border/60 bg-background/30 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {CHART_SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Gráfico mensal em linha">
            <defs>
              {CHART_SERIES.map((series) => (
                <linearGradient
                  key={series.key}
                  id={`monthly-line-${series.key}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor={series.color} stopOpacity="0.55" />
                  <stop offset="100%" stopColor={series.color} stopOpacity="1" />
                </linearGradient>
              ))}
            </defs>

            {yTicks.map((tick) => {
              const axisMax = yTicks[0] || 1
              const y = padding.top + plotHeight - (tick / axisMax) * plotHeight
              return (
                <g key={tick}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke="rgba(148, 163, 184, 0.18)"
                    strokeDasharray="4 6"
                  />
                  <text
                    x={padding.left - 10}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="rgba(148, 163, 184, 0.85)"
                  >
                    {formatAxisValue(tick)}
                  </text>
                </g>
              )
            })}

            {months.map((month, index) => {
              const xStep = months.length > 1 ? plotWidth / (months.length - 1) : 0
              const x = padding.left + xStep * index
              return (
                <g key={month.month}>
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={padding.top + plotHeight}
                    stroke="rgba(148, 163, 184, 0.08)"
                  />
                  <text
                    x={x}
                    y={height - 16}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgba(226, 232, 240, 0.92)"
                    className="uppercase tracking-[0.16em]"
                  >
                    {month.label}
                  </text>
                </g>
              )
            })}

            <line
              x1={padding.left}
              y1={padding.top + plotHeight}
              x2={width - padding.right}
              y2={padding.top + plotHeight}
              stroke="rgba(148, 163, 184, 0.3)"
            />

            {plottedSeries.map((series) => (
              <g key={series.key}>
                <path
                  d={series.path}
                  fill="none"
                  stroke={`url(#monthly-line-${series.key})`}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {series.points.map((point) => (
                  <g key={`${series.key}-${point.month.month}`}>
                    <circle cx={point.x} cy={point.y} r="4.5" fill={series.color} stroke="#0f172a" strokeWidth="2" />
                    <text
                      x={point.x}
                      y={point.y - 10}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill={series.color}
                    >
                      {point.value}
                    </text>
                  </g>
                ))}
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs text-muted-foreground">
          <thead>
            <tr className="border-b border-border/50 text-[11px] uppercase tracking-[0.18em]">
              <th className="py-2 pr-4 font-medium">Mês</th>
              {CHART_SERIES.map((series) => (
                <th key={series.key} className="py-2 pr-4 font-medium">
                  {series.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month} className="border-b border-border/30 last:border-b-0">
                <td className="py-2 pr-4 font-medium text-foreground">{month.label}</td>
                <td className="py-2 pr-4 tabular-nums text-foreground">{month.opened}</td>
                <td className="py-2 pr-4 tabular-nums text-foreground">{month.resolved}</td>
                <td className="py-2 pr-4 tabular-nums text-foreground">{month.breached}</td>
                <td className="py-2 pr-4 tabular-nums text-foreground">{month.resolved_on_time}</td>
                <td className="py-2 pr-4 tabular-nums text-foreground">{month.resolved_late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MonthlyAnalytics({ analytics, isLoading }: MonthlyAnalyticsProps) {
  const months = useMemo(
    () => (analytics?.months ?? []).map(toChartPoint).filter((item): item is MonthlyChartPoint => item !== null),
    [analytics?.months],
  )

  const currentMonth = useMemo(() => {
    const point = analytics?.current_month ? toChartPoint(analytics.current_month) : null
    return point ?? months.at(-1) ?? null
  }, [analytics?.current_month, months])

  return (
    <Card className="rounded-[1.5rem] border-border/60 bg-card/80 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">Visão mensal da equipe</CardTitle>
        <CardDescription>
          O gráfico abaixo usa os valores retornados pela API sem truncar meses nem recalcular totais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-5">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-muted/40" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-5">
              <MetricCard
                label="Abertos no mês"
                value={currentMonth?.opened ?? 0}
                tone="border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos no mês"
                value={currentMonth?.resolved ?? 0}
                tone="border-sky-400/20 bg-gradient-to-br from-sky-400/10 to-transparent"
              />
              <MetricCard
                label="Venceram SLA"
                value={currentMonth?.breached ?? 0}
                tone="border-rose-400/20 bg-gradient-to-br from-rose-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos no prazo"
                value={currentMonth?.resolved_on_time ?? 0}
                tone="border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos fora do prazo"
                value={currentMonth?.resolved_late ?? 0}
                tone="border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-transparent"
              />
            </div>

            {months.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-background/30 py-10 text-center text-sm text-muted-foreground">
                Ainda não há dados suficientes para montar o gráfico mensal.
              </div>
            ) : (
              <MonthlyLineChart months={months} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
