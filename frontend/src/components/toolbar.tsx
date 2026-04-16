import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type SortKey, type SortDir } from '@/hooks/use-ticket-filters'

interface ToolbarProps {
  search: string
  onSearchChange: (v: string) => void
  dateFilter: string
  onDateChange: (v: string) => void
  agentFilter: string
  onAgentChange: (v: string) => void
  agentOptions: string[]
  onSync: () => void
  isSyncing: boolean
  lastSync?: string
  viewMode: 'table' | 'kanban'
  onViewMode: (m: 'table' | 'kanban') => void
}

export function Toolbar({
  search,
  onSearchChange,
  dateFilter,
  onDateChange,
  agentFilter,
  onAgentChange,
  agentOptions,
  onSync,
  isSyncing,
  lastSync,
  viewMode,
  onViewMode,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/40 bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="Pesquisar por ID, assunto, responsável…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 h-8 text-sm"
        />
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-full sm:w-36 h-8 text-sm"
          aria-label="Filtrar por data SLA"
        />
        <select
          value={agentFilter}
          onChange={(e) => onAgentChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground w-full sm:w-44"
          aria-label="Filtrar por agente"
        >
          <option value="">Todos os agentes</option>
          {agentOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['table', 'kanban'] as const).map((m) => (
            <Button
              key={m}
              variant={viewMode === m ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-3 text-xs capitalize"
              onClick={() => onViewMode(m)}
            >
              {m === 'table' ? 'Tabela' : 'Kanban'}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastSync && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Última sync: <strong>{lastSync}</strong>
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onSync} disabled={isSyncing}>
            <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
