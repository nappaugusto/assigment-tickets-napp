import { useState, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Clock, UserX, Trash2 } from 'lucide-react'
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
  metrics?: {
    expired: number
    warning: number
    unassigned: number
  }
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
  metrics,
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
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate font-semibold text-sm">{column.title}</h2>
            <span className="text-xs text-muted-foreground">{tickets.length}</span>
          </div>
          {metrics && (metrics.expired > 0 || metrics.warning > 0 || metrics.unassigned > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {metrics.expired > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">
                  <AlertTriangle size={11} />
                  {metrics.expired}
                </span>
              )}
              {metrics.warning > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-amber-300">
                  <Clock size={11} />
                  {metrics.warning}
                </span>
              )}
              {metrics.unassigned > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                  <UserX size={11} />
                  {metrics.unassigned}
                </span>
              )}
            </div>
          )}
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
