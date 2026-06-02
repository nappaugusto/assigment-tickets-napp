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
