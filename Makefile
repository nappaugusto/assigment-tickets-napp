.DEFAULT_GOAL := help

# ─── Cores ────────────────────────────────────────────────────────────────────
RESET  := \033[0m
BOLD   := \033[1m
GREEN  := \033[32m
YELLOW := \033[33m
CYAN   := \033[36m

# ─── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Exibe esta mensagem
	@echo ""
	@echo "$(BOLD)Atribuição de Tickets$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ─── Primeira vez ─────────────────────────────────────────────────────────────
.PHONY: first-run
first-run: ## [INÍCIO] Clona dependências e configura .env
	@echo "$(YELLOW)→ Instalando dependências do backend...$(RESET)"
	cd backend && pnpm install
	@echo "$(YELLOW)→ Instalando dependências do frontend...$(RESET)"
	cd frontend && pnpm install
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
dev: ## Sobe backend (porta 3001) e frontend (porta 5173) em paralelo
	@echo "$(GREEN)→ Subindo backend e frontend...$(RESET)"
	@echo "   Backend : http://localhost:3001"
	@echo "   Frontend: http://localhost:5173"
	@echo "   Use Ctrl+C para parar ambos."
	@echo ""
	@trap 'kill %1 %2 2>/dev/null; exit' INT TERM; \
	  (cd backend && pnpm run start:dev 2>&1 | sed "s/^/$(BOLD)[backend]$(RESET) /") & \
	  (cd frontend && pnpm run dev 2>&1 | sed "s/^/$(BOLD)[frontend]$(RESET) /") & \
	  wait

.PHONY: dev-backend
dev-backend: ## Sobe apenas o backend em modo watch
	cd backend && pnpm run start:dev

.PHONY: dev-frontend
dev-frontend: ## Sobe apenas o frontend
	cd frontend && pnpm run dev

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
	cd frontend && pnpm run build

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
docker-run: ## Roda o container de produção na porta 80
	docker run --rm -p 80:80 --env-file .env assigment-tickets-napp

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

# ─── Limpeza ──────────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove artefatos de build
	rm -rf backend/dist frontend/dist

.PHONY: clean-all
clean-all: clean ## Remove build + node_modules
	rm -rf backend/node_modules frontend/node_modules
