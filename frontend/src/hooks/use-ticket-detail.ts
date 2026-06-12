import { useQuery } from '@tanstack/react-query'
import { ticketsApi } from '@/lib/api'

export function ticketDetailQueryKey(ticketId: number) {
  return ['ticket-detail', ticketId]
}

export function useTicketDetail(ticketId: number, enabled = true) {
  return useQuery({
    queryKey: ticketDetailQueryKey(ticketId),
    queryFn: () => ticketsApi.detail(ticketId),
    enabled,
    staleTime: 60_000,
  })
}
