import { Pool } from 'pg'
import { applyLimit, validateIdentifier, validateReadOnlySql } from './sql-guard.js'

export interface DbConfig {
  connectionString: string
  schema: string
  maxRows: number
  statementTimeoutMs: number
}

export function createDbConfig(): DbConfig {
  const connectionString = process.env.AI_DIAGNOSTIC_DB_URL?.trim()
  if (!connectionString) {
    throw new Error('AI_DIAGNOSTIC_DB_URL não configurada.')
  }

  return {
    connectionString,
    schema: process.env.AI_DIAGNOSTIC_DB_SCHEMA?.trim() || 'public',
    maxRows: Number(process.env.AI_DIAGNOSTIC_DB_MAX_ROWS || 100),
    statementTimeoutMs: Number(process.env.AI_DIAGNOSTIC_DB_STATEMENT_TIMEOUT_MS || 5000),
  }
}

export function createPool(config: DbConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

export async function listTables(pool: Pool, schema: string) {
  const safeSchema = validateIdentifier(schema, 'Schema')
  const result = await pool.query(
    `
      SELECT table_schema, table_name, table_type
        FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name
    `,
    [safeSchema],
  )
  return result.rows
}

export async function listSchemas(pool: Pool) {
  const result = await pool.query(
    `
      SELECT schema_name
        FROM information_schema.schemata
       WHERE schema_name <> 'information_schema'
         AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name
    `,
  )
  return result.rows
}

export async function describeTable(pool: Pool, schema: string, table: string) {
  const safeSchema = validateIdentifier(schema, 'Schema')
  const safeTable = validateIdentifier(table, 'Tabela')
  const result = await pool.query(
    `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        tc.constraint_type
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON kcu.table_schema = c.table_schema
       AND kcu.table_name = c.table_name
       AND kcu.column_name = c.column_name
      LEFT JOIN information_schema.table_constraints tc
        ON tc.constraint_schema = kcu.constraint_schema
       AND tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE c.table_schema = $1
        AND c.table_name = $2
      ORDER BY c.ordinal_position
    `,
    [safeSchema, safeTable],
  )
  return result.rows
}

export async function executeSelect(
  pool: Pool,
  sql: string,
  maxRows: number,
  statementTimeoutMs: number,
) {
  const safeSql = applyLimit(validateReadOnlySql(sql), maxRows)
  const safeTimeoutMs = Math.max(100, Math.min(statementTimeoutMs, 30_000))
  const client = await pool.connect()

  try {
    await client.query('BEGIN READ ONLY')
    await client.query('SET LOCAL TRANSACTION READ ONLY')
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${safeTimeoutMs}ms'`)
    await client.query(`SET LOCAL statement_timeout = '${safeTimeoutMs}ms'`)
    const result = await client.query(safeSql)
    await client.query('COMMIT')

    return {
      sql: safeSql,
      rowCount: result.rowCount ?? result.rows.length,
      rows: result.rows,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
