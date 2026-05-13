/**
 * macros-suporte.ts — Templates HTML das macros de suporte
 * 
 * Contém as macros (templates) utilizadas pela equipe de suporte ao
 * criar tickets no Movidesk. Segue o formato padrão da equipe:
 * 
 * Campos obrigatórios:
 *   - Descrição: o que o cliente relatou / o que ocorreu
 *   - Versão do(s) banco(s): versão do sistema do cliente
 *   - Solução: o que foi feito para resolver (se resolvido)
 *
 * Campos opcionais:
 *   - Observações: informações extras relevantes
 */

// ============================================================
// INTERFACE — Dados de um atendimento de suporte
// ============================================================

/** Dados coletados durante um atendimento de suporte */
export interface DadosAtendimentoSuporte {
    descricao: string;               // O que o cliente relatou / o problema
    versaoBanco: string;             // Versão do banco de dados / sistema do cliente
    solucao?: string;                // Solução aplicada (se resolvido)
    observacoes?: string;            // Observações adicionais
}

/** Dados para macro de escalonamento */
export interface DadosEscalonamento {
    ticketOrigem?: number;           // ID do ticket original (se existir)
    nomeCliente: string;
    descricaoProblema: string;
    tentativasResolucao: string;     // O que já foi tentado
    motivoEscalonamento: string;     // Por que precisa escalonar
    equipeDestino?: string;          // Equipe para onde escalonar
    versaoBanco?: string;            // Versão do banco de dados
}

// ============================================================
// MACRO PRINCIPAL — Formato padrão do suporte
// ============================================================

/**
 * Gera o HTML da macro de atendimento de suporte
 * 
 * Segue o formato exato utilizado pela equipe:
 * 
 *  Descrição:
 *  [texto do que ocorreu]
 *
 *  Versão do(s) banco(s):
 *  [versão]
 *
 *  Solução:
 *  [texto da solução]
 * 
 * @param dados - Informações coletadas durante o atendimento
 * @returns HTML formatado pronto para inserir no ticket
 */
export function gerarMacroAtendimento(dados: DadosAtendimentoSuporte): string {
    let html = `<div style="font-family: Arial, sans-serif;">`;

    // —— Descrição ——
    html += `<p><strong>Descrição:</strong></p>`;
    html += `<p>${dados.descricao}</p>`;

    // —— Versão do(s) banco(s) ——
    html += `<p><strong>Versão do(s) banco(s) :</strong></p>`;
    html += `<p>${dados.versaoBanco}</p>`;

    // —— Solução ——
    html += `<p><strong>Solução:</strong></p>`;
    if (dados.solucao) {
        html += `<p>${dados.solucao}</p>`;
    } else {
        html += `<p><em>Aguardando resolução</em></p>`;
    }

    // —— Observações (opcional) ——
    if (dados.observacoes) {
        html += `<p><strong>Observações:</strong></p>`;
        html += `<p>${dados.observacoes}</p>`;
    }

    html += `</div>`;
    return html;
}

// ============================================================
// MACRO DE ESCALONAMENTO
// ============================================================

/**
 * Gera o HTML da macro de escalonamento
 * Usada quando um atendimento precisa ser transferido para outra equipe
 * 
 * @param dados - Informações do escalonamento
 * @returns HTML formatado pronto para inserir no ticket
 */
export function gerarMacroEscalonamento(dados: DadosEscalonamento): string {
    let html = `<div style="font-family: Arial, sans-serif;">`;

    // —— Descrição ——
    html += `<p><strong>Descrição:</strong></p>`;
    html += `<p>${dados.descricaoProblema}</p>`;

    // —— Versão do(s) banco(s) ——
    if (dados.versaoBanco) {
        html += `<p><strong>Versão do(s) banco(s) :</strong></p>`;
        html += `<p>${dados.versaoBanco}</p>`;
    }

    // —— Tentativas de Resolução ——
    html += `<p><strong>Tentativas de Resolução:</strong></p>`;
    html += `<p>${dados.tentativasResolucao}</p>`;

    // —— Motivo do Escalonamento ——
    html += `<p><strong>Motivo do Escalonamento:</strong></p>`;
    html += `<p>${dados.motivoEscalonamento}</p>`;

    // —— Equipe Destino (se informada) ——
    if (dados.equipeDestino) {
        html += `<p><strong>Equipe Destino:</strong> ${dados.equipeDestino}</p>`;
    }

    html += `</div>`;
    return html;
}

// ============================================================
// INTERAÇÃO SIMPLES
// ============================================================

/**
 * Gera HTML simples para uma interação/ação de ticket
 * @param conteudo - Conteúdo da interação em texto
 * @param autor - Nome do autor da interação
 * @returns HTML formatado para a interação
 */
export function gerarHtmlInteracao(conteudo: string, autor?: string): string {
    let html = `<div style="font-family: Arial, sans-serif;">`;

    if (autor) {
        html += `<p style="color: #666; font-size: 12px; margin-bottom: 8px;">👤 Registrado por: <strong>${autor}</strong> em ${new Date().toLocaleString("pt-BR")}</p>`;
        html += `<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 8px 0;">`;
    }

    html += `<div style="padding: 8px 0;">${conteudo}</div>`;
    html += `</div>`;

    return html;
}
