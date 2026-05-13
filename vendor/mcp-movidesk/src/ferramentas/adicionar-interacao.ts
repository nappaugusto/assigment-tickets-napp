/**
 * adicionar-interacao.ts — Ferramenta MCP para adicionar interações em tickets
 * 
 * Permite adicionar uma nova ação/interação (comentário) em um ticket
 * existente do Movidesk. O conteúdo é automaticamente formatado em HTML.
 * 
 * Fluxo esperado:
 * 1. Usuário informa o número do ticket (ou nome do cliente para busca)
 * 2. O agente confirma o ticket correto com o título
 * 3. O conteúdo da interação é inserido formatado em HTML
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { ErroMovidesk } from "../cliente-movidesk/tipos.js";
import { converterParaHtml } from "../utilidades/formatador-html.js";
import { gerarHtmlInteracao } from "../utilidades/macros-suporte.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaAdicionarInteracao = z.object({
    ticketId: z
        .number()
        .int()
        .positive("O ID do ticket deve ser um número positivo")
        .describe("ID numérico do ticket onde adicionar a interação"),

    conteudo: z
        .string()
        .min(1, "O conteúdo da interação não pode estar vazio")
        .describe("Conteúdo da interação/comentário. Pode usar Markdown para formatação (negrito, listas, etc.). Será convertido para HTML automaticamente."),

    publico: z
        .boolean()
        .default(true)
        .describe("Se a interação é pública (visível ao cliente) ou interna. Padrão: true (pública)"),

    nomeAutor: z
        .string()
        .optional()
        .describe("Nome do autor da interação (para registro no corpo da mensagem)"),
});

export type ParametrosAdicionarInteracao = z.infer<typeof schemaAdicionarInteracao>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Adiciona uma nova interação/ação em um ticket existente
 * 
 * Fluxo:
 * 1. Busca o ticket para confirmar que existe
 * 2. Converte o conteúdo para HTML formatado
 * 3. Envia a interação via PATCH na API do Movidesk
 * 4. Retorna confirmação com detalhes
 * 
 * @param parametros - ID do ticket e conteúdo da interação
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto com o resultado da operação
 */
export async function executarAdicionarInteracao(
    parametros: ParametrosAdicionarInteracao,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // —— PASSO 1: Verificar se o ticket existe ——
        let ticket;
        try {
            ticket = await clienteApi.buscarTicketPorId(parametros.ticketId);
        } catch {
            return `❌ Ticket #${parametros.ticketId} não encontrado. Verifique o número e tente novamente.`;
        }

        if (!ticket || !ticket.id) {
            return `❌ Ticket #${parametros.ticketId} não encontrado. Verifique o número e tente novamente.`;
        }

        // —— PASSO 2: Converter conteúdo para HTML ——
        const conteudoHtml = converterParaHtml(parametros.conteudo);

        // Aplicar template de interação com autor e data
        const htmlFinal = gerarHtmlInteracao(conteudoHtml, parametros.nomeAutor);

        // —— PASSO 3: Enviar a interação via PATCH ——
        const dadosAtualizacao: Record<string, unknown> = {
            actions: [
                {
                    type: parametros.publico ? 2 : 1,  // 2 = Público, 1 = Interno
                    origin: 9,                          // Origem: API
                    description: htmlFinal,
                    status: ticket.status,              // Manter o status atual
                },
            ],
        };

        await clienteApi.atualizarTicket(parametros.ticketId, dadosAtualizacao);

        // —— PASSO 4: Retornar confirmação ——
        const tipoInteracao = parametros.publico ? "🔓 Pública" : "🔒 Interna";

        return (
            `✅ **Interação adicionada com sucesso!**\n\n` +
            `🎫 **Ticket:** #${parametros.ticketId} — ${ticket.subject}\n` +
            `📝 **Tipo:** ${tipoInteracao}\n` +
            (parametros.nomeAutor ? `👤 **Autor:** ${parametros.nomeAutor}\n` : "") +
            `📅 **Data/Hora:** ${new Date().toLocaleString("pt-BR")}\n\n` +
            `A interação foi registrada no ticket com formatação HTML.`
        );
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao adicionar interação no ticket #${parametros.ticketId}: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}
