import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { useAssignmentPeople, useTickets, useSyncTickets } from '@/hooks/use-tickets'
import { useTicketFilters } from '@/hooks/use-ticket-filters'
import { useTicketActions } from '@/hooks/use-ticket-actions'
import { useAppVersion } from '@/hooks/use-app-version'
import { Header } from '@/components/header'
import { MonthlyAnalytics } from '@/components/monthly-analytics'
import { SummaryCards, computeSummary } from '@/components/summary-cards'
import { QuickFilters } from '@/components/quick-filters'
import { Toolbar } from '@/components/toolbar'
import { TicketTable } from '@/components/ticket-table'
import { KanbanBoard } from '@/components/kanban-board'
import { McpDeskDrawer } from '@/components/mcp-desk-drawer'
import { InternalCasesPanel } from '@/components/internal-cases-panel'
import { formatDate } from '@/lib/date-utils'

export function DashboardPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    return (localStorage.getItem('viewMode') as 'table' | 'kanban') ?? 'table'
  })
  const [mcpDeskOpen, setMcpDeskOpen] = useState(false)

  useAppVersion()

  const { data, isLoading } = useTickets()
  const { data: assignmentPeople } = useAssignmentPeople()
  const syncMutation = useSyncTickets()
  const { assignTicket, unassignTicket, isAssigning, isUnassigning } = useTicketActions()

  const tickets = data?.tickets ?? []
  const newTickets = data?.close_tickets ?? []
  const monthlyAnalytics = data?.monthly_analytics
  const lastSync = data?.now ? formatDate(data.now) : undefined

  const filters = useTicketFilters(tickets, newTickets)
  const agentOptions = assignmentPeople?.people?.length
    ? assignmentPeople.people
    : filters.agentOptions
  const summary = computeSummary(filters.filteredTickets, filters.filteredNewTickets)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const handleSync = () => {
    syncMutation.mutate(undefined, {
      onSuccess: () => toast.success('Tickets sincronizados!'),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Erro ao sincronizar',
        ),
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
    <div className="min-h-screen flex flex-col bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.08))]">
      <Header onLogout={handleLogout} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-72 flex-col gap-4 border-r border-border/40 bg-card/35 p-5 overflow-y-auto backdrop-blur-sm">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">Painel operacional</p>
            <h2 className="font-semibold text-lg leading-tight text-foreground">Priorize com contexto</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enxergue urgência, dono e fechamento sem sair da fila.
            </p>
          </div>

          <SummaryCards {...summary} compact />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filtros rápidos</span>
            <QuickFilters active={filters.quickFilter} onChange={filters.setQuickFilter} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto min-h-0 md:p-6">
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
            dateFilterField={filters.dateFilterField}
            onDateFieldChange={filters.setDateFilterField}
            agentFilter={filters.agentFilter}
            onAgentChange={filters.setAgentFilter}
            agentOptions={agentOptions}
            onSync={handleSync}
            isSyncing={syncMutation.isPending}
            lastSync={lastSync}
            viewMode={viewMode}
            onViewMode={handleViewMode}
            totalCount={tickets.length + newTickets.length}
            visibleCount={summary.visible}
            activeFilterCount={filters.activeFilterCount}
            hasActiveFilters={filters.hasActiveFilters}
            keepFilters={filters.keepFilters}
            onKeepFiltersChange={filters.setKeepFilters}
            onClearFilters={filters.clearFilters}
            onOpenMcpDesk={() => setMcpDeskOpen(true)}
          />

          <MonthlyAnalytics
            analytics={monthlyAnalytics}
            isLoading={isLoading || syncMutation.isPending}
          />

          <InternalCasesPanel />

          {viewMode === 'table' ? (
            <TicketTable
              tickets={filters.filteredTickets}
              newTickets={filters.filteredNewTickets}
              agentOptions={agentOptions}
              onAssign={assignTicket}
              onUnassign={unassignTicket}
              isLoading={isAssigning || isUnassigning}
              sortKey={filters.sortKey}
              sortDir={filters.sortDir}
              onSort={filters.toggleSort}
            />
          ) : (
            <KanbanBoard
              tickets={filters.filteredTickets}
              newTickets={filters.filteredNewTickets}
              agentOptions={agentOptions}
              onAssign={assignTicket}
              onUnassign={unassignTicket}
              isLoading={isAssigning || isUnassigning}
            />
          )}

          <McpDeskDrawer
            open={mcpDeskOpen}
            onClose={() => setMcpDeskOpen(false)}
          />
        </main>
      </div>
    </div>
  )
}
