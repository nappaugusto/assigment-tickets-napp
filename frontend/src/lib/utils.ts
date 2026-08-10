import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { type Ticket } from '@/lib/api'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const movideskBaseUrl = (
  import.meta.env.VITE_MOVIDESK_BASE_URL ?? 'https://atendimento.nappsolutions.com'
).replace(/\/+$/, '')

export function getTicketUrl(ticketId: number | string) {
  return `${movideskBaseUrl}/Ticket/Edit/${ticketId}`
}

export function isTicketInTrello(ticket: Pick<Ticket, 'trello_card_id' | 'trello_card_url'>) {
  return Boolean(ticket.trello_card_id?.trim() || ticket.trello_card_url?.trim())
}
