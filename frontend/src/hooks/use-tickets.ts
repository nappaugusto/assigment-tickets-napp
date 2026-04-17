import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ticketsApi,
  type TicketsPayload,
  type TicketMonthlyAnalyticsPayload,
} from '@/lib/api'

export const TICKETS_QUERY_KEY = ['tickets']
export const TICKETS_MONTHLY_ANALYTICS_QUERY_KEY = ['tickets', 'analytics', 'monthly']

export function useTickets() {
  return useQuery({
    queryKey: TICKETS_QUERY_KEY,
    queryFn: () => ticketsApi.refresh(false),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
}

export function useSyncTickets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => ticketsApi.refresh(true),
    onSuccess: (data) => {
      qc.setQueryData<TicketsPayload>(TICKETS_QUERY_KEY, data)
      qc.invalidateQueries({ queryKey: TICKETS_MONTHLY_ANALYTICS_QUERY_KEY })
    },
  })
}

export function useTicketMonthlyAnalytics(months = 6) {
  return useQuery({
    queryKey: [...TICKETS_MONTHLY_ANALYTICS_QUERY_KEY, months],
    queryFn: () => ticketsApi.monthlyAnalytics(months),
    staleTime: 30_000,
  })
}
