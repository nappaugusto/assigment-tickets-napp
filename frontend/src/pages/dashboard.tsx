import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { useTickets, useSyncTickets } from '@/hooks/use-tickets'
import { useTicketFilters } from '@/hooks/use-ticket-filters'
import { useTicketActions } from '@/hooks/use-ticket-actions'
import { useAppVersion } from '@/hooks/use-app-version'
import { Header } from '@/components/header'
import { SummaryCards, computeSummary } from '@/components/summary-cards'
import { QuickFilters } from '@/components/quick-filters'
import { Toolbar } from '@/components/toolbar'
import { TicketTable } from '@/components/ticket-table'
import { KanbanView } from '@/components/kanban-view'
import { formatDate } from '@/lib/date-utils'

export function DashboardPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    return (localStorage.getItem('viewMode') as 'table' | 'kanban') ?? 'table'
  })

  useAppVersion()

  const { data, isLoading } = useTickets()
  const syncMutation = useSyncTickets()
  const { assignTicket, unassignTicket, isAssigning, isUnassigning } = useTicketActions()

  const tickets = data?.tickets ?? []
  const newTickets = data?.close_tickets ?? []
  const lastSync = data?.now ? formatDate(data.now) : undefined

  const filters = useTicketFilters(tickets, newTickets, '')
  const summary = computeSummary(filters.filteredTickets, filters.filteredNewTickets)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const handleSync = () => {
    syncMutation.mutate(undefined, {
      onSuccess: () => toast.success('Tickets sincronizados!'),
      onError: () => toast.error('Erro ao sincronizar'),
    })
  }

  const handleViewMode = (m: 'table' | 'kanban') => {
    setViewMode(m)
    localStorage.setItem('viewMode', m)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-foreground">Carregando tickets…</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onLogout={handleLogout} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-64 flex-col gap-4 border-r border-border/40 p-4 overflow-y-auto">
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Painel operacional</p>
            <h2 className="font-semibold text-sm leading-tight">Priorize com contexto</h2>
          </div>

          <SummaryCards {...summary} />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filtros rápidos</span>
            <QuickFilters active={filters.quickFilter} onChange={filters.setQuickFilter} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto min-h-0">
          {/* Mobile summary + quick filters */}
          <div className="lg:hidden flex flex-col gap-3">
            <SummaryCards {...summary} />
            <QuickFilters active={filters.quickFilter} onChange={filters.setQuickFilter} />
          </div>

          <Toolbar
            search={filters.search}
            onSearchChange={filters.setSearch}
            dateFilter={filters.dateFilter}
            onDateChange={filters.setDateFilter}
            agentFilter={filters.agentFilter}
            onAgentChange={filters.setAgentFilter}
            agentOptions={filters.agentOptions}
            onSync={handleSync}
            isSyncing={syncMutation.isPending}
            lastSync={lastSync}
            viewMode={viewMode}
            onViewMode={handleViewMode}
          />

          {viewMode === 'table' ? (
            <TicketTable
              tickets={filters.filteredTickets}
              newTickets={filters.filteredNewTickets}
              agentOptions={filters.agentOptions}
              onAssign={assignTicket}
              onUnassign={unassignTicket}
              isLoading={isAssigning || isUnassigning}
              sortKey={filters.sortKey}
              sortDir={filters.sortDir}
              onSort={filters.toggleSort}
            />
          ) : (
            <KanbanView
              tickets={filters.filteredTickets}
              newTickets={filters.filteredNewTickets}
              agentOptions={filters.agentOptions}
              onAssign={assignTicket}
              onUnassign={unassignTicket}
              isLoading={isAssigning || isUnassigning}
            />
          )}
        </main>
      </div>
    </div>
  )
}
