import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { criarServidorMcp } from "./servidor-mcp.js";

// ─── Validação de variáveis de ambiente ──────────────────────────────────────

function validateEnvironment(): void {
    if (!process.env.MOVIDESK_TOKEN) {
        console.error(
            "❌ ERRO FATAL: A variável de ambiente MOVIDESK_TOKEN não está definida."
        );
        console.error(
            '   Configure-a antes de iniciar o servidor:'
        );
        console.error(
            '   export MOVIDESK_TOKEN="seu-token-aqui"'
        );
        process.exit(1);
    }
    console.error("✅ MOVIDESK_TOKEN configurado.");
}

// ─── Inicialização do servidor HTTP ──────────────────────────────────────────

async function main(): Promise<void> {
    validateEnvironment();

    const PORT = parseInt(process.env.MCP_PORT || "3000", 10);

    // Express app pré-configurado para MCP (aceita 0.0.0.0 para Docker)
    const app = createMcpExpressApp({ host: "0.0.0.0" });

    // Mapa de transportes por session ID
    const transports: Record<string, any> = {};

    // =========================================================================
    // NOVO PROTOCOLO (Streamable HTTP)
    // =========================================================================
    
    app.post("/mcp", async (req: Request, res: Response) => {
        try {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                const existingTransport = transports[sessionId];
                if (existingTransport instanceof StreamableHTTPServerTransport) {
                    transport = existingTransport;
                } else {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: { code: -32000, message: "Transport mismatch" },
                        id: null,
                    });
                    return;
                }
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // Nova inicialização
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sid: string) => {
                        transports[sid] = transport;
                    },
                });

                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && transports[sid]) {
                        delete transports[sid];
                    }
                };

                const server = criarServidorMcp(process.env.MOVIDESK_TOKEN!);
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
                return;
            } else {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad Request" },
                    id: null,
                });
                return;
            }

            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error("❌ Erro no POST /mcp:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        }
    });

    app.get("/mcp", async (req: Request, res: Response) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }
        await transports[sessionId].handleRequest(req, res);
    });

    app.delete("/mcp", async (req: Request, res: Response) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }
        try {
            await transports[sessionId].handleRequest(req, res);
        } catch (error) {
            if (!res.headersSent) res.status(500).send("Erro ao encerrar sessão");
        }
    });

    // =========================================================================
    // PROTOCOLO LEGADO (HTTP + SSE), usado pelo AnythingLLM 
    // =========================================================================

    app.get("/sse", async (req: Request, res: Response) => {
        console.log("Recebido request GET em /sse (AnythingLLM)");
        const transport = new SSEServerTransport("/messages", res);
        transports[transport.sessionId] = transport;
        
        res.on("close", () => {
             delete transports[transport.sessionId];
        });

        const server = criarServidorMcp(process.env.MOVIDESK_TOKEN!);
        await server.connect(transport);
    });

    app.post("/messages", async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
            res.status(400).send("Missing sessionId parameter");
            return;
        }

        const existingTransport = transports[sessionId];
        if (existingTransport instanceof SSEServerTransport) {
            await existingTransport.handlePostMessage(req, res, req.body);
        } else {
            res.status(400).send("Session not found or wrong transport");
        }
    });

    // ── Health check ─────────────────────────────────────────────────────────
    app.get("/health", (_req: Request, res: Response) => {
        res.json({ status: "ok", server: "movidesk-mcp", version: "1.0.0" });
    });

    // ── Start ────────────────────────────────────────────────────────────────
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Servidor MCP Movidesk (HTTP) rodando em http://0.0.0.0:${PORT}`);
        console.log(`👉 Endpoint novo (Streamable HTTP): /mcp`);
        console.log(`👉 Endpoint legado (SSE AnythingLLM): /sse`);
    });

    // ── Graceful shutdown ────────────────────────────────────────────────────
    process.on("SIGINT", async () => {
        console.log("Encerrando servidor...");
        for (const sid in transports) {
             try {
                 await transports[sid].close();
                 delete transports[sid];
             } catch { /* ignore */ }
        }
        process.exit(0);
    });
}

main().catch((error) => {
    console.error("❌ Erro fatal ao iniciar o servidor HTTP MCP:", error);
    process.exit(1);
});
