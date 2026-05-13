/**
 * alterar-status.ts — Ferramenta MCP para alterar o status de tickets
 * 
 * Permite mudar o status de um ticket no Movidesk.
 * Status disponíveis: Novo, Em atendimento, Parado, Resolvido, Cancelado, Fechado.
 * Alguns status podem exigir justificativa.
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { STATUS_PORTUGUES, STATUS_PARA_PORTUGUES, ErroMovidesk } from "../cliente-movidesk/tipos.js";
import { converterParaHtml } from "../utilidades/formatador-html.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaAlterarStatus = z.object({
    ticketId: z
        .number()
        .int()
        .positive("O ID do ticket deve ser um número positivo")
        .describe("ID numérico do ticket a ter o status alterado"),

    novoStatus: z
        .string()
        .min(1, "O novo status é obrigatório")
        .describe("Novo status do ticket em português: 'Novo', 'Em atendimento', 'Parado', 'Resolvido', 'Cancelado' ou 'Fechado'"),

    justificativa: z
        .string()
        .optional()
        .describe("Justificativa para a mudança de status (obrigatória para alguns status como 'Parado' e 'Cancelado')"),
});

export type ParametrosAlterarStatus = z.infer<typeof schemaAlterarStatus>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Altera o status de um ticket existente no Movidesk
 * 
 * @param parametros - ID do ticket, novo status e justificativa (opcional)
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto com o resultado da operação
 */
export async function executarAlterarStatus(
    parametros: ParametrosAlterarStatus,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // —— PASSO 1: Validar o status informado ——
        const statusApi = STATUS_PORTUGUES[parametros.novoStatus];

        if (!statusApi) {
            const statusValidos = Object.keys(STATUS_PORTUGUES).join(", ");
            return `❌ Status "${parametros.novoStatus}" não é válido.\n\n**Status disponíveis:** ${statusValidos}`;
        }

        // —— PASSO 2: Verificar se a justificativa é necessária ——
        const statusQueExigemJustificativa = ["Parado", "Cancelado"];
        if (
            statusQueExigemJustificativa.includes(parametros.novoStatus) &&
            !parametros.justificativa
        ) {
            return `⚠️ O status "${parametros.novoStatus}" exige uma justificativa. Por favor, informe o motivo da alteração no campo 'justificativa'.`;
        }

        // —— PASSO 3: Buscar ticket para confirmar que existe ——
        let ticket;
        try {
            ticket = await clienteApi.buscarTicketPorId(parametros.ticketId);
        } catch {
            return `❌ Ticket #${parametros.ticketId} não encontrado. Verifique o número e tente novamente.`;
        }

        if (!ticket || !ticket.id) {
            return `❌ Ticket #${parametros.ticketId} não encontrado.`;
        }

        // Verificar se o status já é o mesmo
        const statusAtualPt = STATUS_PARA_PORTUGUES[ticket.status] || ticket.status;
        if (ticket.status === statusApi) {
            return `ℹ️ O ticket #${parametros.ticketId} já está com o status "${statusAtualPt}". Nenhuma alteração necessária.`;
        }

        // —— PASSO 4: Montar o payload de atualização ——
        const dadosAtualizacao: Record<string, unknown> = {
            status: statusApi,
        };

        // Adicionar justificativa como uma nova ação se informada
        if (parametros.justificativa) {
            const justificativaHtml = converterParaHtml(parametros.justificativa);
            dadosAtualizacao.justification = justificativaHtml;

            // Também adicionar como interação interna para registro
            dadosAtualizacao.actions = [
                {
                    type: 1,  // Ação interna
                    origin: 9, // Origem: API
                    description: `<div style="font-family: Arial, sans-serif;"><strong>📌 Alteração de Status:</strong> ${statusAtualPt} → ${parametros.novoStatus}<br><strong>Justificativa:</strong> ${justificativaHtml}</div>`,
                    status: statusApi,
                    justification: justificativaHtml,
                },
            ];
        }

        // —— PASSO 5: Enviar a atualização ——
        await clienteApi.atualizarTicket(parametros.ticketId, dadosAtualizacao);

        // —— PASSO 6: Retornar confirmação ——
        return (
            `✅ **Status alterado com sucesso!**\n\n` +
            `🎫 **Ticket:** #${parametros.ticketId} — ${ticket.subject}\n` +
            `📊 **Status anterior:** ${statusAtualPt}\n` +
            `📊 **Novo status:** ${parametros.novoStatus}\n` +
            (parametros.justificativa ? `📝 **Justificativa:** ${parametros.justificativa}\n` : "")
        );
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao alterar status do ticket #${parametros.ticketId}: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}
