import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  trelloApi,
  type CreateTrelloCardPayload,
  type TicketsPayload,
} from '@/lib/api'
import { TICKETS_QUERY_KEY } from '@/hooks/use-tickets'

export const TRELLO_STATUS_QUERY_KEY = ['trello', 'status']
export const TRELLO_BOARDS_QUERY_KEY = ['trello', 'boards']

export function trelloListsQueryKey(boardId?: string) {
  return ['trello', 'lists', boardId ?? 'default']
}

export function useTrelloStatus() {
  return useQuery({
    queryKey: TRELLO_STATUS_QUERY_KEY,
    queryFn: trelloApi.status,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

export function useTrelloBoards(enabled = true) {
  return useQuery({
    queryKey: TRELLO_BOARDS_QUERY_KEY,
    queryFn: trelloApi.boards,
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useTrelloLists(boardId?: string, enabled = true) {
  return useQuery({
    queryKey: trelloListsQueryKey(boardId),
    queryFn: () => trelloApi.lists(boardId),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useCreateTrelloCard(ticketId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateTrelloCardPayload) =>
      trelloApi.createCardFromTicket(ticketId, payload),
    onSuccess: ({ card, ticket }) => {
      queryClient.setQueryData<TicketsPayload>(TICKETS_QUERY_KEY, (old) => {
        if (!old) return old
        const patch = (list: typeof old.tickets) =>
          list.map((item) => (item.id === ticket.id ? ticket : item))
        return {
          ...old,
          tickets: patch(old.tickets),
          close_tickets: patch(old.close_tickets),
        }
      })
      toast.success(card.url ? 'Card do Trello pronto' : 'Card do Trello criado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao enviar para o Trello')
    },
  })
}
