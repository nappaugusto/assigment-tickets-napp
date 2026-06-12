import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, MoreVertical, Pencil, Sparkles } from 'lucide-react'
import { type KanbanColumn, type Ticket } from '@/lib/api'
import { formatDate, getSlaStatus, getTimeUntilSla } from '@/lib/date-utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TicketActions } from '@/components/ticket-actions'
import { TicketNoteDrawer } from '@/components/ticket-note-drawer'
import { TicketServiceDrawer } from '@/components/ticket-service-drawer'
import { TicketAiTriageDrawer } from '@/components/ticket-ai-triage-drawer'
import { TicketDetailDrawer } from '@/components/ticket-detail-drawer'
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
  columns?: KanbanColumn[]
  currentColumnId?: string
  onMoveToColumn?: (ticketId: number, columnId: string) => void
  showTriageSummary: boolean
}

export function KanbanCardDraggable({
  ticket,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  isDragOverlay = false,
  columns = [],
  currentColumnId,
  onMoveToColumn,
  showTriageSummary,
}: KanbanCardDraggableProps) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [triageOpen, setTriageOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
  const slaLabel = getTimeUntilSla(ticket.slaSolutionDate)
  const isMyTicket =
    currentUser && ticket.responsavel &&
    ticket.responsavel.toLowerCase() === currentUser.toLowerCase()

  const { data: ticketsWithNotes } = useTicketsWithNotes()
  const hasNote = ticketsWithNotes?.has(ticket.id) ?? false
  const canMoveBetweenColumns = !isDragOverlay && columns.length > 0 && onMoveToColumn

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(ticket.id), disabled: isDragOverlay })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <>
      <div
        ref={isDragOverlay ? undefined : setNodeRef}
        style={isDragOverlay ? { cursor: 'grabbing' } : style}
        className={`rounded-lg border p-3 flex flex-col gap-2 bg-card select-none ${
          isMyTicket ? 'border-primary/40' : 'border-border/40'
        } ${isDragging ? 'ring-1 ring-primary/35' : ''} ${isDragOverlay ? 'shadow-lg rotate-1' : 'cursor-pointer'}`}
        onClick={() => {
          if (!isDragOverlay) setDetailOpen(true)
        }}
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
          <div className="flex items-center gap-1.5">
            <Badge variant={SLA_BADGE_VARIANT[sla]} className="text-xs shrink-0">
              {sla === 'paused' ? 'Pausado' : sla === 'none' ? '—' : slaLabel}
            </Badge>
            {canMoveBetweenColumns && (
              <Popover open={moveOpen} onOpenChange={setMoveOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title="Mover para lista"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreVertical size={14} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-2"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                    Mover para lista
                  </div>
                  <div className="flex flex-col gap-1">
                    {columns.map((column) => {
                      const isCurrent = column.id === currentColumnId
                      return (
                        <button
                          key={column.id}
                          type="button"
                          disabled={isCurrent}
                          onClick={() => {
                            onMoveToColumn(ticket.id, column.id)
                            setMoveOpen(false)
                          }}
                          className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                            isCurrent
                              ? 'cursor-default text-primary bg-primary/10'
                              : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          <span className="truncate">{column.title}</span>
                          {isCurrent && <Check size={13} />}
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {!isDragOverlay && (
              <button
                type="button"
                title="Arrastar chamado"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
                style={{ touchAction: 'none' }}
                onClick={(e) => e.stopPropagation()}
                {...attributes}
                {...listeners}
              >
                <GripVertical size={14} />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm leading-snug line-clamp-3">{ticket.subject || '—'}</p>
      {ticket.ai_triage && (
        <button
          type="button"
          className={`rounded-md border border-primary/25 bg-primary/10 text-left transition-colors hover:bg-primary/15 ${
            showTriageSummary ? 'px-2.5 py-2' : 'px-2 py-1'
          }`}
          onClick={(event) => {
            event.stopPropagation()
            setTriageOpen(true)
          }}
        >
          <div className={`flex items-center gap-1.5 text-[11px] font-medium text-primary ${showTriageSummary ? 'mb-1' : ''}`}>
            <Sparkles size={12} />
            Triagem salva
            <span className="text-muted-foreground">/{ticket.ai_triage.priority}</span>
          </div>
          {showTriageSummary && (
            <p className="line-clamp-2 text-xs leading-snug text-foreground/85">
              {ticket.ai_triage.summary}
            </p>
          )}
        </button>
      )}
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
      <div className="flex flex-wrap items-center gap-1">
        <div className="min-w-0">
          <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <TicketActions
              ticket={ticket}
              agentOptions={agentOptions}
              onAssign={onAssign}
              onUnassign={onUnassign}
              isLoading={isLoading}
              onOpenService={() => setServiceOpen(true)}
              onOpenTriage={() => setTriageOpen(true)}
            />
          </div>
        </div>
          {!isDragOverlay && (
            <div className="flex items-center gap-1">
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
            </div>
          )}
        </div>
      </div>

      <TicketDetailDrawer
        ticket={detailOpen ? ticket : null}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
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
      />
      <TicketAiTriageDrawer
        ticket={triageOpen ? ticket : null}
        open={triageOpen}
        onClose={() => setTriageOpen(false)}
      />
    </>
  )
}
