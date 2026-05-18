import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  BookOpen,
  Bot,
  CheckCircle2,
  FileSearch,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  UserRoundCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { type Ticket } from '@/lib/api'
import { getTicketUrl } from '@/lib/utils'
import {
  mcpResultToText,
  parseJsonishResult,
} from '@/lib/mcp-movidesk'
import {
  useMcpMovideskActions,
  useMcpMovideskStatus,
  useMcpMovideskTools,
} from '@/hooks/use-mcp-movidesk'
import { useAssignmentPeopleDetails } from '@/hooks/use-tickets'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AssignAgentCommand } from '@/components/assign-agent-command'
import { McpAgentSelector } from '@/components/mcp-agent-selector'

interface TicketServiceDrawerProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
  agentOptions: string[]
  onAssignLocal?: (id: number, responsavel: string) => void
}

const STATUS_OPTIONS = ['Novo', 'Em atendimento', 'Parado', 'Resolvido', 'Cancelado', 'Fechado']

export function TicketServiceDrawer({
  ticket,
  open,
  onClose,
  agentOptions,
  onAssignLocal,
}: TicketServiceDrawerProps) {
  if (!ticket) return null

  return (
    <TicketServiceDrawerContent
      ticket={ticket}
      open={open}
      onClose={onClose}
      agentOptions={agentOptions}
      onAssignLocal={onAssignLocal}
    />
  )
}

function TicketServiceDrawerContent({
  ticket,
  open,
  onClose,
  agentOptions,
  onAssignLocal,
}: TicketServiceDrawerProps & { ticket: Ticket }) {
  const [detailText, setDetailText] = useState('')
  const [detailJson, setDetailJson] = useState<unknown>(null)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [kbQuery, setKbQuery] = useState('')
  const [kbResult, setKbResult] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusJustification, setStatusJustification] = useState('')
  const [agentIdentifier, setAgentIdentifier] = useState('')
  const [agentDisplayName, setAgentDisplayName] = useState('')
  const [agentTeam, setAgentTeam] = useState('')

  const statusQuery = useMcpMovideskStatus()
  const toolsQuery = useMcpMovideskTools(open)
  const peopleQuery = useAssignmentPeopleDetails()
  const mcp = useMcpMovideskActions()

  const availableTools = useMemo(
    () => new Set(toolsQuery.data?.tools.map((tool) => tool.name) ?? []),
    [toolsQuery.data],
  )

  const hasMcpActions = statusQuery.data?.configured && !statusQuery.isError
  const hasTool = (...names: string[]) => names.some((name) => availableTools.has(name))

  useEffect(() => {
    if (!open) return
    setDetailText('')
    setDetailJson(null)
    setReply('')
    setInternal(false)
    setKbQuery(ticket?.subject ?? '')
    setKbResult('')
    setStatusJustification('')
    setAgentIdentifier('')
    setAgentDisplayName('')
    setAgentTeam('')
  }, [open, ticket?.id, ticket?.subject])

  useEffect(() => {
    if (!open || !ticket || !hasTool('consultar_ticket')) return
    void loadTicketDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket?.id, availableTools])

  const loadTicketDetails = async () => {
    try {
      const result = await mcp.consultTicket(ticket.id)
      setDetailText(mcpResultToText(result))
      setDetailJson(parseJsonishResult(result))
    } catch (error) {
      mcp.handleError(error, 'Não foi possível consultar o ticket no Movidesk')
    }
  }

  const sendInteraction = async () => {
    const text = reply.trim()
    if (!text) {
      toast.error('Escreva a mensagem antes de enviar.')
      return
    }

    try {
      await mcp.addInteraction(ticket.id, text, internal)
      setReply('')
      await loadTicketDetails()
    } catch (error) {
      mcp.handleError(error, 'Não foi possível enviar a interação')
    }
  }

  const changeStatus = async (status: string) => {
    try {
      await mcp.changeStatus(ticket.id, status, statusJustification.trim() || undefined)
      setStatusJustification('')
      await loadTicketDetails()
    } catch (error) {
      mcp.handleError(error, 'Não foi possível alterar o status')
    }
  }

  const assignAgent = async () => {
    const identifier = agentIdentifier.trim()
    if (!identifier) {
      toast.error('Informe o ID, e-mail ou identificador do agente/equipe.')
      return
    }

    try {
      await mcp.assignAgent(
        ticket.id,
        identifier,
        agentDisplayName.trim() || identifier,
        agentTeam.trim() || undefined,
      )
      onAssignLocal?.(ticket.id, agentDisplayName.trim() || identifier)
      setAssignOpen(false)
      await loadTicketDetails()
    } catch (error) {
      mcp.handleError(error, 'Não foi possível alterar o responsável no Movidesk')
    }
  }

  const searchKb = async () => {
    const query = kbQuery.trim()
    if (!query) {
      toast.error('Digite um termo para buscar na base de conhecimento.')
      return
    }

    try {
      const result = await mcp.searchKb(query)
      setKbResult(mcpResultToText(result))
    } catch (error) {
      mcp.handleError(error, 'Não foi possível buscar na base de conhecimento')
    }
  }

  const details = typeof detailJson === 'object' && detailJson !== null
    ? detailJson as Record<string, unknown>
    : null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-border/45 bg-background shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={getTicketUrl(ticket.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  #{ticket.id}
                </a>
                <Badge variant={hasMcpActions ? 'default' : 'outline'} className="text-[11px]">
                  {hasMcpActions ? 'MCP ativo' : 'MCP pendente'}
                </Badge>
              </div>
              <Dialog.Title className="mt-1 line-clamp-2 text-base font-semibold leading-snug">
                {ticket.subject || 'Sem assunto'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {ticket.responsavel ? `Responsável atual: ${ticket.responsavel}` : 'Sem responsável local'}
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

            <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
              <section className="flex min-w-0 flex-col gap-3">
                <PanelTitle icon={<FileSearch size={15} />} title="Ticket no Movidesk">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={!hasTool('consultar_ticket') || mcp.isPending}
                    onClick={loadTicketDetails}
                  >
                    {mcp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Atualizar
                  </Button>
                </PanelTitle>

                <div className="min-h-44 rounded-lg border border-border/45 bg-muted/16 p-3">
                  {detailText ? (
                    details ? (
                      <TicketDetails details={details} fallback={detailText} />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{detailText}</pre>
                    )
                  ) : (
                    <EmptyState text="Clique em Atualizar para carregar os dados completos do Movidesk." />
                  )}
                </div>

                <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                  <PanelTitle icon={<MessageSquareText size={15} />} title="Responder ou registrar interação" />
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Escreva a resposta ao cliente ou uma nota interna..."
                    className="mt-3 min-h-32 w-full resize-y rounded-md border border-border/45 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={internal}
                        onChange={(event) => setInternal(event.target.checked)}
                        className="h-4 w-4"
                      />
                      Enviar como nota interna
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!hasTool('adicionar_interacao') || mcp.isPending}
                      onClick={sendInteraction}
                    >
                      {mcp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Enviar
                    </Button>
                  </div>
                </section>
              </section>

              <aside className="flex flex-col gap-4">
                <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                  <PanelTitle icon={<CheckCircle2 size={15} />} title="Status" />
                  <textarea
                    value={statusJustification}
                    onChange={(event) => setStatusJustification(event.target.value)}
                    placeholder="Justificativa quando necessário..."
                    className="mt-3 min-h-16 w-full resize-y rounded-md border border-border/45 bg-background/70 p-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                  />
                  <div className="mt-3 grid gap-2">
                    {STATUS_OPTIONS.map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        disabled={!hasTool('alterar_status_ticket') || mcp.isPending}
                        onClick={() => changeStatus(status)}
                      >
                        {status}
                      </Button>
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                  <PanelTitle icon={<UserRoundCheck size={15} />} title="Responsável" />
                  <div className="mt-3 grid gap-2">
                    <McpAgentSelector
                      people={peopleQuery.data?.people ?? []}
                      onSelect={(person, team) => {
                        setAgentIdentifier(person.id)
                        setAgentDisplayName(person.businessName || person.email || person.id)
                        setAgentTeam(team)
                      }}
                      className="h-8 rounded-md border border-input bg-background/70 px-3 text-xs text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                    />
                    <Input
                      value={agentIdentifier}
                      onChange={(event) => setAgentIdentifier(event.target.value)}
                      placeholder="ID/e-mail do agente ou equipe"
                      className="h-8"
                    />
                    <Input
                      value={agentDisplayName}
                      onChange={(event) => setAgentDisplayName(event.target.value)}
                      placeholder="Nome para referência"
                      className="h-8"
                    />
                    <Input
                      value={agentTeam}
                      onChange={(event) => setAgentTeam(event.target.value)}
                      placeholder="Equipe opcional"
                      className="h-8"
                    />
                  </div>
                  <Popover open={assignOpen} onOpenChange={setAssignOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full justify-start"
                        disabled={!hasTool('atribuir_agente') || mcp.isPending}
                      >
                        Escolher responsável local
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-0" align="end">
                      <AssignAgentCommand
                        agentOptions={agentOptions}
                        autoFocus
                        onAssign={(responsavel) => {
                          setAgentIdentifier(responsavel)
                          setAgentDisplayName(responsavel)
                          setAssignOpen(false)
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 w-full justify-start"
                    disabled={!hasTool('atribuir_agente') || mcp.isPending}
                    onClick={assignAgent}
                  >
                    Atribuir no Movidesk
                  </Button>
                </section>

                <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                  <PanelTitle icon={<BookOpen size={15} />} title="Base de conhecimento" />
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={kbQuery}
                      onChange={(event) => setKbQuery(event.target.value)}
                      placeholder="Buscar artigo..."
                      className="h-8"
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!hasTool('buscar_conhecimento', 'buscar_artigo_kb') || mcp.isPending}
                      onClick={searchKb}
                      title="Buscar"
                    >
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  {kbResult && (
                    <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/25 p-2 text-xs">
                      {kbResult}
                    </pre>
                  )}
                </section>

                <section className="rounded-lg border border-border/45 bg-card/50 p-3">
                  <PanelTitle icon={<Bot size={15} />} title="Ferramentas MCP" />
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
              </aside>
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
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function TicketDetails({
  details,
  fallback,
}: {
  details: Record<string, unknown>
  fallback: string
}) {
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== '')

  if (!entries.length) {
    return <pre className="whitespace-pre-wrap break-words text-xs">{fallback}</pre>
  }

  return (
    <div className="grid gap-2">
      {entries.slice(0, 18).map(([key, value]) => (
        <div key={key} className="grid gap-1 rounded-md bg-background/55 p-2">
          <span className="text-[11px] font-medium uppercase text-muted-foreground">{key}</span>
          <span className="break-words text-xs text-foreground">
            {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}
