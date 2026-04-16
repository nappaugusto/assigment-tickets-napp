# Kanban Drag-and-Drop com Colunas Customizáveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o Kanban estático por um board com colunas customizáveis, drag-and-drop via dnd-kit, e estado salvo no backend por usuário.

**Architecture:** Novo módulo NestJS `KanbanModule` com tabela `kanban_board` (SQLite, JSON columns/positions). Frontend substitui `KanbanView` por `KanbanBoard` com `DndContext` do dnd-kit; estado gerenciado via TanStack Query + hook `useKanbanBoard`.

**Tech Stack:** NestJS + better-sqlite3 (backend), React 19 + @dnd-kit/core + @dnd-kit/sortable + TanStack Query + Tailwind CSS v4 + shadcn/ui (frontend)

---

## File Map

**Backend — criar:**
- `backend/src/kanban/kanban.dto.ts` — tipos KanbanColumn e KanbanBoardDto
- `backend/src/kanban/kanban.service.ts` — lógica de get/upsert do board
- `backend/src/kanban/kanban.controller.ts` — endpoints GET e PUT /kanban/board
- `backend/src/kanban/kanban.module.ts` — módulo NestJS

**Backend — modificar:**
- `backend/src/database/database-init.service.ts` — adicionar tabela kanban_board
- `backend/src/app.module.ts` — registrar KanbanModule

**Frontend — instalar:**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**Frontend — criar:**
- `frontend/src/hooks/use-kanban-board.ts` — queries/mutations TanStack Query
- `frontend/src/components/kanban-board.tsx` — DndContext raiz, gerencia state local
- `frontend/src/components/kanban-column.tsx` — coluna droppable (SortableContext)
- `frontend/src/components/kanban-card-draggable.tsx` — card com useSortable

**Frontend — modificar:**
- `frontend/src/lib/api.ts` — adicionar kanbanApi
- `frontend/src/pages/dashboard.tsx` — trocar KanbanView por KanbanBoard

---

## Task 1: Adicionar tabela `kanban_board` no schema

**Files:**
- Modify: `backend/src/database/database-init.service.ts`

- [ ] **Step 1: Adicionar a CREATE TABLE no initSchema**

Abra `backend/src/database/database-init.service.ts`. Adicione ao final da string dentro do `this.db.exec(...)`, antes do fechamento `)`:

```typescript
CREATE TABLE IF NOT EXISTS kanban_board (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  columns    TEXT NOT NULL DEFAULT '[]',
  positions  TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Verificar que o backend sobe sem erros**

```bash
cd backend && npm run start:dev
```

Esperado: `Database schema initialized` nos logs, sem erros. Ctrl+C para parar.

- [ ] **Step 3: Commit**

```bash
git add backend/src/database/database-init.service.ts
git commit -m "feat: add kanban_board table to schema"
```

---

## Task 2: DTOs do módulo Kanban

**Files:**
- Create: `backend/src/kanban/kanban.dto.ts`

- [ ] **Step 1: Criar o arquivo de DTOs**

```typescript
// backend/src/kanban/kanban.dto.ts
export interface KanbanColumn {
  id: string;
  title: string;
  isDefault: boolean;
}

export interface KanbanBoardDto {
  columns: KanbanColumn[];
  positions: Record<string, string>;
}

export class SaveBoardDto {
  columns: KanbanColumn[];
  positions: Record<string, string>;
}

export const DEFAULT_BOARD: KanbanBoardDto = {
  columns: [{ id: 'entrada', title: 'Entrada', isDefault: true }],
  positions: {},
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/kanban/kanban.dto.ts
git commit -m "feat: add kanban DTOs"
```

---

## Task 3: KanbanService

**Files:**
- Create: `backend/src/kanban/kanban.service.ts`

- [ ] **Step 1: Criar o service**

```typescript
// backend/src/kanban/kanban.service.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import { KanbanBoardDto, SaveBoardDto, DEFAULT_BOARD } from './kanban.dto';

interface KanbanBoardRow {
  id: number;
  user_id: number;
  columns: string;
  positions: string;
  updated_at: string;
}

@Injectable()
export class KanbanService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  getBoard(userId: number): KanbanBoardDto {
    const row = this.db
      .prepare('SELECT * FROM kanban_board WHERE user_id = ?')
      .get(userId) as KanbanBoardRow | undefined;

    if (!row) return { ...DEFAULT_BOARD, columns: [...DEFAULT_BOARD.columns], positions: {} };

    return {
      columns: JSON.parse(row.columns),
      positions: JSON.parse(row.positions),
    };
  }

  saveBoard(userId: number, dto: SaveBoardDto): void {
    const defaultCol = dto.columns.find((c) => c.isDefault);
    if (!defaultCol) {
      throw new BadRequestException('Board must have a default column.');
    }

    this.db
      .prepare(`
        INSERT INTO kanban_board (user_id, columns, positions, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          columns = excluded.columns,
          positions = excluded.positions,
          updated_at = excluded.updated_at
      `)
      .run(userId, JSON.stringify(dto.columns), JSON.stringify(dto.positions));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/kanban/kanban.service.ts
git commit -m "feat: add KanbanService"
```

---

## Task 4: KanbanController

**Files:**
- Create: `backend/src/kanban/kanban.controller.ts`

- [ ] **Step 1: Criar o controller**

```typescript
// backend/src/kanban/kanban.controller.ts
import { Controller, Get, Put, Body, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { KanbanService } from './kanban.service';
import { SaveBoardDto } from './kanban.dto';
import { User } from '../users/user.entity';

@UseGuards(SessionGuard)
@Controller('kanban')
export class KanbanController {
  constructor(private readonly kanbanService: KanbanService) {}

  @Get('board')
  getBoard(@Req() req: Request) {
    const user = (req as any).user as User;
    return this.kanbanService.getBoard(user.id);
  }

  @Put('board')
  saveBoard(@Req() req: Request, @Body() dto: SaveBoardDto) {
    const user = (req as any).user as User;
    this.kanbanService.saveBoard(user.id, dto);
    return { success: true };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/kanban/kanban.controller.ts
git commit -m "feat: add KanbanController"
```

---

## Task 5: KanbanModule e registro no AppModule

**Files:**
- Create: `backend/src/kanban/kanban.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Criar o módulo**

```typescript
// backend/src/kanban/kanban.module.ts
import { Module } from '@nestjs/common';
import { KanbanService } from './kanban.service';
import { KanbanController } from './kanban.controller';

@Module({
  providers: [KanbanService],
  controllers: [KanbanController],
})
export class KanbanModule {}
```

- [ ] **Step 2: Registrar no AppModule**

Em `backend/src/app.module.ts`, adicione o import:

```typescript
import { KanbanModule } from './kanban/kanban.module';
```

E adicione `KanbanModule` ao array `imports`:

```typescript
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  DatabaseModule,
  UsersModule,
  AuthModule,
  TicketsModule,
  SyncModule,
  PeopleModule,
  EmailModule,
  PasswordResetModule,
  KanbanModule,  // ← adicionar aqui
],
```

- [ ] **Step 3: Verificar que o backend sobe sem erros**

```bash
cd backend && npm run start:dev
```

Esperado: sem erros de compilação, `KanbanModule` inicializado nos logs.

- [ ] **Step 4: Testar os endpoints manualmente**

Com o backend rodando, abra outro terminal e teste (substitua o cookie de sessão se necessário — mais fácil testar com curl após login):

```bash
# GET deve retornar board padrão para usuário novo
curl -s http://localhost:3000/kanban/board -b "connect.sid=SEU_COOKIE"
# Esperado: {"columns":[{"id":"entrada","title":"Entrada","isDefault":true}],"positions":{}}

# PUT deve salvar e retornar success
curl -s -X PUT http://localhost:3000/kanban/board \
  -H "Content-Type: application/json" \
  -b "connect.sid=SEU_COOKIE" \
  -d '{"columns":[{"id":"entrada","title":"Entrada","isDefault":true},{"id":"abc","title":"Teste","isDefault":false}],"positions":{}}'
# Esperado: {"success":true}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/kanban/kanban.module.ts backend/src/app.module.ts
git commit -m "feat: register KanbanModule in AppModule"
```

---

## Task 6: Instalar dnd-kit e adicionar kanbanApi no frontend

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Instalar as dependências**

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Esperado: pacotes adicionados sem erros de peer deps.

- [ ] **Step 2: Adicionar tipos e kanbanApi em `api.ts`**

Ao final de `frontend/src/lib/api.ts`, adicione:

```typescript
// Kanban Board
export interface KanbanColumn {
  id: string
  title: string
  isDefault: boolean
}

export interface KanbanBoard {
  columns: KanbanColumn[]
  positions: Record<string, string>
}

export const kanbanApi = {
  getBoard: () => get<KanbanBoard>('/kanban/board'),
  saveBoard: (board: KanbanBoard) =>
    http.put<{ success: boolean }>('/kanban/board', board).then((r) => r.data),
}
```

- [ ] **Step 3: Verificar que o frontend compila**

```bash
cd frontend && npm run build
```

Esperado: build sem erros de TypeScript.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/api.ts
git commit -m "feat: install dnd-kit and add kanbanApi"
```

---

## Task 7: Hook `useKanbanBoard`

**Files:**
- Create: `frontend/src/hooks/use-kanban-board.ts`

- [ ] **Step 1: Criar o hook**

```typescript
// frontend/src/hooks/use-kanban-board.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useCallback } from 'react'
import { kanbanApi, type KanbanBoard } from '@/lib/api'
import { toast } from 'sonner'

export const KANBAN_BOARD_KEY = ['kanban-board']

export function useKanbanBoard() {
  const qc = useQueryClient()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: KANBAN_BOARD_KEY,
    queryFn: kanbanApi.getBoard,
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: kanbanApi.saveBoard,
    onError: () => toast.error('Erro ao salvar o board'),
  })

  const saveDebounced = useCallback(
    (board: KanbanBoard) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        mutation.mutate(board)
      }, 800)
    },
    [mutation],
  )

  const updateBoard = useCallback(
    (updater: (prev: KanbanBoard) => KanbanBoard) => {
      qc.setQueryData<KanbanBoard>(KANBAN_BOARD_KEY, (prev) => {
        if (!prev) return prev
        const next = updater(prev)
        saveDebounced(next)
        return next
      })
    },
    [qc, saveDebounced],
  )

  return { board: query.data, isLoading: query.isLoading, updateBoard }
}
```

- [ ] **Step 2: Verificar que o frontend compila**

```bash
cd frontend && npm run build
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-kanban-board.ts
git commit -m "feat: add useKanbanBoard hook"
```

---

## Task 8: Componente `KanbanCardDraggable`

**Files:**
- Create: `frontend/src/components/kanban-card-draggable.tsx`

- [ ] **Step 1: Criar o componente**

```typescript
// frontend/src/components/kanban-card-draggable.tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type Ticket } from '@/lib/api'
import { getSlaStatus, getTimeUntilSla } from '@/lib/date-utils'
import { Badge } from '@/components/ui/badge'
import { TicketActions } from '@/components/ticket-actions'

const SLA_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'outline' | 'default'> = {
  expired: 'destructive',
  warning: 'warning',
  normal: 'default',
  paused: 'secondary',
  none: 'outline',
}

interface KanbanCardDraggableProps {
  ticket: Ticket
  agentOptions: string[]
  onAssign: (id: number, name: string) => void
  onUnassign: (id: number) => void
  isLoading?: boolean
  currentUser: string
  isDragOverlay?: boolean
}

export function KanbanCardDraggable({
  ticket,
  agentOptions,
  onAssign,
  onUnassign,
  isLoading,
  currentUser,
  isDragOverlay = false,
}: KanbanCardDraggableProps) {
  const sla = getSlaStatus(ticket.slaSolutionDate, ticket.slaSolutionDateIsPaused)
  const slaLabel = getTimeUntilSla(ticket.slaSolutionDate)
  const isMyTicket =
    currentUser && ticket.responsavel &&
    ticket.responsavel.toLowerCase() === currentUser.toLowerCase()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(ticket.id), disabled: isDragOverlay })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragOverlay ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? { cursor: 'grabbing' } : style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={`rounded-lg border p-3 flex flex-col gap-2 bg-card select-none ${
        isMyTicket ? 'border-primary/40' : 'border-border/40'
      } ${isDragOverlay ? 'shadow-lg rotate-1' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <a
          href={`https://support.movidesk.com/Ticket/Edit/${ticket.id}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{ticket.id}
        </a>
        <Badge variant={SLA_BADGE_VARIANT[sla]} className="text-xs shrink-0">
          {sla === 'paused' ? 'Pausado' : sla === 'none' ? '—' : slaLabel}
        </Badge>
      </div>
      <p className="text-sm leading-snug line-clamp-3">{ticket.subject || '—'}</p>
      <div className="text-xs text-muted-foreground">
        {ticket.responsavel ? (
          <span className={isMyTicket ? 'text-primary font-medium' : undefined}>
            {isMyTicket ? 'Seu chamado' : ticket.responsavel}
          </span>
        ) : (
          <span className="italic">Não atribuído</span>
        )}
      </div>
      <TicketActions
        ticket={ticket}
        agentOptions={agentOptions}
        onAssign={onAssign}
        onUnassign={onUnassign}
        isLoading={isLoading}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verificar compilação**

```bash
cd frontend && npm run build
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/kanban-card-draggable.tsx
git commit -m "feat: add draggable KanbanCard with dnd-kit"
```

---

## Task 9: Componente `KanbanColumn`

**Files:**
- Create: `frontend/src/components/kanban-column.tsx`

- [ ] **Step 1: Criar o componente**

```typescript
// frontend/src/components/kanban-column.tsx
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
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-2 w-70 shrink-0">
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
```

- [ ] **Step 2: Verificar compilação**

```bash
cd frontend && npm run build
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/kanban-column.tsx
git commit -m "feat: add droppable KanbanColumn"
```

---

## Task 10: Componente `KanbanBoard` (raiz)

**Files:**
- Create: `frontend/src/components/kanban-board.tsx`

- [ ] **Step 1: Criar o componente**

```typescript
// frontend/src/components/kanban-board.tsx
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

    // over.id pode ser um columnId ou um ticketId — resolve o columnId de destino
    const isColumn = board.columns.some((c) => c.id === overId)
    let targetColumnId = overId
    if (!isColumn) {
      targetColumnId = board.positions[overId] ??
        (board.columns.find((c) => c.isDefault)?.id ?? 'entrada')
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
          <div key={i} className="w-70 shrink-0 h-64 rounded-lg bg-muted/30 animate-pulse" />
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

        {/* Botão / input de nova coluna */}
        <div className="w-70 shrink-0">
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
```

- [ ] **Step 2: Verificar compilação**

```bash
cd frontend && npm run build
```

Esperado: sem erros de TypeScript.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/kanban-board.tsx
git commit -m "feat: add KanbanBoard root component with dnd-kit"
```

---

## Task 11: Substituir KanbanView por KanbanBoard no dashboard

**Files:**
- Modify: `frontend/src/pages/dashboard.tsx`

- [ ] **Step 1: Atualizar o import**

Em `frontend/src/pages/dashboard.tsx`, substitua:

```typescript
import { KanbanView } from '@/components/kanban-view'
```

por:

```typescript
import { KanbanBoard } from '@/components/kanban-board'
```

- [ ] **Step 2: Atualizar o JSX**

Ainda em `dashboard.tsx`, substitua:

```tsx
<KanbanView
  tickets={filters.filteredTickets}
  newTickets={filters.filteredNewTickets}
  agentOptions={filters.agentOptions}
  onAssign={assignTicket}
  onUnassign={unassignTicket}
  isLoading={isAssigning || isUnassigning}
/>
```

por:

```tsx
<KanbanBoard
  tickets={filters.filteredTickets}
  newTickets={filters.filteredNewTickets}
  agentOptions={filters.agentOptions}
  onAssign={assignTicket}
  onUnassign={unassignTicket}
  isLoading={isAssigning || isUnassigning}
/>
```

- [ ] **Step 3: Verificar compilação final**

```bash
cd frontend && npm run build
```

Esperado: build limpo, zero erros.

- [ ] **Step 4: Testar manualmente**

```bash
# Terminal 1 — backend
cd backend && npm run start:dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Abra http://localhost:5173, faça login, vá para o modo Kanban e verifique:
1. Coluna "Entrada" aparece com os tickets sem posição definida
2. Arraste um card para outra coluna — ele se move imediatamente
3. Crie uma nova coluna com `+ Nova lista`
4. Recarregue a página — as posições e colunas persistem (salvo no backend)
5. Delete uma coluna criada — os cards voltam para Entrada
6. Filtros da toolbar ainda filtram corretamente dentro das colunas

- [ ] **Step 5: Commit final**

```bash
git add frontend/src/pages/dashboard.tsx
git commit -m "feat: replace KanbanView with draggable KanbanBoard"
```
