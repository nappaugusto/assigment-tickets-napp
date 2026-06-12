import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Ticket } from '@/lib/api'
import { normalizeText, getSlaStatus, formatDate, getBrazilDateKey } from '@/lib/date-utils'

export type QuickFilter =
  | 'all'
  | 'new'
  | 'in_progress'
  | 'waiting'
  | 'sla_interrupt'
  | 'sla_risk'
  | 'due_today'
  | 'unassigned'
  | 'without_ai'
  | 'with_ai'
  | 'trello'

export type SortKey = 'id' | 'slaSolutionDate' | 'closed_at' | 'responsavel' | ''
export type SortDir = 'asc' | 'desc'
export type DateFilterField = 'slaSolutionDate' | 'opened_at' | 'closed_at' | 'last_update'

const STATUS_ALIASES: Record<string, string[]> = {
  new: ['novo', 'new'],
  in_progress: ['em atendimento', 'em andamento', 'in progress'],
  waiting: ['aguardando', 'waiting', 'em pausa', 'pausado'],
}

const KEEP_FILTERS_KEY = 'ticketFiltersKeep'
const FILTERS_STORAGE_KEY = 'ticketFiltersState'

interface StoredTicketFilters {
  search: string
  dateFilter: string
  dateFilterField: DateFilterField
  agentFilter: string
  teamFilter: string
  quickFilter: QuickFilter
  sortKey: SortKey
  sortDir: SortDir
}

const DEFAULT_FILTERS: StoredTicketFilters = {
  search: '',
  dateFilter: '',
  dateFilterField: 'slaSolutionDate',
  agentFilter: '',
  teamFilter: '',
  quickFilter: 'all',
  sortKey: '',
  sortDir: 'asc',
}

const DATE_FIELDS: DateFilterField[] = ['slaSolutionDate', 'opened_at', 'closed_at', 'last_update']
const QUICK_FILTERS: QuickFilter[] = [
  'all',
  'new',
  'in_progress',
  'waiting',
  'sla_interrupt',
  'sla_risk',
  'due_today',
  'unassigned',
  'without_ai',
  'with_ai',
  'trello',
]
const SORT_KEYS: SortKey[] = ['id', 'slaSolutionDate', 'closed_at', 'responsavel', '']
const SORT_DIRS: SortDir[] = ['asc', 'desc']

function readInitialFilters() {
  const keepFilters = localStorage.getItem(KEEP_FILTERS_KEY) === '1'
  if (!keepFilters) return { keepFilters, filters: DEFAULT_FILTERS }

  try {
    const stored = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) ?? '{}') as Partial<StoredTicketFilters>
    return {
      keepFilters,
      filters: {
        search: typeof stored.search === 'string' ? stored.search : DEFAULT_FILTERS.search,
        dateFilter: typeof stored.dateFilter === 'string' ? stored.dateFilter : DEFAULT_FILTERS.dateFilter,
        dateFilterField: DATE_FIELDS.includes(stored.dateFilterField as DateFilterField)
          ? stored.dateFilterField as DateFilterField
          : DEFAULT_FILTERS.dateFilterField,
        agentFilter: typeof stored.agentFilter === 'string' ? stored.agentFilter : DEFAULT_FILTERS.agentFilter,
        teamFilter: typeof stored.teamFilter === 'string' ? stored.teamFilter : DEFAULT_FILTERS.teamFilter,
        quickFilter: QUICK_FILTERS.includes(stored.quickFilter as QuickFilter)
          ? stored.quickFilter as QuickFilter
          : DEFAULT_FILTERS.quickFilter,
        sortKey: SORT_KEYS.includes(stored.sortKey as SortKey)
          ? stored.sortKey as SortKey
          : DEFAULT_FILTERS.sortKey,
        sortDir: SORT_DIRS.includes(stored.sortDir as SortDir)
          ? stored.sortDir as SortDir
          : DEFAULT_FILTERS.sortDir,
      },
    }
  } catch {
    return { keepFilters, filters: DEFAULT_FILTERS }
  }
}

function matchesQuickFilter(ticket: Ticket, filter: QuickFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'unassigned') return !ticket.responsavel
  if (filter === 'without_ai') return !ticket.ai_triage
  if (filter === 'with_ai') return Boolean(ticket.ai_triage)
  if (filter === 'trello') return Boolean(ticket.trello_card_url)
  if (filter === 'sla_risk') {
    const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
    return sla === 'warning' || sla === 'expired'
  }
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
      ticket.trello_card_name,
      ticket.ai_triage?.priority,
      ticket.ai_triage?.summary,
      ticket.ai_triage?.likelyArea,
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
  const [initialFilters] = useState(readInitialFilters)

  const [keepFilters, setKeepFilters] = useState(initialFilters.keepFilters)
  const [search, setSearch] = useState(initialFilters.filters.search)
  const [dateFilter, setDateFilter] = useState(initialFilters.filters.dateFilter)
  const [dateFilterField, setDateFilterField] = useState<DateFilterField>(initialFilters.filters.dateFilterField)
  const [agentFilter, setAgentFilter] = useState(initialFilters.filters.agentFilter)
  const [teamFilter, setTeamFilter] = useState(initialFilters.filters.teamFilter)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialFilters.filters.quickFilter)
  const [sortKey, setSortKey] = useState<SortKey>(initialFilters.filters.sortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialFilters.filters.sortDir)

  useEffect(() => {
    if (!keepFilters) {
      localStorage.removeItem(KEEP_FILTERS_KEY)
      localStorage.removeItem(FILTERS_STORAGE_KEY)
      return
    }

    localStorage.setItem(KEEP_FILTERS_KEY, '1')
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
      search,
      dateFilter,
      dateFilterField,
      agentFilter,
      teamFilter,
      quickFilter,
      sortKey,
      sortDir,
    }))
  }, [agentFilter, dateFilter, dateFilterField, keepFilters, quickFilter, search, sortDir, sortKey, teamFilter])

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
    setDateFilterField('slaSolutionDate')
    setAgentFilter('')
    setTeamFilter('')
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

    if (teamFilter) {
      filtered = filtered.filter(
        (t) => normalizeText(t.ownerTeam ?? '') === normalizeText(teamFilter),
      )
    }

    if (dateFilter) {
      filtered = filtered.filter((t) => {
        return getBrazilDateKey(t[dateFilterField]) === dateFilter
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
  }, [agentFilter, dateFilter, dateFilterField, quickFilter, searchTerms, sortDir, sortKey, teamFilter])

  const filteredTickets = useMemo(() => filterTickets(tickets), [tickets, filterTickets])
  const filteredNewTickets = useMemo(() => filterTickets(newTickets), [newTickets, filterTickets])

  const activeFilterCount = [
    search.trim(),
    dateFilter,
    agentFilter,
    teamFilter,
    quickFilter !== 'all' ? quickFilter : '',
  ].filter(Boolean).length

  const agentOptions = useMemo(() => {
    const names = new Set<string>()
    allTickets.forEach((t) => { if (t.responsavel) names.add(t.responsavel) })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [allTickets])

  const teamOptions = useMemo(() => {
    const names = new Set<string>()
    allTickets.forEach((t) => { if (t.ownerTeam) names.add(t.ownerTeam) })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [allTickets])

  return {
    search, setSearch,
    dateFilter, setDateFilter,
    dateFilterField, setDateFilterField,
    agentFilter, setAgentFilter,
    teamFilter, setTeamFilter,
    quickFilter, setQuickFilter,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    keepFilters, setKeepFilters,
    clearFilters,
    sortKey, sortDir, toggleSort,
    filteredTickets,
    filteredNewTickets,
    agentOptions,
    teamOptions,
  }
}
