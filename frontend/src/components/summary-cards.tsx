import { type Ticket } from '@/lib/api'
import { isToday } from '@/lib/date-utils'

interface SummaryCardsProps {
  visible: number
  novos: number
  emAndamento: number
  venceHoje: number
  semResponsavel: number
  compact?: boolean
}

interface CardItem {
  label: string
  value: number
  className: string
}

export function SummaryCards({ visible, novos, emAndamento, venceHoje, semResponsavel, compact }: SummaryCardsProps) {
  const cards: CardItem[] = [
    { label: 'Visíveis', value: visible, className: 'border-primary/30 bg-gradient-to-br from-primary/18 to-primary/5 shadow-[0_14px_35px_rgba(10,94,94,0.25)]' },
    { label: 'Novos', value: novos, className: 'border-cyan-400/25 bg-gradient-to-br from-cyan-400/16 to-cyan-400/4 shadow-[0_14px_35px_rgba(34,211,238,0.12)]' },
    { label: 'Em andamento', value: emAndamento, className: 'border-emerald-400/25 bg-gradient-to-br from-emerald-400/16 to-emerald-400/4 shadow-[0_14px_35px_rgba(52,211,153,0.12)]' },
    { label: 'Vence hoje', value: venceHoje, className: 'border-amber-400/25 bg-gradient-to-br from-amber-400/16 to-amber-400/4 shadow-[0_14px_35px_rgba(251,191,36,0.12)]' },
    { label: 'Sem responsável', value: semResponsavel, className: 'border-rose-400/25 bg-gradient-to-br from-rose-400/16 to-rose-400/4 shadow-[0_14px_35px_rgba(251,113,133,0.12)]' },
  ]

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
      {cards.map((c) => (
        <article
          key={c.label}
          className={`rounded-2xl border p-3.5 flex flex-col gap-1 ${c.className}`}
        >
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground leading-none">{c.label}</span>
          <strong className="text-3xl font-semibold tabular-nums text-foreground">{c.value}</strong>
        </article>
      ))}
    </div>
  )
}

export function computeSummary(tickets: Ticket[], newTickets: Ticket[]) {
  const all = [...tickets, ...newTickets]
  const novos = newTickets.length
  const emAndamento = tickets.length
  const venceHoje = all.filter((t) => {
    if (!t.slaSolutionDate || t.slaSolutionDateIsPaused) return false
    return isToday(t.slaSolutionDate)
  }).length
  const semResponsavel = all.filter((t) => !t.responsavel).length
  return { visible: all.length, novos, emAndamento, venceHoje, semResponsavel }
}
