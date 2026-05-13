/**
 * tipos.ts — Definições de tipos TypeScript para objetos da API do Movidesk
 * 
 * Este arquivo contém todas as interfaces e enums que representam
 * a estrutura de dados do Movidesk (tickets, pessoas, ações, etc.)
 */

// ============================================================
// ENUMS — Valores padronizados do Movidesk
// ============================================================

/** Status possíveis de um ticket no Movidesk */
export enum StatusTicket {
    NOVO = "Novo",
    EM_ATENDIMENTO = "Em atendimento",
    PARADO = "Parado",
    CANCELADO = "Cancelado",
    RESOLVIDO = "Resolvido",
    FECHADO = "Fechado",
}

/** Mapeamento de nomes em português para valores da API */
export const STATUS_PORTUGUES: Record<string, string> = {
    "Novo": "Novo",
    "Em atendimento": "Em atendimento",
    "Parado": "Parado",
    "Cancelado": "Cancelado",
    "Resolvido": "Resolvido",
    "Fechado": "Fechado",
};

/** Mapeamento reverso: da API para português */
export const STATUS_PARA_PORTUGUES: Record<string, string> = {
    "Novo": "Novo",
    "Em atendimento": "Em atendimento",
    "Parado": "Parado",
    "Cancelado": "Cancelado",
    "Resolvido": "Resolvido",
    "Fechado": "Fechado",
};

/** Níveis de urgência de um ticket */
export enum UrgenciaTicket {
    BAIXA = "Baixa",
    MEDIA = "Média",
    ALTA = "Alta",
    URGENTE = "Urgente",
}

/** Mapeamento de urgência em português para valores da API */
export const URGENCIA_PORTUGUES: Record<string, string> = {
    "Baixa": "Baixa",
    "Média": "Média",
    "Alta": "Alta",
    "Urgente": "Urgente",
};

/** Tipos de ticket */
export enum TipoTicket {
    INTERNO = 1,
    PUBLICO = 2,
}

// ============================================================
// INTERFACES — Objetos da API do Movidesk
// ============================================================

/** Representa uma pessoa (cliente ou agente) no Movidesk */
export interface PessoaMovidesk {
    id: string;
    businessName: string;        // Razão social ou nome
    email: string;
    phone: string;
    personType: number;          // 1 = Pessoa, 2 = Empresa
    profileType: number;         // 1 = Agente, 2 = Cliente
    isDeleted: boolean;
    corporateName?: string;      // Nome fantasia
    cpfCnpj?: string;           // CPF ou CNPJ
}

/** Representa um campo personalizado dentro de um ticket */
export interface CampoPersonalizado {
    customFieldId: number;
    customFieldRuleId: number;
    line: number;
    value: string | number | boolean | null;
    items?: CampoPersonalizado[];
}

/** Representa uma ação (interação) dentro de um ticket */
export interface AcaoTicket {
    id: number;
    type: number;                // 1 = Interno, 2 = Público
    origin: number;              // Origem: 1 = E-mail, 2 = Portal, 9 = API
    description: string;         // Conteúdo HTML da ação
    htmlDescription?: string;    // Conteúdo HTML renderizado
    status: string;              // Status no momento da ação
    justification?: string;      // Justificativa
    createdDate: string;         // Data de criação (ISO 8601)
    createdBy: {
        id: string;
        businessName: string;
        email: string;
        profileType: number;
    };
    isDeleted: boolean;
    tags?: string[];
}

/** Representa um ticket completo do Movidesk */
export interface TicketMovidesk {
    id: number;
    type: number;                    // 1 = Interno, 2 = Público
    subject: string;                 // Assunto do ticket
    category: string;                // Categoria
    urgency: string;                 // Urgência (Low, Medium, High, Urgent)
    status: string;                  // Status atual
    baseStatus: string;              // Status base
    justification?: string;         // Justificativa
    origin: number;                  // Origem do ticket
    createdDate: string;             // Data de criação
    lastUpdate: string;              // Última atualização
    actionCount: number;             // Número de ações
    lastActionDate?: string;         // Data da última ação
    resolvedIn?: string;             // Data de resolução
    closedIn?: string;               // Data de fechamento
    serviceFirstLevel?: string;      // Tipo de serviço (nível 1)
    serviceSecondLevel?: string;     // Tipo de serviço (nível 2)
    serviceThirdLevel?: string;      // Tipo de serviço (nível 3)
    serviceFull?: string[];          // Tipo de serviço completo (array)
    slaSolutionDate?: string;        // Data SLA de solução
    owner?: PessoaMovidesk;         // Responsável (agente)
    ownerTeam?: string;             // Equipe responsável
    createdBy?: PessoaMovidesk;     // Criador do ticket
    clients?: ClienteTicket[];       // Clientes vinculados ao ticket
    actions?: AcaoTicket[];          // Lista de ações/interações
    tags?: string[];                 // Tags do ticket
    customFieldValues?: CampoPersonalizado[]; // Campos personalizados
}

/** Representação do cliente dentro de um ticket */
export interface ClienteTicket {
    id: string;
    businessName: string;
    email: string;
    phone?: string;
    personType: number;
    profileType: number;
    isDeleted: boolean;
    organization?: {
        id: string;
        businessName: string;
    };
}

// ============================================================
// TIPOS DE REQUISIÇÃO — Payloads para criação/atualização
// ============================================================

/** Dados necessários para criar um novo ticket */
export interface DadosCriarTicket {
    assunto: string;               // Título do ticket
    descricao: string;             // Descrição/corpo do ticket (será convertido para HTML)
    emailCliente: string;          // Email ou ID do cliente
    urgencia?: string;             // Urgência (padrão: Baixa)
    categoria?: string;            // Categoria do ticket
    tipoServico?: string;          // Tipo de serviço
    tags?: string[];               // Tags opcionais
}

/** Dados necessários para adicionar uma interação */
export interface DadosInteracao {
    ticketId: number;              // ID do ticket
    conteudo: string;              // Conteúdo da interação (será convertido para HTML)
    publico?: boolean;             // Se a interação é pública (padrão: true)
}

/** Dados para alterar o status de um ticket */
export interface DadosAlterarStatus {
    ticketId: number;
    novoStatus: string;            // Nome do status em português
    justificativa?: string;
}

/** Dados para atribuir um ticket a um agente */
export interface DadosAtribuirAgente {
    ticketId: number;
    agenteId: string;              // ID ou email do agente
    nomeAgente?: string;           // Nome do agente (para referência)
}

// ============================================================
// TIPOS DE RESPOSTA — Respostas formatadas das ferramentas
// ============================================================

/** Resposta padrão de uma ferramenta do MCP */
export interface RespostaFerramenta {
    sucesso: boolean;
    mensagem: string;
    dados?: Record<string, unknown>;
}

/** Erro padronizado da API Movidesk */
export interface ErroMovidesk {
    codigo: number;
    mensagem: string;
    detalhes?: string;
}
