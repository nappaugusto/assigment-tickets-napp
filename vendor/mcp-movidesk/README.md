# 🎫 MCP Movidesk Server

Servidor MCP (Model Context Protocol) para gerenciamento de tickets do Movidesk, construído em **TypeScript + Node.js**.

Permite que agentes de IA criem, consultem, pesquisem e gerenciem tickets diretamente no Movidesk, sem precisar acessar a plataforma manualmente.

---

## 📋 Ferramentas Disponíveis

| # | Ferramenta | Descrição |
|---|-----------|-----------|
| 1 | `criar_ticket` | Criar novo ticket com macro de suporte (atendimento/escalonamento) |
| 2 | `consultar_ticket` | Buscar detalhes completos de um ticket por ID |
| 3 | `buscar_conhecimento` | Pesquisar tickets resolvidos como base de conhecimento |
| 4 | `adicionar_interacao` | Adicionar comentário/ação em ticket existente |
| 5 | `listar_tickets_cliente` | Listar tickets de um cliente por nome/email/CPF/CNPJ |
| 6 | `alterar_status_ticket` | Mudar status do ticket (Novo, Em atendimento, Resolvido, etc.) |
| 7 | `atribuir_agente` | Atribuir ticket a um agente ou equipe |

---

## 🚀 Instalação

### 1. Instalar dependências

```bash
cd c:\Users\Usuario\Documents\Mcp_Eagle
npm install
```

### 2. Configurar token da API

Copie o arquivo de exemplo e insira seu token:

```bash
copy .env.example .env
```

Edite o arquivo `.env` e substitua `seu_token_aqui` pelo seu token real:

```
MOVIDESK_TOKEN=seu_token_real_aqui
```

> **Onde encontrar o token:** Movidesk > Configuração > Conta > Parâmetros > Aba Ambiente

### 3. Compilar o projeto

```bash
npm run build
```

---

## ⚙️ Configuração no Antigravity

Adicione a seguinte configuração ao seu `settings.json` do Antigravity:

```json
{
  "mcpServers": {
    "mcp-movidesk": {
      "command": "node",
      "args": ["c:\\Users\\Usuario\\Documents\\Mcp_Eagle\\dist\\index.js"],
      "env": {
        "MOVIDESK_TOKEN": "seu_token_aqui"
      }
    }
  }
}
```

---

## 🧪 Testes

Execute todos os testes:

```bash
npm test
```

Modo watch (re-executa ao salvar):

```bash
npm run test:watch
```

---

## � Docker (Swarm & Portainer)

O projeto está configurado para ser implantado facilmente através de Portainer/Docker Swarm com suporte a **Traefik** e HTTPS nativo via pacote *Express*.

### Build da Imagem

Para criar a imagem Docker otimizada:

```bash
docker build -t mcp-movidesk-eagle:latest .
```

### Deploy no Portainer (Stacks)

1. Acesse seu Portainer.
2. Navegue até **Swarm > Stacks** e clique em **Add stack**.
3. Copie o conteúdo do arquivo `docker-compose.yml` e cole no Web Editor.
4. Na seção **Environment variables**, adicione `MOVIDESK_TOKEN` com o seu token real.
5. Clique em **Deploy the stack**.

> A configuração utiliza o **Traefik** como proxy e vai publicar automaticamente em `https://mcp.wizeflowsolutions.com/mcp`.

---

## 🌐 Configuração Remota (via Domínio)

Para utilizar as ferramentas do MCP em clientes modernos ou em nuvem que suportam conexões via **domínio (SSE - Server-Sent Events)** como Dify, Flowise, Cursor ou LangChain, você informará que o tipo de conexão é remota.

O formato `JSON` para essas configurações:

```json
{
  "mcpServers": {
    "mcp-movidesk-cloud": {
      "type": "sse",
      "url": "https://mcp.wizeflowsolutions.com/mcp"
    }
  }
}
```

> **Atenção:** Em aplicativos puramente locais não adaptados para leitura web, utilize o método CLI fornecido na seção de "Configuração no Antigravity".

---

## �📁 Estrutura do Projeto

```
src/
├── index.ts                     # Ponto de entrada (stdio transport)
├── servidor-mcp.ts              # Registra as 7 ferramentas
├── cliente-movidesk/
│   ├── api.ts                   # Cliente HTTP com rate-limiting
│   └── tipos.ts                 # Tipos TypeScript (interfaces/enums)
├── ferramentas/
│   ├── criar-ticket.ts          # Criar ticket com macro
│   ├── consultar-ticket.ts      # Consultar ticket por ID
│   ├── buscar-conhecimento.ts   # Base de conhecimento
│   ├── adicionar-interacao.ts   # Adicionar interação
│   ├── listar-tickets.ts        # Listar tickets do cliente
│   ├── alterar-status.ts        # Alterar status
│   └── atribuir-agente.ts       # Atribuir agente
└── utilidades/
    ├── formatador-html.ts       # Markdown → HTML
    ├── validacoes.ts            # Validações (CPF, CNPJ, email)
    └── macros-suporte.ts        # Templates HTML de macros
testes/
├── formatador-html.test.ts
├── validacoes.test.ts
├── api-cliente.test.ts
└── ferramentas.test.ts
```

---

## 🔧 Desenvolvimento

```bash
# Executar em modo desenvolvimento (com tsx)
npm run dev

# Compilar TypeScript
npm run build

# Executar versão compilada
npm start
```

---

## 📄 Licença

MIT
