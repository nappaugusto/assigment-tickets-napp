import { useState } from 'react'
import { MoreHorizontal, Link2, UserCheck, UserX, StickyNote, ChevronLeft, User, Bot, SquareKanban, ExternalLink, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AssignAgentCommand } from '@/components/assign-agent-command'
import { type Ticket } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { useTicketsWithNotes } from '@/hooks/use-ticket-note'
import { useDetachTrelloCard } from '@/hooks/use-trello'
import { useMcpMovideskActions } from '@/hooks/use-mcp-movidesk'
import { getTicketUrl } from '@/lib/utils'
import { TrelloCardDialog } from '@/components/trello-card-dialog'

interface KanbanCardMenuProps {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, responsavel: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  onOpenNotes: () => void
  onOpenService?: () => void
}

type MenuView = 'main' | 'assign'

export function KanbanCardMenu({
  ticket,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  onOpenNotes,
  onOpenService,
}: KanbanCardMenuProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [trelloOpen, setTrelloOpen] = useState(false)
  const [trelloCreateNew, setTrelloCreateNew] = useState(false)
  const [view, setView] = useState<MenuView>('main')
  const { data: ticketsWithNotes } = useTicketsWithNotes()
  const detachTrelloCard = useDetachTrelloCard(ticket.id)
  const mcp = useMcpMovideskActions()
  const hasNote = ticketsWithNotes?.has(ticket.id) ?? false

  const close = () => {
    setOpen(false)
    setView('main')
  }

  const copyLink = () => {
    const url = getTicketUrl(ticket.id)
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado!'))
    close()
  }

  const assignMe = () => {
    if (user?.name) onAssign(ticket.id, user.name)
    close()
  }

  const openTrelloCard = () => {
    if (ticket.trello_card_url) {
      window.open(ticket.trello_card_url, '_blank', 'noreferrer')
    }
    close()
  }

  const openTrelloDialog = (createNew = false) => {
    setTrelloCreateNew(createNew)
    setTrelloOpen(true)
    close()
  }

  const moveBackToService = async () => {
    close()

    try {
      await detachTrelloCard.mutateAsync()
      await mcp.changeStatus(
        ticket.id,
        'Em atendimento',
        'Retorno do Trello para atendimento',
      )
    } catch (error) {
      mcp.handleError(error, 'Não foi possível voltar o ticket para atendimento')
    }
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setView('main')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title="Ações"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <MoreHorizontal size={14} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-52 p-1 z-50"
        align="end"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {view === 'main' ? (
          <div className="flex flex-col gap-0.5">
            {onOpenService && (
              <MenuItem
                icon={<Bot size={13} />}
                onClick={() => { onOpenService(); close() }}
              >
                Atendimento MCP
              </MenuItem>
            )}

            <MenuItem
              icon={<StickyNote size={13} />}
              onClick={() => { onOpenNotes(); close() }}
              indicator={hasNote}
            >
              Anotações
            </MenuItem>

            {ticket.trello_card_url ? (
              <>
                <MenuItem
                  icon={<Undo2 size={13} />}
                  onClick={() => void moveBackToService()}
                  disabled={isLoading || detachTrelloCard.isPending || mcp.isPending}
                >
                  Voltar para atendimento
                </MenuItem>
                <MenuItem
                  icon={<ExternalLink size={13} />}
                  onClick={openTrelloCard}
                  indicator
                >
                  Abrir Trello
                </MenuItem>
                <MenuItem
                  icon={<SquareKanban size={13} />}
                  onClick={() => openTrelloDialog(true)}
                >
                  Enviar novamente
                </MenuItem>
              </>
            ) : (
              <MenuItem
                icon={<SquareKanban size={13} />}
                onClick={() => openTrelloDialog()}
              >
                Enviar ao Trello
              </MenuItem>
            )}

            <div className="h-px bg-border/40 my-0.5" />

            <MenuItem icon={<Link2 size={13} />} onClick={copyLink}>
              Copiar link
            </MenuItem>

            {user?.name && (
              <MenuItem
                icon={<UserCheck size={13} />}
                onClick={assignMe}
                disabled={isLoading}
              >
                Atribuir para mim
              </MenuItem>
            )}

            <MenuItem
              icon={<User size={13} />}
              onClick={() => setView('assign')}
              disabled={isLoading}
              chevron
            >
              Atribuir agente…
            </MenuItem>

            {ticket.responsavel && (
              <>
                <div className="h-px bg-border/40 my-0.5" />
                <MenuItem
                  icon={<UserX size={13} />}
                  onClick={() => { onUnassign(ticket.id); close() }}
                  disabled={isLoading}
                  destructive
                >
                  Desatribuir
                </MenuItem>
              </>
            )}
          </div>
        ) : (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 w-full rounded hover:bg-muted transition-colors mb-1"
              onClick={() => setView('main')}
            >
              <ChevronLeft size={12} />
              Voltar
            </button>
            <AssignAgentCommand
              agentOptions={agentOptions}
              autoFocus
              onAssign={(responsavel) => { onAssign(ticket.id, responsavel); close() }}
            />
          </div>
        )}
      </PopoverContent>

      <TrelloCardDialog
        ticket={trelloOpen ? ticket : null}
        open={trelloOpen}
        startCreateNew={trelloCreateNew}
        onClose={() => {
          setTrelloOpen(false)
          setTrelloCreateNew(false)
        }}
      />
    </Popover>
  )
}

function MenuItem({
  icon,
  onClick,
  disabled,
  destructive,
  chevron,
  indicator,
  children,
}: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  chevron?: boolean
  indicator?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{children}</span>
      {indicator && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      {chevron && <span className="text-muted-foreground">›</span>}
    </button>
  )
}
