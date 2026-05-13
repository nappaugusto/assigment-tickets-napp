/**
 * listar-tickets.ts — Ferramenta MCP para listar tickets de um cliente
 * 
 * Busca os últimos tickets de um cliente específico no Movidesk,
 * filtrando por nome (razão social), email ou documento (CPF/CNPJ).
 * Útil para verificar histórico e evitar abrir tickets duplicados.
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { ErroMovidesk, TicketMovidesk, STATUS_PARA_PORTUGUES } from "../cliente-movidesk/tipos.js";
import { formatarDataBr } from "../utilidades/formatador-html.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaListarTickets = z.object({
    nomeCliente: z
        .string()
        .optional()
        .describe("Nome, razão social ou nome fantasia do cliente para busca (ex: 'ALMEIDA'). Forma preferida de busca."),

    emailCliente: z
        .string()
        .email("Email inválido")
        .optional()
        .describe("Email do cliente para filtrar tickets"),

    documentoCliente: z
        .string()
        .optional()
        .describe("CPF ou CNPJ do cliente para filtrar tickets"),

    quantidade: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Quantidade máxima de tickets a retornar (padrão: 10, máximo: 50)"),
});

export type ParametrosListarTickets = z.infer<typeof schemaListarTickets>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Lista os últimos tickets de um cliente específico
 * 
 * @param parametros - Critérios de busca (nome, email ou documento)
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Lista formatada de tickets
 */
export async function executarListarTickets(
    parametros: ParametrosListarTickets,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // Verificar se pelo menos um critério de busca foi informado
        if (!parametros.nomeCliente && !parametros.emailCliente && !parametros.documentoCliente) {
            return "❌ Informe pelo menos um critério de busca: nome, email ou documento (CPF/CNPJ) do cliente.";
        }

        // —— PASSO 1: Construir filtro OData para buscar tickets do cliente ——
        const filtros: string[] = [];

        if (parametros.nomeCliente) {
            // Buscar por nome no campo clients (busca parcial com contains, ignorando case)
            filtros.push(`clients/any(c: contains(tolower(c/businessName), tolower('${parametros.nomeCliente}')))`);
        }

        if (parametros.emailCliente) {
            // Buscar por email do cliente
            filtros.push(`clients/any(c: c/email eq '${parametros.emailCliente}')`);
        }

        if (parametros.documentoCliente) {
            // Buscar por CPF/CNPJ — limpar formatação antes
            const docLimpo = parametros.documentoCliente.replace(/[.\-\/]/g, "");
            filtros.push(`clients/any(c: c/cpfCnpj eq '${docLimpo}')`);
        }

        // Combinar filtros com AND se houver mais de um
        const filtroCompleto = filtros.join(" and ");

        // —— PASSO 2: Pesquisar tickets no Movidesk ——
        const tickets = await clienteApi.pesquisarTickets(
            filtroCompleto,
            parametros.quantidade,
            "lastUpdate desc",
            "id,subject,status,urgency,category,createdDate,lastUpdate,serviceFull"
        );

        // Verificar se encontrou tickets
        if (!tickets || tickets.length === 0) {
            const criterio = parametros.nomeCliente || parametros.emailCliente || parametros.documentoCliente;
            return `🔍 Nenhum ticket encontrado para "${criterio}". Verifique os dados e tente novamente.`;
        }

        // —— PASSO 3: Formatar a lista de tickets ——
        return formatarListaTickets(tickets, parametros);
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao listar tickets: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}

/**
 * Formata a lista de tickets em uma tabela legível
 */
function formatarListaTickets(
    tickets: TicketMovidesk[],
    parametros: ParametrosListarTickets
): string {
    const criterio = parametros.nomeCliente || parametros.emailCliente || parametros.documentoCliente;

    let resultado = `## 📋 Tickets de "${criterio}"\n\n`;
    resultado += `📊 **Total encontrado:** ${tickets.length} ticket(s)\n\n`;

    // Tabela Markdown com os tickets
    resultado += `| # | ID | Assunto | Status | Urgência | Atualização |\n`;
    resultado += `|---|------|---------|--------|----------|-------------|\n`;

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const statusPt = STATUS_PARA_PORTUGUES[ticket.status] || ticket.status;
        const emojiStatus = obterEmojiStatusLista(ticket.status);
        const urgencia = formatarUrgenciaCurta(ticket.urgency);

        resultado += `| ${i + 1} | #${ticket.id} | ${ticket.subject} | ${emojiStatus} ${statusPt} | ${urgencia} | ${formatarDataBr(ticket.lastUpdate)} |\n`;
    }

    resultado += `\n💡 *Para ver detalhes completos de um ticket, use a ferramenta **consultar_ticket** com o ID.*\n`;

    return resultado;
}

/** Emoji simples para status em lista */
function obterEmojiStatusLista(status: string): string {
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

/** Formata urgência de forma curta */
function formatarUrgenciaCurta(urgencia: string): string {
    const mapa: Record<string, string> = {
        "Low": "🟢 Baixa",
        "Medium": "🟡 Média",
        "High": "🟠 Alta",
        "Urgent": "🔴 Urgente",
    };
    return mapa[urgencia] || urgencia;
}
