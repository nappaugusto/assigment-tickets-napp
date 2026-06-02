import { useState } from 'react'
import { Bot, ExternalLink, Link2, SquareKanban, Undo2, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { type Ticket } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AssignAgentCommand } from '@/components/assign-agent-command'
import { getTicketUrl } from '@/lib/utils'
import { TrelloCardDialog } from '@/components/trello-card-dialog'
import { useDetachTrelloCard } from '@/hooks/use-trello'

interface TicketActionsProps {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, responsavel: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  onOpenService?: () => void
}

export function TicketActions({ ticket, agentOptions, onAssign, onUnassign, isLoading, onOpenService }: TicketActionsProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [trelloOpen, setTrelloOpen] = useState(false)
  const detachTrelloCard = useDetachTrelloCard(ticket.id)

  const copyLink = () => {
    const url = getTicketUrl(ticket.id)
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado!'))
  }

  const assignMe = () => {
    if (user?.name) onAssign(ticket.id, user.name)
  }

  return (
    <div className="flex items-center gap-1">
      {onOpenService && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Atendimento MCP"
          onClick={onOpenService}
        >
          <Bot className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Copiar link do ticket"
        onClick={copyLink}
      >
        <Link2 className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={ticket.trello_card_url ? 'Abrir no Trello' : 'Enviar para o Trello'}
        onClick={() => setTrelloOpen(true)}
      >
        {ticket.trello_card_url ? (
          <ExternalLink className="h-3.5 w-3.5" />
        ) : (
          <SquareKanban className="h-3.5 w-3.5" />
        )}
      </Button>

      {ticket.trello_card_url && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Voltar para atendimento"
          onClick={() => detachTrelloCard.mutate()}
          disabled={isLoading || detachTrelloCard.isPending}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      )}

      {user?.name && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          title="Atribuir para mim"
          onClick={assignMe}
          disabled={isLoading}
        >
          <UserCheck className="h-3.5 w-3.5" />
          Pra mim
        </Button>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={isLoading}>
            Atribuir
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="end">
          <AssignAgentCommand
            agentOptions={agentOptions}
            onAssign={(responsavel) => {
              onAssign(ticket.id, responsavel)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      {ticket.responsavel && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          title="Desatribuir"
          onClick={() => onUnassign(ticket.id)}
          disabled={isLoading}
        >
          <UserX className="h-3.5 w-3.5" />
        </Button>
      )}

      <TrelloCardDialog
        ticket={trelloOpen ? ticket : null}
        open={trelloOpen}
        onClose={() => setTrelloOpen(false)}
      />
    </div>
  )
}
