import { useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Bot, CheckCircle2, Loader2, MessageSquareText, Plus, Search, UserRoundCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { mcpResultToText } from '@/lib/mcp-movidesk'
import {
  useMcpMovideskActions,
  useMcpMovideskStatus,
  useMcpMovideskTools,
} from '@/hooks/use-mcp-movidesk'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface McpDeskDrawerProps {
  open: boolean
  onClose: () => void
}

export function McpDeskDrawer({ open, onClose }: McpDeskDrawerProps) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [urgency, setUrgency] = useState('')
  const [category, setCategory] = useState('')
  const [customer, setCustomer] = useState('')
  const [customerResult, setCustomerResult] = useState('')
  const [createResult, setCreateResult] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [ticketResult, setTicketResult] = useState('')
  const [ticketStatus, setTicketStatus] = useState('Em atendimento')
  const [statusJustification, setStatusJustification] = useState('')
  const [agentIdentifier, setAgentIdentifier] = useState('')
  const [agentDisplayName, setAgentDisplayName] = useState('')
  const [agentTeam, setAgentTeam] = useState('')
  const [interactionText, setInteractionText] = useState('')
  const [interactionInternal, setInteractionInternal] = useState(false)

  const statusQuery = useMcpMovideskStatus()
  const toolsQuery = useMcpMovideskTools(open)
  const mcp = useMcpMovideskActions()

  const availableTools = useMemo(
    () => new Set(toolsQuery.data?.tools.map((tool) => tool.name) ?? []),
    [toolsQuery.data],
  )

  const hasMcpActions = statusQuery.data?.configured && !statusQuery.isError
  const hasTool = (...names: string[]) => names.some((name) => availableTools.has(name))
  const parsedTicketId = Number(ticketId)

  const requireTicketId = () => {
    if (!Number.isInteger(parsedTicketId) || parsedTicketId <= 0) {
      toast.error('Informe um ID de ticket válido.')
      return false
    }

    return true
  }

  const createTicket = async () => {
    if (!subject.trim() || !description.trim() || !email.trim()) {
      toast.error('Assunto, descrição e e-mail são obrigatórios.')
      return
    }

    try {
      const result = await mcp.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        email: email.trim(),
        urgency: urgency.trim() || undefined,
        category: category.trim() || undefined,
      })
      setCreateResult(mcpResultToText(result))
      setSubject('')
      setDescription('')
      setEmail('')
      setUrgency('')
      setCategory('')
    } catch (error) {
      mcp.handleError(error, 'Não foi possível criar o ticket')
    }
  }

  const listCustomerTickets = async () => {
    if (!customer.trim()) {
      toast.error('Informe o e-mail ou documento do cliente.')
      return
    }

    try {
      const result = await mcp.listCustomerTickets(customer.trim())
      setCustomerResult(mcpResultToText(result))
    } catch (error) {
      mcp.handleError(error, 'Não foi possível listar tickets do cliente')
    }
  }

  const consultTicket = async () => {
    if (!requireTicketId()) return

    try {
      const result = await mcp.consultTicket(parsedTicketId)
      setTicketResult(mcpResultToText(result))
    } catch (error) {
      mcp.handleError(error, 'Não foi possível consultar o ticket')
    }
  }

  const changeStatus = async () => {
    if (!requireTicketId()) return

    try {
      const result = await mcp.changeStatus(
        parsedTicketId,
        ticketStatus,
        statusJustification.trim() || undefined,
      )
      setTicketResult(mcpResultToText(result))
      setStatusJustification('')
    } catch (error) {
      mcp.handleError(error, 'Não foi possível alterar o status')
    }
  }

  const assignAgent = async () => {
    if (!requireTicketId()) return

    const identifier = agentIdentifier.trim()
    if (!identifier) {
      toast.error('Informe o ID, e-mail ou identificador do agente/equipe.')
      return
    }

    try {
      const result = await mcp.assignAgent(
        parsedTicketId,
        identifier,
        agentDisplayName.trim() || identifier,
        agentTeam.trim() || undefined,
      )
      setTicketResult(mcpResultToText(result))
    } catch (error) {
      mcp.handleError(error, 'Não foi possível atribuir o agente')
    }
  }

  const addInteraction = async () => {
    if (!requireTicketId()) return

    const text = interactionText.trim()
    if (!text) {
      toast.error('Escreva a interação antes de enviar.')
      return
    }

    try {
      const result = await mcp.addInteraction(parsedTicketId, text, interactionInternal)
      setTicketResult(mcpResultToText(result))
      setInteractionText('')
    } catch (error) {
      mcp.handleError(error, 'Não foi possível adicionar a interação')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-border/45 bg-background shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-4">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <Badge variant={hasMcpActions ? 'default' : 'outline'} className="text-[11px]">
                  {hasMcpActions ? 'MCP ativo' : 'MCP pendente'}
                </Badge>
              </div>
              <Dialog.Title className="mt-1 text-base font-semibold">
                Central MCP Movidesk
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                Criação e consulta operacional direto no Movidesk.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!hasMcpActions && (
              <div className="mb-4 rounded-lg border border-yellow-700/35 bg-yellow-700/10 p-3 text-sm text-foreground">
                Configure MOVIDESK_MCP_ARGS e MOVIDESK_TOKEN no backend para liberar as ações MCP.
              </div>
            )}

            <div className="grid gap-4">
              <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                <PanelTitle icon={<CheckCircle2 size={15} />} title="Operar ticket por ID" />
                <div className="mt-3 grid gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={ticketId}
                      onChange={(event) => setTicketId(event.target.value)}
                      placeholder="ID do ticket"
                      inputMode="numeric"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasTool('consultar_ticket') || mcp.isPending}
                      onClick={consultTicket}
                    >
                      Consultar
                    </Button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      value={ticketStatus}
                      onChange={(event) => setTicketStatus(event.target.value)}
                      className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                    >
                      {['Novo', 'Em atendimento', 'Parado', 'Resolvido', 'Cancelado', 'Fechado'].map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <Input
                      value={statusJustification}
                      onChange={(event) => setStatusJustification(event.target.value)}
                      placeholder="Justificativa opcional"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasTool('alterar_status_ticket') || mcp.isPending}
                      onClick={changeStatus}
                    >
                      Alterar
                    </Button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                    <Input
                      value={agentIdentifier}
                      onChange={(event) => setAgentIdentifier(event.target.value)}
                      placeholder="ID/e-mail do agente ou equipe"
                    />
                    <Input
                      value={agentDisplayName}
                      onChange={(event) => setAgentDisplayName(event.target.value)}
                      placeholder="Nome para referência"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Input
                      value={agentTeam}
                      onChange={(event) => setAgentTeam(event.target.value)}
                      placeholder="Equipe opcional"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasTool('atribuir_agente') || mcp.isPending}
                      onClick={assignAgent}
                    >
                      <UserRoundCheck className="h-4 w-4" />
                      Atribuir
                    </Button>
                  </div>

                  <textarea
                    value={interactionText}
                    onChange={(event) => setInteractionText(event.target.value)}
                    placeholder="Resposta ao cliente ou nota interna..."
                    className="min-h-24 w-full resize-y rounded-md border border-border/45 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={interactionInternal}
                        onChange={(event) => setInteractionInternal(event.target.checked)}
                        className="h-4 w-4"
                      />
                      Enviar como nota interna
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasTool('adicionar_interacao') || mcp.isPending}
                      onClick={addInteraction}
                    >
                      <MessageSquareText className="h-4 w-4" />
                      Enviar interação
                    </Button>
                  </div>
                </div>

                {ticketResult && (
                  <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/25 p-2 text-xs">
                    {ticketResult}
                  </pre>
                )}
              </section>

              <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                <PanelTitle icon={<Plus size={15} />} title="Criar ticket" />
                <div className="mt-3 grid gap-2">
                  <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Assunto" />
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Descrição"
                    className="min-h-28 w-full resize-y rounded-md border border-border/45 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail do cliente" />
                    <Input value={urgency} onChange={(event) => setUrgency(event.target.value)} placeholder="Urgência" />
                  </div>
                  <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Categoria" />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!hasTool('criar_ticket') || mcp.isPending}
                    onClick={createTicket}
                  >
                    {mcp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Criar
                  </Button>
                </div>
                {createResult && (
                  <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/25 p-2 text-xs">
                    {createResult}
                  </pre>
                )}
              </section>

              <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                <PanelTitle icon={<Search size={15} />} title="Tickets do cliente" />
                <div className="mt-3 flex gap-2">
                  <Input
                    value={customer}
                    onChange={(event) => setCustomer(event.target.value)}
                    placeholder="E-mail, CPF ou CNPJ"
                  />
                  <Button
                    type="button"
                    size="icon"
                    disabled={!hasTool('listar_tickets_cliente') || mcp.isPending}
                    onClick={listCustomerTickets}
                    title="Buscar"
                  >
                    {mcp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {customerResult && (
                  <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/25 p-2 text-xs">
                    {customerResult}
                  </pre>
                )}
              </section>

              <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                <PanelTitle icon={<Bot size={15} />} title="Ferramentas disponíveis" />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(toolsQuery.data?.tools ?? []).map((tool) => (
                    <Badge key={tool.name} variant="secondary" className="text-[10px]">
                      {tool.name}
                    </Badge>
                  ))}
                  {toolsQuery.isLoading && (
                    <span className="text-xs text-muted-foreground">Carregando...</span>
                  )}
                </div>
              </section>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PanelTitle({
  icon,
  title,
}: {
  icon: ReactNode
  title: string
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </h3>
  )
}
