import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, Loader2, SquareKanban, X } from 'lucide-react'
import { type Ticket } from '@/lib/api'
import { getTicketUrl } from '@/lib/utils'
import {
  useCreateTrelloCard,
  useTrelloBoards,
  useTrelloLists,
  useTrelloStatus,
} from '@/hooks/use-trello'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface TrelloCardDialogProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
}

export function TrelloCardDialog({ ticket, open, onClose }: TrelloCardDialogProps) {
  if (!ticket) return null

  return (
    <TrelloCardDialogContent
      ticket={ticket}
      open={open}
      onClose={onClose}
    />
  )
}

function TrelloCardDialogContent({ ticket, open, onClose }: TrelloCardDialogProps & { ticket: Ticket }) {
  const status = useTrelloStatus()
  const canLoadTrello = open && status.data?.configured
  const boards = useTrelloBoards(!!canLoadTrello)
  const [boardId, setBoardId] = useState('')
  const canLoadLists = !!canLoadTrello && Boolean(boardId || status.data?.defaultBoardId)
  const lists = useTrelloLists(boardId || undefined, canLoadLists)
  const [listId, setListId] = useState('')
  const [name, setName] = useState('')
  const createCard = useCreateTrelloCard(ticket.id)

  useEffect(() => {
    if (!open) return
    setName(defaultCardName(ticket))
    setBoardId(status.data?.defaultBoardId ?? '')
    setListId(status.data?.defaultListId ?? '')
  }, [open, status.data?.defaultBoardId, status.data?.defaultListId, ticket])

  useEffect(() => {
    if (!open || !lists.data?.length) return
    if (!listId || !lists.data.some((list) => list.id === listId)) {
      setListId(lists.data[0]?.id ?? '')
    }
  }, [listId, lists.data, open])

  const description = useMemo(() => defaultCardDescription(ticket), [ticket])
  const existingUrl = ticket.trello_card_url
  const selectedListMissing = !existingUrl && !listId
  const isBusy = createCard.isPending || status.isLoading || boards.isLoading || lists.isLoading

  const handleSubmit = async () => {
    if (existingUrl) {
      window.open(existingUrl, '_blank', 'noreferrer')
      onClose()
      return
    }

    const result = await createCard.mutateAsync({
      boardId: boardId || undefined,
      listId,
      name,
      description,
    })

    if (result.card.url) {
      window.open(result.card.url, '_blank', 'noreferrer')
    }
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-4">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <SquareKanban size={14} />
                Trello
              </div>
              <Dialog.Title className="text-base font-semibold">
                {existingUrl ? 'Card ja vinculado' : 'Enviar ticket para o Trello'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                #{ticket.id} - {ticket.subject || 'Sem assunto'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {existingUrl ? (
              <div className="rounded-md border border-border/50 bg-muted/25 p-3 text-sm">
                <p className="font-medium">{ticket.trello_card_name || 'Card no Trello'}</p>
                <a
                  href={existingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Abrir card
                  <ExternalLink size={12} />
                </a>
              </div>
            ) : status.data && !status.data.configured ? (
              <div className="rounded-md border border-yellow-700/35 bg-yellow-700/10 p-3 text-sm">
                Trello ainda nao configurado. Defina TRELLO_API_KEY e TRELLO_API_TOKEN no backend.
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Board</span>
                  <select
                    value={boardId}
                    onChange={(event) => {
                      setBoardId(event.target.value)
                      setListId('')
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={isBusy}
                  >
                    <option value="">Board padrao</option>
                    {boards.data?.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Lista</span>
                  <select
                    value={listId}
                    onChange={(event) => setListId(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={isBusy}
                  >
                    <option value="">Selecione a lista</option>
                    {lists.data?.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Titulo</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={isBusy}
                  />
                </label>

                <div className="rounded-md border border-border/50 bg-muted/25 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Descricao</p>
                  <pre className="max-h-40 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </pre>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 p-4">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isBusy || selectedListMissing || status.data?.configured === false}
            >
              {createCard.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {existingUrl ? 'Abrir no Trello' : 'Criar card'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function defaultCardName(ticket: Ticket): string {
  return `#${ticket.id} - ${ticket.subject || 'Sem assunto'}`.slice(0, 160)
}

function defaultCardDescription(ticket: Ticket): string {
  return [
    `Ticket Movidesk: #${ticket.id}`,
    '',
    ticket.subject ? `Assunto: ${ticket.subject}` : null,
    ticket.status ? `Status: ${ticket.status}` : null,
    ticket.ownerTeam ? `Equipe: ${ticket.ownerTeam}` : null,
    ticket.responsavel ? `Responsavel: ${ticket.responsavel}` : 'Responsavel: nao atribuido',
    ticket.slaSolutionDate ? `SLA: ${ticket.slaSolutionDate}` : null,
    ticket.opened_at ? `Aberto em: ${ticket.opened_at}` : null,
    '',
    `Link: ${getTicketUrl(ticket.id)}`,
  ]
    .filter(Boolean)
    .join('\n')
}
