import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { type TicketMonthlyAnalyticsPayload } from '@/lib/api'

interface MonthlyAnalyticsProps {
  analytics?: TicketMonthlyAnalyticsPayload
  isLoading?: boolean
}

interface MetricCardProps {
  label: string
  value: number
  tone: string
}

function MetricCard({ label, value, tone }: MetricCardProps) {
  return (
    <article className={`rounded-2xl border p-4 ${tone}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
    </article>
  )
}

export function MonthlyAnalytics({ analytics, isLoading }: MonthlyAnalyticsProps) {
  const months = analytics?.months ?? []
  const current = analytics?.current_month
  const maxValue = Math.max(
    1,
    ...months.flatMap((month) => [
      month.resolved,
      month.breached,
      month.resolved_on_time,
      month.resolved_late,
      month.opened,
    ]),
  )

  return (
    <Card className="rounded-[1.5rem] border-border/60 bg-card/80 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">Visão mensal da equipe</CardTitle>
        <CardDescription>
          Compare aberturas, vencimentos e resoluções no prazo ou fora do prazo nos últimos meses sincronizados.
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
                value={current?.opened ?? 0}
                tone="border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos no mês"
                value={current?.resolved ?? 0}
                tone="border-sky-400/20 bg-gradient-to-br from-sky-400/10 to-transparent"
              />
              <MetricCard
                label="Venceram SLA"
                value={current?.breached ?? 0}
                tone="border-rose-400/20 bg-gradient-to-br from-rose-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos no prazo"
                value={current?.resolved_on_time ?? 0}
                tone="border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 to-transparent"
              />
              <MetricCard
                label="Resolvidos fora do prazo"
                value={current?.resolved_late ?? 0}
                tone="border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-transparent"
              />
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/30 p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Abertos</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Resolvidos</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Venceram SLA</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> No prazo</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Fora do prazo</span>
              </div>

              {months.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Ainda não há dados suficientes para montar o gráfico mensal.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {months.map((month) => (
                    <div key={month.month} className="rounded-xl border border-border/50 bg-card/50 p-3">
                      <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {month.label}
                      </div>
                      <div className="flex h-40 items-end gap-2">
                        {[
                          { key: 'opened', value: month.opened, color: 'bg-cyan-400' },
                          { key: 'resolved', value: month.resolved, color: 'bg-sky-400' },
                          { key: 'breached', value: month.breached, color: 'bg-rose-400' },
                          { key: 'resolved_on_time', value: month.resolved_on_time, color: 'bg-emerald-400' },
                          { key: 'resolved_late', value: month.resolved_late, color: 'bg-amber-400' },
                        ].map((bar) => (
                          <div key={bar.key} className="flex flex-1 flex-col items-center gap-2">
                            <span className="text-[11px] text-muted-foreground tabular-nums">{bar.value}</span>
                            <div className="flex h-28 w-full items-end rounded-full bg-muted/25 px-1 py-1">
                              <div
                                className={`w-full rounded-full ${bar.color} transition-all`}
                                style={{ height: `${Math.max(8, (bar.value / maxValue) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <span>
                          Abertos: <strong className="text-foreground">{month.opened}</strong>
                        </span>
                        <span>
                          Resolvidos: <strong className="text-foreground">{month.resolved}</strong>
                        </span>
                        <span>
                          No prazo: <strong className="text-foreground">{month.resolved_on_time}</strong>
                        </span>
                        <span>
                          Fora do prazo: <strong className="text-foreground">{month.resolved_late}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
