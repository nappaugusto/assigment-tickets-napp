/**
 * atribuir-agente.ts — Ferramenta MCP para atribuir tickets a agentes
 * 
 * Permite atribuir (ou reatribuir) um ticket a um agente ou equipe
 * específica no Movidesk, alterando o responsável (owner) do ticket.
 * Útil para escalonar ou redistribuir tickets na equipe.
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { ErroMovidesk } from "../cliente-movidesk/tipos.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaAtribuirAgente = z.object({
    ticketId: z
        .number()
        .int()
        .positive("O ID do ticket deve ser um número positivo")
        .describe("ID numérico do ticket a ser atribuído"),

    agenteId: z
        .string()
        .min(1, "O ID ou email do agente é obrigatório")
        .describe("ID (identificador/email) do agente ou equipe que assumirá o ticket"),

    nomeAgente: z
        .string()
        .optional()
        .describe("Nome do agente para referência (não é enviado à API, apenas para contexto)"),

    equipe: z
        .string()
        .optional()
        .describe("Nome da equipe à qual o ticket será atribuído (opcional)"),
});

export type ParametrosAtribuirAgente = z.infer<typeof schemaAtribuirAgente>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Atribui um ticket a um agente ou equipe no Movidesk
 * 
 * @param parametros - ID do ticket e dados do agente
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto com o resultado da operação
 */
export async function executarAtribuirAgente(
    parametros: ParametrosAtribuirAgente,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // —— PASSO 1: Buscar ticket para confirmar existência ——
        let ticket;
        try {
            ticket = await clienteApi.buscarTicketPorId(parametros.ticketId);
        } catch {
            return `❌ Ticket #${parametros.ticketId} não encontrado. Verifique o número e tente novamente.`;
        }

        if (!ticket || !ticket.id) {
            return `❌ Ticket #${parametros.ticketId} não encontrado.`;
        }

        // Verificar se o ticket já está atribuído ao mesmo agente
        if (ticket.owner && ticket.owner.id === parametros.agenteId) {
            return `ℹ️ O ticket #${parametros.ticketId} já está atribuído a ${ticket.owner.businessName}. Nenhuma alteração necessária.`;
        }

        // —— PASSO 2: Obter informações do responsável anterior (para log) ——
        const responsavelAnterior = ticket.owner
            ? ticket.owner.businessName
            : "Ninguém (sem responsável)";

        // —— PASSO 3: Montar payload de atualização ——
        const dadosAtualizacao: Record<string, unknown> = {
            owner: {
                id: parametros.agenteId,
                personType: 1,     // Pessoa
                profileType: 1,    // Agente
            },
        };

        // Adicionar equipe se informada
        if (parametros.equipe) {
            dadosAtualizacao.ownerTeam = parametros.equipe;
        }

        // —— PASSO 4: Enviar a atualização ——
        await clienteApi.atualizarTicket(parametros.ticketId, dadosAtualizacao);

        // —— PASSO 5: Retornar confirmação ——
        const nomeNovoAgente = parametros.nomeAgente || parametros.agenteId;

        return (
            `✅ **Ticket atribuído com sucesso!**\n\n` +
            `🎫 **Ticket:** #${parametros.ticketId} — ${ticket.subject}\n` +
            `👤 **Responsável anterior:** ${responsavelAnterior}\n` +
            `👤 **Novo responsável:** ${nomeNovoAgente}\n` +
            (parametros.equipe ? `👥 **Equipe:** ${parametros.equipe}\n` : "")
        );
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao atribuir ticket #${parametros.ticketId}: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}
