import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { internalTeamsApi } from '@/lib/api'

export const INTERNAL_TEAMS_QUERY_KEY = ['internal-teams']
export const INTERNAL_USERS_QUERY_KEY = ['internal-users']

export function useInternalTeams() {
  return useQuery({
    queryKey: INTERNAL_TEAMS_QUERY_KEY,
    queryFn: internalTeamsApi.list,
  })
}

export function useInternalUsers() {
  return useQuery({
    queryKey: INTERNAL_USERS_QUERY_KEY,
    queryFn: internalTeamsApi.users,
  })
}

export function useCreateInternalTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: internalTeamsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success('Time criado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar time')
    },
  })
}

export function useSyncMovideskTeams() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: internalTeamsApi.syncMovidesk,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success(`${data.syncedCount} time(s) sincronizado(s) do Movidesk`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao sincronizar times')
    },
  })
}

export function useAddInternalTeamMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ teamId, userId, isAdmin }: { teamId: number; userId: number; isAdmin?: boolean }) =>
      internalTeamsApi.addMember(teamId, { userId, isAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success('Membro atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar membro')
    },
  })
}

export function useUpdateInternalTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ teamId, name, description }: { teamId: number; name?: string; description?: string }) =>
      internalTeamsApi.update(teamId, { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success('Time atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar time')
    },
  })
}

export function useDeleteInternalTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (teamId: number) => internalTeamsApi.delete(teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success('Time removido')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover time')
    },
  })
}

export function useRemoveInternalTeamMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ teamId, userId }: { teamId: number; userId: number }) =>
      internalTeamsApi.removeMember(teamId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_TEAMS_QUERY_KEY })
      toast.success('Membro removido')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover membro')
    },
  })
}
