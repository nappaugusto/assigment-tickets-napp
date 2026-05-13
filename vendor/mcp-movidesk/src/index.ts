/**
 * index.ts — Ponto de entrada do servidor MCP Movidesk
 * 
 * Este é o arquivo principal que inicia o servidor MCP.
 * Ele carrega as variáveis de ambiente, valida o token do Movidesk
 * e conecta o servidor via transporte stdio (padrão do MCP).
 * 
 * Para executar:
 *   npm run dev      (desenvolvimento com tsx)
 *   npm run build    (compilar TypeScript)
 *   npm start        (executar versão compilada)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { criarServidorMcp } from "./servidor-mcp.js";

// ============================================================
// CARREGAR VARIÁVEIS DE AMBIENTE
// ============================================================

// Carregar o arquivo .env (se existir) para obter o token do Movidesk
dotenv.config();

// ============================================================
// VALIDAR TOKEN DO MOVIDESK
// ============================================================

// Obter o token da variável de ambiente
const tokenMovideskEnv = process.env.MOVIDESK_TOKEN;

// Verificar se o token foi configurado
if (!tokenMovideskEnv || tokenMovideskEnv === "seu_token_aqui") {
    console.error("═══════════════════════════════════════════════════════════");
    console.error("❌ ERRO: Token da API do Movidesk não configurado!");
    console.error("");
    console.error("Para configurar:");
    console.error("  1. Copie o arquivo .env.example para .env");
    console.error("  2. Substitua 'seu_token_aqui' pelo seu token real");
    console.error("");
    console.error("O token pode ser obtido em:");
    console.error("  Movidesk > Configuração > Conta > Parâmetros > Aba Ambiente");
    console.error("═══════════════════════════════════════════════════════════");
    process.exit(1);
}

// ============================================================
// INICIAR O SERVIDOR MCP
// ============================================================

async function iniciarServidor(): Promise<void> {
    try {
        // Criar o servidor MCP com todas as ferramentas registradas
        const servidor = criarServidorMcp(tokenMovideskEnv!);

        // Criar o transporte stdio (comunicação via stdin/stdout)
        const transporte = new StdioServerTransport();

        // Conectar o servidor ao transporte
        await servidor.connect(transporte);

        // Log de sucesso (vai para stderr pois stdout é usado pelo MCP)
        console.error("═══════════════════════════════════════════════════════════");
        console.error("✅ Servidor MCP Movidesk iniciado com sucesso!");
        console.error("");
        console.error("📋 Ferramentas disponíveis:");
        console.error("   1. criar_ticket          — Criar novo ticket com macro de suporte");
        console.error("   2. consultar_ticket       — Buscar ticket por ID");
        console.error("   3. buscar_conhecimento    — Pesquisar base de conhecimento");
        console.error("   4. adicionar_interacao    — Adicionar interação em ticket");
        console.error("   5. listar_tickets_cliente — Listar tickets de um cliente");
        console.error("   6. alterar_status_ticket  — Alterar status de ticket");
        console.error("   7. atribuir_agente        — Atribuir ticket a agente/equipe");
        console.error("═══════════════════════════════════════════════════════════");
    } catch (erro) {
        console.error("❌ Erro fatal ao iniciar o servidor MCP:", erro);
        process.exit(1);
    }
}

// Executar o servidor
iniciarServidor();
