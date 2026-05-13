/**
 * api.ts — Cliente HTTP para a API do Movidesk
 * 
 * Implementa todas as chamadas à API REST do Movidesk:
 * - Rate-limiting automático (máximo 10 req/min conforme documentação)
 * - Retry com backoff exponencial em caso de erro 429 (Too Many Requests)
 * - Tratamento de erros com mensagens claras em português
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import {
    TicketMovidesk,
    PessoaMovidesk,
    ErroMovidesk,
} from "./tipos.js";

// ============================================================
// CONFIGURAÇÕES PADRÃO
// ============================================================

/** URL base da API do Movidesk (v1) */
const URL_BASE_PADRAO = "https://api.movidesk.com/public/v1";

/** Limite de requisições por minuto imposto pelo Movidesk */
const LIMITE_REQUISICOES_POR_MINUTO = 10;

/** Intervalo mínimo entre requisições (em milissegundos) — 6 segundos */
const INTERVALO_MINIMO_MS = Math.ceil(60000 / LIMITE_REQUISICOES_POR_MINUTO);

/** Número máximo de tentativas em caso de erro */
const MAXIMO_TENTATIVAS = 3;

// ============================================================
// CLASSE PRINCIPAL — ClienteMovidesk
// ============================================================

export class ClienteMovidesk {
    private clienteHttp: AxiosInstance;
    private token: string;

    /** Timestamp da última requisição feita (para rate-limiting) */
    private ultimaRequisicao: number = 0;

    /**
     * Cria uma nova instância do cliente da API Movidesk
     * @param token - Token de autenticação da API
     * @param urlBase - URL base da API (opcional, padrão: https://api.movidesk.com/public/v1)
     */
    constructor(token: string, urlBase?: string) {
        // Validar que o token foi fornecido
        if (!token || token.trim() === "") {
            throw new Error(
                "❌ Token da API do Movidesk não informado. " +
                "Configure a variável de ambiente MOVIDESK_TOKEN."
            );
        }

        this.token = token;

        // Criar instância do axios com configurações padrão
        this.clienteHttp = axios.create({
            baseURL: urlBase || URL_BASE_PADRAO,
            timeout: 30000, // 30 segundos de timeout
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        });
    }

    // ============================================================
    // CONTROLE DE RATE-LIMITING
    // ============================================================

    /**
     * Aguarda o tempo necessário antes de fazer uma nova requisição
     * Garante que respeitamos o limite de 10 req/min do Movidesk
     */
    private async aguardarRateLimit(): Promise<void> {
        const agora = Date.now();
        const tempoDesdeUltimaRequisicao = agora - this.ultimaRequisicao;

        // Se o tempo desde a última requisição é menor que o intervalo mínimo, esperamos
        if (tempoDesdeUltimaRequisicao < INTERVALO_MINIMO_MS) {
            const tempoEspera = INTERVALO_MINIMO_MS - tempoDesdeUltimaRequisicao;
            await new Promise((resolve) => setTimeout(resolve, tempoEspera));
        }

        // Atualizar timestamp da última requisição
        this.ultimaRequisicao = Date.now();
    }

    // ============================================================
    // MÉTODO GENÉRICO DE REQUISIÇÃO COM RETRY
    // ============================================================

    /**
     * Executa uma requisição HTTP com rate-limiting e retry automático
     * @param metodo - Método HTTP (GET, POST, PATCH)
     * @param endpoint - Caminho do endpoint (ex: "/tickets")
     * @param dados - Corpo da requisição (para POST/PATCH)
     * @param parametros - Query parameters adicionais
     * @param tentativa - Número da tentativa atual (uso interno)
     * @returns Dados da resposta da API
     */
    private async executarRequisicao<T>(
        metodo: "GET" | "POST" | "PATCH",
        endpoint: string,
        dados?: Record<string, unknown>,
        parametros?: Record<string, string>,
        tentativa: number = 1
    ): Promise<T> {
        // Respeitar rate-limiting antes de cada requisição
        await this.aguardarRateLimit();

        try {
            // Montar os query parameters incluindo o token de autenticação
            const queryParams = {
                token: this.token,
                ...parametros,
            };

            // Executar a requisição de acordo com o método
            const resposta = await this.clienteHttp.request<T>({
                method: metodo,
                url: endpoint,
                data: dados,
                params: queryParams,
            });

            return resposta.data;
        } catch (erro) {
            // Tratar erro 429 (rate limit excedido) com retry
            if (erro instanceof AxiosError && erro.response?.status === 429) {
                if (tentativa < MAXIMO_TENTATIVAS) {
                    // Backoff exponencial: 6s, 12s, 24s...
                    const tempoEspera = INTERVALO_MINIMO_MS * Math.pow(2, tentativa - 1);
                    console.error(
                        `⚠️ Rate limit atingido. Aguardando ${tempoEspera / 1000}s antes de tentar novamente... ` +
                        `(tentativa ${tentativa}/${MAXIMO_TENTATIVAS})`
                    );
                    await new Promise((resolve) => setTimeout(resolve, tempoEspera));
                    return this.executarRequisicao<T>(metodo, endpoint, dados, parametros, tentativa + 1);
                }
            }

            // Traduzir o erro para uma mensagem amigável em português
            throw this.traduzirErro(erro);
        }
    }

    // ============================================================
    // TRADUÇÃO DE ERROS
    // ============================================================

    /**
     * Converte erros da API em mensagens amigáveis em português
     * @param erro - Erro capturado (AxiosError ou Error genérico)
     * @returns ErroMovidesk com mensagem traduzida
     */
    private traduzirErro(erro: unknown): ErroMovidesk {
        if (erro instanceof AxiosError) {
            const status = erro.response?.status;
            const dadosErro = erro.response?.data;

            switch (status) {
                case 400:
                    return {
                        codigo: 400,
                        mensagem: "❌ Requisição inválida. Verifique os dados enviados.",
                        detalhes: typeof dadosErro === "string" ? dadosErro : JSON.stringify(dadosErro),
                    };
                case 401:
                    return {
                        codigo: 401,
                        mensagem: "❌ Token de autenticação inválido ou expirado. Verifique MOVIDESK_TOKEN.",
                    };
                case 403:
                    return {
                        codigo: 403,
                        mensagem: "❌ Sem permissão para acessar este recurso no Movidesk.",
                    };
                case 404:
                    return {
                        codigo: 404,
                        mensagem: "❌ Recurso não encontrado no Movidesk. Verifique o ID informado.",
                    };
                case 429:
                    return {
                        codigo: 429,
                        mensagem: "❌ Limite de requisições excedido (máximo 10/min). Tente novamente em 1 minuto.",
                    };
                case 500:
                    return {
                        codigo: 500,
                        mensagem: "❌ Erro interno do servidor Movidesk. Tente novamente mais tarde.",
                    };
                default:
                    return {
                        codigo: status || 0,
                        mensagem: `❌ Erro inesperado na API do Movidesk (status ${status}).`,
                        detalhes: erro.message,
                    };
            }
        }

        // Erro genérico (sem resposta HTTP — timeout, rede, etc.)
        return {
            codigo: 0,
            mensagem: "❌ Erro de conexão com o Movidesk. Verifique sua internet e tente novamente.",
            detalhes: erro instanceof Error ? erro.message : String(erro),
        };
    }

    // ============================================================
    // MÉTODOS PÚBLICOS — Tickets
    // ============================================================

    /**
     * Busca um ticket pelo seu ID numérico
     * @param ticketId - ID do ticket no Movidesk
     * @returns Dados completos do ticket
     */
    async buscarTicketPorId(ticketId: number): Promise<TicketMovidesk> {
        return this.executarRequisicao<TicketMovidesk>("GET", "/tickets", undefined, {
            id: String(ticketId),
        });
    }

    /**
     * Cria um novo ticket no Movidesk
     * @param dadosTicket - Objeto com os dados do ticket a ser criado
     * @returns Ticket criado com o ID gerado
     */
    async criarTicket(dadosTicket: Record<string, unknown>): Promise<TicketMovidesk> {
        return this.executarRequisicao<TicketMovidesk>("POST", "/tickets", dadosTicket);
    }

    /**
     * Atualiza um ticket existente (PATCH)
     * Usado para adicionar interações, mudar status, atribuir agente, etc.
     * @param ticketId - ID do ticket a ser atualizado
     * @param dadosAtualizacao - Dados parciais para atualização
     * @returns Ticket atualizado
     */
    async atualizarTicket(
        ticketId: number,
        dadosAtualizacao: Record<string, unknown>
    ): Promise<TicketMovidesk> {
        // O PATCH do Movidesk requer o ID como query parameter
        return this.executarRequisicao<TicketMovidesk>(
            "PATCH",
            "/tickets",
            dadosAtualizacao,
            { id: String(ticketId) }
        );
    }

    /**
     * Pesquisa tickets usando filtros OData
     * @param filtroOData - Expressão de filtro OData (ex: "status eq 'Resolved'")
     * @param top - Número máximo de resultados (padrão: 10)
     * @param orderBy - Critério de ordenação (padrão: lastUpdate desc)
     * @param select - Campos a retornar (para reduzir tamanho da resposta)
     * @param expand - Campos a expandir (persons, actions, etc.)
     * @returns Lista de tickets que atendem ao filtro
     */
    async pesquisarTickets(
        filtroOData?: string,
        top: number = 10,
        orderBy: string = "lastUpdate desc",
        select?: string,
        expand?: string
    ): Promise<TicketMovidesk[]> {
        const parametros: Record<string, string> = {
            $top: String(top),
            $orderby: orderBy,
        };

        // Adicionar filtro OData se fornecido
        if (filtroOData) {
            parametros["$filter"] = filtroOData;
        }

        // Adicionar seleção de campos se fornecida
        if (select) {
            parametros["$select"] = select;
        }

        // Adicionar expansão de campos se fornecida
        if (expand) {
            parametros["$expand"] = expand;
        }

        return this.executarRequisicao<TicketMovidesk[]>("GET", "/tickets", undefined, parametros);
    }

    // ============================================================
    // MÉTODOS PÚBLICOS — Pessoas
    // ============================================================

    /**
     * Busca uma pessoa (cliente/agente) pelo email
     * @param email - Email da pessoa a buscar
     * @returns Lista de pessoas encontradas
     */
    async buscarPessoaPorEmail(email: string): Promise<PessoaMovidesk[]> {
        return this.executarRequisicao<PessoaMovidesk[]>(
            "GET",
            "/persons",
            undefined,
            {
                $filter: `email eq '${email}'`,
                $top: "5",
            }
        );
    }

    /**
     * Busca pessoas pelo nome (busca parcial)
     * @param nome - Nome ou razão social para buscar
     * @returns Lista de pessoas encontradas
     */
    async buscarPessoaPorNome(nome: string): Promise<PessoaMovidesk[]> {
        return this.executarRequisicao<PessoaMovidesk[]>(
            "GET",
            "/persons",
            undefined,
            {
                $filter: `contains(tolower(businessName), tolower('${nome}'))`,
                $top: "10",
            }
        );
    }

    /**
     * Busca uma pessoa pelo CPF ou CNPJ
     * @param documento - CPF ou CNPJ da pessoa
     * @returns Lista de pessoas encontradas
     */
    async buscarPessoaPorDocumento(documento: string): Promise<PessoaMovidesk[]> {
        // Remover formatação do documento (pontos, traços, barras)
        const documentoLimpo = documento.replace(/[.\-\/]/g, "");

        return this.executarRequisicao<PessoaMovidesk[]>(
            "GET",
            "/persons",
            undefined,
            {
                $filter: `cpfCnpj eq '${documentoLimpo}'`,
                $top: "5",
            }
        );
    }

    /**
     * Busca uma pessoa pelo ID
     * @param pessoaId - ID da pessoa no Movidesk
     * @returns Dados da pessoa
     */
    async buscarPessoaPorId(pessoaId: string): Promise<PessoaMovidesk> {
        return this.executarRequisicao<PessoaMovidesk>(
            "GET",
            "/persons",
            undefined,
            { id: pessoaId }
        );
    }
}
