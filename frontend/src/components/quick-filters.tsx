import { type QuickFilter } from '@/hooks/use-ticket-filters'
import { Button } from '@/components/ui/button'

const FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'new', label: 'Novos' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'waiting', label: 'Aguardando' },
  { value: 'sla_interrupt', label: 'Interrupção de SLA' },
  { value: 'sla_risk', label: 'Risco SLA' },
  { value: 'due_today', label: 'Vence hoje' },
  { value: 'unassigned', label: 'Não atribuídos' },
  { value: 'without_ai', label: 'Sem IA' },
  { value: 'with_ai', label: 'Com IA' },
  { value: 'trello', label: 'No Trello' },
]

interface QuickFiltersProps {
  active: QuickFilter
  onChange: (f: QuickFilter) => void
}

export function QuickFilters({ active, onChange }: QuickFiltersProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => (
        <Button
          key={f.value}
          variant={active === f.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(f.value)}
          className="h-7 px-3 text-xs"
        >
          {f.label}
        </Button>
      ))}
    </div>
  )
}
