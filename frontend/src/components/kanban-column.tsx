import { useState, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Trash2 } from 'lucide-react'
import { type Ticket, type KanbanColumn as KanbanColumnType } from '@/lib/api'
import { KanbanCardDraggable } from '@/components/kanban-card-draggable'

interface KanbanColumnProps {
  column: KanbanColumnType
  tickets: Ticket[]
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  onDelete: (columnId: string) => void
}

export function KanbanColumn({
  column,
  tickets,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  onDelete,
}: KanbanColumnProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  const ticketIds = tickets.map((t) => String(t.id))

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(column.id)
    } else {
      setConfirmDelete(true)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-2 w-[280px] shrink-0">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold text-sm">{column.title}</h2>
          <span className="text-xs text-muted-foreground">{tickets.length}</span>
        </div>
        {!column.isDefault && (
          <button
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

      <div
        ref={setNodeRef}
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
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}
