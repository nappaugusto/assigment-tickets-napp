import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const movideskBaseUrl = (
  import.meta.env.VITE_MOVIDESK_BASE_URL ?? 'https://atendimento.nappsolutions.com'
).replace(/\/+$/, '')

export function getTicketUrl(ticketId: number | string) {
  return `${movideskBaseUrl}/Ticket/Edit/${ticketId}`
}
