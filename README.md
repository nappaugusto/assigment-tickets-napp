# Atribuição de Tickets

Sistema de atribuição e acompanhamento de tickets integrado com a API do Movidesk. Visualize, filtre e atribua tickets em tempo real com interface dark mode moderna.

## Visão geral

```
/
├── backend/          # API REST — NestJS + TypeScript + SQLite
├── frontend/         # SPA — React + Vite + TypeScript + shadcn/ui
├── Dockerfile        # Build multi-stage (frontend + backend + nginx)
├── docker-compose.yml
├── nginx.conf        # Proxy reverso + serve SPA
└── Makefile          # Atalhos para todos os fluxos
```

## Stack

| Camada    | Tecnologia                                             |
|-----------|--------------------------------------------------------|
| Backend   | NestJS 11, Passport (sessão), better-sqlite3, bcrypt   |
| Frontend  | React 19, Vite 8, TypeScript, Tailwind CSS v4, shadcn  |
| Banco     | SQLite (WAL mode, persistido em volume no Docker)      |
| Auth      | Sessão por cookie (express-session)                    |
| Infra     | Docker, nginx, docker-compose                          |
| Pacotes   | pnpm                                                   |

## Pré-requisitos

- Node.js ≥ 20
- pnpm ≥ 9
- Docker (opcional, para produção)

## Configuração

Copie o arquivo de exemplo e preencha as variáveis:

```bash
cp .env.example .env
```

Variáveis obrigatórias:

| Variável                    | Descrição                                            |
|-----------------------------|------------------------------------------------------|
| `SESSION_SECRET`            | Segredo para assinar cookies de sessão               |
| `DATABASE_PATH`             | Caminho do SQLite; em produção use diretório persistente |
| `PERSISTENT_DATA_DIR`       | Diretório persistente opcional; ex.: `/data` em volumes |
| `MOVIDESK_API_TOKEN`        | Token da API pública do Movidesk                     |
| `MOVIDESK_API_QUERY_PARAMS` | Query de busca de tickets, incluindo campos de SLA e fechamento |
| `MOVIDESK_DEBUG_DATE_FIELDS` | Quando `true`, loga amostras do payload bruto de datas retornado pela API |
| `MOVIDESK_DEBUG_DATE_FIELDS_SAMPLE_SIZE` | Quantidade de tickets amostrados nos logs de diagnóstico |
| `ASSIGNMENT_TEAM_NAMES`     | Nomes das equipes para o seletor de atribuição       |
| `MAIL_SERVER`               | Servidor SMTP para recuperação de senha              |
| `MAIL_USERNAME`             | Usuário SMTP                                         |
| `MAIL_PASSWORD`             | Senha SMTP                                           |
| `VITE_MOVIDESK_BASE_URL`    | URL base da instância do Movidesk para abrir tickets |

### MCP Movidesk

Este projeto também pode chamar o servidor MCP Movidesk listado no LobeHub:
https://lobehub.com/mcp/raylann-lopes-mcp-movidesk

Configure o servidor MCP como um processo local via stdio:

```bash
git clone <url-do-repositorio-indicado-no-lobehub> MCP_MOVIDESK
cd MCP_MOVIDESK
npm install
npm run build
```

Depois ajuste o `.env` deste app:

```bash
MOVIDESK_MCP_COMMAND=node
MOVIDESK_MCP_ARGS=/caminho/absoluto/para/MCP_MOVIDESK/dist/index.js
MOVIDESK_TOKEN=seu-token-movidesk
```

Se `MOVIDESK_TOKEN` ficar vazio, o backend reutiliza `MOVIDESK_API_TOKEN`.

---

## Fluxos com Makefile

> Execute `make` ou `make help` para ver todos os targets disponíveis.

### Primeira vez (clone novo)

```bash
make first-run
```

Instala dependências do backend e frontend, e cria `.env` a partir de `.env.example`. Após isso, edite o `.env` com suas credenciais.

### Desenvolvimento local

```bash
make dev
```

Sobe backend (porta 3001) e frontend (porta 5173) em paralelo no mesmo terminal. Use `Ctrl+C` para parar os dois.

Ou separadamente:

```bash
make dev-backend   # apenas NestJS em modo watch
make dev-frontend  # apenas Vite
```

Acesse: http://localhost:5173

> O Vite faz proxy automático de `/auth`, `/tickets`, `/atribuir`, `/desatribuir` e `/app-version` para o backend na porta 3001.

### Build de produção (sem Docker)

```bash
make build   # compila backend + frontend
make start   # build + inicia NestJS em produção
```

### Docker

```bash
# Build da imagem
make docker-build

# Rodar o container na porta 80 (lê variáveis do .env)
make docker-run

# Ou via docker compose
make docker-up    # sobe
make docker-down  # para e remove
```

A imagem Docker inclui nginx na porta 8080 servindo o frontend e fazendo proxy das rotas de API para o NestJS interno.
No fluxo Docker, o banco é salvo em `./data/tickets.db` no host e montado como volume persistente dentro do container.

Em plataformas de deploy com volume, a recomendação é montar o volume em `/data` e usar:

```bash
DATABASE_PATH=/data/tickets.db
```

Ou, se preferir deixar o nome do arquivo a cargo da aplicação:

```bash
PERSISTENT_DATA_DIR=/data
```

### Outros targets

```bash
make lint        # ESLint em backend e frontend
make typecheck   # tsc --noEmit em ambos
make clean       # remove backend/dist e frontend/dist
make clean-all   # clean + node_modules
```

---

## Docker — detalhes

O `Dockerfile` usa **3 stages** (`node:20-alpine`):

1. **`frontend-builder`** — `pnpm build` do Vite → gera `frontend/dist/`
2. **`backend-builder`** — `nest build` → gera `backend/dist/`
3. **`production`** — instala apenas deps de produção, copia os artefatos, adiciona nginx

O `docker-start.sh` orquestra a inicialização dentro do container:
- Inicia o NestJS em background
- Aguarda a readiness (`/app-version`) por até 15s
- Sobe o nginx em foreground (mantém o container vivo)

O `nginx.conf` faz:
- Proxy das rotas de API para `localhost:3001`
- Serve o frontend como SPA (`try_files ... /index.html`)
- Gzip habilitado
- Cache de 1 ano para assets estáticos (JS/CSS/fontes)

O `docker-compose.yml` monta o volume `./data` para persistir o banco SQLite fora do container.
O target `make docker-run` também cria e monta `./data`, evitando perda do banco mesmo sem `docker compose`.

Como usuários, sessões e notas ficam no mesmo arquivo SQLite, persistir `tickets.db` também preserva login e dados locais entre deploys.

---

## Funcionalidades

- **Autenticação** — login, registro, recuperação de senha por e-mail
- **Dashboard** — visualização em tabela ou kanban
- **Filtros** — busca por texto, data SLA, agente, filtros rápidos por status
- **Atribuição** — atribuir para si mesmo ou para qualquer agente da equipe
- **SLA** — indicadores coloridos de prazo (expirado / vence hoje / normal / pausado)
- **Sincronização** — polling automático a cada 30s + botão de sync manual
- **Versão** — detecção automática de nova versão com recarga da página

---

## Estrutura do backend

```
backend/src/
├── auth/              # Autenticação (Passport local + sessão)
├── database/          # Módulo SQLite + inicialização do schema
├── email/             # Envio de e-mails via SMTP
├── password-reset/    # Fluxo de recuperação de senha
├── people/            # Busca de agentes via API Movidesk
├── mcp/               # Cliente MCP Movidesk via stdio
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

---

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
| GET    | `/mcp/movidesk/status`            | Status da integração MCP         |
| GET    | `/mcp/movidesk/tools`             | Listar ferramentas MCP           |
| POST   | `/mcp/movidesk/tools/:name/call`  | Executar ferramenta MCP          |
| GET    | `/app-version`                    | Versão da aplicação              |

---

## Licença

Veja [LICENSE](LICENSE).
