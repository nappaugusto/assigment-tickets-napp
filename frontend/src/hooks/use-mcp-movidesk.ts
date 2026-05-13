import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  mcpMovideskApi,
  type McpTool,
  type McpToolCallResult,
} from '@/lib/api'
import { buildToolArguments, findTool } from '@/lib/mcp-movidesk'
import { TICKETS_QUERY_KEY } from '@/hooks/use-tickets'

export const MCP_MOVIDESK_STATUS_QUERY_KEY = ['mcp-movidesk', 'status']
export const MCP_MOVIDESK_TOOLS_QUERY_KEY = ['mcp-movidesk', 'tools']

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function requireTool(tools: McpTool[] | undefined, name: string): McpTool {
  const tool = findTool(tools, name)
  if (!tool) throw new Error(`Ferramenta MCP indisponível: ${name}`)
  return tool
}

export function useMcpMovideskStatus() {
  return useQuery({
    queryKey: MCP_MOVIDESK_STATUS_QUERY_KEY,
    queryFn: () => mcpMovideskApi.status(),
    staleTime: 30_000,
  })
}

export function useMcpMovideskTools(enabled = true) {
  return useQuery({
    queryKey: MCP_MOVIDESK_TOOLS_QUERY_KEY,
    queryFn: () => mcpMovideskApi.tools(),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useMcpMovideskActions() {
  const qc = useQueryClient()
  const { data: toolsPayload } = useMcpMovideskTools()
  const tools = toolsPayload?.tools

  const call = useMutation({
    mutationFn: ({ name, args }: { name: string; args: Record<string, unknown> }) =>
      mcpMovideskApi.callTool(name, args),
  })

  const callKnownTool = (name: string, candidates: Record<string, unknown>) => {
    const tool = requireTool(tools, name)
    return call.mutateAsync({
      name,
      args: buildToolArguments(tool, candidates),
    })
  }

  return {
    tools,
    isPending: call.isPending,
    rawCall: call.mutateAsync,
    consultTicket: (ticketId: number) =>
      callKnownTool('consultar_ticket', { ticketId }),
    addInteraction: async (ticketId: number, message: string, internal: boolean) => {
      const result = await callKnownTool('adicionar_interacao', {
        ticketId,
        message,
        internal,
      })
      toast.success(internal ? 'Nota interna enviada ao Movidesk' : 'Resposta enviada ao Movidesk')
      return result
    },
    changeStatus: async (ticketId: number, status: string) => {
      const result = await callKnownTool('alterar_status_ticket', {
        ticketId,
        status,
      })
      await qc.invalidateQueries({ queryKey: TICKETS_QUERY_KEY })
      toast.success('Status atualizado no Movidesk')
      return result
    },
    assignAgent: async (ticketId: number, agent: string) => {
      const result = await callKnownTool('atribuir_agente', {
        ticketId,
        agent,
        team: agent,
      })
      await qc.invalidateQueries({ queryKey: TICKETS_QUERY_KEY })
      toast.success('Responsável atualizado no Movidesk')
      return result
    },
    searchKb: (query: string): Promise<McpToolCallResult> =>
      callKnownTool('buscar_artigo_kb', { query }),
    createTicket: async (payload: {
      subject: string
      description: string
      email: string
      urgency?: string
      category?: string
    }) => {
      const result = await callKnownTool('criar_ticket', payload)
      await qc.invalidateQueries({ queryKey: TICKETS_QUERY_KEY })
      toast.success('Ticket criado no Movidesk')
      return result
    },
    listCustomerTickets: (customer: string): Promise<McpToolCallResult> =>
      callKnownTool('listar_tickets_cliente', {
        customer,
        email: customer,
        document: customer,
      }),
    handleError: (error: unknown, fallback: string) => {
      toast.error(errorMessage(error, fallback))
    },
  }
}
