import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bot,
  Clipboard,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  SquareKanban,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { type Ticket, type TicketAiTriageResult } from '@/lib/api'
import { getTicketUrl } from '@/lib/utils'
import {
  useAiTriageDecision,
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
  const [trelloOpen, setTrelloOpen] = useState(false)
  const triageQuery = useTicketAiTriage(ticket.id, open)
  const startTriage = useStartAiTriage(ticket.id)
  const reanalyze = useReanalyzeAiTriage(ticket.id)
  const decision = useAiTriageDecision(ticket.id)
  const triageRecord = triageQuery.data?.triage ?? null
  const triage = triageRecord?.triage ?? null
  const isWorking =
    startTriage.isPending ||
    reanalyze.isPending ||
    triageRecord?.status === 'pending' ||
    triageRecord?.status === 'running'

  useEffect(() => {
    if (!open || triageQuery.isLoading || triageRecord) return
    startTriage.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triageQuery.isLoading, triageRecord?.id])

  const copyTriage = async () => {
    if (!triage || !triageRecord) return
    await navigator.clipboard.writeText(formatTriageForCopy(ticket, triage))
    await decision.mutateAsync({ id: triageRecord.id, decision: 'copied' })
    toast.success('Triagem copiada')
  }

  const ignore = async () => {
    if (!triageRecord) return
    await decision.mutateAsync({ id: triageRecord.id, decision: 'ignored' })
    toast.success('Sugestão ignorada')
  }

  const openSuggestedCard = async () => {
    if (triageRecord) {
      await decision.mutateAsync({ id: triageRecord.id, decision: 'card_created' })
    }
    setTrelloOpen(true)
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
                Analisando ticket e trechos do código...
              </div>
            ) : triageRecord?.status === 'failed' ? (
              <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm">
                <p className="font-medium text-foreground">Não foi possível gerar a triagem.</p>
                <p className="mt-1 text-muted-foreground">{triageRecord.error}</p>
              </div>
            ) : triage ? (
              <div className="space-y-4">
                <TriagePanel triage={triage} />
                <SuggestedCardPanel
                  triage={triage}
                  onCopy={copyTriage}
                  onIgnore={ignore}
                  onCreateCard={openSuggestedCard}
                  isBusy={decision.isPending}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-border/45 bg-muted/15 p-4 text-sm text-muted-foreground">
                Nenhuma triagem encontrada para este ticket.
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <TrelloCardDialog
        ticket={trelloOpen ? ticket : null}
        open={trelloOpen}
        startCreateNew
        suggestedName={triage?.suggestedCard.title}
        suggestedDescription={triage?.suggestedCard.description || formatTriageForCopy(ticket, triage)}
        onClose={() => setTrelloOpen(false)}
      />
    </Dialog.Root>
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
      <ListBlock title="Próximos passos" items={triage.nextSteps} ordered />

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
        <Button size="sm" onClick={onCreateCard} disabled={isBusy || !triage.shouldCreateCard}>
          <SquareKanban className="h-3.5 w-3.5" />
          Criar card editar antes
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

function ListBlock({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      {ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
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
    ...triage.nextSteps.map((item, index) => `${index + 1}. ${item}`),
  ]
    .filter(Boolean)
    .join('\n')
}
