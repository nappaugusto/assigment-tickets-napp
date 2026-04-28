/**
 * SLA date utilities — ported from app/utils/datetime_util.py
 */

export type SlaStatus = 'expired' | 'warning' | 'normal' | 'paused' | 'none'

const BRAZIL_TIME_ZONE = 'America/Sao_Paulo'
const ISO_WITHOUT_TIME_ZONE_RE =
  /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/

function parseDate(value: string): Date {
  const normalized = ISO_WITHOUT_TIME_ZONE_RE.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z`
    : value

  return new Date(normalized)
}

export function getSlaStatus(
  slaSolutionDate: string | null,
  isPaused: boolean,
): SlaStatus {
  if (!slaSolutionDate) return 'none'
  if (isPaused) return 'paused'

  const deadline = parseDate(slaSolutionDate)
  const now = new Date()

  if (deadline.getTime() < now.getTime()) return 'expired'

  const diffMs = deadline.getTime() - now.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)

  if (diffHours <= 24) return 'warning'
  return 'normal'
}

export function getTimeUntilSla(slaSolutionDate: string | null): string {
  if (!slaSolutionDate) return ''

  const deadline = parseDate(slaSolutionDate)
  const now = new Date()
  const diffMs = deadline.getTime() - now.getTime()

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
  const d = parseDate(isoDate)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  return parseDate(isoDate).toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIME_ZONE,
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
