import { type Ticket } from '@/lib/api'
import { getSlaStatus, getTimeUntilSla, formatDate } from '@/lib/date-utils'
import { useAuth } from '@/contexts/auth-context'
import { Badge } from '@/components/ui/badge'
import { TicketActions } from '@/components/ticket-actions'
import { getTicketUrl } from '@/lib/utils'

const SLA_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'outline' | 'default'> = {
  expired: 'destructive',
  warning: 'warning',
  normal: 'default',
  paused: 'secondary',
  none: 'outline',
}

interface KanbanCardProps {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
}

function KanbanCard({ ticket, agentOptions, onAssign, onUnassign, isLoading, currentUser }: KanbanCardProps) {
  const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
  const slaLabel = getTimeUntilSla(ticket.slaSolutionDate)
  const isMyTicket = currentUser && ticket.responsavel &&
    ticket.responsavel.toLowerCase() === currentUser.toLowerCase()

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-2 bg-card ${isMyTicket ? 'border-primary/40' : 'border-border/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <a
          href={getTicketUrl(ticket.id)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-primary hover:underline"
        >
          #{ticket.id}
        </a>
        <Badge variant={SLA_BADGE_VARIANT[sla]} className="text-xs shrink-0">
          {sla === 'paused' ? 'Pausado' : sla === 'none' ? '—' : slaLabel}
        </Badge>
      </div>
      <p className="text-sm leading-snug line-clamp-3">{ticket.subject || '—'}</p>
      <div className="text-xs text-muted-foreground">
        {ticket.responsavel ? (
          <span className={isMyTicket ? 'text-primary font-medium' : undefined}>
            {isMyTicket ? 'Seu chamado' : ticket.responsavel}
          </span>
        ) : (
          <span className="italic">Não atribuído</span>
        )}
      </div>
      <div className="rounded-md bg-background/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/85">Vencimento:</span>{' '}
        {ticket.slaSolutionDate ? formatDate(ticket.slaSolutionDate) : '—'}
      </div>
      <TicketActions
        ticket={ticket}
        agentOptions={agentOptions}
        onAssign={onAssign}
        onUnassign={onUnassign}
        isLoading={isLoading}
      />
    </div>
  )
}

interface KanbanViewProps {
  tickets: Ticket[]
  newTickets: Ticket[]
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
}

export function KanbanView({ tickets, newTickets, agentOptions, onAssign, onUnassign, isLoading }: KanbanViewProps) {
  const { user } = useAuth()
  const currentUser = user?.name ?? ''

  const columns = [
    { title: 'Novos', list: newTickets },
    { title: 'Em Andamento', list: tickets },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {columns.map(({ title, list }) => (
        <div key={title} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold">{title}</h2>
            <span className="text-xs text-muted-foreground">{list.length} tickets</span>
          </div>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center">Nenhum ticket</p>
          ) : (
            list.map((t) => (
              <KanbanCard
                key={t.id}
                ticket={t}
                agentOptions={agentOptions}
                onAssign={onAssign}
                onUnassign={onUnassign}
                isLoading={isLoading}
                currentUser={currentUser}
              />
            ))
          )}
        </div>
      ))}
    </div>
  )
}
