import { useState, useRef } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { type KanbanBoard as KanbanBoardState, type Ticket } from '@/lib/api'
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
  const { board, isLoading: boardLoading, isError: boardError, updateBoard } = useKanbanBoard()

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const allTickets = [...tickets, ...newTickets]

  const getDefaultColId = () => board?.columns?.find((c) => c.isDefault)?.id ?? 'entrada'

  const getTicketsForColumn = (columnId: string): Ticket[] => {
    if (!board || !Array.isArray(board.columns)) return []
    const defaultColId = getDefaultColId()
    const columnItems = board.columnItems ?? {}
    const explicitIds = columnItems[columnId] ?? []

    let ids = explicitIds
    if (columnId === defaultColId) {
      // tickets not placed in any column implicitly belong to the default
      const allPlaced = new Set(Object.values(columnItems).flat())
      const unplacedIds = allTickets
        .map((t) => String(t.id))
        .filter((id) => !allPlaced.has(id))
      ids = [...explicitIds, ...unplacedIds]
    }

    return ids
      .map((id) => allTickets.find((t) => String(t.id) === id))
      .filter((t): t is Ticket => t !== undefined)
  }

  const findColumnIdForItem = (boardState: KanbanBoardState, itemId: string) => {
    if (boardState.columns.some((c) => c.id === itemId)) return itemId
    return Object.entries(boardState.columnItems ?? {}).find(([, ids]) => ids.includes(itemId))?.[0]
  }

  const getClosestColumnId = (activeRect: { left: number; width: number } | null | undefined) => {
    if (!activeRect) return null

    const activeCenterX = activeRect.left + activeRect.width / 2
    const columns = Array.from(
      document.querySelectorAll<HTMLElement>('[data-kanban-column-id]'),
    )

    let closest: { id: string; distance: number; limit: number } | null = null

    for (const column of columns) {
      const rect = column.getBoundingClientRect()
      const id = column.dataset.kanbanColumnId
      if (!id) continue

      const distance =
        activeCenterX < rect.left
          ? rect.left - activeCenterX
          : activeCenterX > rect.right
            ? activeCenterX - rect.right
            : 0

      const limit = rect.width / 2 + 120
      if (!closest || distance < closest.distance) {
        closest = { id, distance, limit }
      }
    }

    return closest && closest.distance <= closest.limit ? closest.id : null
  }

  const getDropTarget = (
    boardState: KanbanBoardState,
    activeRect: { left: number; width: number } | null | undefined,
    overId?: string,
  ) => {
    const closestColumnId = getClosestColumnId(activeRect)
    if (!closestColumnId) return overId ?? null
    if (!overId) return closestColumnId

    const overColumnId = findColumnIdForItem(boardState, overId)
    return overColumnId === closestColumnId ? overId : closestColumnId
  }

  const moveTicketOnBoard = (
    prev: KanbanBoardState,
    activeId: string,
    overId: string,
    insertAfter = false,
  ): KanbanBoardState => {
    if (activeId === overId) return prev

    const defaultColId = prev.columns.find((c) => c.isDefault)?.id ?? 'entrada'
    const sourceColId =
      Object.entries(prev.columnItems ?? {}).find(([, ids]) => ids.includes(activeId))?.[0] ??
      defaultColId
    const isOverColumn = prev.columns.some((c) => c.id === overId)
    const targetColId = isOverColumn
      ? overId
      : Object.entries(prev.columnItems ?? {}).find(([, ids]) => ids.includes(overId))?.[0] ??
        defaultColId

    const nextItems = { ...prev.columnItems }
    const allPlaced = new Set(Object.values(prev.columnItems ?? {}).flat())
    const unplacedIds = allTickets
      .map((t) => String(t.id))
      .filter((id) => !allPlaced.has(id))

    const buildColumnList = (columnId: string, excludeId?: string) => {
      const explicitIds = nextItems[columnId] ?? []
      const implicitIds =
        columnId === defaultColId ? unplacedIds.filter((id) => id !== excludeId) : []

      return [...explicitIds, ...implicitIds].filter((id) => id !== excludeId)
    }

    const sourceList = buildColumnList(sourceColId)
    if (!sourceList.includes(activeId)) return prev

    if (sourceColId === targetColId) {
      const oldIndex = sourceList.indexOf(activeId)
      const targetList = sourceList.filter((id) => id !== activeId)
      const overIndex = isOverColumn ? targetList.length : targetList.indexOf(overId)
      const insertAt =
        overIndex === -1 ? targetList.length : overIndex + (insertAfter ? 1 : 0)
      const reordered = [
        ...targetList.slice(0, insertAt),
        activeId,
        ...targetList.slice(insertAt),
      ]

      if (oldIndex === insertAt || sourceList.join('|') === reordered.join('|')) return prev
      nextItems[sourceColId] = reordered
      return { ...prev, columnItems: nextItems }
    }

    nextItems[sourceColId] = sourceList.filter((id) => id !== activeId)

    const targetList = buildColumnList(targetColId, activeId)
    const overIndex = isOverColumn ? targetList.length : targetList.indexOf(overId)
    const insertAt = overIndex === -1 ? targetList.length : overIndex + (insertAfter ? 1 : 0)
    nextItems[targetColId] = [
      ...targetList.slice(0, insertAt),
      activeId,
      ...targetList.slice(insertAt),
    ]

    return { ...prev, columnItems: nextItems }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = allTickets.find((t) => String(t.id) === event.active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!board) return

    const activeRect = active.rect.current.translated
    const targetId = getDropTarget(board, activeRect, over ? String(over.id) : undefined)
    if (!targetId) return

    const overRect = over?.rect
    const insertAfter =
      activeRect && overRect && !board.columns.some((c) => c.id === targetId)
        ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
        : false

    updateBoard((prev) => moveTicketOnBoard(prev, String(active.id), targetId, insertAfter))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicket(null)
    const { active, over } = event
    if (!board) return

    const activeRect = active.rect.current.translated
    const targetId = getDropTarget(board, activeRect, over ? String(over.id) : undefined)
    if (!targetId) return

    const overRect = over?.rect
    const insertAfter =
      activeRect && overRect && !board.columns.some((c) => c.id === targetId)
        ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
        : false

    updateBoard((prev) => moveTicketOnBoard(prev, String(active.id), targetId, insertAfter))
  }

  const handleDeleteColumn = (columnId: string) => {
    if (!board) return
    const defaultColId = getDefaultColId()
    updateBoard((prev) => {
      const newItems = { ...prev.columnItems }
      const deletedIds = newItems[columnId] ?? []
      newItems[defaultColId] = [...(newItems[defaultColId] ?? []), ...deletedIds]
      delete newItems[columnId]
      return {
        columns: prev.columns.filter((c) => c.id !== columnId),
        columnItems: newItems,
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

  if (boardLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="w-[280px] shrink-0 h-64 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    )
  }

  if (boardError || !board || !Array.isArray(board.columns)) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Erro ao carregar o board. Recarregue a página.
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
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
