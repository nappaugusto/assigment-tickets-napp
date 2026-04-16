import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ticketsApi, type Ticket } from '@/lib/api'

export function useTicketActions() {
  const queryClient = useQueryClient()

  const assignMutation = useMutation({
    mutationFn: ({ id, responsavel }: { id: number; responsavel: string }) =>
      ticketsApi.assign(id, responsavel),
    onMutate: async ({ id, responsavel }) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] })
      const previous = queryClient.getQueryData<{ tickets: Ticket[]; newTickets: Ticket[] }>(['tickets'])
      queryClient.setQueryData<{ tickets: Ticket[]; newTickets: Ticket[] }>(['tickets'], (old) => {
        if (!old) return old
        const patch = (list: Ticket[]) =>
          list.map((t) => (t.id === id ? { ...t, responsavel } : t))
        return { tickets: patch(old.tickets), newTickets: patch(old.newTickets) }
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['tickets'], ctx.previous)
      toast.error('Erro ao atribuir ticket')
    },
    onSuccess: () => {
      toast.success('Ticket atribuído')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })

  const unassignMutation = useMutation({
    mutationFn: (id: number) => ticketsApi.unassign(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] })
      const previous = queryClient.getQueryData<{ tickets: Ticket[]; newTickets: Ticket[] }>(['tickets'])
      queryClient.setQueryData<{ tickets: Ticket[]; newTickets: Ticket[] }>(['tickets'], (old) => {
        if (!old) return old
        const patch = (list: Ticket[]) =>
          list.map((t) => (t.id === id ? { ...t, responsavel: null } : t))
        return { tickets: patch(old.tickets), newTickets: patch(old.newTickets) }
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['tickets'], ctx.previous)
      toast.error('Erro ao desatribuir ticket')
    },
    onSuccess: () => {
      toast.success('Ticket desatribuído')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })

  return {
    assignTicket: (id: number, responsavel: string) =>
      assignMutation.mutate({ id, responsavel }),
    unassignTicket: (id: number) => unassignMutation.mutate(id),
    isAssigning: assignMutation.isPending,
    isUnassigning: unassignMutation.isPending,
  }
}
