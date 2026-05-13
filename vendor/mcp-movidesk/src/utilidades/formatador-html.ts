/**
 * formatador-html.ts — Utilitário para converter Markdown em HTML
 * 
 * O Movidesk aceita APENAS HTML na formatação de tickets e interações.
 * Este módulo converte texto Markdown para HTML usando a biblioteca 'marked',
 * garantindo que o conteúdo fique bonito e legível dentro do Movidesk.
 */

import { marked } from "marked";

// ============================================================
// CONFIGURAÇÃO DO MARKED
// ============================================================

// Configurar o marked para gerar HTML limpo e seguro
marked.setOptions({
    breaks: true,     // Tratar quebras de linha como <br>
    gfm: true,        // Habilitar GitHub Flavored Markdown (tabelas, listas, etc.)
});

// ============================================================
// FUNÇÕES PRINCIPAIS
// ============================================================

/**
 * Converte texto em Markdown para HTML formatado
 * Ideal para descrições e interações de tickets
 * 
 * @param textoMarkdown - Texto em Markdown para converter
 * @returns HTML formatado pronto para enviar ao Movidesk
 * 
 * @example
 * converterParaHtml("**Problema:** O sistema está lento")
 * // Retorna: "<p><strong>Problema:</strong> O sistema está lento</p>"
 */
export function converterParaHtml(textoMarkdown: string): string {
    // Se o texto já parece ser HTML, retorná-lo como está
    if (textoJaEhHtml(textoMarkdown)) {
        return textoMarkdown;
    }

    // Converter Markdown para HTML usando o marked
    const htmlGerado = marked.parse(textoMarkdown) as string;

    // Retornar o HTML limpo (sem espaços desnecessários no início e fim)
    return htmlGerado.trim();
}

/**
 * Verifica se o texto já está em formato HTML
 * Evita dupla conversão caso o conteúdo já venha formatado
 * 
 * @param texto - Texto a ser verificado
 * @returns true se o texto já contém tags HTML
 */
export function textoJaEhHtml(texto: string): boolean {
    // Verificar se contém tags HTML comuns
    const regexHtml = /<\/?[a-z][\s\S]*>/i;
    return regexHtml.test(texto);
}

/**
 * Cria uma tabela HTML a partir de um objeto de dados
 * Útil para exibir informações estruturadas em tickets
 * 
 * @param cabecalhos - Lista de cabeçalhos da tabela
 * @param linhas - Lista de linhas (cada linha é um array de strings)
 * @returns Tabela HTML formatada com estilo visual
 * 
 * @example
 * criarTabelaHtml(
 *   ["Campo", "Valor"],
 *   [["Status", "Aberto"], ["Urgência", "Alta"]]
 * )
 */
export function criarTabelaHtml(
    cabecalhos: string[],
    linhas: string[][]
): string {
    // Estilo CSS inline para a tabela (funciona dentro do Movidesk)
    const estiloTabela = `style="border-collapse: collapse; width: 100%; margin: 10px 0; font-family: Arial, sans-serif;"`;
    const estiloCabecalho = `style="background-color: #1a73e8; color: white; padding: 10px 14px; text-align: left; border: 1px solid #ddd; font-weight: bold;"`;
    const estiloCelula = `style="padding: 8px 14px; text-align: left; border: 1px solid #ddd;"`;
    const estiloLinhaAlternada = `style="background-color: #f8f9fa;"`;

    // Montar os cabeçalhos da tabela
    const htmlCabecalhos = cabecalhos
        .map((cab) => `<th ${estiloCabecalho}>${cab}</th>`)
        .join("");

    // Montar as linhas com estilo alternado (zebrado) para melhor legibilidade
    const htmlLinhas = linhas
        .map((linha, indice) => {
            const estiloLinha = indice % 2 === 1 ? estiloLinhaAlternada : "";
            const celulas = linha
                .map((celula) => `<td ${estiloCelula}>${celula}</td>`)
                .join("");
            return `<tr ${estiloLinha}>${celulas}</tr>`;
        })
        .join("");

    return `<table ${estiloTabela}><thead><tr>${htmlCabecalhos}</tr></thead><tbody>${htmlLinhas}</tbody></table>`;
}

/**
 * Cria um bloco de informação destacado em HTML
 * Útil para destacar seções importantes em tickets
 * 
 * @param titulo - Título do bloco
 * @param conteudo - Conteúdo do bloco (aceita HTML)
 * @param tipo - Tipo do bloco: "info" (azul), "sucesso" (verde), "alerta" (amarelo), "erro" (vermelho)
 * @returns HTML do bloco formatado
 */
export function criarBlocoDestaque(
    titulo: string,
    conteudo: string,
    tipo: "info" | "sucesso" | "alerta" | "erro" = "info"
): string {
    // Cores para cada tipo de bloco
    const cores: Record<string, { fundo: string; borda: string; texto: string }> = {
        info: { fundo: "#e3f2fd", borda: "#1a73e8", texto: "#0d47a1" },
        sucesso: { fundo: "#e8f5e9", borda: "#4caf50", texto: "#1b5e20" },
        alerta: { fundo: "#fff3e0", borda: "#ff9800", texto: "#e65100" },
        erro: { fundo: "#ffebee", borda: "#f44336", texto: "#b71c1c" },
    };

    const cor = cores[tipo];

    return `<div style="background-color: ${cor.fundo}; border-left: 4px solid ${cor.borda}; padding: 12px 16px; margin: 10px 0; border-radius: 4px;">` +
        `<strong style="color: ${cor.texto}; font-size: 14px;">${titulo}</strong>` +
        `<div style="margin-top: 8px; color: #333;">${conteudo}</div>` +
        `</div>`;
}

/**
 * Formata uma data ISO 8601 para formato brasileiro (DD/MM/AAAA HH:MM)
 * 
 * @param dataIso - Data em formato ISO 8601
 * @returns Data formatada em pt-BR
 */
export function formatarDataBr(dataIso: string | undefined): string {
    if (!dataIso) return "Não informado";

    try {
        const data = new Date(dataIso);
        return data.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return dataIso;
    }
}
