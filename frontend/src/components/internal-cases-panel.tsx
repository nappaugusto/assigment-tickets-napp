import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Clock3,
  ImagePlus,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Send,
  Settings,
  UserMinus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  casesApi,
  type CreateInternalCaseAttachmentPayload,
  type InternalCase,
  type InternalCaseSlaPolicy,
  type InternalTeam,
  type InternalUser,
} from '@/lib/api'
import {
  useAddInternalCaseComment,
  useCreateInternalCase,
  useInternalCase,
  useInternalCaseDashboard,
  useInternalCases,
  useInternalCaseSlaPolicies,
  useUpdateInternalCaseSlaPolicy,
  useUpdateInternalCaseStatus,
} from '@/hooks/use-cases'
import {
  useAddInternalTeamMember,
  useInternalTeams,
  useInternalUsers,
  useRemoveInternalTeamMember,
  useSyncMovideskTeams,
} from '@/hooks/use-internal-teams'
import { useAuth } from '@/contexts/auth-context'
import { formatDate, getTimeUntilSla } from '@/lib/date-utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

const PRIORITIES = ['Baixa', 'Normal', 'Alta', 'Urgente']
const STATUSES: InternalCase['status'][] = [
  'Novo',
  'Em atendimento',
  'Aguardando solicitante',
  'Aguardando terceiro',
  'Reaberto',
  'Resolvido',
  'Cancelado',
]
const ACTIVE_COLUMNS: Array<{
  status: InternalCase['status']
  title: string
  description: string
  actionLabel?: string
  nextStatus?: InternalCase['status']
}> = [
  {
    status: 'Novo',
    title: 'Novos chamados',
    description: 'Entradas recentes aguardando triagem.',
    actionLabel: 'Puxar',
    nextStatus: 'Em atendimento',
  },
  {
    status: 'Em atendimento',
    title: 'Em atendimento',
    description: 'Itens em análise ou execução.',
    actionLabel: 'Resolver',
    nextStatus: 'Resolvido',
  },
  {
    status: 'Aguardando solicitante',
    title: 'Aguardando solicitante',
    description: 'Dependem de retorno interno.',
  },
  {
    status: 'Aguardando terceiro',
    title: 'Aguardando terceiro',
    description: 'Dependem de fornecedor ou outra área.',
  },
  {
    status: 'Reaberto',
    title: 'Reabertos',
    description: 'Voltaram para tratamento.',
    actionLabel: 'Atender',
    nextStatus: 'Em atendimento',
  },
]
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_FILE_BYTES = 5 * 1024 * 1024

interface AttachmentDraft extends CreateInternalCaseAttachmentPayload {
  previewUrl: string
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function priorityVariant(priority: string) {
  return priority === 'Urgente' || priority === 'Alta' ? 'warning' : 'secondary'
}

function dueLabel(item: InternalCase) {
  if (!item.dueAt) return 'Sem SLA'
  if (item.isOverdue) return 'SLA vencido'
  return `SLA ${getTimeUntilSla(item.dueAt)}`
}

export function InternalCasesPanel() {
  const [open, setOpen] = useState(false)
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null)
  const casesQuery = useInternalCases()
  const teamsQuery = useInternalTeams()
  const usersQuery = useInternalUsers()
  const dashboardQuery = useInternalCaseDashboard()
  const updateStatus = useUpdateInternalCaseStatus()
  const cases = casesQuery.data?.cases ?? []
  const teams = teamsQuery.data?.teams ?? []
  const users = usersQuery.data?.users ?? []

  const grouped = useMemo(() => {
    const byStatus = new Map<InternalCase['status'], InternalCase[]>()
    for (const status of STATUSES) byStatus.set(status, [])
    for (const item of cases) {
      byStatus.set(item.status, [...(byStatus.get(item.status) ?? []), item])
    }
    return byStatus
  }, [cases])

  return (
    <section className="flex flex-col gap-4">
      <InternalDashboard data={dashboardQuery.data} />

      <section className="rounded-xl border border-border/55 bg-card/62 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary/85">Central interna</p>
            <h2 className="text-base font-semibold text-foreground">Fila de chamados</h2>
          </div>
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <MessageSquarePlus className="h-4 w-4" />
            Abrir novo chamado
          </Button>
        </div>
      </section>

      <InternalSettings teams={teams} users={users} />

      <section className="grid gap-3 xl:grid-cols-2">
        {ACTIVE_COLUMNS.map((column) => (
          <CaseColumn
            key={column.status}
            title={column.title}
            description={column.description}
            cases={grouped.get(column.status) ?? []}
            emptyText={`Nenhum chamado em ${column.status.toLowerCase()}`}
            actionLabel={column.actionLabel}
            onOpen={setSelectedCaseId}
            onAction={
              column.nextStatus
                ? (item) => updateStatus.mutate({ id: item.id, status: column.nextStatus as InternalCase['status'] })
                : undefined
            }
            isUpdating={updateStatus.isPending}
          />
        ))}
      </section>

      <ResolvedHistory cases={[...(grouped.get('Resolvido') ?? []), ...(grouped.get('Cancelado') ?? [])]} onOpen={setSelectedCaseId} />

      <CreateCaseDialog open={open} onClose={() => setOpen(false)} teams={teams} users={users} />
      <CaseDetailDialog caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
    </section>
  )
}

function InternalDashboard({ data }: { data: ReturnType<typeof useInternalCaseDashboard>['data'] }) {
  const summary = data?.summary

  return (
    <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label="Novos" value={summary?.newCount ?? 0} tone="primary" icon={<MessageCircle className="h-4 w-4" />} />
        <SummaryTile label="Abertos" value={(summary?.inServiceCount ?? 0) + (summary?.waitingCount ?? 0)} tone="warning" icon={<Clock3 className="h-4 w-4" />} />
        <SummaryTile label="SLA vencido" value={summary?.overdueCount ?? 0} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="rounded-xl border border-border/55 bg-card/62 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Indicadores CMC</h3>
          </div>
          <Badge variant="outline">
            Média {summary?.avgResolutionHours == null ? '--' : `${summary.avgResolutionHours}h`}
          </Badge>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
          <MetricRows title="Por time" rows={data?.byTeam ?? []} />
          <MetricRows title="Por prioridade" rows={data?.byPriority ?? []} />
        </div>
      </div>

      {data?.oldestOpen?.length ? (
        <div className="rounded-xl border border-border/55 bg-card/50 p-3 xl:col-span-2">
          <h3 className="text-sm font-semibold text-foreground">Chamados abertos há mais tempo</h3>
          <div className="mt-2 grid gap-2 md:grid-cols-5">
            {data.oldestOpen.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/45 bg-background/25 p-2">
                <span className="font-mono text-xs text-primary">CMC-{item.id}</span>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-foreground">{item.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(item.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function MetricRows({ title, rows }: { title: string; rows: Array<{ label: string; total: number }> }) {
  return (
    <div>
      <span className="font-medium text-foreground">{title}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {rows.length ? rows.map((row) => (
          <Badge key={row.label} variant="outline">{row.label}: {row.total}</Badge>
        )) : <span>Nenhum dado ainda</span>}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, tone, icon }: { label: string; value: number; tone: 'primary' | 'warning' | 'success' | 'danger'; icon: React.ReactNode }) {
  const color =
    tone === 'primary'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : tone === 'warning'
        ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
        : tone === 'danger'
          ? 'border-red-500/30 bg-red-500/10 text-red-300'
          : 'border-green-500/30 bg-green-500/10 text-green-300'

  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <strong className="mt-2 block text-2xl text-foreground">{value}</strong>
    </div>
  )
}

function CaseColumn({
  title,
  description,
  cases,
  emptyText,
  actionLabel,
  onAction,
  onOpen,
  isUpdating,
}: {
  title: string
  description: string
  cases: InternalCase[]
  emptyText: string
  actionLabel?: string
  onAction?: (item: InternalCase) => void
  onOpen: (id: number) => void
  isUpdating: boolean
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/45 bg-background/25">
      <div className="border-b border-border/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <Badge variant="outline">{cases.length}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid max-h-[34rem] gap-2 overflow-y-auto p-3">
        {cases.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          cases.map((item) => (
            <CaseCard
              key={item.id}
              item={item}
              actionLabel={actionLabel}
              onAction={onAction ? () => onAction(item) : undefined}
              onOpen={() => onOpen(item.id)}
              isUpdating={isUpdating}
            />
          ))
        )}
      </div>
    </div>
  )
}

function CaseCard({
  item,
  actionLabel,
  onAction,
  onOpen,
  isUpdating,
}: {
  item: InternalCase
  actionLabel?: string
  onAction?: () => void
  onOpen: () => void
  isUpdating: boolean
}) {
  return (
    <article className={`rounded-lg border p-3 ${item.isOverdue ? 'border-red-500/45 bg-red-950/15' : 'border-border/45 bg-card/45'}`}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-primary">CMC-{item.id}</span>
            <Badge variant={priorityVariant(item.priority)}>{item.priority}</Badge>
            <Badge variant={item.isOverdue ? 'destructive' : 'outline'}>{dueLabel(item)}</Badge>
          </div>
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">{item.title}</h4>
        </button>
        {actionLabel && onAction ? (
          <Button type="button" variant="outline" size="sm" onClick={onAction} disabled={isUpdating}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{item.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Aberto por {item.requester.name}</span>
        {item.team && <span>Time: {item.team.name}</span>}
        {item.assignee && <span>Responsável: {item.assignee.name}</span>}
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          {formatDate(item.createdAt)}
        </span>
        {item.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" />
            {item.attachmentCount}
          </span>
        )}
        {item.commentCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
            {item.commentCount}
          </span>
        )}
      </div>
      {item.attachments?.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {item.attachments.slice(0, 3).map((attachment) => (
            <a
              key={attachment.id}
              href={casesApi.attachmentUrl(item.id, attachment.id)}
              target="_blank"
              rel="noreferrer"
              className="aspect-video overflow-hidden rounded-md border border-border/45 bg-muted"
              title={attachment.fileName}
            >
              <img src={casesApi.attachmentUrl(item.id, attachment.id)} alt={attachment.fileName} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function ResolvedHistory({ cases, onOpen }: { cases: InternalCase[]; onOpen: (id: number) => void }) {
  if (!cases.length) return null

  return (
    <section className="rounded-xl border border-border/55 bg-card/45 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Histórico resolvido/cancelado</h3>
        <Badge variant="outline">{cases.length}</Badge>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {cases.slice(0, 9).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="rounded-lg border border-border/40 bg-background/20 p-2 text-left transition-colors hover:bg-muted/40"
          >
            <span className="font-mono text-xs text-primary">CMC-{item.id}</span>
            <p className="mt-1 line-clamp-1 text-xs font-medium text-foreground">{item.title}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{item.status} · {formatDate(item.updatedAt)}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

function CaseDetailDialog({ caseId, onClose }: { caseId: number | null; onClose: () => void }) {
  const caseQuery = useInternalCase(caseId)
  const updateStatus = useUpdateInternalCaseStatus()
  const addComment = useAddInternalCaseComment()
  const item = caseQuery.data
  const [comment, setComment] = useState('')

  useEffect(() => {
    setComment('')
  }, [caseId])

  const submitComment = () => {
    if (!caseId || comment.trim().length < 2) {
      toast.error('Escreva um comentário.')
      return
    }
    addComment.mutate({ id: caseId, content: comment.trim() }, { onSuccess: () => setComment('') })
  }

  return (
    <Dialog.Root open={!!caseId} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-screen w-[min(860px,100vw)] flex-col overflow-hidden border-l border-border/55 bg-background shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-primary">
                <span className="font-mono text-xs">{item ? `CMC-${item.id}` : 'CMC'}</span>
                {item && <Badge variant={priorityVariant(item.priority)}>{item.priority}</Badge>}
                {item && <Badge variant={item.isOverdue ? 'destructive' : 'outline'}>{dueLabel(item)}</Badge>}
              </div>
              <Dialog.Title className="mt-1 line-clamp-2 text-lg font-semibold">{item?.title ?? 'Carregando chamado...'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                Detalhes, anexos, comentários e status do atendimento interno.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid flex-1 gap-4 overflow-y-auto p-4">
            {caseQuery.isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando chamado
              </div>
            ) : item ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <InfoTile label="Status" value={item.status} />
                  <InfoTile label="Time" value={item.team?.name ?? 'Sem time'} />
                  <InfoTile label="Responsável" value={item.assignee?.name ?? 'Sem responsável'} />
                  <InfoTile label="SLA" value={item.dueAt ? formatDate(item.dueAt) : 'Sem prazo'} />
                </div>

                <div className="rounded-lg border border-border/45 bg-card/45 p-3">
                  <h3 className="text-sm font-semibold text-foreground">Descrição</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
                </div>

                <div className="rounded-lg border border-border/45 bg-card/45 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Status</h3>
                    <select
                      value={item.status}
                      onChange={(event) => updateStatus.mutate({ id: item.id, status: event.target.value as InternalCase['status'] })}
                      className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none"
                      disabled={updateStatus.isPending}
                    >
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                </div>

                {item.attachments?.length ? (
                  <div className="rounded-lg border border-border/45 bg-card/45 p-3">
                    <h3 className="text-sm font-semibold text-foreground">Anexos</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {item.attachments.map((attachment) => (
                        <a key={attachment.id} href={casesApi.attachmentUrl(item.id, attachment.id)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-md border border-border/45 bg-muted">
                          <img src={casesApi.attachmentUrl(item.id, attachment.id)} alt={attachment.fileName} className="aspect-video w-full object-cover" />
                          <p className="truncate px-2 py-1 text-xs text-muted-foreground">{attachment.fileName}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-border/45 bg-card/45 p-3">
                  <h3 className="text-sm font-semibold text-foreground">Comentários internos</h3>
                  <div className="mt-3 grid gap-2">
                    {item.comments?.length ? item.comments.map((entry) => (
                      <div key={entry.id} className="rounded-md border border-border/40 bg-background/30 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <strong className="text-foreground">{entry.author.name}</strong>
                          <span className="text-muted-foreground">{formatDate(entry.createdAt)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{entry.content}</p>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
                  </div>
                  <div className="mt-3 grid gap-2">
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Adicionar atualização interna..."
                      className="min-h-24 w-full resize-y rounded-md border border-border/45 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                    />
                    <div className="flex justify-end">
                      <Button type="button" size="sm" onClick={submitComment} disabled={addComment.isPending}>
                        {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Comentar
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Chamado não encontrado.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/45 bg-card/45 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <strong className="mt-1 block truncate text-sm text-foreground">{value}</strong>
    </div>
  )
}

function InternalSettings({ teams, users }: { teams: InternalTeam[]; users: InternalUser[] }) {
  const { user } = useAuth()
  const policiesQuery = useInternalCaseSlaPolicies()

  if (user?.role !== 'admin') {
    return (
      <section className="rounded-xl border border-border/55 bg-card/45 p-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Configurações internas</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {teams.length ? `${teams.length} time(s) configurado(s).` : 'Nenhum time configurado ainda.'}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border/55 bg-card/45 p-3">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Configurações internas</h3>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <TeamAdminPanel teams={teams} users={users} />
        <SlaAdminPanel policies={policiesQuery.data?.policies ?? []} />
      </div>
    </section>
  )
}

function TeamAdminPanel({ teams, users }: { teams: InternalTeam[]; users: InternalUser[] }) {
  const syncMovidesk = useSyncMovideskTeams()
  const addMember = useAddInternalTeamMember()
  const removeMember = useRemoveInternalTeamMember()
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)

  const currentTeam = teams.find((team) => String(team.id) === selectedTeam)

  const submitMember = () => {
    const teamId = Number(selectedTeam)
    const userId = Number(selectedUser)
    if (!teamId || !userId) {
      toast.error('Selecione time e usuário.')
      return
    }
    addMember.mutate({ teamId, userId, isAdmin: isTeamAdmin })
  }

  return (
    <div className="rounded-lg border border-border/45 bg-background/25 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Times e membros</h4>
      <div className="mt-3 grid gap-2">
        <p className="text-xs text-muted-foreground">
          A lista de times do CMC usa os nomes retornados pelo Movidesk. Sincronize depois de alterar times por lá.
        </p>
        <Button type="button" size="sm" onClick={() => syncMovidesk.mutate()} disabled={syncMovidesk.isPending}>
          {syncMovidesk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
          Sincronizar times do Movidesk
        </Button>
      </div>

      <div className="mt-4 grid gap-2">
        <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)} className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none">
          <option value="">Selecione o time</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        {currentTeam ? (
          <>
            <div className="rounded-md border border-border/40 bg-card/35 p-2 text-xs text-muted-foreground">
              <strong className="text-foreground">{currentTeam.name}</strong>
              {currentTeam.description ? <span> · {currentTeam.description}</span> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <select value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none">
                <option value="">Selecione o usuário</option>
                {users.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.email ?? item.username})</option>)}
              </select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={isTeamAdmin} onChange={(event) => setIsTeamAdmin(event.target.checked)} className="h-4 w-4" />
                Admin
              </label>
              <Button type="button" size="sm" onClick={submitMember} disabled={addMember.isPending}>
                Adicionar
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentTeam.members.length ? currentTeam.members.map((member) => (
                <Badge key={member.userId} variant="outline" className="gap-1.5">
                  {member.name}{member.isAdmin ? ' · admin' : ''}
                  <button type="button" onClick={() => removeMember.mutate({ teamId: currentTeam.id, userId: member.userId })} disabled={removeMember.isPending}>
                    <UserMinus className="h-3 w-3" />
                  </button>
                </Badge>
              )) : <span className="text-xs text-muted-foreground">Nenhum membro nesse time.</span>}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SlaAdminPanel({ policies }: { policies: InternalCaseSlaPolicy[] }) {
  const updateSla = useUpdateInternalCaseSlaPolicy()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setDrafts(Object.fromEntries(policies.map((policy) => [policy.priority, String(policy.durationHours)])))
  }, [policies])

  const submit = (priority: string) => {
    const durationHours = Number(drafts[priority])
    if (!Number.isInteger(durationHours) || durationHours < 1) {
      toast.error('Informe um prazo em horas válido.')
      return
    }
    updateSla.mutate({ priority, durationHours })
  }

  return (
    <div className="rounded-lg border border-border/45 bg-background/25 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SLA por prioridade</h4>
      <div className="mt-3 grid gap-2">
        {PRIORITIES.map((priority) => (
          <div key={priority} className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
            <Badge variant={priorityVariant(priority)}>{priority}</Badge>
            <Input
              type="number"
              min={1}
              value={drafts[priority] ?? ''}
              onChange={(event) => setDrafts((current) => ({ ...current, [priority]: event.target.value }))}
              placeholder="Horas"
            />
            <Button type="button" size="sm" variant="outline" onClick={() => submit(priority)} disabled={updateSla.isPending}>
              <Pencil className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CreateCaseDialog({
  open,
  onClose,
  teams,
  users,
}: {
  open: boolean
  onClose: () => void
  teams: InternalTeam[]
  users: InternalUser[]
}) {
  const createCase = useCreateInternalCase()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [teamId, setTeamId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])

  const reset = () => {
    for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl)
    setTitle('')
    setDescription('')
    setCategory('')
    setPriority('Normal')
    setTeamId('')
    setAssigneeId('')
    setAttachments([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next: AttachmentDraft[] = []

    for (const file of Array.from(files).slice(0, 6 - attachments.length)) {
      if (!IMAGE_TYPES.has(file.type)) {
        toast.error(`${file.name} não é uma imagem suportada.`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} excede 5 MB.`)
        continue
      }

      next.push({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        dataBase64: await fileToBase64(file),
        previewUrl: URL.createObjectURL(file),
      })
    }

    setAttachments((current) => [...current, ...next])
  }

  const removeAttachment = (index: number) => {
    setAttachments((current) => {
      const target = current[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((_, currentIndex) => currentIndex !== index)
    })
  }

  const submit = () => {
    if (title.trim().length < 3) {
      toast.error('Informe um título para o chamado.')
      return
    }
    if (description.trim().length < 5) {
      toast.error('Descreva o chamado antes de enviar.')
      return
    }

    createCase.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        priority,
        teamId: teamId ? Number(teamId) : undefined,
        assigneeId: assigneeId ? Number(assigneeId) : undefined,
        attachments: attachments.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
      },
      { onSuccess: close },
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(720px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border/55 bg-background shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border/45 p-4">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <MessageSquarePlus className="h-4 w-4" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Abrir novo chamado</span>
              </div>
              <Dialog.Title className="mt-1 text-base font-semibold">Registrar solicitação no CMC</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                O prazo de SLA será calculado pela prioridade configurada.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid gap-4 overflow-y-auto p-4">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título do chamado" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Categoria opcional" />
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring">
                {PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring">
                <option value="">Time responsável</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring">
                <option value="">Usuário responsável</option>
                {users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descreva o problema, impacto, passos para reproduzir e o que precisa ser analisado..."
              className="min-h-36 w-full resize-y rounded-md border border-border/45 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-card/35 p-4 text-center transition-colors hover:bg-muted/40">
              <ImagePlus className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-foreground">Anexar prints ou imagens</span>
              <span className="text-xs text-muted-foreground">PNG, JPG, WEBP ou GIF, até 5 MB cada</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }} />
            </label>
            {attachments.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.fileName}-${index}`} className="group relative overflow-hidden rounded-md border border-border/45 bg-card">
                    <img src={attachment.previewUrl} alt={attachment.fileName} className="aspect-video w-full object-cover" />
                    <button type="button" className="absolute right-1 top-1 rounded bg-background/85 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100" onClick={() => removeAttachment(index)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <p className="truncate px-2 py-1 text-xs text-muted-foreground">{attachment.fileName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/45 p-4">
            <Button type="button" variant="outline" onClick={close} disabled={createCase.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={submit} disabled={createCase.isPending}>
              {createCase.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Abrir chamado
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
