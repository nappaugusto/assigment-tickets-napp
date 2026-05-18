import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  peopleApi,
  ticketsApi,
  type TicketsPayload,
} from '@/lib/api'

export const TICKETS_QUERY_KEY = ['tickets']
export const ASSIGNMENT_PEOPLE_QUERY_KEY = ['assignment-people']
export const ASSIGNMENT_PEOPLE_DETAILS_QUERY_KEY = ['assignment-people-details']

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

export function useAssignmentPeople() {
  return useQuery({
    queryKey: ASSIGNMENT_PEOPLE_QUERY_KEY,
    queryFn: () => peopleApi.assignment(),
    staleTime: 5 * 60_000,
  })
}

export function useAssignmentPeopleDetails() {
  return useQuery({
    queryKey: ASSIGNMENT_PEOPLE_DETAILS_QUERY_KEY,
    queryFn: () => peopleApi.assignmentDetails(),
    staleTime: 5 * 60_000,
  })
}
