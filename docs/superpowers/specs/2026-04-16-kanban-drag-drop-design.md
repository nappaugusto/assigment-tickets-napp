# Kanban Drag-and-Drop com Colunas Customizáveis

**Data:** 2026-04-16  
**Status:** Aprovado

## Resumo

Substituir o Kanban estático de 2 colunas fixas por um board totalmente customizável com drag-and-drop fluído. O usuário pode criar e deletar colunas, arrastar cards livremente entre elas, e o estado fica salvo no backend por usuário.

---

## Decisões de escopo

- Drag-and-drop é **puramente visual** — não altera status no Movidesk
- Estado do board salvo no **backend** (por usuário, persiste entre dispositivos)
- Colunas fixas atuais ("Novos"/"Em Andamento") são **substituídas** por colunas customizáveis
- Coluna **"Entrada"** é sempre criada automaticamente, não pode ser deletada
- Tickets novos sem posição mapeada aparecem automaticamente na coluna Entrada
- Biblioteca de drag-and-drop: **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`)

---

## Modelo de dados (Backend)

### Tabela `kanban_board`

```sql
CREATE TABLE kanban_board (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
  columns    TEXT NOT NULL DEFAULT '[]',  -- JSON
  positions  TEXT NOT NULL DEFAULT '{}',  -- JSON
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Estrutura JSON

**`columns`** — array ordenado de colunas:
```json
[
  { "id": "entrada", "title": "Entrada", "isDefault": true },
  { "id": "uuid-1",  "title": "Em análise", "isDefault": false }
]
```

**`positions`** — mapa ticketId → columnId:
```json
{
  "12345": "entrada",
  "67890": "uuid-1"
}
```

Tickets sem entrada no mapa são implicitamente na coluna Entrada. Tickets que somem do sync são ignorados na renderização (posição fica no mapa mas não renderiza).

---

## API (Backend — NestJS)

### Módulo: `KanbanModule`

**`GET /kanban/board`**
- Requer sessão autenticada
- Retorna o board do usuário; se não existir, cria um board padrão com só a coluna Entrada
- Response: `{ columns: Column[], positions: Record<string, string> }`

**`PUT /kanban/board`**
- Body: `{ columns: Column[], positions: Record<string, string> }`
- Valida que existe exatamente uma coluna com `isDefault: true`
- Valida que a coluna padrão não foi removida
- Upsert na tabela `kanban_board`
- Response: `{ success: true }`

---

## Componentes (Frontend)

### Árvore de componentes

```
KanbanBoard                  ← DndContext, carrega/salva estado
  ├── KanbanColumn (n×)      ← SortableContext (droppable)
  │     └── KanbanCard (n×)  ← useSortable (draggable)
  ├── KanbanDragOverlay      ← clone visual flutuante
  └── AddColumnButton        ← inline input para criar coluna
```

### `KanbanBoard`
- Carrega `GET /kanban/board` ao montar (skeleton enquanto carrega)
- Mantém estado local: `columns` e `positions`
- `onDragEnd`: atualiza `positions` imediatamente (otimista), depois salva com debounce de 800ms
- Passa `allTickets = [...tickets, ...newTickets]` para as colunas filtrarem por posição

### `KanbanColumn`
- Header: título editável (clique duplo) + badge com contagem + botão deletar (ícone lixeira)
- Deletar: confirmação inline no botão (primeiro clique muda ícone para "confirmar", segundo clique executa)
- Ao deletar: todos os `positions[ticketId] === columnId` são remapeados para a coluna Entrada
- Coluna Entrada não exibe botão deletar
- Layout: largura fixa 280px, altura máxima com scroll interno

### `KanbanCard`
- Mesmo conteúdo visual do card atual (id, subject, SLA badge, responsável, TicketActions)
- `useSortable` do dnd-kit para drag handle
- Cursor `grab` / `grabbing` durante drag

### `KanbanDragOverlay`
- Renderiza clone do card arrastado com leve sombra e opacidade 0.9
- Animação de drop suave (`keyframes` do dnd-kit)

### `AddColumnButton`
- Botão `+ Nova lista` no final horizontal do board
- Clique transforma em input inline
- Enter ou blur com texto confirma criação (gera `id` com `crypto.randomUUID()`)
- Escape cancela

---

## Integração com o dashboard

- `dashboard.tsx`: troca `<KanbanView .../>` por `<KanbanBoard .../>` com mesma interface de props
- Props recebidas: `tickets`, `newTickets`, `agentOptions`, `onAssign`, `onUnassign`, `isLoading`
- Filtros da toolbar continuam funcionando — filtram tickets visíveis por coluna sem alterar posições
- `viewMode` e `localStorage` existentes não mudam

---

## Comportamento de edge cases

| Situação | Comportamento |
|---|---|
| Ticket some do sync | Ignorado na renderização, posição mantida no mapa |
| Ticket novo sem posição | Renderiza na coluna Entrada |
| Usuário sem board | Backend cria board padrão com coluna Entrada |
| Coluna deletada com cards | Cards migram para Entrada automaticamente |
| Falha ao salvar no backend | Toast de erro discreto, estado local mantido |
