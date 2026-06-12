import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import dotenv from 'dotenv'
import { z } from 'zod'
import {
  createDbConfig,
  createPool,
  describeTable,
  executeSelect,
  listSchemas,
  listTables,
} from './db.js'

dotenv.config()

const config = createDbConfig()
const pool = createPool(config)

const server = new McpServer({
  name: 'db-readonly',
  version: '1.0.0',
  description: 'MCP read-only para diagnostico seguro em banco Postgres',
})

function textResponse(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

server.tool(
  'listar_schemas',
  'Lista schemas disponíveis para diagnóstico, excluindo schemas internos do Postgres.',
  {},
  async () => textResponse(await listSchemas(pool)),
)

server.tool(
  'listar_tabelas',
  'Lista tabelas e views do schema configurado no banco de diagnostico.',
  {
    schema: z.string().optional().describe('Schema a consultar. Padrão: AI_DIAGNOSTIC_DB_SCHEMA ou public.'),
  },
  async ({ schema }) => textResponse(await listTables(pool, schema || config.schema)),
)

server.tool(
  'descrever_tabela',
  'Descreve colunas, tipos e constraints de uma tabela.',
  {
    table: z.string().describe('Nome da tabela, sem schema.'),
    schema: z.string().optional().describe('Schema da tabela. Padrão: AI_DIAGNOSTIC_DB_SCHEMA ou public.'),
  },
  async ({ table, schema }) =>
    textResponse(await describeTable(pool, schema || config.schema, table)),
)

server.tool(
  'executar_select',
  'Executa somente SELECT/WITH em transação READ ONLY, com timeout e limite de linhas.',
  {
    sql: z.string().describe('Consulta SELECT ou WITH. Não use ponto e vírgula.'),
  },
  async ({ sql }) =>
    textResponse(
      await executeSelect(
        pool,
        sql,
        config.maxRows,
        config.statementTimeoutMs,
      ),
    ),
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('MCP db-readonly iniciado.')
}

process.on('SIGINT', async () => {
  await pool.end().catch(() => undefined)
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await pool.end().catch(() => undefined)
  process.exit(0)
})

main().catch((error) => {
  console.error('Erro fatal no MCP db-readonly:', error)
  process.exit(1)
})
