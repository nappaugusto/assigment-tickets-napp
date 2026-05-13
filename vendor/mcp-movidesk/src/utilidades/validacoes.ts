/**
 * validacoes.ts — Funções de validação para campos de tickets
 * 
 * Garante que os dados enviados ao Movidesk estejam corretos,
 * evitando erros 400 da API e dados inválidos nos tickets.
 */

import { STATUS_PORTUGUES, URGENCIA_PORTUGUES } from "../cliente-movidesk/tipos.js";

// ============================================================
// VALIDAÇÃO DE EMAIL
// ============================================================

/**
 * Valida se um email é válido
 * @param email - Email a ser validado
 * @returns true se o email é válido
 * 
 * @example
 * validarEmail("usuario@empresa.com") // true
 * validarEmail("email-invalido")       // false
 */
export function validarEmail(email: string): boolean {
    // Regex padrão para validação de email (RFC 5322 simplificado)
    const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regexEmail.test(email);
}

// ============================================================
// VALIDAÇÃO DE CPF
// ============================================================

/**
 * Valida se um CPF é válido (verifica dígitos verificadores)
 * @param cpf - CPF a ser validado (com ou sem formatação)
 * @returns true se o CPF é válido
 * 
 * @example
 * validarCpf("123.456.789-09") // true (se dígitos válidos)
 * validarCpf("111.111.111-11") // false (sequência repetida)
 */
export function validarCpf(cpf: string): boolean {
    // Remover formatação (pontos e traço)
    const cpfLimpo = cpf.replace(/[.\-]/g, "");

    // CPF deve ter exatamente 11 dígitos
    if (cpfLimpo.length !== 11) return false;

    // Rejeitar CPFs com todos os dígitos iguais (111.111.111-11, etc.)
    if (/^(\d)\1{10}$/.test(cpfLimpo)) return false;

    // Calcular primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpfLimpo.charAt(i)) * (10 - i);
    }
    let resto = 11 - (soma % 11);
    const primeiroDigito = resto >= 10 ? 0 : resto;

    // Verificar primeiro dígito
    if (parseInt(cpfLimpo.charAt(9)) !== primeiroDigito) return false;

    // Calcular segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpfLimpo.charAt(i)) * (11 - i);
    }
    resto = 11 - (soma % 11);
    const segundoDigito = resto >= 10 ? 0 : resto;

    // Verificar segundo dígito
    return parseInt(cpfLimpo.charAt(10)) === segundoDigito;
}

// ============================================================
// VALIDAÇÃO DE CNPJ
// ============================================================

/**
 * Valida se um CNPJ é válido (verifica dígitos verificadores)
 * @param cnpj - CNPJ a ser validado (com ou sem formatação)
 * @returns true se o CNPJ é válido
 */
export function validarCnpj(cnpj: string): boolean {
    // Remover formatação
    const cnpjLimpo = cnpj.replace(/[.\-\/]/g, "");

    // CNPJ deve ter exatamente 14 dígitos
    if (cnpjLimpo.length !== 14) return false;

    // Rejeitar CNPJs com todos os dígitos iguais
    if (/^(\d)\1{13}$/.test(cnpjLimpo)) return false;

    // Pesos para cálculo dos dígitos verificadores
    const pesosPrimeiro = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesosSegundo = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    // Calcular primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 12; i++) {
        soma += parseInt(cnpjLimpo.charAt(i)) * pesosPrimeiro[i];
    }
    let resto = soma % 11;
    const primeiroDigito = resto < 2 ? 0 : 11 - resto;

    if (parseInt(cnpjLimpo.charAt(12)) !== primeiroDigito) return false;

    // Calcular segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 13; i++) {
        soma += parseInt(cnpjLimpo.charAt(i)) * pesosSegundo[i];
    }
    resto = soma % 11;
    const segundoDigito = resto < 2 ? 0 : 11 - resto;

    return parseInt(cnpjLimpo.charAt(13)) === segundoDigito;
}

// ============================================================
// VALIDAÇÃO DE DOCUMENTO (CPF OU CNPJ)
// ============================================================

/**
 * Identifica e valida se um documento é um CPF ou CNPJ válido
 * @param documento - CPF ou CNPJ (com ou sem formatação)
 * @returns Objeto com o tipo (cpf/cnpj) e se é válido
 */
export function validarDocumento(documento: string): { tipo: "cpf" | "cnpj" | "desconhecido"; valido: boolean } {
    const documentoLimpo = documento.replace(/[.\-\/]/g, "");

    if (documentoLimpo.length === 11) {
        return { tipo: "cpf", valido: validarCpf(documento) };
    } else if (documentoLimpo.length === 14) {
        return { tipo: "cnpj", valido: validarCnpj(documento) };
    }

    return { tipo: "desconhecido", valido: false };
}

// ============================================================
// VALIDAÇÃO DE STATUS
// ============================================================

/**
 * Valida se um status em português é válido e retorna o valor da API
 * @param statusPortugues - Nome do status em português
 * @returns Valor do status para a API, ou null se inválido
 */
export function validarEObterStatus(statusPortugues: string): string | null {
    return STATUS_PORTUGUES[statusPortugues] || null;
}

/**
 * Retorna lista de status válidos em português
 */
export function listarStatusValidos(): string[] {
    return Object.keys(STATUS_PORTUGUES);
}

// ============================================================
// VALIDAÇÃO DE URGÊNCIA
// ============================================================

/**
 * Valida se uma urgência em português é válida e retorna o valor da API
 * @param urgenciaPortugues - Nome da urgência em português
 * @returns Valor da urgência para a API, ou null se inválido
 */
export function validarEObterUrgencia(urgenciaPortugues: string): string | null {
    return URGENCIA_PORTUGUES[urgenciaPortugues] || null;
}

// ============================================================
// VALIDAÇÃO DE CAMPOS OBRIGATÓRIOS
// ============================================================

/**
 * Valida se todos os campos obrigatórios foram preenchidos
 * @param campos - Objeto com os campos a serem validados
 * @param camposObrigatorios - Lista de nomes de campos que são obrigatórios
 * @returns Objeto com resultado da validação e lista de campos faltantes
 */
export function validarCamposObrigatorios(
    campos: Record<string, unknown>,
    camposObrigatorios: string[]
): { valido: boolean; camposFaltantes: string[] } {
    const camposFaltantes: string[] = [];

    for (const campo of camposObrigatorios) {
        const valor = campos[campo];

        // Verificar se o campo existe e não está vazio
        if (valor === undefined || valor === null || valor === "") {
            camposFaltantes.push(campo);
        }

        // Verificar se string não é apenas espaços em branco
        if (typeof valor === "string" && valor.trim() === "") {
            if (!camposFaltantes.includes(campo)) {
                camposFaltantes.push(campo);
            }
        }
    }

    return {
        valido: camposFaltantes.length === 0,
        camposFaltantes,
    };
}

/**
 * Remove caracteres especiais de um documento (CPF/CNPJ)
 * Mantém apenas os dígitos numéricos
 * @param documento - Documento formatado
 * @returns Documento com apenas números
 */
export function limparDocumento(documento: string): string {
    return documento.replace(/\D/g, "");
}
