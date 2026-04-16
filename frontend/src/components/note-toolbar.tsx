import { type RefObject } from 'react'
import { Bold, Italic, Strikethrough, Code } from 'lucide-react'

interface NoteToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
}

const COLORS = [
  { label: 'Vermelho', value: '#ef4444' },
  { label: 'Laranja', value: '#f97316' },
  { label: 'Amarelo', value: '#eab308' },
  { label: 'Verde', value: '#22c55e' },
  { label: 'Azul', value: '#3b82f6' },
  { label: 'Roxo', value: '#a855f7' },
  { label: 'Rosa', value: '#ec4899' },
  { label: 'Cinza', value: '#6b7280' },
]

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = 'texto',
): string {
  const { selectionStart: start, selectionEnd: end, value } = textarea
  const selected = value.slice(start, end) || placeholder
  const newValue = value.slice(0, start) + before + selected + after + value.slice(end)

  // Restore focus and move cursor after the inserted content
  setTimeout(() => {
    textarea.focus()
    const cursorPos = start + before.length + selected.length + after.length
    textarea.setSelectionRange(
      selected === placeholder ? start + before.length : cursorPos,
      selected === placeholder ? start + before.length + placeholder.length : cursorPos,
    )
  }, 0)

  return newValue
}

export function NoteToolbar({ textareaRef, onChange }: NoteToolbarProps) {
  const apply = (before: string, after: string, placeholder?: string) => {
    const ta = textareaRef.current
    if (!ta) return
    onChange(wrapSelection(ta, before, after, placeholder))
  }

  const applyColor = (color: string) => {
    apply(`<span style="color:${color}">`, '</span>')
  }

  return (
    <div className="flex items-center gap-0.5 px-1 py-1 border border-border/40 rounded-lg bg-muted/30 flex-wrap">
      {/* Format buttons */}
      <ToolButton onClick={() => apply('**', '**')} title="Negrito (Ctrl+B)">
        <Bold size={13} />
      </ToolButton>
      <ToolButton onClick={() => apply('*', '*')} title="Itálico (Ctrl+I)">
        <Italic size={13} />
      </ToolButton>
      <ToolButton onClick={() => apply('~~', '~~')} title="Tachado">
        <Strikethrough size={13} />
      </ToolButton>
      <ToolButton onClick={() => apply('`', '`', 'código')} title="Código inline">
        <Code size={13} />
      </ToolButton>

      <div className="w-px h-4 bg-border/60 mx-1" />

      {/* Color swatches */}
      {COLORS.map((c) => (
        <button
          key={c.value}
          title={c.label}
          onPointerDown={(e) => e.preventDefault()} // prevent textarea blur
          onClick={() => applyColor(c.value)}
          className="w-4 h-4 rounded-full border border-white/20 hover:scale-110 transition-transform shrink-0"
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  )
}

function ToolButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onPointerDown={(e) => e.preventDefault()} // prevent textarea blur
      onClick={onClick}
      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {children}
    </button>
  )
}
