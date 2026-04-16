import { type Ticket } from '@/lib/api'

interface SummaryCardsProps {
  visible: number
  novos: number
  emAndamento: number
  venceHoje: number
  semResponsavel: number
}

interface CardItem {
  label: string
  value: number
  className: string
}

export function SummaryCards({ visible, novos, emAndamento, venceHoje, semResponsavel }: SummaryCardsProps) {
  const cards: CardItem[] = [
    { label: 'Visíveis', value: visible, className: 'border-primary/30 bg-primary/5' },
    { label: 'Novos', value: novos, className: 'border-blue-500/30 bg-blue-500/5' },
    { label: 'Em andamento', value: emAndamento, className: 'border-green-500/30 bg-green-500/5' },
    { label: 'Vence hoje', value: venceHoje, className: 'border-yellow-500/30 bg-yellow-500/5' },
    { label: 'Sem responsável', value: semResponsavel, className: 'border-red-500/30 bg-red-500/5' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <article
          key={c.label}
          className={`rounded-lg border p-3 flex flex-col gap-0.5 ${c.className}`}
        >
          <span className="text-xs text-muted-foreground leading-none">{c.label}</span>
          <strong className="text-2xl font-bold tabular-nums">{c.value}</strong>
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
    const slaDate = new Date(t.slaSolutionDate)
    const now = new Date()
    return (
      slaDate.getFullYear() === now.getFullYear() &&
      slaDate.getMonth() === now.getMonth() &&
      slaDate.getDate() === now.getDate()
    )
  }).length
  const semResponsavel = all.filter((t) => !t.responsavel).length
  return { visible: all.length, novos, emAndamento, venceHoje, semResponsavel }
}
