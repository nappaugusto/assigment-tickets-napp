import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  casesApi,
  type CreateInternalCasePayload,
  type InternalCase,
} from '@/lib/api'

export const CASES_QUERY_KEY = ['internal-cases']

export function useInternalCases() {
  return useQuery({
    queryKey: CASES_QUERY_KEY,
    queryFn: () => casesApi.list(),
    refetchInterval: 60_000,
  })
}

export function useCreateInternalCase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateInternalCasePayload) => casesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASES_QUERY_KEY })
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASES_QUERY_KEY })
      toast.success('Status do chamado atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar chamado')
    },
  })
}
