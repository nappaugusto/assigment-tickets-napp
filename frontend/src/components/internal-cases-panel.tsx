import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  CalendarClock,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Send,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  casesApi,
  type CreateInternalCaseAttachmentPayload,
  type InternalCase,
} from '@/lib/api'
import {
  useCreateInternalCase,
  useInternalCases,
  useUpdateInternalCaseStatus,
} from '@/hooks/use-cases'
import { formatDate } from '@/lib/date-utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

const PRIORITIES = ['Baixa', 'Normal', 'Alta', 'Urgente']
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

export function InternalCasesPanel() {
  const [open, setOpen] = useState(false)
  const casesQuery = useInternalCases()
  const updateStatus = useUpdateInternalCaseStatus()
  const cases = casesQuery.data?.cases ?? []

  const grouped = useMemo(() => ({
    newCases: cases.filter((item) => item.status === 'Novo'),
    inService: cases.filter((item) => item.status === 'Em atendimento'),
    done: cases.filter((item) => item.status === 'Resolvido'),
  }), [cases])

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/55 bg-card/62 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary/85">CMC interno</p>
          <h2 className="text-base font-semibold text-foreground">Chamados próprios</h2>
        </div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <MessageSquarePlus className="h-4 w-4" />
          Abrir novo chamado
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <CaseColumn
          title="Novos chamados"
          description="Entram como Novo e viram atendimento no próximo dia."
          cases={grouped.newCases}
          emptyText="Nenhum chamado novo"
          actionLabel="Puxar para atendimento"
          onAction={(item) => updateStatus.mutate({ id: item.id, status: 'Em atendimento' })}
          isUpdating={updateStatus.isPending}
        />
        <CaseColumn
          title="Em atendimento"
          description="Fila compartilhada para análise e resolução."
          cases={grouped.inService}
          emptyText="Nenhum chamado em atendimento"
          actionLabel="Resolver"
          onAction={(item) => updateStatus.mutate({ id: item.id, status: 'Resolvido' })}
          isUpdating={updateStatus.isPending}
        />
      </div>

      {grouped.done.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-background/20 px-3 py-2 text-xs text-muted-foreground">
          {grouped.done.length} chamado{grouped.done.length !== 1 ? 's' : ''} resolvido{grouped.done.length !== 1 ? 's' : ''} no histórico.
        </div>
      )}

      <CreateCaseDialog open={open} onClose={() => setOpen(false)} />
    </section>
  )
}

function CaseColumn({
  title,
  description,
  cases,
  emptyText,
  actionLabel,
  onAction,
  isUpdating,
}: {
  title: string
  description: string
  cases: InternalCase[]
  emptyText: string
  actionLabel: string
  onAction: (item: InternalCase) => void
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
      <div className="grid max-h-96 gap-2 overflow-y-auto p-3">
        {cases.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          cases.map((item) => (
            <CaseCard
              key={item.id}
              item={item}
              actionLabel={actionLabel}
              onAction={() => onAction(item)}
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
  isUpdating,
}: {
  item: InternalCase
  actionLabel: string
  onAction: () => void
  isUpdating: boolean
}) {
  return (
    <article className="rounded-lg border border-border/45 bg-card/45 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-primary">CMC-{item.id}</span>
            <Badge variant={item.priority === 'Urgente' || item.priority === 'Alta' ? 'warning' : 'secondary'}>
              {item.priority}
            </Badge>
          </div>
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">{item.title}</h4>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAction} disabled={isUpdating}>
          {actionLabel}
        </Button>
      </div>
      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{item.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Aberto por {item.requester.name}</span>
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
              <img
                src={casesApi.attachmentUrl(item.id, attachment.id)}
                alt={attachment.fileName}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function CreateCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createCase = useCreateInternalCase()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])

  const reset = () => {
    for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl)
    setTitle('')
    setDescription('')
    setCategory('')
    setPriority('Normal')
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
        attachments: attachments.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
      },
      {
        onSuccess: close,
      },
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
                O chamado ficará visível para todos os usuários do painel.
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
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
              >
                {PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
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
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(event) => {
                  void addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
            {attachments.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.fileName}-${index}`} className="group relative overflow-hidden rounded-md border border-border/45 bg-card">
                    <img src={attachment.previewUrl} alt={attachment.fileName} className="aspect-video w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-background/85 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      onClick={() => removeAttachment(index)}
                    >
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
