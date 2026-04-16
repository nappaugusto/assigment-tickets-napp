import axios, { type AxiosError } from 'axios'

export const http = axios.create({
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
  responsavel: string | null
  assigned_at: string | null
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
