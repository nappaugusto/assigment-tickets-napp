import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Pencil } from 'lucide-react'
import { type Ticket } from '@/lib/api'
import { formatDate, getSlaStatus, getTimeUntilSla } from '@/lib/date-utils'
import { Badge } from '@/components/ui/badge'
import { TicketActions } from '@/components/ticket-actions'
import { TicketNoteDrawer } from '@/components/ticket-note-drawer'
import { TicketServiceDrawer } from '@/components/ticket-service-drawer'
import { useTicketsWithNotes } from '@/hooks/use-ticket-note'
import { getTicketUrl } from '@/lib/utils'

const SLA_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'outline' | 'default'> = {
  expired: 'destructive',
  warning: 'warning',
  normal: 'default',
  paused: 'secondary',
  none: 'outline',
}

interface KanbanCardDraggableProps {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  isDragOverlay?: boolean
}

export function KanbanCardDraggable({
  ticket,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  isDragOverlay = false,
}: KanbanCardDraggableProps) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
  const slaLabel = getTimeUntilSla(ticket.slaSolutionDate)
  const isMyTicket =
    currentUser && ticket.responsavel &&
    ticket.responsavel.toLowerCase() === currentUser.toLowerCase()

  const { data: ticketsWithNotes } = useTicketsWithNotes()
  const hasNote = ticketsWithNotes?.has(ticket.id) ?? false

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(ticket.id), disabled: isDragOverlay })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragOverlay ? 'grabbing' : 'grab',
  }

  return (
    <>
      <div
        ref={isDragOverlay ? undefined : setNodeRef}
        style={isDragOverlay ? { cursor: 'grabbing' } : style}
        {...(isDragOverlay ? {} : attributes)}
        {...(isDragOverlay ? {} : listeners)}
        className={`rounded-lg border p-3 flex flex-col gap-2 bg-card select-none ${
          isMyTicket ? 'border-primary/40' : 'border-border/40'
        } ${isDragOverlay ? 'shadow-lg rotate-1' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <a
            href={getTicketUrl(ticket.id)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
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
      <div className="flex items-center justify-between gap-2">
        <TicketActions
          ticket={ticket}
            agentOptions={agentOptions}
            onAssign={onAssign}
            onUnassign={onUnassign}
            isLoading={isLoading}
            onOpenService={() => setServiceOpen(true)}
          />
          {!isDragOverlay && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setNoteOpen(true) }}
              title="Anotações"
              className="relative flex items-center justify-center p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <Pencil size={13} />
              {hasNote && (
                <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          )}
        </div>
      </div>

      <TicketNoteDrawer
        ticket={noteOpen ? ticket : null}
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
      />
      <TicketServiceDrawer
        ticket={serviceOpen ? ticket : null}
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        agentOptions={agentOptions}
        onAssignLocal={onAssign}
      />
    </>
  )
}
