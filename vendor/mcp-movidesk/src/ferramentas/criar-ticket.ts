/**
 * criar-ticket.ts — Ferramenta MCP para criar tickets no Movidesk
 * 
 * Permite criar novos tickets com macro de suporte formatada em HTML.
 * A macro segue o formato padrão da equipe:
 *   - Descrição: o que ocorreu / relato do cliente
 *   - Versão do(s) banco(s): versão do sistema
 *   - Solução: o que foi feito para resolver
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { URGENCIA_PORTUGUES, ErroMovidesk } from "../cliente-movidesk/tipos.js";
import { converterParaHtml } from "../utilidades/formatador-html.js";
import { gerarMacroAtendimento, gerarMacroEscalonamento } from "../utilidades/macros-suporte.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

/** Schema de validação dos parâmetros de entrada */
export const schemaCriarTicket = z.object({
    assunto: z
        .string()
        .min(3, "O assunto deve ter no mínimo 3 caracteres")
        .describe("Título/assunto do ticket (mínimo 3 caracteres)"),

    descricao: z
        .string()
        .min(10, "A descrição deve ter no mínimo 10 caracteres")
        .describe("Descrição detalhada do problema ou solicitação. Pode usar Markdown para formatação (negrito, listas, etc.)"),

    emailCliente: z
        .string()
        .min(1, "O email, CPF, CNPJ ou ID do cliente é obrigatório")
        .describe("Email, CPF, CNPJ ou ID do cliente que está cadastrado no Movidesk"),

    urgencia: z
        .enum(["Baixa", "Média", "Alta", "Urgente"])
        .default("Baixa")
        .describe("Nível de urgência do ticket: Baixa, Média, Alta ou Urgente"),

    categoria: z
        .string()
        .optional()
        .describe("Categoria do ticket. Opções: 'Dúvida', 'Problema', 'Solicitação de serviço', 'Sugestão'"),

    tipoServico: z
        .string()
        .optional()
        .describe("Tipo de serviço associado ao ticket (ex: 'Vendas', 'Suporte'). Use o nome exato cadastrado no Movidesk."),

    nivelServico: z
        .string()
        .optional()
        .describe("Sub-nível do serviço (ex: 'Nivel Basico', 'Nivel 1'). Usado junto com tipoServico."),

    // —— Campos da coluna esquerda (Responsável e Equipe) ——

    responsavelId: z
        .string()
        .optional()
        .describe("ID do agente responsável pelo ticket. Se não informado, usa o owner padrão da conta."),

    equipeResponsavel: z
        .string()
        .optional()
        .describe("Nome da equipe responsável pelo ticket (ex: 'Administradores', 'Atendimento')."),

    // —— Campos da macro de atendimento (formato padrão da equipe) ——

    versaoBanco: z
        .string()
        .optional()
        .describe("Versão do(s) banco(s) / sistema do cliente (ex: 2025.002)"),

    solucaoAplicada: z
        .string()
        .optional()
        .describe("Solução que foi aplicada para resolver o problema (se resolvido)"),

    observacoes: z
        .string()
        .optional()
        .describe("Observações adicionais sobre o atendimento"),

    // —— Canal e atendente ——

    nomeAtendente: z
        .string()
        .optional()
        .describe("Nome do atendente que realizou o suporte"),

    canalAtendimento: z
        .enum(["Telefone", "Chat", "Email", "WhatsApp", "Presencial"])
        .optional()
        .describe("Canal pelo qual o atendimento foi realizado"),

    sistemaAfetado: z
        .string()
        .optional()
        .describe("Sistema ou módulo que foi afetado pelo problema"),

    // Tipo de macro a ser usada
    tipoMacro: z
        .enum(["atendimento", "escalonamento", "nenhuma"])
        .default("atendimento")
        .describe("Tipo de macro a aplicar: 'atendimento' (padrão), 'escalonamento' ou 'nenhuma'"),

    // Campos específicos para escalonamento
    tentativasResolucao: z
        .string()
        .optional()
        .describe("(Escalonamento) O que já foi tentado para resolver o problema"),

    motivoEscalonamento: z
        .string()
        .optional()
        .describe("(Escalonamento) Motivo pelo qual o ticket está sendo escalonado"),

    equipeDestino: z
        .string()
        .optional()
        .describe("(Escalonamento) Equipe para a qual o ticket será escalonado"),

    tags: z
        .array(z.string())
        .optional()
        .describe("Tags/etiquetas para categorizar o ticket (lista de strings)"),
});

/** Tipo inferido do schema de criação de ticket */
export type ParametrosCriarTicket = z.infer<typeof schemaCriarTicket>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

/**
 * Executa a criação de um ticket no Movidesk
 * 
 * Fluxo:
 * 1. Valida os parâmetros de entrada
 * 2. Gera o HTML da macro de suporte (formato: Descrição / Versão / Solução)
 * 3. Monta o payload para a API do Movidesk
 * 4. Cria o ticket via POST
 * 5. Retorna confirmação com ID e detalhes
 * 
 * @param parametros - Dados do ticket validados pelo Zod
 * @param clienteApi - Instância do cliente da API Movidesk
 * @returns Texto com o resultado da operação
 */
export async function executarCriarTicket(
    parametros: ParametrosCriarTicket,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        // —— PASSO 1: Gerar o HTML do corpo do ticket ——
        let corpoHtml: string;

        if (parametros.tipoMacro === "atendimento") {
            // Usar a macro de atendimento (formato padrão: Descrição / Versão / Solução)
            corpoHtml = gerarMacroAtendimento({
                descricao: converterParaHtml(parametros.descricao),
                versaoBanco: parametros.versaoBanco || "Não informada",
                solucao: parametros.solucaoAplicada
                    ? converterParaHtml(parametros.solucaoAplicada)
                    : undefined,
                observacoes: parametros.observacoes
                    ? converterParaHtml(parametros.observacoes)
                    : undefined,
            });
        } else if (parametros.tipoMacro === "escalonamento") {
            // Usar a macro de escalonamento
            if (!parametros.tentativasResolucao || !parametros.motivoEscalonamento) {
                return "❌ Para usar a macro de escalonamento, é obrigatório informar os campos 'tentativasResolucao' e 'motivoEscalonamento'.";
            }

            corpoHtml = gerarMacroEscalonamento({
                nomeCliente: parametros.emailCliente,
                descricaoProblema: converterParaHtml(parametros.descricao),
                tentativasResolucao: converterParaHtml(parametros.tentativasResolucao),
                motivoEscalonamento: converterParaHtml(parametros.motivoEscalonamento),
                equipeDestino: parametros.equipeDestino,
                versaoBanco: parametros.versaoBanco,
            });
        } else {
            // Sem macro — apenas converter a descrição para HTML
            corpoHtml = converterParaHtml(parametros.descricao);
        }

        // —— PASSO 2: Mapear urgência do português para API ——
        const urgenciaApi = URGENCIA_PORTUGUES[parametros.urgencia] || "Baixa";

        // —— PASSO 3: Montar o payload para a API do Movidesk ——
        const payloadTicket: Record<string, unknown> = {
            type: 2,                              // Tipo público
            subject: parametros.assunto,
            urgency: urgenciaApi,
            status: "Novo",                       // Status inicial
            origin: 9,                            // Origem: API
            createdBy: {
                id: parametros.emailCliente,      // Criador do ticket
            },
            // Responsável do ticket (coluna esquerda)
            ownerTeam: parametros.equipeResponsavel || "Administradores",
            // Tags (padrão: Geral)
            tags: (parametros.tags && parametros.tags.length > 0) ? parametros.tags : ["Geral"],
            actions: [
                {
                    type: 2,                           // Ação pública
                    origin: 9,                         // Origem: API
                    description: corpoHtml,            // Corpo HTML com macro
                    status: "Novo",
                },
            ],
            clients: [
                {
                    id: parametros.emailCliente,        // ID ou email do cliente
                    personType: 2,                      // Pessoa jurídica (empresa)
                    profileType: 2,                     // Perfil: Cliente
                },
            ],
        };

        // Adicionar responsável (agente) se informado
        if (parametros.responsavelId) {
            payloadTicket.owner = {
                id: parametros.responsavelId,
                personType: 1,
                profileType: 1,
            };
        }

        // Adicionar categoria se informada
        if (parametros.categoria) {
            payloadTicket.category = parametros.categoria;
        }

        // Adicionar tipo de serviço com hierarquia
        if (parametros.tipoServico) {
            const serviceFull = [parametros.tipoServico];
            if (parametros.nivelServico) {
                serviceFull.push(parametros.nivelServico);
            }
            payloadTicket.serviceFull = serviceFull;
        }


        // —— PASSO 4: Criar o ticket na API do Movidesk ——
        const ticketCriado = await clienteApi.criarTicket(payloadTicket);

        // —— PASSO 5: Retornar mensagem de sucesso com detalhes ——
        return (
            `✅ **Ticket criado com sucesso!**\n\n` +
            `📌 **ID do Ticket:** #${ticketCriado.id}\n` +
            `📋 **Assunto:** ${ticketCriado.subject}\n` +
            `⚡ **Urgência:** ${parametros.urgencia}\n` +
            `📊 **Status:** Novo\n` +
            (parametros.versaoBanco ? `💾 **Versão do(s) banco(s):** ${parametros.versaoBanco}\n` : "") +
            (parametros.categoria ? `📁 **Categoria:** ${parametros.categoria}\n` : "") +
            (parametros.tipoServico ? `🔧 **Serviço:** ${parametros.tipoServico}${parametros.nivelServico ? ` > ${parametros.nivelServico}` : ""}\n` : "") +
            `👥 **Equipe:** ${parametros.equipeResponsavel || "Administradores"}\n` +
            `🏷️ **Tags:** ${(parametros.tags && parametros.tags.length > 0) ? parametros.tags.join(", ") : "Geral"}\n` +
            (parametros.tipoMacro !== "nenhuma" ? `📝 **Macro aplicada:** ${parametros.tipoMacro}\n` : "") +
            `\n🔗 O ticket foi criado e está aguardando atendimento.`
        );
    } catch (erro) {
        // Tratar erros da API Movidesk
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? `\n📋 Detalhes: ${erroMovidesk.detalhes}` : ""}`;
        }

        // Erro genérico inesperado
        return `❌ Erro inesperado ao criar ticket: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}
