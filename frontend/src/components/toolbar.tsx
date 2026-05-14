import { Bot, CalendarDays, Columns3, RefreshCw, Search, Table2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { type DateFilterField } from '@/hooks/use-ticket-filters'

interface ToolbarProps {
  search: string
  onSearchChange: (v: string) => void
  dateFilter: string
  onDateChange: (v: string) => void
  dateFilterField: DateFilterField
  onDateFieldChange: (v: DateFilterField) => void
  agentFilter: string
  onAgentChange: (v: string) => void
  agentOptions: string[]
  onSync: () => void
  isSyncing: boolean
  lastSync?: string
  viewMode: 'table' | 'kanban'
  onViewMode: (m: 'table' | 'kanban') => void
  totalCount: number
  visibleCount: number
  activeFilterCount: number
  hasActiveFilters: boolean
  keepFilters: boolean
  onKeepFiltersChange: (v: boolean) => void
  onClearFilters: () => void
  onOpenMcpDesk?: () => void
}

export function Toolbar({
  search,
  onSearchChange,
  dateFilter,
  onDateChange,
  dateFilterField,
  onDateFieldChange,
  agentFilter,
  onAgentChange,
  agentOptions,
  onSync,
  isSyncing,
  lastSync,
  viewMode,
  onViewMode,
  totalCount,
  visibleCount,
  activeFilterCount,
  hasActiveFilters,
  keepFilters,
  onKeepFiltersChange,
  onClearFilters,
  onOpenMcpDesk,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/88 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tickets</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold leading-tight text-foreground">Fila operacional</h1>
            <span className="text-sm text-muted-foreground">
              {visibleCount} de {totalCount} visíveis
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasActiveFilters && (
            <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
              {activeFilterCount} filtro{activeFilterCount !== 1 ? 's' : ''} ativo{activeFilterCount !== 1 ? 's' : ''}
            </span>
          )}
          {lastSync && (
            <span className="rounded-full border border-border/60 bg-background/55 px-3 py-1.5 text-xs text-muted-foreground">
              Última sync: <strong>{lastSync}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_180px_240px_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Pesquisar por #ID, assunto, responsável, status…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 rounded-lg border-border/70 bg-background/70 pl-9 pr-9 text-sm shadow-inner"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Limpar pesquisa"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => onDateChange(e.target.value)}
            className="h-10 rounded-lg border-border/70 bg-background/70 pl-9 text-sm shadow-inner"
            aria-label="Filtrar por data"
          />
        </label>

        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={dateFilterField}
            onChange={(e) => onDateFieldChange(e.target.value as DateFilterField)}
            className="h-10 w-full rounded-lg border border-input bg-background/70 pl-9 pr-3 text-sm text-foreground shadow-inner outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            aria-label="Tipo de data para filtro"
          >
            <option value="slaSolutionDate">Vencimento/SLA</option>
            <option value="opened_at">Abertura</option>
            <option value="closed_at">Fechamento</option>
            <option value="last_update">Última atualização</option>
          </select>
        </label>

        <label className="relative">
          <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={agentFilter}
            onChange={(e) => onAgentChange(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background/70 pl-9 pr-3 text-sm text-foreground shadow-inner outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            aria-label="Filtrar por agente"
          >
            <option value="">Todos os agentes</option>
            {agentOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>

        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-lg px-3 text-xs"
          onClick={onClearFilters}
          disabled={!hasActiveFilters}
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-fit gap-1 rounded-lg border border-border/60 bg-background/60 p-1">
            {(['table', 'kanban'] as const).map((m) => (
              <Button
                key={m}
                variant={viewMode === m ? 'default' : 'outline'}
                size="sm"
                className="h-8 rounded-md px-3 text-xs"
                onClick={() => onViewMode(m)}
              >
                {m === 'table' ? <Table2 className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}
                {m === 'table' ? 'Tabela' : 'Kanban'}
              </Button>
            ))}
          </div>

          <label className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs text-muted-foreground">
            <Checkbox
              checked={keepFilters}
              onCheckedChange={(checked) => onKeepFiltersChange(checked === true)}
              aria-label="Manter filtros"
            />
            Manter filtros
          </label>
        </div>

        <div className="flex items-center gap-2 sm:justify-end">
          {onOpenMcpDesk && (
            <Button size="sm" variant="outline" className="h-8 rounded-md gap-1.5 px-3 text-xs" onClick={onOpenMcpDesk}>
              <Bot className="h-3.5 w-3.5" />
              MCP
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 rounded-md gap-1.5 px-3 text-xs" onClick={onSync} disabled={isSyncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
