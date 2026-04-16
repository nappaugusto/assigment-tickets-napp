import { useState, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { type Ticket } from '@/lib/api'
import { useKanbanBoard } from '@/hooks/use-kanban-board'
import { useAuth } from '@/contexts/auth-context'
import { KanbanColumn } from '@/components/kanban-column'
import { KanbanCardDraggable } from '@/components/kanban-card-draggable'

interface KanbanBoardProps {
  tickets: Ticket[]
  newTickets: Ticket[]
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
}

export function KanbanBoard({
  tickets,
  newTickets,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
}: KanbanBoardProps) {
  const { user } = useAuth()
  const currentUser = user?.name ?? ''
  const { board, isLoading: boardLoading, updateBoard } = useKanbanBoard()

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const allTickets = [...tickets, ...newTickets]

  const getTicketsForColumn = (columnId: string): Ticket[] => {
    if (!board) return []
    const defaultColId = board.columns.find((c) => c.isDefault)?.id ?? 'entrada'
    return allTickets.filter((t) => {
      const pos = board.positions[String(t.id)]
      return pos ? pos === columnId : columnId === defaultColId
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = allTickets.find((t) => String(t.id) === event.active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicket(null)
    const { active, over } = event
    if (!over || !board) return

    const ticketId = String(active.id)
    const overId = String(over.id)

    const isColumn = board.columns.some((c) => c.id === overId)
    let targetColumnId = overId
    if (!isColumn) {
      const defaultColId = board.columns.find((c) => c.isDefault)?.id ?? 'entrada'
      targetColumnId = board.positions[overId] ?? defaultColId
    }

    updateBoard((prev) => ({
      ...prev,
      positions: { ...prev.positions, [ticketId]: targetColumnId },
    }))
  }

  const handleDeleteColumn = (columnId: string) => {
    if (!board) return
    const defaultColId = board.columns.find((c) => c.isDefault)?.id ?? 'entrada'
    updateBoard((prev) => {
      const newPositions = { ...prev.positions }
      for (const [tid, cid] of Object.entries(newPositions)) {
        if (cid === columnId) newPositions[tid] = defaultColId
      }
      return {
        columns: prev.columns.filter((c) => c.id !== columnId),
        positions: newPositions,
      }
    })
  }

  const handleAddColumn = () => {
    const title = newColumnTitle.trim()
    if (!title) {
      setAddingColumn(false)
      setNewColumnTitle('')
      return
    }
    updateBoard((prev) => ({
      ...prev,
      columns: [
        ...prev.columns,
        { id: crypto.randomUUID(), title, isDefault: false },
      ],
    }))
    setAddingColumn(false)
    setNewColumnTitle('')
  }

  if (boardLoading || !board) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="w-[280px] shrink-0 h-64 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 items-start">
        {board.columns.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            tickets={getTicketsForColumn(col.id)}
            agentOptions={agentOptions}
            onAssign={onAssign}
            onUnassign={onUnassign}
            isLoading={isLoading}
            currentUser={currentUser}
            onDelete={handleDeleteColumn}
          />
        ))}

        <div className="w-[280px] shrink-0">
          {addingColumn ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3 bg-card">
              <input
                ref={inputRef}
                autoFocus
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddColumn()
                  if (e.key === 'Escape') {
                    setAddingColumn(false)
                    setNewColumnTitle('')
                  }
                }}
                onBlur={handleAddColumn}
                placeholder="Nome da lista..."
                className="text-sm bg-transparent outline-none border-b border-border/60 pb-1 placeholder:text-muted-foreground"
              />
              <span className="text-xs text-muted-foreground">Enter para confirmar · Esc para cancelar</span>
            </div>
          ) : (
            <button
              onClick={() => {
                setAddingColumn(true)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full rounded-lg border border-dashed border-border/40 p-3 hover:border-border hover:bg-muted/20"
            >
              <Plus size={14} />
              Nova lista
            </button>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeTicket ? (
          <KanbanCardDraggable
            ticket={activeTicket}
            agentOptions={agentOptions}
            onAssign={onAssign}
            onUnassign={onUnassign}
            isLoading={isLoading}
            currentUser={currentUser}
            isDragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
