import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ticketsApi, type Ticket, type TicketsPayload } from '@/lib/api'

function patchTicketResponsavel(
  payload: TicketsPayload | undefined,
  id: number,
  responsavel: string | null,
): TicketsPayload | undefined {
  if (!payload) return payload

  const patch = (list: Ticket[]) =>
    list.map((ticket) =>
      ticket.id === id ? { ...ticket, responsavel } : ticket,
    )

  return {
    ...payload,
    tickets: patch(payload.tickets),
    close_tickets: patch(payload.close_tickets),
  }
}

export function useTicketActions() {
  const queryClient = useQueryClient()

  const assignMutation = useMutation({
    mutationFn: ({ id, responsavel }: { id: number; responsavel: string }) =>
      ticketsApi.assign(id, responsavel),
    onMutate: async ({ id, responsavel }) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] })
      const previous = queryClient.getQueryData<TicketsPayload>(['tickets'])
      queryClient.setQueryData<TicketsPayload>(['tickets'], (old) =>
        patchTicketResponsavel(old, id, responsavel),
      )
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
      const previous = queryClient.getQueryData<TicketsPayload>(['tickets'])
      queryClient.setQueryData<TicketsPayload>(['tickets'], (old) =>
        patchTicketResponsavel(old, id, null),
      )
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
