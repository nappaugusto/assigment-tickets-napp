import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Award, ChevronDown, ChevronUp, Gauge, PauseCircle, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type TicketMonthlyAnalyticsPayload } from '@/lib/api'

interface MonthlyAnalyticsProps {
  analytics?: TicketMonthlyAnalyticsPayload
  isLoading?: boolean
}

interface MetricCardProps {
  label: string
  value: number
  tone: string
  helper?: string
}

type ChartMetricKey = 'opened' | 'resolved_on_time' | 'resolved_late' | 'sla_paused'

interface ChartSeries {
  key: ChartMetricKey
  label: string
  color: string
}

interface HoveredPoint {
  key: ChartMetricKey
  label: string
  color: string
  monthLabel: string
  value: number
  x: number
  y: number
}

interface MonthlyChartPoint {
  month: string
  label: string
  opened: number
  resolved_on_time: number
  resolved_late: number
  sla_paused: number
}

const CHART_SERIES: ChartSeries[] = [
  { key: 'opened', label: 'Abertos no mês', color: '#22d3ee' },
  { key: 'resolved_on_time', label: 'Resposta dentro do prazo', color: '#34d399' },
  { key: 'resolved_late', label: 'Resposta fora do prazo', color: '#fb7185' },
  { key: 'sla_paused', label: 'Pausados no mês', color: '#facc15' },
]

const DEFAULT_VISIBLE_SERIES = CHART_SERIES.map((series) => series.key)
const MONTHLY_ANALYTICS_COLLAPSED_KEY = 'monthlyAnalyticsCollapsed'
const MONTHLY_ANALYTICS_SUMMARY_COLLAPSED_KEY = 'monthlyAnalyticsSummaryCollapsed'

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return '-'
  return `${Math.round(value)}%`
}

function getSlaRate(month: MonthlyChartPoint | null) {
  if (!month) return null
  const resolved = month.resolved_on_time + month.resolved_late
  if (resolved === 0) return null
  return (month.resolved_on_time / resolved) * 100
}

function getResolvedCount(month: MonthlyChartPoint | null) {
  if (!month) return 0
  return month.resolved_on_time + month.resolved_late
}

function getMonthlyBalance(month: MonthlyChartPoint | null) {
  if (!month) return 0
  return month.opened - getResolvedCount(month)
}

function getDelta(current: number, previous?: number) {
  if (previous === undefined) return 'Sem mês anterior'
  if (current === previous) return 'Sem variação'

  const diff = current - previous
  return `${diff > 0 ? '+' : ''}${diff} vs. mês anterior`
}

function getPercentDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return 'Sem base comparável'
  if (Math.round(current) === Math.round(previous)) return 'Sem variação'

  const diff = Math.round(current - previous)
  return `${diff > 0 ? '+' : ''}${diff} p.p. vs. mês anterior`
}

function getBestSlaMonth(months: MonthlyChartPoint[]) {
  return months.reduce<MonthlyChartPoint | null>((best, month) => {
    const rate = getSlaRate(month)
    const bestRate = getSlaRate(best)
    if (rate === null) return best
    if (bestRate === null || rate > bestRate) return month
    return best
  }, null)
}

function getPeakOpenedMonth(months: MonthlyChartPoint[]) {
  return months.reduce<MonthlyChartPoint | null>((peak, month) => {
    if (!peak || month.opened > peak.opened) return month
    return peak
  }, null)
}

function getWorstLateMonth(months: MonthlyChartPoint[]) {
  return months.reduce<MonthlyChartPoint | null>((worst, month) => {
    if (!worst || month.resolved_late > worst.resolved_late) return month
    return worst
  }, null)
}

function MetricCard({ label, value, tone, helper }: MetricCardProps) {
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      {helper && <div className="mt-2 text-xs text-muted-foreground">{helper}</div>}
    </article>
  )
}

function InsightCard({
  title,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  title: string
  value: string
  helper: string
  icon: LucideIcon
  tone: string
}) {
  return (
    <article className={`flex min-h-28 gap-3 rounded-xl border p-4 ${tone}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/55">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
      </div>
    </article>
  )
}

function toChartPoint(raw: TicketMonthlyAnalyticsPayload['months'][number]): MonthlyChartPoint | null {
  if (!raw) return null

  return {
    month: String(raw.month),
    label: raw.label,
    opened: Number(raw.opened),
    resolved_on_time: Number(raw.resolved_on_time),
    resolved_late: Number(raw.resolved_late),
    sla_paused: Number(raw.sla_paused),
  }
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function formatAxisValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function MonthlyLineChart({ months }: { months: MonthlyChartPoint[] }) {
  const [visibleSeriesKeys, setVisibleSeriesKeys] = useState<ChartMetricKey[]>(DEFAULT_VISIBLE_SERIES)
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null)
  const width = 960
  const height = 320
  const padding = { top: 20, right: 24, bottom: 50, left: 44 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const activeSeries = useMemo(
    () => CHART_SERIES.filter((series) => visibleSeriesKeys.includes(series.key)),
    [visibleSeriesKeys],
  )

  const { yTicks, seriesWithPoints } = useMemo(() => {
    const allValues = months.flatMap((month) => activeSeries.map((series) => month[series.key]))
    const maxValue = Math.max(0, ...allValues)
    const yMax = maxValue === 0 ? 1 : maxValue
    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4
      return yMax - yMax * ratio
    })
    const xStep = months.length > 1 ? plotWidth / (months.length - 1) : 0

    const seriesWithPoints = activeSeries.map((series) => {
      const points = months.map((month, index) => {
        const value = month[series.key]
        const x = padding.left + xStep * index
        const y = padding.top + plotHeight - (value / yMax) * plotHeight
        return { x, y, value, month }
      })

      return {
        ...series,
        points,
        path: buildLinePath(points.map(({ x, y }) => ({ x, y }))),
      }
    })

    return { yTicks, seriesWithPoints }
  }, [activeSeries, months, plotHeight, plotWidth, padding.left, padding.top])

  const xStep = months.length > 1 ? plotWidth / (months.length - 1) : 0
  const toggleSeries = (key: ChartMetricKey) => {
    setVisibleSeriesKeys((current) => {
      if (current.includes(key)) {
        return current.length === 1 ? current : current.filter((item) => item !== key)
      }

      return [...current, key]
    })
    setHoveredPoint(null)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {CHART_SERIES.map((series) => (
          <button
            key={series.key}
            type="button"
            onClick={() => toggleSeries(series.key)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
              visibleSeriesKeys.includes(series.key)
                ? 'border-border/70 bg-muted/50 text-foreground'
                : 'border-border/30 text-muted-foreground/55'
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Gráfico mensal de tickets">
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
                    y={height - 14}
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

            {seriesWithPoints.map((series) => (
              <g key={series.key}>
                <path
                  d={series.path}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {series.points.map((point) => (
                  <g key={`${series.key}-${point.month.month}`}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="12"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          key: series.key,
                          label: series.label,
                          color: series.color,
                          monthLabel: point.month.label,
                          value: point.value,
                          x: point.x,
                          y: point.y,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={hoveredPoint?.key === series.key && hoveredPoint.monthLabel === point.month.label ? 7 : 4.5}
                      fill={series.color}
                      stroke="#0f172a"
                      strokeWidth="2"
                      className="cursor-pointer transition-all"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          key: series.key,
                          label: series.label,
                          color: series.color,
                          monthLabel: point.month.label,
                          value: point.value,
                          x: point.x,
                          y: point.y,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                  </g>
                ))}
              </g>
            ))}

            {hoveredPoint && (
              <g pointerEvents="none">
                <line
                  x1={hoveredPoint.x}
                  y1={padding.top}
                  x2={hoveredPoint.x}
                  y2={padding.top + plotHeight}
                  stroke="rgba(226, 232, 240, 0.35)"
                  strokeDasharray="4 6"
                />
                <rect
                  x={Math.min(Math.max(hoveredPoint.x - 86, padding.left), width - padding.right - 172)}
                  y={Math.max(hoveredPoint.y - 72, padding.top + 4)}
                  width="172"
                  height="54"
                  rx="8"
                  fill="rgba(15, 23, 42, 0.96)"
                  stroke="rgba(148, 163, 184, 0.35)"
                />
                <text
                  x={Math.min(Math.max(hoveredPoint.x - 74, padding.left + 12), width - padding.right - 160)}
                  y={Math.max(hoveredPoint.y - 48, padding.top + 28)}
                  fontSize="11"
                  fill="rgba(226, 232, 240, 0.72)"
                >
                  {hoveredPoint.monthLabel}
                </text>
                <circle
                  cx={Math.min(Math.max(hoveredPoint.x - 74, padding.left + 12), width - padding.right - 160) + 5}
                  cy={Math.max(hoveredPoint.y - 26, padding.top + 50)}
                  r="4"
                  fill={hoveredPoint.color}
                />
                <text
                  x={Math.min(Math.max(hoveredPoint.x - 62, padding.left + 24), width - padding.right - 148)}
                  y={Math.max(hoveredPoint.y - 22, padding.top + 54)}
                  fontSize="12"
                  fontWeight="600"
                  fill="rgba(248, 250, 252, 0.95)"
                >
                  {hoveredPoint.label}: {hoveredPoint.value}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border/40 bg-card/35">
        <table className="min-w-full text-left text-xs text-muted-foreground">
          <thead>
            <tr className="border-b border-border/50 bg-muted/25 text-[11px] uppercase tracking-[0.16em]">
              <th className="px-3 py-2 font-medium">Mês</th>
              <th className="px-3 py-2 font-medium">Abertos</th>
              <th className="px-3 py-2 font-medium">Resolvidos</th>
              <th className="px-3 py-2 font-medium">Dentro</th>
              <th className="px-3 py-2 font-medium">Fora</th>
              <th className="px-3 py-2 font-medium">SLA</th>
              <th className="px-3 py-2 font-medium">Saldo</th>
              <th className="px-3 py-2 font-medium">Pausados</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month} className="border-b border-border/30 last:border-b-0">
                <td className="px-3 py-2 font-medium text-foreground">{month.label}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{month.opened}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{getResolvedCount(month)}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{month.resolved_on_time}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{month.resolved_late}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{formatPercent(getSlaRate(month))}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{getMonthlyBalance(month)}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">{month.sla_paused}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MonthlyAnalytics({ analytics, isLoading }: MonthlyAnalyticsProps) {
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(MONTHLY_ANALYTICS_COLLAPSED_KEY) === '1',
  )
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(
    () => localStorage.getItem(MONTHLY_ANALYTICS_SUMMARY_COLLAPSED_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(MONTHLY_ANALYTICS_COLLAPSED_KEY, isCollapsed ? '1' : '0')
  }, [isCollapsed])

  useEffect(() => {
    localStorage.setItem(MONTHLY_ANALYTICS_SUMMARY_COLLAPSED_KEY, isSummaryCollapsed ? '1' : '0')
  }, [isSummaryCollapsed])

  const months = useMemo(
    () => (analytics?.months ?? []).map(toChartPoint).filter((item): item is MonthlyChartPoint => item !== null),
    [analytics?.months],
  )

  const currentMonth = useMemo(() => {
    const current = analytics?.current_month ? toChartPoint(analytics.current_month) : null
    return current ?? months.at(-1) ?? null
  }, [analytics, months])

  const previousMonth = months.length > 1 ? months.at(-2) : undefined
  const currentSlaRate = getSlaRate(currentMonth)
  const previousSlaRate = getSlaRate(previousMonth ?? null)
  const lateTrendIcon = previousMonth && currentMonth && currentMonth.resolved_late <= previousMonth.resolved_late
    ? TrendingDown
    : TrendingUp
  const bestSlaMonth = getBestSlaMonth(months)
  const peakOpenedMonth = getPeakOpenedMonth(months)
  const worstLateMonth = getWorstLateMonth(months)

  return (
    <Card className="rounded-xl border-border/60 bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Visão mensal da equipe</CardTitle>
            {!isCollapsed && !isLoading && currentMonth && (
              <p className="mt-1 text-sm text-muted-foreground">
                Recorte atual: <strong className="text-foreground">{currentMonth.label}</strong>
              </p>
            )}
          </div>
          {!isCollapsed && !isLoading && (
            <div className="flex flex-wrap items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
              <span>
                Tickets pausados:{' '}
                <strong className="tabular-nums text-amber-50">{analytics?.active_sla_paused ?? 0}</strong>
              </span>
              <span className="text-amber-200/60">|</span>
              <span>
                Pausados no mês:{' '}
                <strong className="tabular-nums text-amber-50">{currentMonth?.sla_paused ?? 0}</strong>
              </span>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 rounded-full"
            onClick={() => setIsCollapsed((value) => !value)}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {isCollapsed ? 'Expandir' : 'Minimizar'}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/25 px-3 py-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Resumo mensal</p>
                  <p className="text-xs text-muted-foreground">
                    {isSummaryCollapsed ? 'Cards ocultos para priorizar o gráfico.' : 'Indicadores principais e destaques do período.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-md text-xs"
                  onClick={() => setIsSummaryCollapsed((value) => !value)}
                >
                  {isSummaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                  {isSummaryCollapsed ? 'Mostrar resumo' : 'Ocultar resumo'}
                </Button>
              </div>

              {!isSummaryCollapsed && (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricCard
                      label="Abertos no mês"
                      value={currentMonth?.opened ?? 0}
                      helper={getDelta(currentMonth?.opened ?? 0, previousMonth?.opened)}
                      tone="border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-transparent"
                    />
                    <MetricCard
                      label="Dentro do prazo"
                      value={currentMonth?.resolved_on_time ?? 0}
                      helper={getDelta(currentMonth?.resolved_on_time ?? 0, previousMonth?.resolved_on_time)}
                      tone="border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 to-transparent"
                    />
                    <MetricCard
                      label="Fora do prazo"
                      value={currentMonth?.resolved_late ?? 0}
                      helper={getDelta(currentMonth?.resolved_late ?? 0, previousMonth?.resolved_late)}
                      tone="border-rose-400/20 bg-gradient-to-br from-rose-400/10 to-transparent"
                    />
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    <InsightCard
                      title="Taxa de SLA"
                      value={formatPercent(currentSlaRate)}
                      helper={getPercentDelta(currentSlaRate, previousSlaRate)}
                      icon={currentSlaRate !== null && currentSlaRate >= 80 ? TrendingUp : AlertTriangle}
                      tone="border-primary/20 bg-primary/10 text-primary"
                    />
                    <InsightCard
                      title="Atrasos"
                      value={`${currentMonth?.resolved_late ?? 0}`}
                      helper={getDelta(currentMonth?.resolved_late ?? 0, previousMonth?.resolved_late)}
                      icon={lateTrendIcon}
                      tone="border-rose-400/20 bg-rose-400/10 text-rose-200"
                    />
                    <InsightCard
                      title="SLA pausado"
                      value={`${analytics?.active_sla_paused ?? 0}`}
                      helper={`${currentMonth?.sla_paused ?? 0} pausados no mês`}
                      icon={PauseCircle}
                      tone="border-amber-400/20 bg-amber-400/10 text-amber-100"
                    />
                  </div>

                  {months.length > 1 && (
                    <div className="grid gap-3 lg:grid-cols-3">
                      <InsightCard
                        title="Melhor SLA"
                        value={bestSlaMonth ? formatPercent(getSlaRate(bestSlaMonth)) : '-'}
                        helper={bestSlaMonth ? `${bestSlaMonth.label} foi o melhor mês do período` : 'Sem base suficiente'}
                        icon={Award}
                        tone="border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                      />
                      <InsightCard
                        title="Maior entrada"
                        value={`${peakOpenedMonth?.opened ?? 0}`}
                        helper={peakOpenedMonth ? `${peakOpenedMonth.label} concentrou mais tickets abertos` : 'Sem base suficiente'}
                        icon={Gauge}
                        tone="border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                      />
                      <InsightCard
                        title="Mês mais crítico"
                        value={`${worstLateMonth?.resolved_late ?? 0}`}
                        helper={worstLateMonth ? `${worstLateMonth.label} teve mais respostas fora do prazo` : 'Sem base suficiente'}
                        icon={AlertTriangle}
                        tone="border-orange-400/20 bg-orange-400/10 text-orange-100"
                      />
                    </div>
                  )}
                </>
              )}

              {months.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-background/30 py-10 text-center text-sm text-muted-foreground">
                  Ainda não há dados suficientes para montar o gráfico mensal.
                </div>
              ) : (
                <MonthlyLineChart months={months} />
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
