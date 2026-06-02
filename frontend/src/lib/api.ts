import axios, { type AxiosError } from 'axios'

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
})

// Normalize axios errors to plain Error with a readable message
http.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ error?: string; message?: string }>) => {
    const data = err.response?.data
    const message =
      data?.error ?? data?.message ?? `HTTP ${err.response?.status ?? 'unknown'}`
    return Promise.reject(new Error(message))
  },
)

const get = <T>(path: string) => http.get<T>(path).then((r) => r.data)
const post = <T>(path: string, body?: unknown) =>
  http.post<T>(path, body).then((r) => r.data)
const del = <T>(path: string) => http.delete<T>(path).then((r) => r.data)

// Auth
export interface AuthUser { id: number; name: string }
export interface MeResponse { authenticated: boolean; user: AuthUser | null }
export interface AuthResponse { success: boolean; user?: AuthUser; error?: string }

export const authApi = {
  me: () => get<MeResponse>('/auth/me'),
  login: (username: string, password: string, remember_me = false) =>
    post<AuthResponse>('/auth/login', { username, password, remember_me }),
  register: (name: string, username: string, password: string, confirm_password: string) =>
    post<AuthResponse>('/auth/register', { name, username, password, confirm_password }),
  logout: () => post<{ success: boolean }>('/auth/logout'),
  forgotPassword: (username: string) =>
    post<{ success: boolean; message: string }>('/auth/forgot-password', { username }),
  validateResetToken: (token: string) =>
    get<{ valid: boolean }>(`/auth/reset-password/${token}`),
  resetPassword: (token: string, password: string, confirm_password: string) =>
    post<{ success: boolean; message?: string }>(`/auth/reset-password/${token}`, {
      password,
      confirm_password,
    }),
}

// Tickets
export interface Ticket {
  id: number
  subject: string | null
  status: string | null
  ownerTeam: string | null
  slaSolutionDate: string | null
  slaSolutionDateIsPaused: boolean
  opened_at: string | null
  closed_at: string | null
  last_update: string | null
  responsavel: string | null
  assigned_at: string | null
  trello_card_id: string | null
  trello_card_url: string | null
  trello_card_name: string | null
  trello_card_created_at: string | null
}

export interface TicketMonthlyAnalyticsItem {
  month: string
  label: string
  opened: number
  resolved_on_time: number
  resolved_late: number
  sla_paused: number
}

export interface TicketMonthlyAnalyticsPayload {
  generated_at: string
  active_sla_paused: number
  months: TicketMonthlyAnalyticsItem[]
  current_month: TicketMonthlyAnalyticsItem | null
}

export interface TicketsPayload {
  now: string
  tickets: Ticket[]
  close_tickets: Ticket[]
  count_tickets: number
  close_count_tickets: number
  monthly_analytics?: TicketMonthlyAnalyticsPayload
}

export const ticketsApi = {
  refresh: (manual = false) =>
    get<TicketsPayload>(`/tickets/refresh${manual ? '?manual=1' : ''}`),
  monthlyAnalytics: (months = 4) =>
    get<TicketMonthlyAnalyticsPayload>(`/tickets/analytics/monthly?months=${months}`),
  assign: (id: number, responsavel: string) =>
    http
      .post<{ success: boolean; message: string; ticket_id: number; responsavel: string | null; now: string }>(
        `/atribuir/${id}`,
        new URLSearchParams({ responsavel }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      )
      .then((r) => r.data),
  unassign: (id: number) =>
    post<{ success: boolean; message: string; ticket_id: number; responsavel: null; now: string }>(
      `/desatribuir/${id}`,
    ),
  appVersion: () => get<{ version: string }>('/app-version'),
}

export const peopleApi = {
  assignment: () => get<{ people: string[] }>('/people/assignment'),
  assignmentDetails: () => get<{ people: AssignmentPerson[] }>('/people/assignment/details'),
}

export interface AssignmentPerson {
  id: string
  businessName: string
  email: string | null
  teams: string[]
}

export interface McpMovideskStatus {
  configured: boolean
  connected: boolean
  command: string
  args: string[]
  cwd: string | null
  tokenConfigured: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
    [key: string]: unknown
  }
}

export interface McpToolsPayload {
  tools: McpTool[]
}

export interface McpToolCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  [key: string]: unknown
}

export const mcpMovideskApi = {
  status: () => get<McpMovideskStatus>('/mcp/movidesk/status'),
  tools: () => get<McpToolsPayload>('/mcp/movidesk/tools'),
  callTool: (name: string, args: Record<string, unknown> = {}) =>
    post<McpToolCallResult>(`/mcp/movidesk/tools/${encodeURIComponent(name)}/call`, {
      arguments: args,
    }),
}

// Kanban Board
export interface KanbanColumn {
  id: string
  title: string
  isDefault: boolean
}

export interface KanbanBoard {
  columns: KanbanColumn[]
  columnItems: Record<string, string[]>
}

export const kanbanApi = {
  getBoard: () => get<KanbanBoard>('/kanban/board'),
  saveBoard: (board: KanbanBoard) =>
    http.put<{ success: boolean }>('/kanban/board', board).then((r) => r.data),
}

export interface MonthlyAnalyticsPreference {
  collapsed: boolean
  summaryCollapsed: boolean
}

export const preferencesApi = {
  monthlyAnalytics: () => get<MonthlyAnalyticsPreference>('/preferences/monthly-analytics'),
  saveMonthlyAnalytics: (preference: MonthlyAnalyticsPreference) =>
    http.put<{ success: boolean }>('/preferences/monthly-analytics', preference).then((r) => r.data),
}

// Ticket Notes
export const notesApi = {
  getNote: (ticketId: number) =>
    get<{ content: string }>(`/notes/${ticketId}`),
  saveNote: (ticketId: number, content: string) =>
    http.put<{ success: boolean }>(`/notes/${ticketId}`, { content }).then((r) => r.data),
  getTicketsWithNotes: () =>
    get<{ ticketIds: number[] }>('/notes/tickets-with-notes'),
}

// Trello
export interface TrelloStatus {
  configured: boolean
  defaultBoardId: string | null
  defaultListId: string | null
}

export interface TrelloBoard {
  id: string
  name: string
  url: string
}

export interface TrelloList {
  id: string
  name: string
  closed: boolean
}

export interface TrelloCard {
  id: string
  name: string
  url: string
  shortUrl?: string
}

export interface CreateTrelloCardPayload {
  boardId?: string
  listId?: string
  name?: string
  description?: string
  forceNew?: boolean
}

export const trelloApi = {
  status: () => get<TrelloStatus>('/trello/status'),
  boards: () => get<TrelloBoard[]>('/trello/boards'),
  lists: (boardId?: string) =>
    get<TrelloList[]>(`/trello/lists${boardId ? `?boardId=${encodeURIComponent(boardId)}` : ''}`),
  createCardFromTicket: (ticketId: number, payload: CreateTrelloCardPayload) =>
    post<{ card: TrelloCard; ticket: Ticket }>(`/trello/tickets/${ticketId}/cards`, payload),
  detachCardFromTicket: (ticketId: number) =>
    del<{ ticket: Ticket }>(`/trello/tickets/${ticketId}/card`),
}
