import { useCallback, useMemo, useState } from 'react'
import { type Ticket } from '@/lib/api'
import { normalizeText, getSlaStatus, formatDate } from '@/lib/date-utils'

export type QuickFilter =
  | 'all'
  | 'new'
  | 'in_progress'
  | 'waiting'
  | 'sla_interrupt'
  | 'due_today'
  | 'unassigned'

export type SortKey = 'id' | 'slaSolutionDate' | 'closed_at' | 'responsavel' | ''
export type SortDir = 'asc' | 'desc'

const STATUS_ALIASES: Record<string, string[]> = {
  new: ['novo', 'new'],
  in_progress: ['em atendimento', 'em andamento', 'in progress'],
  waiting: ['aguardando', 'waiting', 'em pausa', 'pausado'],
}

function matchesQuickFilter(ticket: Ticket, filter: QuickFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'unassigned') return !ticket.responsavel
  if (filter === 'due_today') {
    const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
    return sla === 'warning' || sla === 'expired'
  }
  if (filter === 'sla_interrupt') {
    return getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused) === 'expired'
  }

  const statusNorm = normalizeText(ticket.status ?? '')
  if (filter === 'new') {
    return STATUS_ALIASES.new.some((s) => statusNorm.includes(s))
  }
  if (filter === 'in_progress') {
    return STATUS_ALIASES.in_progress.some((s) => statusNorm.includes(s))
  }
  if (filter === 'waiting') {
    return STATUS_ALIASES.waiting.some((s) => statusNorm.includes(s))
  }
  return true
}

function buildSearchHaystack(ticket: Ticket): string {
  return normalizeText(
    [
      ticket.id,
      `#${ticket.id}`,
      ticket.subject,
      ticket.status,
      ticket.ownerTeam,
      ticket.responsavel,
      ticket.slaSolutionDate,
      ticket.slaSolutionDate ? formatDate(ticket.slaSolutionDate) : '',
      ticket.opened_at,
      ticket.opened_at ? formatDate(ticket.opened_at) : '',
      ticket.closed_at,
      ticket.closed_at ? formatDate(ticket.closed_at) : '',
      ticket.last_update,
      ticket.last_update ? formatDate(ticket.last_update) : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
}

export function useTicketFilters(
  tickets: Ticket[],
  newTickets: Ticket[],
) {
  const allTickets = useMemo(() => [...tickets, ...newTickets], [tickets, newTickets])

  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const clearFilters = () => {
    setSearch('')
    setDateFilter('')
    setAgentFilter('')
    setQuickFilter('all')
  }

  const searchTerms = useMemo(() => {
    return normalizeText(search)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  }, [search])

  const filterTickets = useCallback((list: Ticket[]): Ticket[] => {
    let filtered = list

    if (searchTerms.length > 0) {
      filtered = filtered.filter(
        (t) => {
          const haystack = buildSearchHaystack(t)
          return searchTerms.every((term) => haystack.includes(term))
        },
      )
    }

    if (agentFilter) {
      filtered = filtered.filter(
        (t) => normalizeText(t.responsavel ?? '') === normalizeText(agentFilter),
      )
    }

    if (dateFilter) {
      filtered = filtered.filter((t) => {
        if (!t.slaSolutionDate) return false
        return t.slaSolutionDate.slice(0, 10) === dateFilter
      })
    }

    filtered = filtered.filter((t) => matchesQuickFilter(t, quickFilter))

    if (sortKey) {
      filtered = [...filtered].sort((a, b) => {
        let aVal: string | number = ''
        let bVal: string | number = ''
        if (sortKey === 'id') {
          aVal = a.id
          bVal = b.id
        } else if (sortKey === 'slaSolutionDate') {
          aVal = a.slaSolutionDate ?? ''
          bVal = b.slaSolutionDate ?? ''
        } else if (sortKey === 'closed_at') {
          aVal = a.closed_at ?? ''
          bVal = b.closed_at ?? ''
        } else if (sortKey === 'responsavel') {
          aVal = normalizeText(a.responsavel ?? '')
          bVal = normalizeText(b.responsavel ?? '')
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }

    return filtered
  }, [agentFilter, dateFilter, quickFilter, searchTerms, sortDir, sortKey])

  const filteredTickets = useMemo(() => filterTickets(tickets), [tickets, filterTickets])
  const filteredNewTickets = useMemo(() => filterTickets(newTickets), [newTickets, filterTickets])

  const activeFilterCount = [
    search.trim(),
    dateFilter,
    agentFilter,
    quickFilter !== 'all' ? quickFilter : '',
  ].filter(Boolean).length

  const agentOptions = useMemo(() => {
    const names = new Set<string>()
    allTickets.forEach((t) => { if (t.responsavel) names.add(t.responsavel) })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [allTickets])

  return {
    search, setSearch,
    dateFilter, setDateFilter,
    agentFilter, setAgentFilter,
    quickFilter, setQuickFilter,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    clearFilters,
    sortKey, sortDir, toggleSort,
    filteredTickets,
    filteredNewTickets,
    agentOptions,
  }
}
