import { useEffect, useMemo, type ReactNode } from 'react'
import { AlertTriangle, Bell, Clock, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { type Ticket } from '@/lib/api'
import { getSlaStatus } from '@/lib/date-utils'

interface OperationalAlertsProps {
  tickets: Ticket[]
  newTickets: Ticket[]
  onQuickFilter: (value: string) => void
  onSearch: (value: string) => void
}

interface AlertItem {
  key: string
  title: string
  description: string
  count: number
  tone: 'danger' | 'warning' | 'muted'
  icon: ReactNode
  actionLabel: string
  onClick: () => void
}

const STALE_HOURS = 72

export function OperationalAlerts({ tickets, newTickets, onQuickFilter, onSearch }: OperationalAlertsProps) {
  const allTickets = useMemo(() => [...tickets, ...newTickets], [tickets, newTickets])

  const metrics = useMemo(() => {
    const expired = allTickets.filter((ticket) =>
      getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused) === 'expired',
    )
    const warning = allTickets.filter((ticket) =>
      getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused) === 'warning',
    )
    const unassigned = allTickets.filter((ticket) => !ticket.responsavel)
    const criticalUnassigned = unassigned.filter((ticket) =>
      ticket.ai_triage?.priority === 'critica' || ticket.ai_triage?.priority === 'alta',
    )
    const stale = allTickets.filter(isStaleTicket)

    return { expired, warning, unassigned, criticalUnassigned, stale }
  }, [allTickets])

  const alerts: AlertItem[] = [
    {
      key: 'expired',
      title: 'SLA vencido',
      description: 'Tickets precisam de ação imediata.',
      count: metrics.expired.length,
      tone: 'danger',
      icon: <AlertTriangle className="h-4 w-4" />,
      actionLabel: 'Ver vencidos',
      onClick: () => onQuickFilter('sla_risk'),
    },
    {
      key: 'warning',
      title: 'SLA em risco',
      description: 'Vencimento nas próximas 24 horas.',
      count: metrics.warning.length,
      tone: 'warning',
      icon: <Clock className="h-4 w-4" />,
      actionLabel: 'Filtrar risco',
      onClick: () => onQuickFilter('sla_risk'),
    },
    {
      key: 'critical-unassigned',
      title: 'Críticos sem responsável',
      description: 'Alta prioridade sem dono definido.',
      count: metrics.criticalUnassigned.length,
      tone: 'danger',
      icon: <UserX className="h-4 w-4" />,
      actionLabel: 'Ver críticos',
      onClick: () => {
        onQuickFilter('unassigned')
        onSearch('')
      },
    },
    {
      key: 'stale',
      title: 'Sem movimentação',
      description: `Sem atualização há mais de ${STALE_HOURS}h.`,
      count: metrics.stale.length,
      tone: 'muted',
      icon: <Bell className="h-4 w-4" />,
      actionLabel: 'Buscar antigos',
      onClick: () => onSearch(metrics.stale[0] ? `#${metrics.stale[0].id}` : ''),
    },
  ].filter((alert) => alert.count > 0)

  const signature = alerts.map((alert) => `${alert.key}:${alert.count}`).join('|')

  useEffect(() => {
    if (!signature) return
    const storageKey = `operationalAlertsToast:${signature}`
    if (sessionStorage.getItem(storageKey)) return

    const mainAlert = alerts[0]
    toast.warning(`${mainAlert.count} alerta${mainAlert.count !== 1 ? 's' : ''}: ${mainAlert.title}`, {
      description: mainAlert.description,
    })
    sessionStorage.setItem(storageKey, '1')
  }, [alerts, signature])

  if (!alerts.length) return null

  return (
    <section className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
      {alerts.map((alert) => (
        <button
          key={alert.key}
          type="button"
          onClick={alert.onClick}
          className={`group flex min-h-24 items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
            alert.tone === 'danger'
              ? 'border-destructive/35 bg-destructive/10 hover:bg-destructive/15'
              : alert.tone === 'warning'
                ? 'border-amber-400/35 bg-amber-400/10 hover:bg-amber-400/15'
                : 'border-border/60 bg-card/70 hover:bg-muted/45'
          }`}
        >
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
              alert.tone === 'danger'
                ? 'bg-destructive/15 text-destructive'
                : alert.tone === 'warning'
                  ? 'bg-amber-400/15 text-amber-300'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {alert.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <strong className="text-xl leading-none tabular-nums text-foreground">{alert.count}</strong>
              <span className="text-sm font-semibold text-foreground">{alert.title}</span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{alert.description}</span>
            <span className="mt-2 block text-xs font-medium text-primary group-hover:underline">{alert.actionLabel}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

function isStaleTicket(ticket: Ticket) {
  if (!ticket.last_update || ticket.closed_at) return false
  const updatedAt = new Date(ticket.last_update).getTime()
  if (Number.isNaN(updatedAt)) return false

  const ageHours = (Date.now() - updatedAt) / (1000 * 60 * 60)
  return ageHours >= STALE_HOURS
}
