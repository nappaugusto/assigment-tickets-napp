.DEFAULT_GOAL := help

# ─── Cores ────────────────────────────────────────────────────────────────────
RESET  := \033[0m
BOLD   := \033[1m
GREEN  := \033[32m
YELLOW := \033[33m
CYAN   := \033[36m
NODE    ?= node

# Vite 8 exige Node >= 20.19 (ou >= 22.12). Esta validação evita que os
# processos encerrem antes de abrir as portas locais.
define CHECK_LOCAL_TOOLS
	@command -v $(NODE) >/dev/null 2>&1 || { \
		echo "$(YELLOW)✖ Node.js não encontrado. Instale a versão indicada em .nvmrc.$(RESET)"; \
		exit 1; \
	}
	@$(NODE) -e 'const [M,m]=process.versions.node.split(".").map(Number); if (!((M===20&&m>=19)||(M===22&&m>=12)||M>22)) { console.error("\x1b[33m✖ Node.js "+process.versions.node+" incompatível. Use Node >= 20.19 (recomendado: nvm use).\x1b[0m"); process.exit(1) }'
	@command -v pnpm >/dev/null 2>&1 || { \
		echo "$(YELLOW)✖ pnpm não encontrado. Rode: corepack enable && corepack prepare pnpm@10.29.3 --activate$(RESET)"; \
		exit 1; \
	}
endef

# ─── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Exibe esta mensagem
	@echo ""
	@echo "$(BOLD)Atribuição de Tickets$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ─── Primeira vez ─────────────────────────────────────────────────────────────
.PHONY: check-tools
check-tools: ## Valida Node.js e pnpm para desenvolvimento local
	$(CHECK_LOCAL_TOOLS)

.PHONY: doctor
doctor: check-tools ## Verifica se a máquina está pronta para desenvolvimento local
	@test -f .env || { echo "$(YELLOW)✖ Arquivo .env ausente. Rode: cp .env.example .env$(RESET)"; exit 1; }
	@echo "$(GREEN)✔ Ambiente local pronto (Node $$($(NODE) --version), pnpm $$(pnpm --version)).$(RESET)"

.PHONY: first-run
first-run: check-tools ## [INÍCIO] Instala dependências e configura .env
	@echo "$(YELLOW)→ Instalando dependências do backend...$(RESET)"
	cd backend && pnpm install --frozen-lockfile
	@echo "$(YELLOW)→ Instalando dependências do frontend...$(RESET)"
	cd frontend && pnpm install --frozen-lockfile
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(GREEN)✔ .env criado a partir de .env.example — preencha as variáveis antes de rodar.$(RESET)"; \
	else \
		echo "$(GREEN)✔ .env já existe, pulando.$(RESET)"; \
	fi
	@echo ""
	@echo "$(BOLD)Pronto! Próximo passo:$(RESET)"
	@echo "  1. Edite o arquivo $(CYAN).env$(RESET) com suas credenciais"
	@echo "  2. Execute $(CYAN)make dev$(RESET) para subir o ambiente"
	@echo ""

# ─── Desenvolvimento ──────────────────────────────────────────────────────────
.PHONY: dev
dev: doctor ## Sobe backend (porta 3001) e frontend (porta 5173) em paralelo
	@echo "$(GREEN)→ Subindo backend e frontend...$(RESET)"
	@echo "   Backend : http://localhost:3001"
	@echo "   Frontend: http://localhost:5173"
	@echo "   Use Ctrl+C para parar ambos."
	@echo ""
	@bash -o pipefail -c ' \
	  cleanup() { kill "$$backend_pid" "$$frontend_pid" 2>/dev/null || true; wait "$$backend_pid" "$$frontend_pid" 2>/dev/null || true; }; \
	  trap cleanup EXIT INT TERM; \
	  (cd backend && pnpm run start:dev 2>&1 | sed "s/^/$(BOLD)[backend]$(RESET) /") & backend_pid=$$!; \
	  (cd frontend && pnpm run dev 2>&1 | sed "s/^/$(BOLD)[frontend]$(RESET) /") & frontend_pid=$$!; \
	  wait -n "$$backend_pid" "$$frontend_pid"; status=$$?; \
	  exit "$$status"'

.PHONY: dev-backend
dev-backend: doctor ## Sobe apenas o backend em modo watch
	cd backend && pnpm run start:dev

.PHONY: dev-frontend
dev-frontend: doctor ## Sobe apenas o frontend
	cd frontend && pnpm run dev

.PHONY: open
open: ## Abre no navegador o modo que estiver rodando (Docker ou Vite)
	@url=http://localhost:5173; \
	  if curl -fsS --max-time 2 http://localhost/app-version >/dev/null 2>&1; then url=http://localhost; fi; \
	  echo "$(GREEN)→ Abrindo $$url$(RESET)"; \
	  (xdg-open "$$url" >/dev/null 2>&1 || open "$$url" >/dev/null 2>&1) &

# ─── Build ────────────────────────────────────────────────────────────────────
.PHONY: build
build: build-backend build-frontend ## Build de produção completo (backend + frontend)

.PHONY: build-backend
build-backend: ## Build do NestJS
	@echo "$(YELLOW)→ Compilando backend...$(RESET)"
	cd backend && pnpm run build

.PHONY: build-frontend
build-frontend: ## Build do Vite
	@echo "$(YELLOW)→ Compilando frontend...$(RESET)"
	cd frontend && pnpm exec tsc -b && pnpm exec vite build

# ─── Produção (sem Docker) ────────────────────────────────────────────────────
.PHONY: start
start: build ## Build + inicia servidor de produção NestJS
	@echo "$(GREEN)→ Iniciando backend em produção na porta 3001...$(RESET)"
	cd backend && node dist/main.js

# ─── Docker ───────────────────────────────────────────────────────────────────
.PHONY: docker-build
docker-build: ## Build da imagem Docker de produção
	docker build -t assigment-tickets-napp .

.PHONY: docker-run
docker-run: ## Roda apenas o app na porta 80 (requer DATABASE_URL acessível)
	docker run --rm -p 80:8080 --env-file .env \
	  -v "$${HOME}/.claude:/root/.claude:ro" \
	  -v "$${HOME}/.claude.json:/root/.claude.json:ro" \
	  assigment-tickets-napp

.PHONY: docker-up
docker-up: ## Sobe via docker compose (build + run)
	docker compose up --build

.PHONY: docker-down
docker-down: ## Para e remove containers do docker compose
	docker compose down

# ─── Qualidade ────────────────────────────────────────────────────────────────
.PHONY: lint
lint: ## Lint em backend e frontend
	cd backend && pnpm run lint
	cd frontend && pnpm run lint

.PHONY: typecheck
typecheck: ## Verificação de tipos TypeScript
	cd backend && pnpm exec tsc --noEmit
	cd frontend && pnpm exec tsc --noEmit

.PHONY: security-scan
security-scan: ## Verifica vazamento de tokens/segredos antes do push
	./scripts/security-scan.sh

# ─── Limpeza ──────────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove artefatos de build
	rm -rf backend/dist frontend/dist

.PHONY: clean-all
clean-all: clean ## Remove build + node_modules
	rm -rf backend/node_modules frontend/node_modules
