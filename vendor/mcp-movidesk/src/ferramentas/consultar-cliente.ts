/**
 * consultar-cliente.ts — Ferramenta MCP para consultar clientes
 * 
 * Busca informações de um cliente específico no Movidesk,
 * filtrando por nome (razão social), email ou documento (CPF/CNPJ).
 */

import { z } from "zod";
import { ClienteMovidesk } from "../cliente-movidesk/api.js";
import { ErroMovidesk, PessoaMovidesk } from "../cliente-movidesk/tipos.js";

// ============================================================
// SCHEMA ZOD — Parâmetros aceitos pela ferramenta
// ============================================================

export const schemaConsultarCliente = z.object({
    nomeCliente: z
        .string()
        .optional()
        .describe("Nome, razão social ou nome fantasia do cliente para busca (ex: 'ALMEIDA')"),

    emailCliente: z
        .string()
        .email("Email inválido")
        .optional()
        .describe("Email do cliente para busca"),

    documentoCliente: z
        .string()
        .optional()
        .describe("CPF ou CNPJ do cliente para busca"),
});

export type ParametrosConsultarCliente = z.infer<typeof schemaConsultarCliente>;

// ============================================================
// HANDLER — Lógica de execução da ferramenta
// ============================================================

export async function executarConsultarCliente(
    parametros: ParametrosConsultarCliente,
    clienteApi: ClienteMovidesk
): Promise<string> {
    try {
        if (!parametros.nomeCliente && !parametros.emailCliente && !parametros.documentoCliente) {
            return "❌ Informe pelo menos um critério de busca: nome, email ou documento (CPF/CNPJ) do cliente.";
        }

        let pessoas: PessoaMovidesk[] = [];

        if (parametros.documentoCliente) {
            pessoas = await clienteApi.buscarPessoaPorDocumento(parametros.documentoCliente);
        } else if (parametros.emailCliente) {
            pessoas = await clienteApi.buscarPessoaPorEmail(parametros.emailCliente);
        } else if (parametros.nomeCliente) {
            pessoas = await clienteApi.buscarPessoaPorNome(parametros.nomeCliente);
        }

        if (!pessoas || pessoas.length === 0) {
            const criterio = parametros.nomeCliente || parametros.emailCliente || parametros.documentoCliente;
            return `🔍 Nenhum cliente ou pessoa encontrado para "${criterio}". Verifique os dados e tente novamente.`;
        }

        return formatarListaPessoas(pessoas, parametros);
    } catch (erro) {
        if (typeof erro === "object" && erro !== null && "mensagem" in erro) {
            const erroMovidesk = erro as ErroMovidesk;
            return `${erroMovidesk.mensagem}${erroMovidesk.detalhes ? "\\n📋 Detalhes: " + erroMovidesk.detalhes : ""}`;
        }
        return `❌ Erro ao consultar cliente: ${erro instanceof Error ? erro.message : String(erro)}`;
    }
}

/**
 * Formata a lista de pessoas em uma resposta legível
 */
function formatarListaPessoas(
    pessoas: PessoaMovidesk[],
    parametros: ParametrosConsultarCliente
): string {
    const criterio = parametros.nomeCliente || parametros.emailCliente || parametros.documentoCliente;

    let resultado = `## 🧑‍💼 Clientes/Pessoas encontrados para "${criterio}"\n\n`;
    resultado += `📊 **Total encontrado:** ${pessoas.length} registro(s)\n\n`;

    for (let i = 0; i < pessoas.length; i++) {
        const p = pessoas[i];
        const tipo = p.personType === 1 ? "Pessoa Física" : "Empresa";

        resultado += `### ${i + 1}. ${p.businessName || "Sem Nome"}\n`;
        resultado += `- **Tipo:** ${tipo}\n`;
        if (p.cpfCnpj) resultado += `- **CPF/CNPJ:** ${p.cpfCnpj}\n`;

        const emailsStr = p.email || "Nenhum email cadastrado";
        resultado += `- **Email:** ${emailsStr}\n`;
        resultado += `- **ID Movidesk:** ${p.id}\n\n`;
    }

    return resultado;
}
