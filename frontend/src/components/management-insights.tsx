import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bot, ChevronDown, ChevronUp, Clock3, Hash, KanbanSquare, UserRound, Workflow } from 'lucide-react'
import { type Ticket } from '@/lib/api'
import { formatDate } from '@/lib/date-utils'
import { type QuickFilter } from '@/hooks/use-ticket-filters'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface ManagementInsightsProps {
  tickets: Ticket[]
  newTickets: Ticket[]
  onQuickFilter?: (filter: QuickFilter) => void
  onSearch?: (search: string) => void
}

interface RankedItem {
  label: string
  value: number
  search?: string
}

const RECURRENT_STOP_WORDS = new Set([
  'com',
  'das',
  'dos',
  'para',
  'por',
  'sem',
  'uma',
  'nos',
  'nas',
  'erro',
  'ticket',
  'cnpj',
  'ltda',
  'produtos',
  'produto',
])

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysSince(value: string | null) {
  const date = parseDate(value)
  if (!date) return null
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
}

function isOverdue(ticket: Ticket) {
  if (!ticket.slaSolutionDate || ticket.slaSolutionDateIsPaused) return false
  const date = parseDate(ticket.slaSolutionDate)
  return Boolean(date && date.getTime() < Date.now())
}

function dueSoon(ticket: Ticket) {
  if (!ticket.slaSolutionDate || ticket.slaSolutionDateIsPaused) return false
  const date = parseDate(ticket.slaSolutionDate)
  if (!date) return false
  const diffHours = (date.getTime() - Date.now()) / 3_600_000
  return diffHours >= 0 && diffHours <= 48
}

function percent(part: number, total: number) {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

function rankBy(items: Ticket[], getLabel: (ticket: Ticket) => string | null): RankedItem[] {
  const map = new Map<string, number>()
  for (const ticket of items) {
    const label = getLabel(ticket)?.trim()
    if (!label) continue
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 5)
}

function normalizeProblemText(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function extractCnpj(value: string | null | undefined) {
  return String(value ?? '').match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)?.map((item) => item.replace(/\D/g, '')) ?? []
}

function formatCnpj(value: string) {
  if (value.length !== 14) return value
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`
}

function extractProblemTerms(value: string | null | undefined) {
  return normalizeProblemText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !RECURRENT_STOP_WORDS.has(term) && !/^\d+$/.test(term))
}

function rankRecurringProblems(items: Ticket[]): RankedItem[] {
  const map = new Map<string, RankedItem>()

  for (const ticket of items) {
    for (const cnpj of extractCnpj(ticket.subject)) {
      const key = `cnpj:${cnpj}`
      const current = map.get(key) ?? {
        label: `CNPJ ${formatCnpj(cnpj)}`,
        value: 0,
        search: cnpj,
      }
      current.value += 1
      map.set(key, current)
    }

    const terms = Array.from(new Set(extractProblemTerms(ticket.subject)))
    for (const term of terms) {
      const key = `term:${term}`
      const current = map.get(key) ?? {
        label: term,
        value: 0,
        search: term,
      }
      current.value += 1
      map.set(key, current)
    }
  }

  return Array.from(map.values())
    .filter((item) => item.value >= 2)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, 8)
}

function MetricTile({
  icon,
  label,
  value,
  helper,
  tone,
  onClick,
}: {
  icon: ReactNode
  label: string
  value: string
  helper: string
  tone: string
  onClick?: () => void
}) {
  const Component = onClick ? 'button' : 'article'

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-colors ${tone} ${onClick ? 'hover:border-primary/45 hover:bg-primary/10' : ''}`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </Component>
  )
}

function Ranking({
  title,
  items,
  empty,
  onItemClick,
}: {
  title: string
  items: RankedItem[]
  empty: string
  onItemClick?: (item: RankedItem) => void
}) {
  return (
    <section className="rounded-xl border border-border/55 bg-card/60 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.length ? (
          items.map((item) => {
            const Component = onItemClick ? 'button' : 'div'

            return (
            <Component
              key={item.label}
              type={onItemClick ? 'button' : undefined}
              onClick={() => onItemClick?.(item)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg bg-background/45 px-3 py-2 text-left text-sm transition-colors ${onItemClick ? 'hover:bg-primary/10 hover:text-foreground' : ''}`}
            >
              <span className="min-w-0 truncate text-foreground">{item.label}</span>
              <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {item.value}
              </span>
            </Component>
          )})
        ) : (
          <p className="rounded-lg bg-background/35 px-3 py-4 text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  )
}

const MANAGEMENT_INSIGHTS_COLLAPSED_KEY = 'managementInsightsCollapsed'

export function ManagementInsights({ tickets, newTickets, onQuickFilter, onSearch }: ManagementInsightsProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(MANAGEMENT_INSIGHTS_COLLAPSED_KEY) === '1'
  })
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedResponsible, setSelectedResponsible] = useState('')
  const sourceAll = useMemo(() => [...tickets, ...newTickets], [tickets, newTickets])
  const teamOptions = useMemo(
    () => Array.from(new Set(sourceAll.map((ticket) => ticket.ownerTeam).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [sourceAll],
  )
  const responsibleOptions = useMemo(() => {
    const selectedTeamKey = selectedTeam.trim()
    const source = selectedTeamKey
      ? sourceAll.filter((ticket) => ticket.ownerTeam === selectedTeamKey)
      : sourceAll

    return Array.from(new Set(source.map((ticket) => ticket.responsavel).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [selectedTeam, sourceAll])
  const all = useMemo(
    () =>
      sourceAll.filter((ticket) => {
        if (selectedTeam && ticket.ownerTeam !== selectedTeam) return false
        if (selectedResponsible && ticket.responsavel !== selectedResponsible) return false
        return true
      }),
    [selectedResponsible, selectedTeam, sourceAll],
  )
  const total = all.length
  const withTriage = all.filter((ticket) => ticket.ai_triage).length
  const overdue = all.filter(isOverdue)
  const next48h = all.filter(dueSoon)
  const inTrello = all.filter((ticket) => ticket.trello_card_url).length
  const ages = all
    .map((ticket) => daysSince(ticket.opened_at))
    .filter((value): value is number => value !== null)
  const avgAge = ages.length ? Math.round(ages.reduce((sum, value) => sum + value, 0) / ages.length) : 0
  const oldest = [...all]
    .map((ticket) => ({ ticket, age: daysSince(ticket.opened_at) ?? -1 }))
    .sort((a, b) => b.age - a.age)[0]
  const byTeam = rankBy(all, (ticket) => ticket.ownerTeam)
  const byOwner = rankBy(all, (ticket) => ticket.responsavel)
  const recurringProblems = rankRecurringProblems(all)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(MANAGEMENT_INSIGHTS_COLLAPSED_KEY, next ? '1' : '0')
  }

  return (
    <Card className="rounded-xl border-border/60 bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Gestão operacional</CardTitle>
            {!collapsed && (
              <p className="mt-1 text-sm text-muted-foreground">
                Indicadores da fila atual
                {oldest?.ticket && oldest.age >= 0 && (
                  <>
                    <span className="mx-2 text-muted-foreground/55">|</span>
                    <span>
                      Mais antigo: <strong className="text-foreground">#{oldest.ticket.id}</strong> · {oldest.age}d ·{' '}
                      {oldest.ticket.opened_at ? formatDate(oldest.ticket.opened_at) : 'sem data'}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          {!collapsed && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[220px] flex-1 sm:flex-none">
                <Workflow className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={selectedTeam}
                  onChange={(event) => {
                    setSelectedTeam(event.target.value)
                    setSelectedResponsible('')
                  }}
                  className="h-9 w-full rounded-full border border-input bg-background/70 pl-9 pr-9 text-xs text-foreground shadow-inner outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                  aria-label="Filtrar gestão por equipe"
                >
                  <option value="">Todas as equipes</option>
                  {teamOptions.map((team) => (
                    <option key={team} value={team}>{team}</option>
                  ))}
                </select>
              </label>
              <label className="relative min-w-[240px] flex-1 sm:flex-none">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={selectedResponsible}
                  onChange={(event) => setSelectedResponsible(event.target.value)}
                  className="h-9 w-full rounded-full border border-input bg-background/70 pl-9 pr-9 text-xs text-foreground shadow-inner outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                  aria-label="Filtrar gestão por responsável"
                >
                  <option value="">Todos os responsáveis</option>
                  {responsibleOptions.map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 rounded-full"
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {collapsed ? 'Expandir' : 'Minimizar'}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              icon={<Bot className="h-3.5 w-3.5 text-primary" />}
              label="Cobertura IA"
              value={percent(withTriage, total)}
              helper={`${withTriage}/${total} tickets com triagem salva`}
              tone="border-cyan-400/25 bg-cyan-400/10"
              onClick={() => onQuickFilter?.('with_ai')}
            />
            <MetricTile
              icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}
              label="Risco SLA"
              value={String(overdue.length + next48h.length)}
              helper={`${overdue.length} vencidos · ${next48h.length} em 48h`}
              tone="border-amber-400/25 bg-amber-400/10"
              onClick={() => onQuickFilter?.('sla_risk')}
            />
            <MetricTile
              icon={<KanbanSquare className="h-3.5 w-3.5 text-emerald-300" />}
              label="Virou Trello"
              value={percent(inTrello, total)}
              helper={`${inTrello} tickets vinculados a card`}
              tone="border-emerald-400/25 bg-emerald-400/10"
              onClick={() => onQuickFilter?.('trello')}
            />
            <MetricTile
              icon={<Clock3 className="h-3.5 w-3.5 text-blue-300" />}
              label="Idade media"
              value={`${avgAge}d`}
              helper="Tempo desde abertura na fila atual"
              tone="border-blue-400/25 bg-blue-400/10"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Ranking title="Volume por time" items={byTeam} empty="Nenhum time identificado na fila." />
            <Ranking title="Carga por responsável" items={byOwner} empty="Nenhum responsável atribuído." />
          </div>
          <Ranking
            title="Problemas recorrentes"
            items={recurringProblems}
            empty="Nenhum padrão recorrente relevante neste recorte."
            onItemClick={(item) => {
              if (item.search) onSearch?.(item.search)
            }}
          />
        </CardContent>
      )}
    </Card>
  )
}
