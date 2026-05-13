/**
 * buscar-conhecimento.ts — Ferramenta MCP para buscar na base de conhecimento
 * 
 * Pesquisa tickets resolvidos no Movidesk usando palavras-chave extraídas
 * do problema reportado. Funciona como uma "base de conhecimento viva",
 * retornando soluções de problemas similares já resolvidos anteriormente.
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { ErroMovidesk, TicketMovidesk } from "../cliente-movidesk/tipos.js";
import { formatarDataBr } from "../utilidades/formatador-html.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaBuscarConhecimento = z.object({
    descricaoProblema: z
        .string()
        .min(5, "Descreva o problema com pelo menos 5 caracteres")
        .describe("Descrição do problema que você está enfrentando. Quanto mais detalhado, melhor será a busca na base de conhecimento."),

    quantidadeResultados: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Quantidade máxima de resultados a retornar (padrão: 5, máximo: 20)"),

    incluirInteracoes: z
        .boolean()
        .default(true)
        .describe("Se deve incluir as interações/soluções encontradas nos tickets (padrão: true)"),
});

export type ParametrosBuscarConhecimento = z.infer<typeof schemaBuscarConhecimento>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Busca na base de conhecimento do Movidesk por soluções de problemas
 * 
 * Fluxo:
 * 1. Extrai palavras-chave relevantes da descrição do problema
 * 2. Constrói filtro OData para buscar tickets resolvidos/fechados
 * 3. Pesquisa os tickets no Movidesk
 * 4. Analisa as interações para encontrar soluções
 * 5. Retorna os resultados formatados com instruções de resolução
 * 
 * @param parametros - Descrição do problema e configurações da busca
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto com soluções encontradas na base de conhecimento
 */
export async function executarBuscarConhecimento(
    parametros: ParametrosBuscarConhecimento,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // —— PASSO 1: Extrair palavras-chave da descrição do problema ——
        const palavrasChave = extrairPalavrasChave(parametros.descricaoProblema);

        if (palavrasChave.length === 0) {
            return "❌ Não foi possível extrair palavras-chave relevantes da descrição. Por favor, descreva o problema com mais detalhes.";
        }

        // —— PASSO 2: Construir filtros OData para busca ——
        // Buscar tickets resolvidos ou fechados que contenham as palavras-chave no assunto
        const filtrosSubject = palavrasChave
            .map((palavra) => `contains(tolower(subject), '${palavra}')`)
            .join(" or ");

        // Filtrar por status resolvido ou fechado (onde as soluções estão)
        const filtroStatus = "(status eq 'Resolvido' or status eq 'Fechado')";
        const filtroCompleto = `${filtroStatus} and (${filtrosSubject})`;

        // —— PASSO 3: Pesquisar tickets no Movidesk ——
        const ticketsEncontrados = await clienteApi.pesquisarTickets(
            filtroCompleto,
            parametros.quantidadeResultados,
            "lastUpdate desc",
            "id,subject,status,category,urgency,createdDate,resolvedIn,serviceFull,actions",
            "actions($select=description,type,createdDate,createdBy)"
        );

        // Verificar se encontrou resultados
        if (!ticketsEncontrados || ticketsEncontrados.length === 0) {
            // Tentar uma busca mais ampla se a primeira não encontrou nada
            return await tentarBuscaAlternativa(parametros, clienteApi, palavrasChave);
        }

        // —— PASSO 4: Formatar resultados com soluções ——
        return formatarResultadosBusca(
            ticketsEncontrados,
            parametros.descricaoProblema,
            palavrasChave,
            parametros.incluirInteracoes
        );
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        return `❌ Erro ao buscar na base de conhecimento: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

/**
 * Extrai palavras-chave relevantes da descrição do problema
 * Remove stop words (palavras muito comuns) e retorna as mais relevantes
 * 
 * @param descricao - Texto da descrição do problema
 * @returns Lista de palavras-chave relevantes
 */
function extrairPalavrasChave(descricao: string): string[] {
    // Lista de stop words em português (palavras muito comuns que não ajudam na busca)
    const stopWords = new Set([
        "a", "o", "e", "é", "de", "do", "da", "dos", "das", "em", "no", "na",
        "nos", "nas", "um", "uma", "uns", "umas", "para", "por", "com", "sem",
        "que", "se", "não", "nao", "mais", "muito", "como", "mas", "ou", "ter",
        "ser", "está", "esta", "esse", "essa", "este", "isso", "isto", "aqui",
        "ali", "lá", "meu", "seu", "nosso", "dele", "dela", "eles", "elas",
        "quando", "onde", "qual", "quem", "porque", "pois", "já", "ainda",
        "bem", "mal", "só", "mesmo", "também", "tambem", "foi", "fui", "vai",
        "vou", "pode", "tem", "temos", "tinha", "havia", "houve", "todo",
        "toda", "todos", "todas", "cada", "outro", "outra", "preciso", "estou",
        "tenho", "problema", "erro", "favor", "ajuda", "consegue", "consigo",
        "sistema", "cliente", "ticket",
    ]);

    // Limpar e dividir o texto em palavras
    const palavras = descricao
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")  // Remover acentos para matchear melhor
        .replace(/[^\w\s]/g, " ")          // Remover pontuação
        .split(/\s+/)                      // Dividir por espaços
        .filter((palavra) => {
            // Manter apenas palavras com 3+ caracteres que não sejam stop words
            const palavraSemAcento = palavra.toLowerCase();
            return palavra.length >= 3 && !stopWords.has(palavraSemAcento);
        });

    // Remover duplicatas e limitar a 6 palavras-chave (evitar filtro muito restritivo)
    const palavrasUnicas = [...new Set(palavras)];
    return palavrasUnicas.slice(0, 6);
}

/**
 * Tenta uma busca alternativa com menos filtros caso a principal não encontre nada
 * 
 * @param parametros - Parâmetros originais da busca
 * @param clienteApi - Cliente da API
 * @param palavrasChave - Palavras-chave originais
 * @returns Resultado da busca alternativa
 */
async function tentarBuscaAlternativa(
    parametros: ParametrosBuscarConhecimento,
    clienteApi: ClienteMovidesk,
    palavrasChave: string[]
): Promise<string> {
    // Tentar com apenas as 2 primeiras palavras-chave (busca mais ampla)
    if (palavrasChave.length > 2) {
        const palavrasReduzidas = palavrasChave.slice(0, 2);
        const filtrosReduzidos = palavrasReduzidas
            .map((palavra) => `contains(tolower(subject), '${palavra}')`)
            .join(" or ");

        const filtroStatus = "(status eq 'Resolvido' or status eq 'Fechado')";

        const ticketsAlternativos = await clienteApi.pesquisarTickets(
            `${filtroStatus} and (${filtrosReduzidos})`,
            parametros.quantidadeResultados,
            "lastUpdate desc",
            "id,subject,status,category,urgency,createdDate,resolvedIn,serviceFull,actions",
            "actions($select=description,type,createdDate,createdBy)"
        );

        if (ticketsAlternativos && ticketsAlternativos.length > 0) {
            return formatarResultadosBusca(
                ticketsAlternativos,
                parametros.descricaoProblema,
                palavrasReduzidas,
                parametros.incluirInteracoes
            );
        }
    }

    // Se ainda não encontrou, informar ao usuário
    return (
        `🔍 **Nenhuma solução encontrada na base de conhecimento.**\n\n` +
        `Palavras-chave pesquisadas: ${palavrasChave.map((p) => `"${p}"`).join(", ")}\n\n` +
        `**Sugestões:**\n` +
        `1. Tente descrever o problema com termos diferentes\n` +
        `2. Use termos mais técnicos ou específicos\n` +
        `3. Verifique se o problema é novo e ainda não tem solução registrada\n` +
        `4. Se for um problema novo, considere criar um ticket para registro`
    );
}

/**
 * Formata os tickets encontrados em uma resposta legível com soluções
 * 
 * @param tickets - Tickets encontrados na busca
 * @param descricaoOriginal - Descrição do problema original
 * @param palavrasChave - Palavras-chave usadas na busca
 * @param incluirInteracoes - Se deve mostrar as interações
 * @returns Texto formatado com os resultados
 */
function formatarResultadosBusca(
    tickets: TicketMovidesk[],
    descricaoOriginal: string,
    palavrasChave: string[],
    incluirInteracoes: boolean
): string {
    let resultado = `## 📚 Base de Conhecimento — Resultados da Busca\n\n`;
    resultado += `🔍 **Problema pesquisado:** ${descricaoOriginal}\n`;
    resultado += `🏷️ **Palavras-chave:** ${palavrasChave.map((p) => `"${p}"`).join(", ")}\n`;
    resultado += `📊 **Resultados encontrados:** ${tickets.length}\n\n`;
    resultado += `---\n\n`;

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        resultado += `### ${i + 1}. 🎫 Ticket #${ticket.id} — ${ticket.subject}\n\n`;
        resultado += `- **Status:** ${ticket.status === "Resolvido" ? "✅ Resolvido" : "🔒 Fechado"}\n`;
        resultado += `- **Categoria:** ${ticket.category || "N/A"}\n`;
        resultado += `- **Criado em:** ${formatarDataBr(ticket.createdDate)}\n`;
        resultado += `- **Resolvido em:** ${formatarDataBr(ticket.resolvedIn)}\n`;

        if (ticket.serviceFull && ticket.serviceFull.length > 0) {
            resultado += `- **Serviço:** ${ticket.serviceFull.join(" > ")}\n`;
        }

        // Incluir as interações com soluções (se habilitado)
        if (incluirInteracoes && ticket.actions && ticket.actions.length > 0) {
            // Filtrar interações que podem conter soluções (as mais recentes geralmente têm a solução)
            const acoesComSolucao = ticket.actions
                .filter((acao) => !acao.isDeleted && acao.description)
                .slice(-3); // Pegar as 3 últimas ações (mais prováveis de conter solução)

            if (acoesComSolucao.length > 0) {
                resultado += `\n**💡 Solução/Resolução encontrada:**\n\n`;

                for (const acao of acoesComSolucao) {
                    const descricaoLimpa = limparHtmlParaTextoBasico(acao.description);
                    if (descricaoLimpa.trim()) {
                        resultado += `> ${descricaoLimpa.replace(/\n/g, "\n> ")}\n\n`;
                    }
                }
            }
        }

        resultado += `---\n\n`;
    }

    resultado += `💡 *Dica: Se nenhuma solução se aplica exatamente, tente adaptar as soluções encontradas ao seu caso específico.*\n`;

    return resultado;
}

/**
 * Limpa HTML básico para exibição como texto
 */
function limparHtmlParaTextoBasico(html: string): string {
    return html
        // 1. Converter tags de imagem para Markdown: ![alt](url)
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "![img - $2]($1)")
        .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, "![img - $1]($2)")
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "![img]($1)")
        // 2. Outras conversões...
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li>/gi, "• ")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
