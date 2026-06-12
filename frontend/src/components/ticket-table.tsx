import { useState } from 'react'
import { type Ticket } from '@/lib/api'
import { getSlaStatus, getTimeUntilSla, formatDate } from '@/lib/date-utils'
import { useAuth } from '@/contexts/auth-context'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KanbanCardMenu } from '@/components/kanban-card-menu'
import { TicketNoteDrawer } from '@/components/ticket-note-drawer'
import { TicketServiceDrawer } from '@/components/ticket-service-drawer'
import { TicketAiTriageDrawer } from '@/components/ticket-ai-triage-drawer'
import { TicketDetailDrawer } from '@/components/ticket-detail-drawer'
import { type SortKey, type SortDir } from '@/hooks/use-ticket-filters'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronsDownUp, ChevronsUpDown, Sparkles } from 'lucide-react'
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
  showTriageSummary: boolean
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

function TicketRow({ ticket, agentOptions, onAssign, onUnassign, isLoading, currentUser, showTriageSummary }: {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  showTriageSummary: boolean
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [triageOpen, setTriageOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
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
      <TableRow
        className={`${rowColor ?? ''} cursor-pointer border-border/35 transition-colors`}
        onClick={() => setDetailOpen(true)}
      >
        <TableCell className="font-mono text-xs w-16">
          <a
            href={getTicketUrl(ticket.id)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/18 hover:no-underline"
            onClick={(event) => event.stopPropagation()}
          >
            #{ticket.id}
          </a>
        </TableCell>
        <TableCell className="max-w-xs">
          <span className="line-clamp-2 text-sm">{ticket.subject || '—'}</span>
          {ticket.ai_triage && (
            <button
              type="button"
              className={`mt-2 flex max-w-full items-start gap-1.5 rounded-md border border-primary/25 bg-primary/10 text-left text-xs text-muted-foreground transition-colors hover:bg-primary/15 ${
                showTriageSummary ? 'px-2 py-1.5' : 'w-fit px-2 py-1'
              }`}
              onClick={(event) => {
                event.stopPropagation()
                setTriageOpen(true)
              }}
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="font-medium text-primary">Triagem salva</span>
                <span className="text-muted-foreground"> / {ticket.ai_triage.priority}: </span>
                {showTriageSummary && (
                  <span className="line-clamp-2 text-foreground/80">{ticket.ai_triage.summary}</span>
                )}
              </span>
            </button>
          )}
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
                onClick={(event) => event.stopPropagation()}
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
          <div onClick={(event) => event.stopPropagation()}>
            <KanbanCardMenu
              ticket={ticket}
              agentOptions={agentOptions}
              onAssign={onAssign}
              onUnassign={onUnassign}
              isLoading={isLoading}
              onOpenNotes={() => setNoteOpen(true)}
              onOpenService={() => setServiceOpen(true)}
              onOpenTriage={() => setTriageOpen(true)}
            />
          </div>
        </TableCell>
      </TableRow>

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
  collapsed,
  onToggleCollapsed,
  showTriageSummary,
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
  collapsed: boolean
  onToggleCollapsed: () => void
  showTriageSummary: boolean
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/55 bg-card/62 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        </button>
        <button
          type="button"
          className="rounded-full border border-border/60 bg-background/55 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? `Expandir ${title}` : `Minimizar ${title}`}
        >
          {count} ticket{count !== 1 ? 's' : ''}
        </button>
      </div>
      {!collapsed && <div className="overflow-x-auto rounded-lg border border-border/45 bg-background/25">
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
                  showTriageSummary={showTriageSummary}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>}
    </div>
  )
}

export function TicketTable(props: TicketTableProps) {
  const { user } = useAuth()
  const currentUser = user?.name ?? ''
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ticketTableCollapsedSections') ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const trelloTickets = [...props.tickets, ...props.newTickets].filter(
    (ticket) => Boolean(ticket.trello_card_url),
  )
  const inProgressTickets = props.tickets.filter((ticket) => !ticket.trello_card_url)
  const newTickets = props.newTickets.filter((ticket) => !ticket.trello_card_url)
  const sectionIds = ['inProgress', 'trello', 'newTickets']
  const allCollapsed = sectionIds.every((id) => collapsedSections[id])

  const saveCollapsedSections = (next: Record<string, boolean>) => {
    setCollapsedSections(next)
    localStorage.setItem('ticketTableCollapsedSections', JSON.stringify(next))
  }

  const toggleSection = (id: string) => {
    saveCollapsedSections({
      ...collapsedSections,
      [id]: !collapsedSections[id],
    })
  }

  const setAllSectionsCollapsed = (collapsed: boolean) => {
    saveCollapsedSections(Object.fromEntries(sectionIds.map((id) => [id, collapsed])))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs"
          onClick={() => setAllSectionsCollapsed(!allCollapsed)}
        >
          {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
          {allCollapsed ? 'Expandir listas' : 'Minimizar listas'}
        </Button>
      </div>
      <Section
        title="Em Andamento"
        count={inProgressTickets.length}
        tickets={inProgressTickets}
        agentOptions={props.agentOptions}
        onAssign={props.onAssign}
        onUnassign={props.onUnassign}
        isLoading={props.isLoading}
        currentUser={currentUser}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onSort={props.onSort}
        collapsed={!!collapsedSections.inProgress}
        onToggleCollapsed={() => toggleSection('inProgress')}
        showTriageSummary={props.showTriageSummary}
      />
      <Section
        title="No Trello"
        count={trelloTickets.length}
        tickets={trelloTickets}
        agentOptions={props.agentOptions}
        onAssign={props.onAssign}
        onUnassign={props.onUnassign}
        isLoading={props.isLoading}
        currentUser={currentUser}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onSort={props.onSort}
        collapsed={!!collapsedSections.trello}
        onToggleCollapsed={() => toggleSection('trello')}
        showTriageSummary={props.showTriageSummary}
      />
      <Section
        title="Novos Tickets"
        count={newTickets.length}
        tickets={newTickets}
        agentOptions={props.agentOptions}
        onAssign={props.onAssign}
        onUnassign={props.onUnassign}
        isLoading={props.isLoading}
        currentUser={currentUser}
        sortKey={props.sortKey}
        sortDir={props.sortDir}
        onSort={props.onSort}
        collapsed={!!collapsedSections.newTickets}
        onToggleCollapsed={() => toggleSection('newTickets')}
        showTriageSummary={props.showTriageSummary}
      />
    </div>
  )
}
