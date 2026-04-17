import { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { X, Eye, Pencil } from 'lucide-react'
import { type Ticket } from '@/lib/api'
import { useTicketNote } from '@/hooks/use-ticket-note'
import { NoteToolbar } from '@/components/note-toolbar'
import { getTicketUrl } from '@/lib/utils'

interface TicketNoteDrawerProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
}

export function TicketNoteDrawer({ ticket, open, onClose }: TicketNoteDrawerProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const { content, isLoading, saveDebounced, isSaving } = useTicketNote(ticket?.id ?? 0)
  const [localContent, setLocalContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open && !isLoading) {
      setLocalContent(content)
    }
  }, [open, content, isLoading])

  const handleChange = (value: string) => {
    setLocalContent(value)
    if (ticket) saveDebounced(value)
  }

  if (!ticket) return null

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border/40 shadow-xl z-50 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border/40 shrink-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              <a
                href={getTicketUrl(ticket.id)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-primary hover:underline"
              >
                #{ticket.id}
              </a>
              <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground">
                {ticket.subject || '—'}
              </p>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded hover:bg-muted transition-colors shrink-0 text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Mode toggle + save indicator */}
          <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
            <button
              onClick={() => setMode('edit')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                mode === 'edit'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Pencil size={12} />
              Editar
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                mode === 'preview'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Eye size={12} />
              Preview
            </button>
            {isSaving && (
              <span className="ml-auto text-xs text-muted-foreground">Salvando…</span>
            )}
          </div>

          {/* Toolbar (edit mode only) */}
          {mode === 'edit' && !isLoading && (
            <div className="px-4 pt-2 shrink-0">
              <NoteToolbar textareaRef={textareaRef} onChange={handleChange} />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-hidden p-4">
            {isLoading ? (
              <div className="h-full rounded-lg bg-muted/30 animate-pulse" />
            ) : mode === 'edit' ? (
              <textarea
                ref={textareaRef}
                value={localContent}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Escreva suas anotações em Markdown…"
                className="w-full h-full resize-none bg-muted/20 border border-border/40 rounded-lg p-3 text-sm font-mono outline-none focus:border-primary/50 focus:bg-muted/30 transition-colors placeholder:text-muted-foreground leading-relaxed"
              />
            ) : (
              <div className="h-full overflow-y-auto rounded-lg bg-muted/20 border border-border/40 p-4">
                {localContent.trim() ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground
                    [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4
                    [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3
                    [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2
                    [&_p]:mb-2 [&_p]:leading-relaxed
                    [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2
                    [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2
                    [&_li]:mb-1
                    [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                    [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-2
                    [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_blockquote]:mb-2
                    [&_hr]:border-border/40 [&_hr]:my-3
                    [&_strong]:font-semibold
                    [&_a]:text-primary [&_a]:hover:underline
                    [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse
                    [&_th]:border [&_th]:border-border/40 [&_th]:p-1.5 [&_th]:bg-muted/50 [&_th]:font-medium
                    [&_td]:border [&_td]:border-border/40 [&_td]:p-1.5
                  ">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {localContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic text-center mt-8">
                    Nenhuma anotação ainda
                  </p>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
