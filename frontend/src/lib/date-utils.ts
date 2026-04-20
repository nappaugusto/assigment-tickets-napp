/**
 * SLA date utilities — ported from app/utils/datetime_util.py
 */

export type SlaStatus = 'expired' | 'warning' | 'normal' | 'paused' | 'none'

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export function getSlaStatus(
  slaSolutionDate: string | null,
  isPaused: boolean,
): SlaStatus {
  if (!slaSolutionDate) return 'none'
  if (isPaused) return 'paused'

  const deadline = new Date(slaSolutionDate)
  const now = new Date()
  const deadlineDayEnd = endOfDay(deadline)
  const nowDayEnd = endOfDay(now)

  if (deadlineDayEnd < nowDayEnd) return 'expired'

  const diffMs = deadlineDayEnd.getTime() - now.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)

  if (diffHours <= 24) return 'warning'
  return 'normal'
}

export function getTimeUntilSla(slaSolutionDate: string | null): string {
  if (!slaSolutionDate) return ''

  const deadline = new Date(slaSolutionDate)
  const now = new Date()
  const diffMs = endOfDay(deadline).getTime() - now.getTime()

  if (diffMs < 0) return 'Expirado'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}m`
  if (hours < 24) return `${hours}h ${minutes}m`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

export function isToday(isoDate: string | null): boolean {
  if (!isoDate) return false
  const d = new Date(isoDate)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Normalize text: lowercase + remove accents */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
