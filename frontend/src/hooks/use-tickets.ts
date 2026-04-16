import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ticketsApi, type TicketsPayload } from '@/lib/api'

export const TICKETS_QUERY_KEY = ['tickets']

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
    },
  })
}
