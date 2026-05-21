# Backend

API NestJS do sistema de atribuicao de tickets.

## Seguranca

- Segredos devem ficar somente em variaveis de ambiente do backend.
- Nunca crie variaveis `VITE_*` para tokens, senhas ou chaves privadas.
- Em producao, defina `SESSION_SECRET` com um valor forte.
- Execute `make security-scan` antes de commitar ou enviar para o Bitbucket.
