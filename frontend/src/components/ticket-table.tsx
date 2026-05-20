import { useState } from 'react'
import { type Ticket } from '@/lib/api'
import { getSlaStatus, getTimeUntilSla, formatDate } from '@/lib/date-utils'
import { useAuth } from '@/contexts/auth-context'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KanbanCardMenu } from '@/components/kanban-card-menu'
import { TicketNoteDrawer } from '@/components/ticket-note-drawer'
import { TicketServiceDrawer } from '@/components/ticket-service-drawer'
import { type SortKey, type SortDir } from '@/hooks/use-ticket-filters'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AssignAgentCommand } from '@/components/assign-agent-command'
import { getTicketUrl } from '@/lib/utils'

const SLA_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'outline' | 'default'> = {
  expired: 'destructive',
  warning: 'warning',
  normal: 'default',
  paused: 'secondary',
  none: 'outline',
}

interface TicketTableProps {
  tickets: Ticket[]
  newTickets: Ticket[]
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}

function SortButton({ label, sortK, active, dir, onSort }: {
  label: string
  sortK: SortKey
  active: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const Icon = active === sortK ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <Button variant="ghost" size="sm" className="h-7 px-1 gap-1 text-xs font-medium" onClick={() => onSort(sortK)}>
      {label}
      <Icon className="h-3 w-3" />
    </Button>
  )
}

function TicketRow({ ticket, agentOptions, onAssign, onUnassign, isLoading, currentUser }: {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
  const slaLabel = getTimeUntilSla(ticket.slaSolutionDate)
  const isMyTicket = currentUser && ticket.responsavel &&
    ticket.responsavel.toLowerCase() === currentUser.toLowerCase()

  const rowColor =
    sla === 'expired' ? 'bg-destructive/10 hover:bg-destructive/15' :
    sla === 'warning' ? 'bg-orange-500/10 hover:bg-orange-500/15' :
    isMyTicket ? 'bg-primary/5' : undefined

  return (
    <>
      <TableRow className={`${rowColor ?? ''} border-border/35 transition-colors`}>
        <TableCell className="font-mono text-xs w-16">
          <a
            href={getTicketUrl(ticket.id)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/18 hover:no-underline"
          >
            #{ticket.id}
          </a>
        </TableCell>
        <TableCell className="max-w-xs">
          <span className="line-clamp-2 text-sm">{ticket.subject || '—'}</span>
        </TableCell>
        <TableCell className="w-36">
          <Badge variant={SLA_BADGE_VARIANT[sla]} className="text-xs gap-1 whitespace-nowrap">
            {sla === 'paused' ? 'Pausado' : sla === 'none' ? '—' : slaLabel}
          </Badge>
        </TableCell>
        <TableCell className="w-40 text-sm text-muted-foreground">
          {ticket.slaSolutionDate ? formatDate(ticket.slaSolutionDate) : '—'}
        </TableCell>
        <TableCell className="w-36 text-sm">
          <Popover open={assignOpen} onOpenChange={setAssignOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="max-w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
                disabled={isLoading}
                title="Alterar responsável"
              >
                {ticket.responsavel ? (
                  <span className={isMyTicket ? 'text-primary font-medium' : undefined}>
                    {isMyTicket ? 'Seu chamado' : ticket.responsavel}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Não atribuído</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="end">
              <AssignAgentCommand
                agentOptions={agentOptions}
                autoFocus
                onAssign={(responsavel) => {
                  onAssign(ticket.id, responsavel)
                  setAssignOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </TableCell>
        <TableCell className="w-12 text-center">
          <KanbanCardMenu
            ticket={ticket}
            agentOptions={agentOptions}
            onAssign={onAssign}
            onUnassign={onUnassign}
            isLoading={isLoading}
            onOpenNotes={() => setNoteOpen(true)}
            onOpenService={() => setServiceOpen(true)}
          />
        </TableCell>
      </TableRow>

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
    </>
  )
}

function Section({
  title,
  count,
  tickets,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  sortKey,
  sortDir,
  onSort,
}: {
  title: string
  count: number
  tickets: Ticket[]
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/55 bg-card/62 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <span className="rounded-full border border-border/60 bg-background/55 px-3 py-1 text-xs text-muted-foreground">
          {count} ticket{count !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/45 bg-background/25">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 bg-muted/35 hover:bg-muted/35">
              <TableHead className="w-16">
                <SortButton label="ID" sortK="id" active={sortKey} dir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead className="w-36">
                <SortButton label="Data SLA" sortK="slaSolutionDate" active={sortKey} dir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead className="w-40">
                <SortButton label="Vencimento" sortK="slaSolutionDate" active={sortKey} dir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead className="w-36">
                <SortButton label="Responsável" sortK="responsavel" active={sortKey} dir={sortDir} onSort={onSort} />
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  Nenhum ticket encontrado
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => (
                <TicketRow
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
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function TicketTable(props: TicketTableProps) {
  const { user } = useAuth()
  const currentUser = user?.name ?? ''

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Novos Tickets"
        count={props.newTickets.length}
        tickets={props.newTickets}
        agentOptions={props.agentOptions}
        onAssign={props.onAssign}
        onUnassign={props.onUnassign}
        isLoading={props.isLoading}
        currentUser={currentUser}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onSort={props.onSort}
      />
      <Section
        title="Em Andamento"
        count={props.tickets.length}
        tickets={props.tickets}
        agentOptions={props.agentOptions}
        onAssign={props.onAssign}
        onUnassign={props.onUnassign}
        isLoading={props.isLoading}
        currentUser={currentUser}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onSort={props.onSort}
      />
    </div>
  )
}
