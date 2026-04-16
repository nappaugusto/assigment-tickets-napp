import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useCallback } from 'react'
import { notesApi } from '@/lib/api'
import { toast } from 'sonner'

export const NOTES_WITH_CONTENT_KEY = ['tickets-with-notes']

export function noteQueryKey(ticketId: number) {
  return ['ticket-note', ticketId]
}

export function useTicketsWithNotes() {
  return useQuery({
    queryKey: NOTES_WITH_CONTENT_KEY,
    queryFn: () => notesApi.getTicketsWithNotes().then((r) => new Set(r.ticketIds)),
    staleTime: 30_000,
  })
}

export function useTicketNote(ticketId: number) {
  const qc = useQueryClient()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: noteQueryKey(ticketId),
    queryFn: () => notesApi.getNote(ticketId).then((r) => r.content),
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: (content: string) => notesApi.saveNote(ticketId, content),
    onSuccess: (_, content) => {
      // Update the tickets-with-notes set optimistically
      qc.setQueryData<Set<number>>(NOTES_WITH_CONTENT_KEY, (prev) => {
        const next = new Set(prev ?? [])
        if (content.trim()) next.add(ticketId)
        else next.delete(ticketId)
        return next
      })
    },
    onError: () => toast.error('Erro ao salvar anotação'),
  })

  const saveDebounced = useCallback(
    (content: string) => {
      qc.setQueryData(noteQueryKey(ticketId), content)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        mutation.mutate(content)
      }, 800)
    },
    [ticketId, qc, mutation],
  )

  return {
    content: query.data ?? '',
    isLoading: query.isLoading,
    saveDebounced,
    isSaving: mutation.isPending,
  }
}
