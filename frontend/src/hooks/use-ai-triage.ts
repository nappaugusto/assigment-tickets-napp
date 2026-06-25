import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { aiTriageApi, type TriageDecision } from '@/lib/api'
import { TICKETS_QUERY_KEY } from '@/hooks/use-tickets'

export function aiTriageQueryKey(ticketId: number) {
  return ['ai-triage', ticketId]
}

export function useTicketAiTriage(ticketId: number, enabled = true) {
  const queryClient = useQueryClient()
  const lastSettledTriageId = useRef<number | null>(null)
  const query = useQuery({
    queryKey: aiTriageQueryKey(ticketId),
    queryFn: () => aiTriageApi.latest(ticketId),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.triage?.status
      return status === 'pending' || status === 'running' ? 2_500 : false
    },
  })

  useEffect(() => {
    const triage = query.data?.triage
    if (!triage || (triage.status !== 'completed' && triage.status !== 'failed')) return
    if (lastSettledTriageId.current === triage.id) return

    lastSettledTriageId.current = triage.id
    void queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY })
  }, [query.data?.triage?.id, query.data?.triage?.status, queryClient])

  return query
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

export function useAnalyzeCodeAiTriage(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (context: { sellerIds?: string[]; eans?: string[]; notes?: string }) =>
      aiTriageApi.analyzeCode(ticketId, context),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
      toast.success('Análise de código iniciada')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao analisar código')
    },
  })
}

export function useAiTriageDecision(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: TriageDecision }) => aiTriageApi.decision(id, decision),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao registrar decisão')
    },
  })
}

export function useAiTriageFollowUp(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) => aiTriageApi.followUp(id, message),
    onSuccess: (data) => {
      queryClient.setQueryData(aiTriageQueryKey(ticketId), data)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao enviar mensagem para a triagem')
    },
  })
}
