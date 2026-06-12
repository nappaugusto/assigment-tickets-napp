import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bot,
  CheckSquare,
  Clipboard,
  Code2,
  CornerDownLeft,
  ExternalLink,
  FileCode2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  SquareKanban,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { ticketsApi, type SimilarTicket, type Ticket, type TicketAiTriage, type TicketAiTriageResult } from '@/lib/api'
import { getTicketUrl } from '@/lib/utils'
import {
  useAnalyzeCodeAiTriage,
  useAiTriageDecision,
  useAiTriageFollowUp,
  useReanalyzeAiTriage,
  useStartAiTriage,
  useTicketAiTriage,
} from '@/hooks/use-ai-triage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrelloCardDialog } from '@/components/trello-card-dialog'

interface TicketAiTriageDrawerProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
}

const PRIORITY_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'outline' | 'default'> = {
  critica: 'destructive',
  alta: 'destructive',
  media: 'warning',
  baixa: 'secondary',
}

export function TicketAiTriageDrawer({ ticket, open, onClose }: TicketAiTriageDrawerProps) {
  if (!ticket) return null

  return (
    <TicketAiTriageDrawerContent
      ticket={ticket}
      open={open}
      onClose={onClose}
    />
  )
}

function TicketAiTriageDrawerContent({
  ticket,
  open,
  onClose,
}: TicketAiTriageDrawerProps & { ticket: Ticket }) {
  const triageQuery = useTicketAiTriage(ticket.id, open)
  const similarQuery = useQuery({
    queryKey: ['similar-tickets', ticket.id],
    queryFn: () => ticketsApi.similar(ticket.id),
    enabled: open,
    staleTime: 60_000,
  })
  const startTriage = useStartAiTriage(ticket.id)
  const reanalyze = useReanalyzeAiTriage(ticket.id)
  const analyzeCode = useAnalyzeCodeAiTriage(ticket.id)
  const decision = useAiTriageDecision(ticket.id)
  const followUp = useAiTriageFollowUp(ticket.id)
  const [trelloOpen, setTrelloOpen] = useState(false)
  const triageRecord = triageQuery.data?.triage ?? null
  const triage = triageRecord?.triage ?? null
  const trelloLabels = triage ? buildTrelloLabels(triage) : []
  const isWorking =
    startTriage.isPending ||
    reanalyze.isPending ||
    analyzeCode.isPending ||
    triageRecord?.status === 'pending' ||
    triageRecord?.status === 'running'

  useEffect(() => {
    if (!open || triageQuery.isLoading || triageRecord) return
    startTriage.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triageQuery.isLoading, triageRecord?.id])

  const copyTriage = async () => {
    if (!triage || !triageRecord) return
    try {
      await copyText(formatTriageForCopy(ticket, triage))
      toast.success('Triagem copiada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível copiar a triagem')
      return
    }

    void decision.mutateAsync({ id: triageRecord.id, decision: 'copied' }).catch(() => {
      // The mutation hook already shows the user-facing error toast.
    })
  }

  const ignore = async () => {
    if (!triageRecord) return
    await decision.mutateAsync({ id: triageRecord.id, decision: 'ignored' })
    toast.success('Sugestão ignorada')
  }

  const markCardCreated = async () => {
    if (triageRecord) {
      await decision.mutateAsync({ id: triageRecord.id, decision: 'card_created' })
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col border-l border-border/45 bg-background shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-5">
            <div className="min-w-0">
              <a
                href={getTicketUrl(ticket.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                #{ticket.id}
                <ExternalLink size={12} />
              </a>
              <Dialog.Title className="mt-2 line-clamp-2 text-lg font-semibold leading-snug">
                {ticket.subject || 'Sem assunto'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {[ticket.status, ticket.ownerTeam, ticket.responsavel ? `resp: ${ticket.responsavel}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={isWorking}
                onClick={() => reanalyze.mutate()}
              >
                {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Re-analisar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={isWorking}
                onClick={() => analyzeCode.mutate()}
              >
                {analyzeCode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
                Analisar código
              </Button>
              <Dialog.Close asChild>
                <button className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <X size={17} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {isWorking ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-border/45 bg-muted/15 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                {analyzeCode.isPending ? 'Analisando código e evidências do banco...' : 'Analisando ticket...'}
              </div>
            ) : triageRecord?.status === 'failed' ? (
              <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm">
                <p className="font-medium text-foreground">Não foi possível gerar a triagem.</p>
                <p className="mt-1 text-muted-foreground">{triageRecord.error}</p>
              </div>
            ) : triage && triageRecord ? (
              <div className="space-y-4">
                <TriagePanel triage={triage} />
                <QuickCopyPanel ticket={ticket} triage={triage} />
                <CustomerReplyPanel text={getSuggestedCustomerReply(ticket, triage)} />
                <SimilarTicketsPanel
                  tickets={similarQuery.data?.tickets ?? []}
                  triageSimilarTickets={triage.similarTickets ?? []}
                  isLoading={similarQuery.isLoading}
                />
                <TriageChatPanel
                  triageRecord={triageRecord}
                  isPending={followUp.isPending}
                  onSend={(message) => followUp.mutateAsync({ id: triageRecord.id, message })}
                />
                <SuggestedCardPanel
                  triage={triage}
                  onCopy={copyTriage}
                  onIgnore={ignore}
                  onCreateCard={() => setTrelloOpen(true)}
                  isBusy={decision.isPending}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-border/45 bg-muted/15 p-4 text-sm text-muted-foreground">
                Nenhuma triagem encontrada para este ticket.
              </div>
            )}
          </div>
          <TrelloCardDialog
            ticket={trelloOpen ? ticket : null}
            open={trelloOpen}
            onClose={() => setTrelloOpen(false)}
            startCreateNew={Boolean(ticket.trello_card_url)}
            suggestedName={triage?.suggestedCard.title}
            suggestedDescription={triage ? formatTriageForTrello(ticket, triage) : undefined}
            suggestedLabels={trelloLabels}
            onCreated={markCardCreated}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function QuickCopyPanel({ ticket, triage }: { ticket: Ticket; triage: TicketAiTriageResult }) {
  const actions = [
    {
      label: 'Resumo executivo',
      icon: <Clipboard className="h-3.5 w-3.5" />,
      text: formatExecutiveSummary(ticket, triage),
      success: 'Resumo executivo copiado',
    },
    {
      label: 'Descrição técnica',
      icon: <Code2 className="h-3.5 w-3.5" />,
      text: formatTechnicalDescription(ticket, triage),
      success: 'Descrição técnica copiada',
    },
    {
      label: 'Checklist',
      icon: <CheckSquare className="h-3.5 w-3.5" />,
      text: formatChecklist(triage),
      success: 'Checklist copiado',
    },
    {
      label: 'Mensagem cliente',
      icon: <MessageSquareText className="h-3.5 w-3.5" />,
      text: getSuggestedCustomerReply(ticket, triage),
      success: 'Mensagem ao cliente copiada',
    },
  ]

  const copyAction = async (text: string, success: string) => {
    try {
      await copyText(text)
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível copiar')
    }
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <PanelHeader icon={<Sparkles size={15} />} title="Atalhos da triagem" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            variant="outline"
            size="sm"
            className="h-9 justify-start gap-2 text-xs"
            onClick={() => void copyAction(action.text, action.success)}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  )
}

function TriagePanel({ triage }: { triage: TicketAiTriageResult }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <PanelHeader icon={<Bot size={15} />} title="Triagem" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {triage.tags.map((tag) => (
          <Badge key={tag} variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            {tag}
          </Badge>
        ))}
        <Badge variant={PRIORITY_VARIANT[triage.priority] ?? 'outline'}>{triage.priority}</Badge>
        <span className="text-xs text-muted-foreground">confiança: {triage.confidence}</span>
      </div>

      <div className="mt-4 space-y-3 text-sm leading-relaxed">
        <LabeledText label="Resumo" text={triage.summary} strong />
        <LabeledText label="Sintoma" text={triage.symptom} strong />
        <LabeledText label="Repo" text={triage.likelyArea} />
        {triage.technicalHypothesis && (
          <LabeledText label="Hipótese" text={triage.technicalHypothesis} />
        )}
        {triage.reasoning && (
          <p className="text-xs leading-relaxed text-muted-foreground">{triage.reasoning}</p>
        )}
      </div>

      <ListBlock title="Evidências" items={triage.evidence} />
      <NextStepsBlock items={triage.nextSteps} />

      {triage.relevantFiles.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <FileCode2 size={14} />
            Arquivos relacionados
          </div>
          <div className="space-y-2">
            {triage.relevantFiles.map((file) => (
              <div key={`${file.path}-${file.reason}`} className="rounded-md border border-border/45 bg-background/35 p-2">
                <p className="font-mono text-xs text-foreground">{file.path}</p>
                {file.reason && <p className="mt-1 text-xs text-muted-foreground">{file.reason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CustomerReplyPanel({ text }: { text?: string }) {
  const reply = text?.trim()
  if (!reply) return null

  const copyReply = async () => {
    try {
      await copyText(reply)
      toast.success('Resposta ao cliente copiada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível copiar a resposta')
    }
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <PanelHeader icon={<MessageSquareText size={15} />} title="Resposta sugerida ao cliente" />
        <Button size="sm" variant="outline" className="h-8 gap-2 text-xs" onClick={copyReply}>
          <Clipboard className="h-3.5 w-3.5" />
          Copiar
        </Button>
      </div>
      <div className="mt-3 whitespace-pre-wrap rounded-md border border-border/45 bg-background/35 p-3 text-sm leading-relaxed text-foreground">
        {reply}
      </div>
    </section>
  )
}

function SimilarTicketsPanel({
  tickets,
  triageSimilarTickets,
  isLoading,
}: {
  tickets: SimilarTicket[]
  triageSimilarTickets: TicketAiTriageResult['similarTickets']
  isLoading?: boolean
}) {
  const aiItems = triageSimilarTickets.filter(
    (item) => !tickets.some((ticket) => ticket.id === item.id),
  )

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border/60 bg-card/60 p-4">
        <PanelHeader icon={<Sparkles size={15} />} title="Tickets semelhantes" />
        <p className="mt-3 text-sm text-muted-foreground">Buscando comparações...</p>
      </section>
    )
  }

  if (!tickets.length && !aiItems.length) return null

  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <PanelHeader icon={<Sparkles size={15} />} title="Tickets semelhantes" />
      <div className="mt-3 space-y-2">
        {tickets.map((item) => (
          <a
            key={item.id}
            href={getTicketUrl(item.id)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border border-border/45 bg-background/35 p-3 transition-colors hover:border-primary/35 hover:bg-primary/10 hover:no-underline"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-primary">#{item.id}</span>
              {item.status && <Badge variant="outline">{item.status}</Badge>}
              {item.ai_triage && <Badge variant="secondary">IA {item.ai_triage.priority}</Badge>}
              {item.trello_card_url && <Badge variant="outline">Trello</Badge>}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{item.subject || 'Sem assunto'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.reasons.length ? item.reasons.join(' · ') : `Similaridade ${item.score}`}
            </p>
            {item.ai_triage?.summary && (
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/75">
                {item.ai_triage.summary}
              </p>
            )}
          </a>
        ))}

        {aiItems.map((item) => (
          <div key={`ai-${item.id}`} className="rounded-md border border-border/45 bg-background/35 p-3">
            <div className="font-mono text-xs text-primary">#{item.id}</div>
            <p className="mt-1 text-sm font-medium text-foreground">{item.subject}</p>
            {item.reason && <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function SuggestedCardPanel({
  triage,
  onCopy,
  onIgnore,
  onCreateCard,
  isBusy,
}: {
  triage: TicketAiTriageResult
  onCopy: () => void
  onIgnore: () => void
  onCreateCard: () => void
  isBusy?: boolean
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <PanelHeader icon={<SquareKanban size={15} />} title="Card sugerido" />
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Título: </span>
        <strong>{triage.suggestedCard.title}</strong>
      </p>
      {triage.suggestedCard.labels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {triage.suggestedCard.labels.map((label) => (
            <Badge key={label} variant="secondary">{label}</Badge>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onCreateCard} disabled={isBusy}>
          <SquareKanban className="h-3.5 w-3.5" />
          Criar card no Trello
        </Button>
        <Button size="sm" variant="outline" onClick={onCopy} disabled={isBusy}>
          <Clipboard className="h-3.5 w-3.5" />
          Copiar análise
        </Button>
        <Button size="sm" variant="ghost" onClick={onIgnore} disabled={isBusy}>
          Ignorar sugestão
        </Button>
      </div>
    </section>
  )
}

function TriageChatPanel({
  triageRecord,
  isPending,
  onSend,
}: {
  triageRecord: TicketAiTriage
  isPending?: boolean
  onSend: (message: string) => Promise<unknown>
}) {
  const [message, setMessage] = useState('')
  const messages = triageRecord.follow_up_messages ?? []

  const submit = async () => {
    const trimmed = message.trim()
    if (!trimmed || isPending) return
    setMessage('')
    await onSend(trimmed)
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
      <PanelHeader icon={<MessageSquareText size={15} />} title="Mini chat da triagem" />
      <div className="mt-3 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-md border border-border/45 bg-background/35 p-3 text-xs leading-relaxed text-muted-foreground">
            Cole aqui o erro retornado por uma consulta, um log, ou uma hipótese sua. A resposta usa o contexto do ticket e da triagem salva.
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {messages.map((item, index) => (
              <div
                key={`${item.created_at}-${index}`}
                className={`rounded-md border p-3 text-sm leading-relaxed ${
                  item.role === 'user'
                    ? 'border-primary/30 bg-primary/10 text-foreground'
                    : 'border-border/45 bg-background/35 text-muted-foreground'
                }`}
              >
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {item.role === 'user' ? 'Você' : 'IA'}
                </div>
                <div className="whitespace-pre-wrap">{item.content}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={isPending}
            rows={3}
            placeholder="Cole o erro, resultado do SELECT ou sua ideia..."
            className="min-h-20 flex-1 resize-y rounded-md border border-input bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          />
          <Button
            type="button"
            size="sm"
            className="self-end gap-2"
            onClick={() => void submit()}
            disabled={isPending || !message.trim()}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
            Enviar
          </Button>
        </div>
      </div>
    </section>
  )
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {icon}
      {title}
    </div>
  )
}

function LabeledText({ label, text, strong }: { label: string; text: string; strong?: boolean }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {strong ? <strong className="text-foreground">{text}</strong> : <span>{text}</span>}
    </p>
  )
}

function stripLeadingNumber(value: string) {
  return value.replace(/^\s*\d+[).]\s*/, '').trim()
}

function getSuggestedCustomerReply(ticket: Ticket, triage: TicketAiTriageResult | null) {
  const reply = triage?.suggestedCustomerReply?.trim()
  if (reply) return reply

  const questionText = triage?.customerQuestions?.length
    ? ` Para avançarmos com mais precisão, poderia nos enviar: ${triage.customerQuestions.map(stripLeadingNumber).join('; ')}.`
    : ''

  return [
    'Olá! Obrigado pelo contato.',
    `Recebemos a solicitação${ticket.subject ? ` sobre "${ticket.subject}"` : ''} e já estamos analisando o cenário informado.`,
    triage?.summary ? `Identificamos inicialmente: ${triage.summary}` : null,
    questionText,
    'Assim que tivermos uma atualização mais concreta, retornaremos por aqui.',
  ]
    .filter(Boolean)
    .join(' ')
}

async function copyText(text: string) {
  if (!text.trim()) {
    throw new Error('Não há análise para copiar.')
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('O navegador bloqueou a cópia automática.')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

function splitStepAndSql(value: string) {
  const text = stripLeadingNumber(value)
  const match = text.match(/\b(SELECT|WITH)\b/i)
  if (!match || match.index === undefined) {
    return { text, sql: '' }
  }

  return {
    text: text.slice(0, match.index).replace(/[:;\s]+$/, '').trim(),
    sql: text.slice(match.index).replace(/;?\s*$/, ';').trim(),
  }
}

function NextStepsBlock({ items }: { items: string[] }) {
  if (!items.length) return null

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Próximos passos</p>
      <div className="space-y-2">
        {items.map((item, index) => {
          const step = splitStepAndSql(item)

          return (
            <div key={`${index}-${item}`} className="rounded-lg border border-border/50 bg-background/35 p-3">
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {step.text && <p className="text-sm leading-relaxed text-foreground">{step.text}</p>}
                  {step.sql ? (
                    <pre className="overflow-x-auto rounded-md border border-cyan-400/25 bg-cyan-950/20 p-3 font-mono text-xs leading-relaxed text-cyan-50">
                      <code>{step.sql}</code>
                    </pre>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {items.map((item) => (
          <li key={item}>{stripLeadingNumber(item)}</li>
        ))}
      </ul>
    </div>
  )
}

function formatTriageForCopy(ticket: Ticket, triage: TicketAiTriageResult | null) {
  if (!triage) return ''

  return [
    `Ticket #${ticket.id}`,
    ticket.subject ? `Assunto: ${ticket.subject}` : null,
    '',
    `Resumo: ${triage.summary}`,
    `Sintoma: ${triage.symptom}`,
    `Área provável: ${triage.likelyArea}`,
    `Hipótese técnica: ${triage.technicalHypothesis}`,
    '',
    'Evidências:',
    ...triage.evidence.map((item) => `- ${item}`),
    '',
    'Próximos passos:',
    ...triage.nextSteps.map((item, index) => `${index + 1}. ${stripLeadingNumber(item)}`),
    '',
    'Resposta sugerida ao cliente:',
    getSuggestedCustomerReply(ticket, triage),
  ]
    .filter(Boolean)
    .join('\n')
}

function formatExecutiveSummary(ticket: Ticket, triage: TicketAiTriageResult) {
  return [
    `Ticket #${ticket.id}${ticket.subject ? ` - ${ticket.subject}` : ''}`,
    `Prioridade: ${triage.priority} | Confiança: ${triage.confidence}`,
    `Resumo: ${triage.summary}`,
    `Área provável: ${triage.likelyArea}`,
    triage.shouldCreateCard ? 'Recomendação: criar card para acompanhamento técnico.' : 'Recomendação: tratar na fila de atendimento.',
  ].join('\n')
}

function formatTechnicalDescription(ticket: Ticket, triage: TicketAiTriageResult) {
  return [
    `Ticket: #${ticket.id}`,
    ticket.subject ? `Assunto: ${ticket.subject}` : null,
    `Sintoma: ${triage.symptom}`,
    `Hipótese técnica: ${triage.technicalHypothesis}`,
    `Área provável: ${triage.likelyArea}`,
    '',
    'Evidências:',
    ...triage.evidence.map((item) => `- ${stripLeadingNumber(item)}`),
    '',
    'Arquivos relacionados:',
    ...triage.relevantFiles.map((file) => `- ${file.path}${file.reason ? `: ${file.reason}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n')
}

function formatChecklist(triage: TicketAiTriageResult) {
  return triage.nextSteps
    .map((item) => `- [ ] ${stripLeadingNumber(item)}`)
    .join('\n')
}

function buildTrelloLabels(triage: TicketAiTriageResult) {
  return Array.from(
    new Set([
      ...triage.suggestedCard.labels,
      ...triage.tags,
      triage.priority !== 'baixa' ? triage.priority : null,
    ].filter((label): label is string => Boolean(label?.trim()))),
  ).slice(0, 8)
}

function formatTriageForTrello(ticket: Ticket, triage: TicketAiTriageResult | null) {
  if (!triage) return ''

  return [
    `Resumo: ${triage.summary}`,
    `Sintoma: ${triage.symptom}`,
    `Área provável: ${triage.likelyArea}`,
    `Hipótese técnica: ${triage.technicalHypothesis}`,
    '',
    'Evidências:',
    ...triage.evidence.map((item) => `- ${stripLeadingNumber(item)}`),
    '',
    'Próximos passos:',
    ...triage.nextSteps.map((item, index) => `${index + 1}. ${stripLeadingNumber(item)}`),
    '',
    'Resposta sugerida ao cliente:',
    getSuggestedCustomerReply(ticket, triage),
  ]
    .filter(Boolean)
    .join('\n')
}
