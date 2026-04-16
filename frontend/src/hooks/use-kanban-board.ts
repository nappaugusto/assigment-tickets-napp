import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useCallback } from 'react'
import { kanbanApi, type KanbanBoard } from '@/lib/api'
import { toast } from 'sonner'

export const KANBAN_BOARD_KEY = ['kanban-board']

export function useKanbanBoard() {
  const qc = useQueryClient()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: KANBAN_BOARD_KEY,
    queryFn: kanbanApi.getBoard,
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: kanbanApi.saveBoard,
    onError: () => toast.error('Erro ao salvar o board'),
  })

  const saveDebounced = useCallback(
    (board: KanbanBoard) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        mutation.mutate(board)
      }, 800)
    },
    [mutation],
  )

  const updateBoard = useCallback(
    (updater: (prev: KanbanBoard) => KanbanBoard) => {
      qc.setQueryData<KanbanBoard>(KANBAN_BOARD_KEY, (prev) => {
        if (!prev) return prev
        const next = updater(prev)
        saveDebounced(next)
        return next
      })
    },
    [qc, saveDebounced],
  )

  return { board: query.data, isLoading: query.isLoading, updateBoard }
}
