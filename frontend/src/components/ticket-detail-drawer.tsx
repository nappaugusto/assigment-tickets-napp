import { useState } from 'react'
import { type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bot,
  CalendarClock,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Tag,
  UserRound,
  X,
} from 'lucide-react'
import { type Ticket, type TicketDetailInteraction } from '@/lib/api'
import { formatDate } from '@/lib/date-utils'
import { getTicketUrl } from '@/lib/utils'
import { useTicketDetail } from '@/hooks/use-ticket-detail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TicketAiTriageDrawer } from '@/components/ticket-ai-triage-drawer'

interface TicketDetailDrawerProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
}

export function TicketDetailDrawer({ ticket, open, onClose }: TicketDetailDrawerProps) {
  if (!ticket) return null

  return <TicketDetailDrawerContent ticket={ticket} open={open} onClose={onClose} />
}

function TicketDetailDrawerContent({
  ticket,
  open,
  onClose,
}: TicketDetailDrawerProps & { ticket: Ticket }) {
  const [triageOpen, setTriageOpen] = useState(false)
  const detailQuery = useTicketDetail(ticket.id, open)
  const detail = detailQuery.data?.detail

  return (
    <>
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
                  {detail?.subject || ticket.subject || 'Sem assunto'}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  {[detail?.status ?? ticket.status, detail?.ownerTeam ?? ticket.ownerTeam, ticket.responsavel ? `resp: ${ticket.responsavel}` : null]
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
                  onClick={() => setTriageOpen(true)}
                >
                  <Bot className="h-3.5 w-3.5" />
                  Triagem
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={detailQuery.isFetching}
                  onClick={() => detailQuery.refetch()}
                  title="Atualizar"
                >
                  {detailQuery.isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Dialog.Close asChild>
                  <button className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <X size={17} />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detailQuery.isLoading ? (
                <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-border/45 bg-muted/15 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  Carregando resumo e interações...
                </div>
              ) : detailQuery.isError ? (
                <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm">
                  <p className="font-medium text-foreground">Não foi possível carregar o ticket.</p>
                  <p className="mt-1 text-muted-foreground">
                    {detailQuery.error instanceof Error ? detailQuery.error.message : 'Erro desconhecido'}
                  </p>
                </div>
              ) : detail ? (
                <div className="grid gap-4">
                  <section className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <PanelHeader icon={<MessageSquareText size={15} />} title="Resumo do ticket" />
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {detail.summary}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <InfoBadge icon={<CalendarClock size={13} />} label={detail.createdDate ? formatDate(detail.createdDate) : 'Sem criação'} />
                      <InfoBadge label={detail.urgency || 'Sem urgência'} />
                      <InfoBadge label={detail.category || 'Sem categoria'} />
                      {detail.ownerName && <InfoBadge icon={<UserRound size={13} />} label={detail.ownerName} />}
                    </div>
                    {(detail.serviceFull.length > 0 || detail.tags.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail.serviceFull.map((item) => (
                          <Badge key={item} variant="secondary" className="text-[11px]">
                            {item}
                          </Badge>
                        ))}
                        {detail.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="gap-1 text-[11px]">
                            <Tag size={11} />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </section>

                  {detail.clients.length > 0 && (
                    <section className="rounded-lg border border-border/60 bg-card/60 p-4">
                      <PanelHeader icon={<UserRound size={15} />} title="Cliente" />
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {detail.clients.map((client, index) => (
                          <div key={`${client.email ?? client.name}-${index}`} className="rounded-md border border-border/45 bg-background/40 p-3 text-sm">
                            <p className="font-medium text-foreground">{client.name || 'Sem nome'}</p>
                            {client.email && <p className="mt-1 text-xs text-muted-foreground">{client.email}</p>}
                            {client.organization && <p className="mt-1 text-xs text-muted-foreground">{client.organization}</p>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <PanelHeader
                      icon={<MessageSquareText size={15} />}
                      title={`Interações (${detail.interactions.length}${detail.rawActionCount > detail.interactions.length ? ` de ${detail.rawActionCount}` : ''})`}
                    />
                    <div className="mt-3 grid gap-3">
                      {detail.interactions.length === 0 ? (
                        <p className="rounded-md bg-muted/20 p-3 text-sm text-muted-foreground">
                          Nenhuma interação encontrada no Movidesk.
                        </p>
                      ) : (
                        detail.interactions.map((interaction, index) => (
                          <InteractionItem
                            key={interaction.id ?? `${interaction.createdDate}-${index}`}
                            interaction={interaction}
                          />
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <TicketAiTriageDrawer
        ticket={triageOpen ? ticket : null}
        open={triageOpen}
        onClose={() => setTriageOpen(false)}
      />
    </>
  )
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </h3>
  )
}

function InfoBadge({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/45 bg-background/50 px-2 py-1 text-xs text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  )
}

function InteractionItem({ interaction }: { interaction: TicketDetailInteraction }) {
  return (
    <article className="rounded-lg border border-border/45 bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={interaction.type === 'public' ? 'default' : 'secondary'} className="text-[11px]">
          {interaction.type === 'public' ? 'Pública' : 'Interna'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {interaction.author || 'Sistema'}
          {interaction.createdDate ? ` · ${formatDate(interaction.createdDate)}` : ''}
        </span>
        {interaction.status && (
          <span className="text-xs text-muted-foreground">status: {interaction.status}</span>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {interaction.text || 'Interação sem texto.'}
      </p>
    </article>
  )
}
