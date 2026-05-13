import { type McpTool, type McpToolCallResult } from '@/lib/api'

type CandidateMap = Record<string, unknown>

const FIELD_ALIASES: Record<string, string[]> = {
  ticketId: ['ticketId', 'ticket_id', 'id', 'ticket', 'codigo', 'code'],
  status: ['status', 'newStatus', 'novoStatus', 'situacao'],
  agent: ['agent', 'agente', 'agenteId', 'responsavel', 'owner', 'ownerName', 'person', 'personName'],
  team: ['team', 'equipe', 'ownerTeam', 'teamName'],
  message: ['message', 'mensagem', 'comentario', 'comment', 'text', 'description', 'descricao', 'body', 'content', 'conteudo'],
  internal: ['internal', 'interno', 'isInternal', 'private', 'privado'],
  public: ['public', 'publico', 'isPublic'],
  query: ['query', 'termo', 'search', 'q', 'keyword', 'keywords', 'descricaoProblema'],
  subject: ['subject', 'assunto', 'title', 'titulo'],
  description: ['description', 'descricao', 'body', 'content', 'message', 'mensagem'],
  email: ['email', 'emailCliente', 'customerEmail', 'clienteEmail', 'clientEmail'],
  document: ['document', 'documento', 'documentoCliente', 'cpf', 'cnpj', 'customerDocument', 'clienteDocumento'],
  urgency: ['urgency', 'urgencia', 'priority', 'prioridade'],
  category: ['category', 'categoria', 'service', 'servico'],
  customer: ['customer', 'cliente', 'nomeCliente', 'emailCliente', 'documentoCliente', 'email', 'document', 'documento', 'cpf', 'cnpj'],
}

export function findTool(tools: McpTool[] | undefined, name: string): McpTool | undefined {
  return tools?.find((tool) => tool.name === name)
}

export function findFirstTool(
  tools: McpTool[] | undefined,
  names: string[],
): McpTool | undefined {
  return tools?.find((tool) => names.includes(tool.name))
}

export function buildToolArguments(tool: McpTool | undefined, candidates: CandidateMap): CandidateMap {
  if (!tool?.inputSchema?.properties) return candidates

  const props = Object.keys(tool.inputSchema.properties)
  const result: CandidateMap = {}

  for (const [semanticKey, value] of Object.entries(candidates)) {
    if (value === undefined || value === null || value === '') continue

    const aliases = FIELD_ALIASES[semanticKey] ?? [semanticKey]
    const prop = props.find((candidate) =>
      aliases.some((alias) => alias.toLowerCase() === candidate.toLowerCase()),
    )

    if (prop) result[prop] = value
  }

  return result
}

export function mcpResultToText(result: McpToolCallResult | undefined): string {
  if (!result) return ''

  const textParts = result.content
    ?.map((item) => {
      if (item.type === 'text' && typeof item.text === 'string') return item.text
      if (item.type === 'resource' && typeof item.resource === 'object') {
        const resource = item.resource as { text?: unknown }
        return typeof resource.text === 'string' ? resource.text : ''
      }
      return ''
    })
    .filter(Boolean)

  if (textParts?.length) return textParts.join('\n\n')
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2)
  return JSON.stringify(result, null, 2)
}

export function parseJsonishResult(result: McpToolCallResult | undefined): unknown {
  const text = mcpResultToText(result).trim()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
