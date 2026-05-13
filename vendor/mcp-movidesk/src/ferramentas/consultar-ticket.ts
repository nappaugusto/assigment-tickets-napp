/**
 * consultar-ticket.ts — Ferramenta MCP para consultar tickets no Movidesk
 * 
 * Busca um ticket pelo seu ID numérico e retorna todas as informações
 * formatadas de forma legível, incluindo status, responsável, cliente,
 * interações, campos personalizados e datas.
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { STATUS_PARA_PORTUGUES, ErroMovidesk, TicketMovidesk } from "../cliente-movidesk/tipos.js";
import { formatarDataBr } from "../utilidades/formatador-html.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaConsultarTicket = z.object({
    ticketId: z
        .number()
        .int()
        .positive("O ID do ticket deve ser um número positivo")
        .describe("ID numérico do ticket no Movidesk (ex: 12345)"),
});

export type ParametrosConsultarTicket = z.infer<typeof schemaConsultarTicket>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Executa a consulta de um ticket por ID e formata os dados para exibição
 * 
 * @param parametros - Contém o ID do ticket
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto formatado com todas as informações do ticket
 */
export async function executarConsultarTicket(
    parametros: ParametrosConsultarTicket,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // Buscar o ticket na API do Movidesk
        const ticket = await clienteApi.buscarTicketPorId(parametros.ticketId);

        // Verificar se o ticket foi encontrado
        if (!ticket || !ticket.id) {
            return `❌ Ticket #${parametros.ticketId} não encontrado no Movidesk. Verifique o número e tente novamente.`;
        }

        // Formatar o resultado para exibição legível
        return formatarTicketParaExibicao(ticket);
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao consultar ticket #${parametros.ticketId}: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}

// ============================================================
// FORMATAÇÃO — Converte dados do ticket em texto legível
// ============================================================

/**
 * Formata todas as informações de um ticket para exibição
 * Organiza em seções claras: dados gerais, cliente, responsável, interações
 * 
 * @param ticket - Dados completos do ticket da API
 * @returns Texto Markdown formatado com todos os detalhes
 */
function formatarTicketParaExibicao(ticket: TicketMovidesk): string {
    // Traduzir o status para português
    const statusPt = STATUS_PARA_PORTUGUES[ticket.status] || ticket.status;

    // Determinar emoji do status para facilitar leitura visual
    const emojiStatus = obterEmojiStatus(ticket.status);

    // Montar as seções do ticket
    let resultado = "";

    // —— Cabeçalho ——
    resultado += `## 🎫 Ticket #${ticket.id}\n\n`;

    // —— Dados gerais ——
    resultado += `### 📋 Informações Gerais\n`;
    resultado += `- **Assunto:** ${ticket.subject}\n`;
    resultado += `- **Status:** ${emojiStatus} ${statusPt}\n`;
    resultado += `- **Urgência:** ${formatarUrgencia(ticket.urgency)}\n`;
    resultado += `- **Categoria:** ${ticket.category || "Não informada"}\n`;

    // Tipo de serviço (pode ter até 3 níveis)
    if (ticket.serviceFull && ticket.serviceFull.length > 0) {
        resultado += `- **Tipo de Serviço:** ${ticket.serviceFull.join(" > ")}\n`;
    }

    // Tags
    if (ticket.tags && ticket.tags.length > 0) {
        resultado += `- **Tags:** ${ticket.tags.join(", ")}\n`;
    }

    resultado += `\n`;

    // —— Datas ——
    resultado += `### 📅 Datas\n`;
    resultado += `- **Criado em:** ${formatarDataBr(ticket.createdDate)}\n`;
    resultado += `- **Última atualização:** ${formatarDataBr(ticket.lastUpdate)}\n`;

    if (ticket.resolvedIn) {
        resultado += `- **Resolvido em:** ${formatarDataBr(ticket.resolvedIn)}\n`;
    }
    if (ticket.closedIn) {
        resultado += `- **Fechado em:** ${formatarDataBr(ticket.closedIn)}\n`;
    }
    if (ticket.slaSolutionDate) {
        resultado += `- **Prazo SLA:** ${formatarDataBr(ticket.slaSolutionDate)}\n`;
    }

    resultado += `\n`;

    // —— Cliente ——
    if (ticket.clients && ticket.clients.length > 0) {
        resultado += `### 👤 Cliente\n`;
        for (const cliente of ticket.clients) {
            resultado += `- **Nome:** ${cliente.businessName}\n`;
            resultado += `- **Email:** ${cliente.email || "Não informado"}\n`;
            if (cliente.organization) {
                resultado += `- **Organização:** ${cliente.organization.businessName}\n`;
            }
        }
        resultado += `\n`;
    }

    // —— Responsável ——
    if (ticket.owner) {
        resultado += `### 🧑‍💼 Responsável\n`;
        resultado += `- **Nome:** ${ticket.owner.businessName}\n`;
        resultado += `- **Email:** ${ticket.owner.email || "Não informado"}\n`;
        if (ticket.ownerTeam) {
            resultado += `- **Equipe:** ${ticket.ownerTeam}\n`;
        }
        resultado += `\n`;
    }

    // —— Últimas interações (limitada a 5 para não poluir) ——
    if (ticket.actions && ticket.actions.length > 0) {
        const acoesVisiveis = ticket.actions
            .filter((acao) => !acao.isDeleted)
            .slice(-5); // Pegar as 5 mais recentes

        resultado += `### 💬 Últimas Interações (${acoesVisiveis.length} de ${ticket.actionCount} total)\n`;

        for (const acao of acoesVisiveis) {
            const tipoAcao = acao.type === 2 ? "🔓 Pública" : "🔒 Interna";
            const autor = acao.createdBy?.businessName || "Sistema";
            const data = formatarDataBr(acao.createdDate);

            resultado += `\n---\n`;
            resultado += `**${tipoAcao}** — por ${autor} em ${data}\n\n`;

            // Limpar HTML da descrição para exibição como texto
            const descricaoLimpa = limparHtmlParaTexto(acao.description || acao.htmlDescription || "");
            resultado += `${descricaoLimpa}\n`;
        }
    }

    return resultado;
}

/**
 * Retorna emoji representando o status do ticket
 */
function obterEmojiStatus(status: string): string {
    const emojis: Record<string, string> = {
        "New": "🆕",
        "InAttendance": "🔄",
        "Stopped": "⏸️",
        "Canceled": "❌",
        "Resolved": "✅",
        "Closed": "🔒",
    };
    return emojis[status] || "📌";
}

/**
 * Formata a urgência para exibição com emoji
 */
function formatarUrgencia(urgencia: string): string {
    const mapa: Record<string, string> = {
        "Low": "🟢 Baixa",
        "Medium": "🟡 Média",
        "High": "🟠 Alta",
        "Urgent": "🔴 Urgente",
    };
    return mapa[urgencia] || urgencia;
}

/**
 * Remove tags HTML e retorna texto simples (para exibir interações)
 * @param html - Texto com HTML
 * @returns Texto limpo sem tags
 */
function limparHtmlParaTexto(html: string): string {
    return html
        // 1. Converter tags de imagem para Markdown: ![alt](url)
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "![img - $2]($1)")
        .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, "![img - $1]($2)")
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "![img]($1)")
        // 2. Outras conversões...
        .replace(/<br\s*\/?>/gi, "\n")    // Converter <br> em quebra de linha
        .replace(/<\/p>/gi, "\n")          // Converter </p> em quebra de linha
        .replace(/<\/li>/gi, "\n")         // Converter </li> em quebra de linha
        .replace(/<li>/gi, "• ")           // Converter <li> em bullet
        .replace(/<[^>]*>/g, "")           // Remover todas as outras tags
        .replace(/&nbsp;/g, " ")           // Converter &nbsp;
        .replace(/&amp;/g, "&")            // Converter &amp;
        .replace(/&lt;/g, "<")             // Converter &lt;
        .replace(/&gt;/g, ">")             // Converter &gt;
        .replace(/\n{3,}/g, "\n\n")        // Remover quebras de linha excessivas
        .trim();
}
