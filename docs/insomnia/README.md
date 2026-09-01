# Coleção do Insomnia

O arquivo `openapi.yaml` contém todas as rotas HTTP expostas pelos controllers do backend.

## Importação

1. Inicie o backend na porta `3001`.
2. No Insomnia, escolha **Create > Import from File**.
3. Selecione `docs/insomnia/openapi.yaml`.
4. Execute **Auth > Entrar e criar sessão** com um usuário válido.
5. Execute as demais requisições. O cookie `connect.sid` é mantido pelo cookie jar do Insomnia.

O servidor padrão é `http://localhost:3001`. Para outro ambiente, altere a URL base no ambiente criado pelo Insomnia.

Rotas marcadas com `(admin)` exigem que o usuário autenticado seja administrador.

## Importar uma coleção para o projeto

Na tela **Console de APIs**, use o botão **Importar Insomnia** e escolha um export
YAML v5. Pastas, requisições, autenticação, parâmetros, headers, variáveis e bodies
serão salvos para o usuário autenticado. Reimportar o mesmo arquivo atualiza as
requisições existentes sem duplicá-las.
