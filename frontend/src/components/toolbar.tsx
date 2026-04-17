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
    <div className="flex flex-col gap-3 rounded-[1.35rem] border border-border/60 bg-card/80 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="Pesquisar por ID, assunto, responsável…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 flex-1 rounded-xl border-border/70 bg-background/70 text-sm shadow-inner"
        />
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-10 w-full rounded-xl border-border/70 bg-background/70 text-sm shadow-inner sm:w-40"
          aria-label="Filtrar por data SLA"
        />
        <select
          value={agentFilter}
          onChange={(e) => onAgentChange(e.target.value)}
          className="h-10 w-full rounded-xl border border-input bg-background/70 px-3 text-sm text-foreground shadow-inner sm:w-52"
          aria-label="Filtrar por agente"
        >
          <option value="">Todos os agentes</option>
          {agentOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full border border-border/60 bg-background/60 p-1">
          {(['table', 'kanban'] as const).map((m) => (
            <Button
              key={m}
              variant={viewMode === m ? 'default' : 'outline'}
              size="sm"
              className="h-8 rounded-full px-4 text-xs capitalize"
              onClick={() => onViewMode(m)}
            >
              {m === 'table' ? 'Tabela' : 'Kanban'}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastSync && (
            <span className="hidden rounded-full bg-background/60 px-3 py-1.5 text-xs text-muted-foreground sm:block">
              Última sync: <strong>{lastSync}</strong>
            </span>
          )}
          <Button size="sm" variant="outline" className="h-8 rounded-full gap-1.5 px-4 text-xs" onClick={onSync} disabled={isSyncing}>
            <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
