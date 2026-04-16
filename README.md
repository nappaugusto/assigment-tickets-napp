# Atribuição de Tickets

Sistema de atribuição e acompanhamento de tickets integrado com a API do Movidesk. Permite visualizar, filtrar e atribuir tickets em tempo real através de uma interface moderna com tema escuro.

## Visão geral

```
/
├── backend/   # API REST — NestJS + TypeScript + SQLite
└── frontend/  # SPA — React + Vite + TypeScript + shadcn/ui
```

## Stack

| Camada    | Tecnologia                                              |
|-----------|--------------------------------------------------------|
| Backend   | NestJS 11, Passport (sessão), better-sqlite3, bcrypt   |
| Frontend  | React 19, Vite 8, TypeScript, Tailwind CSS v4, shadcn  |
| Banco     | SQLite (WAL mode)                                      |
| Auth      | Sessão por cookie (express-session)                    |
| Pacotes   | pnpm                                                   |

## Pré-requisitos

- Node.js ≥ 20
- pnpm ≥ 9

## Configuração

1. Copie o arquivo de exemplo e preencha as variáveis:

```bash
cp .env.example .env
```

Variáveis obrigatórias:

| Variável                  | Descrição                                  |
|---------------------------|--------------------------------------------|
| `SESSION_SECRET`          | Segredo para assinar cookies de sessão     |
| `MOVIDESK_API_TOKEN`      | Token da API pública do Movidesk           |
| `MOVIDESK_API_QUERY_PARAMS` | Query de busca de tickets (com filtro de equipe) |
| `ASSIGNMENT_TEAM_NAMES`   | Nomes das equipes para o seletor de atribuição |
| `MAIL_SERVER`             | Servidor SMTP para recuperação de senha    |
| `MAIL_USERNAME`           | Usuário SMTP                               |
| `MAIL_PASSWORD`           | Senha SMTP                                 |

## Instalação

```bash
# Backend
cd backend
pnpm install

# Frontend
cd ../frontend
pnpm install
```

## Desenvolvimento

Abra dois terminais:

```bash
# Terminal 1 — Backend (porta 3001)
cd backend
pnpm run start:dev

# Terminal 2 — Frontend (porta 5173)
cd frontend
pnpm run dev
```

Acesse: http://localhost:5173

> O Vite faz proxy automático de `/auth`, `/tickets`, `/atribuir`, `/desatribuir` e `/app-version` para o backend na porta 3001.

## Build de produção

```bash
# Backend
cd backend
pnpm run build
node dist/main.js

# Frontend
cd frontend
pnpm run build
# Servir frontend/dist/ com qualquer servidor estático (nginx, serve, etc.)
```

## Funcionalidades

- **Autenticação** — login, registro, recuperação de senha por e-mail
- **Dashboard** — visualização em tabela ou kanban
- **Filtros** — busca por texto, data SLA, agente, filtros rápidos por status
- **Atribuição** — atribuir para si mesmo ou para qualquer agente da equipe
- **SLA** — indicadores coloridos de prazo (expirado / vence hoje / normal / pausado)
- **Sincronização** — polling automático a cada 30s + botão de sync manual integrado com a API do Movidesk
- **Versão** — detecção automática de nova versão com recarga da página

## Estrutura do backend

```
backend/src/
├── auth/              # Autenticação (Passport local + sessão)
├── database/          # Módulo SQLite + inicialização do schema
├── email/             # Envio de e-mails via SMTP
├── password-reset/    # Fluxo de recuperação de senha
├── people/            # Busca de agentes via API Movidesk
├── sync/              # Sincronização de tickets com Movidesk
├── tickets/           # CRUD de tickets + atribuição
└── users/             # Gerenciamento de usuários
```

## Estrutura do frontend

```
frontend/src/
├── components/        # Componentes reutilizáveis (header, toolbar, tabela, kanban…)
│   └── ui/            # Componentes shadcn/ui
├── contexts/          # AuthContext (useQuery + useMutation)
├── hooks/             # use-tickets, use-ticket-filters, use-ticket-actions, use-app-version
├── lib/               # axios (api.ts), utilitários de data, query-client
└── pages/             # login, register, forgot-password, reset-password, dashboard
```

## Endpoints da API

| Método | Rota                              | Descrição                        |
|--------|-----------------------------------|----------------------------------|
| GET    | `/auth/me`                        | Usuário autenticado              |
| POST   | `/auth/login`                     | Login                            |
| POST   | `/auth/register`                  | Registro                         |
| POST   | `/auth/logout`                    | Logout                           |
| POST   | `/auth/forgot-password`           | Solicitar reset de senha         |
| GET    | `/auth/reset-password/:token`     | Validar token de reset           |
| POST   | `/auth/reset-password/:token`     | Redefinir senha                  |
| GET    | `/tickets/refresh`                | Listar tickets (sync automático) |
| GET    | `/tickets/refresh?manual=1`       | Forçar sincronização             |
| POST   | `/atribuir/:id`                   | Atribuir ticket                  |
| POST   | `/desatribuir/:id`                | Desatribuir ticket               |
| GET    | `/app-version`                    | Versão da aplicação              |

## Licença

Veja [LICENSE](LICENSE).
