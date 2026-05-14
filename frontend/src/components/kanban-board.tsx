import { useCallback, useEffect, useState, useRef } from 'react'
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
import { KanbanColumn, type KanbanColumnDateSort } from '@/components/kanban-column'
import { KanbanCardDraggable } from '@/components/kanban-card-draggable'

const KANBAN_COLUMN_DATE_SORTS_KEY = 'kanbanColumnDateSorts'

interface ScrollContainerSnapshot {
  element: HTMLElement
  scrollTop: number
  scrollLeft: number
  overflowX: string
  overflowY: string
}

function restoreScrollContainers(containers: ScrollContainerSnapshot[]) {
  for (const container of containers) {
    container.element.style.overflowX = container.overflowX
    container.element.style.overflowY = container.overflowY
    container.element.scrollTo(container.scrollLeft, container.scrollTop)
  }
}

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
  const [columnDateSorts, setColumnDateSorts] = useState<Record<string, KanbanColumnDateSort>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KANBAN_COLUMN_DATE_SORTS_KEY) ?? '{}')
      if (!stored || typeof stored !== 'object') return {}

      return Object.fromEntries(
        Object.entries(stored).filter(([, value]) =>
          value === 'manual' || value === 'date_asc' || value === 'date_desc',
        ),
      ) as Record<string, KanbanColumnDateSort>
    } catch {
      return {}
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollLockRef = useRef<{
    scrollX: number
    scrollY: number
    bodyPosition: string
    bodyTop: string
    bodyLeft: string
    bodyWidth: string
    bodyOverflow: string
    scrollContainers: ScrollContainerSnapshot[]
  } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const allTickets = [...tickets, ...newTickets]

  const getDefaultColId = () => board?.columns?.find((c) => c.isDefault)?.id ?? 'entrada'

  const lockPageScroll = useCallback(() => {
    if (scrollLockRef.current) return

    const scrollContainers = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const style = window.getComputedStyle(element)
        const canScrollY = element.scrollHeight > element.clientHeight
        const canScrollX = element.scrollWidth > element.clientWidth
        const hasScrollableOverflow =
          /(auto|scroll|overlay)/.test(style.overflowY) ||
          /(auto|scroll|overlay)/.test(style.overflowX)

        return hasScrollableOverflow && (canScrollY || canScrollX)
      })
      .map((element) => ({
        element,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        overflowX: element.style.overflowX,
        overflowY: element.style.overflowY,
      }))

    scrollLockRef.current = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyLeft: document.body.style.left,
      bodyWidth: document.body.style.width,
      bodyOverflow: document.body.style.overflow,
      scrollContainers,
    }

    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollLockRef.current.scrollY}px`
    document.body.style.left = `-${scrollLockRef.current.scrollX}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'

    for (const container of scrollContainers) {
      container.element.style.overflowY = 'hidden'
      container.element.style.overflowX = 'hidden'
    }
  }, [])

  const unlockPageScroll = useCallback(() => {
    const lock = scrollLockRef.current
    if (!lock) return
    scrollLockRef.current = null

    document.body.style.position = lock.bodyPosition
    document.body.style.top = lock.bodyTop
    document.body.style.left = lock.bodyLeft
    document.body.style.width = lock.bodyWidth
    document.body.style.overflow = lock.bodyOverflow

    restoreScrollContainers(lock.scrollContainers)

    window.scrollTo(lock.scrollX, lock.scrollY)
  }, [])

  useEffect(() => unlockPageScroll, [unlockPageScroll])

  useEffect(() => {
    localStorage.setItem(KANBAN_COLUMN_DATE_SORTS_KEY, JSON.stringify(columnDateSorts))
  }, [columnDateSorts])

  const getTicketDateTime = (ticket: Ticket) => {
    if (!ticket.slaSolutionDate) return Number.POSITIVE_INFINITY
    const date = new Date(ticket.slaSolutionDate)
    const time = date.getTime()
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
  }

  const sortTicketsForColumn = (columnId: string, columnTickets: Ticket[]) => {
    const sort = columnDateSorts[columnId] ?? 'manual'
    if (sort === 'manual') return columnTickets

    return [...columnTickets].sort((a, b) => {
      const aTime = getTicketDateTime(a)
      const bTime = getTicketDateTime(b)
      if (aTime !== bTime) return sort === 'date_asc' ? aTime - bTime : bTime - aTime
      return a.id - b.id
    })
  }

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

  const getDefaultColumnId = (boardState: KanbanBoardState) =>
    boardState.columns.find((c) => c.isDefault)?.id ?? 'entrada'

  const getColumnRects = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-kanban-column-id]'))
      .map((column) => ({
        id: column.dataset.kanbanColumnId,
        rect: column.getBoundingClientRect(),
      }))
      .filter((column): column is { id: string; rect: DOMRect } => Boolean(column.id))
      .sort((a, b) => a.rect.left - b.rect.left)

  const getClosestColumnId = (
    boardState: KanbanBoardState,
    activeId: string,
    activeRect: { left: number; width: number } | null | undefined,
  ) => {
    if (!activeRect) return null

    const activeCenterX = activeRect.left + activeRect.width / 2
    const activeRight = activeRect.left + activeRect.width
    const columns = getColumnRects()
    const sourceColumnId = findColumnIdForItem(boardState, activeId) ?? getDefaultColumnId(boardState)
    const sourceIndex = columns.findIndex((column) => column.id === sourceColumnId)

    if (sourceIndex !== -1) {
      const nextColumns = columns.slice(sourceIndex + 1)
      const rightTarget = nextColumns
        .filter((column) => activeRight >= column.rect.left - 96)
        .at(-1)
      if (rightTarget) return rightTarget.id

      const previousColumns = columns.slice(0, sourceIndex)
      const leftTarget = previousColumns.find((column) => activeRect.left <= column.rect.right + 96)
      if (leftTarget) return leftTarget.id
    }

    let closest: { id: string; distance: number } | null = null

    for (const column of columns) {
      const columnCenterX = column.rect.left + column.rect.width / 2
      const distance = Math.abs(activeCenterX - columnCenterX)
      if (!closest || distance < closest.distance) {
        closest = { id: column.id, distance }
      }
    }

    return closest?.id ?? null
  }

  const getDropTarget = (
    boardState: KanbanBoardState,
    activeId: string,
    activeRect: { left: number; width: number } | null | undefined,
    overId?: string,
  ) => {
    const closestColumnId = getClosestColumnId(boardState, activeId, activeRect)
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
    lockPageScroll()
    const ticket = allTickets.find((t) => String(t.id) === event.active.id)
    setActiveTicket(ticket ?? null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!board) return

    const activeRect = active.rect.current.translated
    const targetId = getDropTarget(board, String(active.id), activeRect, over ? String(over.id) : undefined)
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
    unlockPageScroll()
    const { active, over } = event
    if (!board) return

    const activeRect = active.rect.current.translated
    const targetId = getDropTarget(board, String(active.id), activeRect, over ? String(over.id) : undefined)
    if (!targetId) return

    const overRect = over?.rect
    const insertAfter =
      activeRect && overRect && !board.columns.some((c) => c.id === targetId)
        ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
        : false

    updateBoard((prev) => moveTicketOnBoard(prev, String(active.id), targetId, insertAfter))
  }

  const handleDragCancel = () => {
    setActiveTicket(null)
    unlockPageScroll()
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

  const handleColumnDateSortChange = (columnId: string, sort: KanbanColumnDateSort) => {
    setColumnDateSorts((prev) => {
      const next = { ...prev }
      if (sort === 'manual') delete next[columnId]
      else next[columnId] = sort
      return next
    })
  }

  const handleMoveTicketToColumn = (ticketId: number, columnId: string) => {
    updateBoard((prev) => moveTicketOnBoard(prev, String(ticketId), columnId))
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
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 items-start">
        {board.columns.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            columns={board.columns}
            tickets={sortTicketsForColumn(col.id, getTicketsForColumn(col.id))}
            dateSort={columnDateSorts[col.id] ?? 'manual'}
            onDateSortChange={handleColumnDateSortChange}
            agentOptions={agentOptions}
            onAssign={onAssign}
            onUnassign={onUnassign}
            isLoading={isLoading}
            currentUser={currentUser}
            onDelete={handleDeleteColumn}
            onMoveTicketToColumn={handleMoveTicketToColumn}
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
