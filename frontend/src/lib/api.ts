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
  responsavel: string | null
  assigned_at: string | null
}

export interface TicketMonthlyAnalyticsItem {
  month: string
  label: string
  opened: number
  breached: number
  resolved_on_time: number
  resolved_late: number
}

export interface TicketMonthlyAnalyticsPayload {
  generated_at: string
  months: TicketMonthlyAnalyticsItem[]
  current_month: TicketMonthlyAnalyticsItem | null
}

export interface TicketsPayload {
  now: string
  tickets: Ticket[]
  close_tickets: Ticket[]
  count_tickets: number
  close_count_tickets: number
}

export const ticketsApi = {
  refresh: (manual = false) =>
    get<TicketsPayload>(`/tickets/refresh${manual ? '?manual=1' : ''}`),
  monthlyAnalytics: (months = 6) =>
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

// Ticket Notes
export const notesApi = {
  getNote: (ticketId: number) =>
    get<{ content: string }>(`/notes/${ticketId}`),
  saveNote: (ticketId: number, content: string) =>
    http.put<{ success: boolean }>(`/notes/${ticketId}`, { content }).then((r) => r.data),
  getTicketsWithNotes: () =>
    get<{ ticketIds: number[] }>('/notes/tickets-with-notes'),
}
