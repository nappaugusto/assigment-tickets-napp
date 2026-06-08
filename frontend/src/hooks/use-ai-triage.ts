import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { aiTriageApi, type TriageDecision } from '@/lib/api'

export function aiTriageQueryKey(ticketId: number) {
  return ['ai-triage', ticketId]
}

export function useTicketAiTriage(ticketId: number, enabled = true) {
  return useQuery({
    queryKey: aiTriageQueryKey(ticketId),
    queryFn: () => aiTriageApi.latest(ticketId),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.triage?.status
      return status === 'pending' || status === 'running' ? 2_500 : false
    },
  })
}

export function useStartAiTriage(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => aiTriageApi.start(ticketId),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
      toast.success('Triagem IA iniciada')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao iniciar triagem IA')
    },
  })
}

export function useReanalyzeAiTriage(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => aiTriageApi.reanalyze(ticketId),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
      toast.success('Reanalise iniciada')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao reanalisar ticket')
    },
  })
}

export function useAiTriageDecision(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: TriageDecision }) =>
      aiTriageApi.decision(id, decision),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao registrar decisão')
    },
  })
}
