const BLOCKED_KEYWORDS = [
  'alter',
  'analyze',
  'call',
  'checkpoint',
  'cluster',
  'comment',
  'copy',
  'create',
  'delete',
  'discard',
  'do',
  'drop',
  'execute',
  'grant',
  'insert',
  'listen',
  'load',
  'lock',
  'merge',
  'notify',
  'prepare',
  'reassign',
  'refresh',
  'reindex',
  'reset',
  'revoke',
  'security',
  'set',
  'truncate',
  'unlisten',
  'update',
  'vacuum',
]

export function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) throw new Error('SQL vazio.')
  if (trimmed.includes(';')) throw new Error('Múltiplas statements não são permitidas.')
  if (/--|\/\*|\*\//.test(trimmed)) throw new Error('Comentários SQL não são permitidos.')

  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ')
  if (!normalized.startsWith('select ') && !normalized.startsWith('with ')) {
    throw new Error('Somente SELECT ou WITH é permitido.')
  }

  for (const keyword of BLOCKED_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(normalized)) {
      throw new Error(`Comando bloqueado: ${keyword}.`)
    }
  }

  return trimmed
}

export function applyLimit(sql: string, maxRows: number): string {
  const safeMaxRows = Math.max(1, Math.min(maxRows, 500))
  if (/\blimit\s+\d+\b/i.test(sql)) return sql
  return `${sql}\nLIMIT ${safeMaxRows}`
}

export function validateIdentifier(value: string, label: string): string {
  const trimmed = value.trim()
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`${label} inválido.`)
  }
  return trimmed
}
