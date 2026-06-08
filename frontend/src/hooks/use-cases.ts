import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  casesApi,
  type CreateInternalCasePayload,
  type InternalCase,
} from '@/lib/api'

export const CASES_QUERY_KEY = ['internal-cases']
export const CASE_DASHBOARD_QUERY_KEY = ['internal-cases-dashboard']
export const CASE_SLA_POLICIES_QUERY_KEY = ['internal-case-sla-policies']

export function useInternalCases() {
  return useQuery({
    queryKey: CASES_QUERY_KEY,
    queryFn: () => casesApi.list(),
    refetchInterval: 60_000,
  })
}

export function useInternalCase(id: number | null) {
  return useQuery({
    queryKey: [...CASES_QUERY_KEY, id],
    queryFn: () => casesApi.get(id as number),
    enabled: !!id,
  })
}

export function useInternalCaseDashboard() {
  return useQuery({
    queryKey: CASE_DASHBOARD_QUERY_KEY,
    queryFn: () => casesApi.dashboard(),
    refetchInterval: 60_000,
  })
}

export function useInternalCaseSlaPolicies() {
  return useQuery({
    queryKey: CASE_SLA_POLICIES_QUERY_KEY,
    queryFn: () => casesApi.slaPolicies(),
  })
}

export function useCreateInternalCase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateInternalCasePayload) => casesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CASE_DASHBOARD_QUERY_KEY })
      toast.success('Chamado aberto com sucesso')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao abrir chamado')
    },
  })
}

export function useUpdateInternalCaseStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: InternalCase['status'] }) =>
      casesApi.updateStatus(id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: CASES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: [...CASES_QUERY_KEY, variables.id] })
      queryClient.invalidateQueries({ queryKey: CASE_DASHBOARD_QUERY_KEY })
      toast.success('Status do chamado atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar chamado')
    },
  })
}

export function useAddInternalCaseComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      casesApi.addComment(id, content),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: CASES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: [...CASES_QUERY_KEY, variables.id] })
      toast.success('Comentário adicionado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao comentar')
    },
  })
}

export function useUpdateInternalCaseSlaPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: casesApi.updateSlaPolicy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASE_SLA_POLICIES_QUERY_KEY })
      toast.success('SLA atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar SLA')
    },
  })
}
