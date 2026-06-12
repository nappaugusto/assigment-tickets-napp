import { useState, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from 'lucide-react'
import { type Ticket, type KanbanColumn as KanbanColumnType } from '@/lib/api'
import { KanbanCardDraggable } from '@/components/kanban-card-draggable'

export type KanbanColumnDateSort = 'manual' | 'date_asc' | 'date_desc'

interface KanbanColumnProps {
  column: KanbanColumnType
  columns: KanbanColumnType[]
  tickets: Ticket[]
  dateSort: KanbanColumnDateSort
  onDateSortChange: (columnId: string, sort: KanbanColumnDateSort) => void
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  onDelete: (columnId: string) => void
  onMoveTicketToColumn: (ticketId: number, columnId: string) => void
  showTriageSummary: boolean
}

export function KanbanColumn({
  column,
  columns,
  tickets,
  dateSort,
  onDateSortChange,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  onDelete,
  onMoveTicketToColumn,
  showTriageSummary,
}: KanbanColumnProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  const ticketIds = tickets.map((t) => String(t.id))
  const SortIcon = dateSort === 'date_asc' ? ArrowUp : dateSort === 'date_desc' ? ArrowDown : ArrowUpDown
  const sortTitle =
    dateSort === 'date_asc'
      ? 'Data mais próxima primeiro'
      : dateSort === 'date_desc'
        ? 'Data mais distante primeiro'
        : 'Ordem manual'

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(column.id)
    } else {
      setConfirmDelete(true)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  const handleDateSortClick = () => {
    const nextSort =
      dateSort === 'manual' ? 'date_asc' : dateSort === 'date_asc' ? 'date_desc' : 'manual'
    onDateSortChange(column.id, nextSort)
  }

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col gap-2 w-[280px] shrink-0"
      data-kanban-column-id={column.id}
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold text-sm">{column.title}</h2>
          <span className="text-xs text-muted-foreground">{tickets.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleDateSortClick}
            title={`Ordenar por vencimento: ${sortTitle}`}
            className={`p-1 rounded transition-colors ${
              dateSort === 'manual'
                ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                : 'text-primary bg-primary/10 hover:bg-primary/15'
            }`}
            aria-label={`Ordenar lista por vencimento: ${sortTitle}`}
          >
            <SortIcon size={14} />
          </button>
          {!column.isDefault && (
            <button
              type="button"
              onClick={handleDeleteClick}
              title={confirmDelete ? 'Clique para confirmar exclusão' : 'Deletar lista'}
              className={`p-1 rounded transition-colors ${
                confirmDelete
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div
        className={`flex flex-col gap-2 min-h-24 rounded-lg p-2 transition-colors ${
          isOver ? 'bg-muted/60' : 'bg-muted/20'
        }`}
      >
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          {tickets.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              Nenhum ticket
            </p>
          ) : (
            tickets.map((t) => (
              <KanbanCardDraggable
                key={t.id}
                ticket={t}
                agentOptions={agentOptions}
                onAssign={onAssign}
                onUnassign={onUnassign}
                isLoading={isLoading}
                currentUser={currentUser}
                columns={columns}
                currentColumnId={column.id}
                onMoveToColumn={onMoveTicketToColumn}
                showTriageSummary={showTriageSummary}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}
