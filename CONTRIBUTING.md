# Contribuição

Este documento descreve o ambiente de desenvolvimento, o padrão de código e o fluxo de
alterações do projeto.

## Requisitos

- Node.js 22.13 ou superior (recomendado 24).
- Git.
- Nenhum banco externo: o sistema usa SQLite em `data/imobiliaria.db`.

## Ambiente local

```bash
npm ci
npm start
```

A aplicação sobe em `http://127.0.0.1:3000`. Na primeira execução, o administrador é criado com
uma senha aleatória exibida no terminal. Para definir a senha inicial, use `ADMIN_SENHA` antes do
primeiro start.

Para desenvolver sem afetar a base local, use um diretório de dados temporário:

```bash
DATA_DIR=.tmp-dev npm run dev
```

## Testes

```bash
npm test
npm audit
```

Os testes usam bancos temporários e cobrem API, regras de negócio, interface e carga inicial.
Antes de abrir uma alteração:

1. execute `npm test`;
2. execute `npm audit`;
3. confirme que nenhum arquivo de `data/`, `.env` ou credencial foi incluído no commit.

## Estrutura

```text
src/            backend HTTP, regras, banco, relatórios e integrações
public/         SPA em JavaScript puro, estilos e gráficos SVG
tests/          testes automatizados
docs/           arquitetura, funcionalidades, segurança e roadmap
deploy/         systemd, Caddy, backup e guia de publicação
```

## Padrões do projeto

- Valores monetários são armazenados em centavos (`INTEGER`).
- Percentuais são `REAL`; datas usam `YYYY-MM-DD`; competências usam `YYYY-MM`.
- Toda escrita relevante deve gerar registro em `auditoria`.
- Autorizações são verificadas no servidor com `exigir(user, acao)`.
- Consultas SQL usam parâmetros (`?`), nunca interpolação de entrada do usuário.
- Dados exibidos no frontend são escapados antes de entrar em HTML.
- Novas regras de negócio devem ter teste em `tests/`.

## Fluxo de branches

- `main` contém a versão estável.
- `feat/nome-curto` para funcionalidade.
- `fix/nome-curto` para correção.
- `docs/nome-curto` para documentação.
- `chore/nome-curto` para manutenção.

Abra um pull request para `main`. O workflow de CI executa `npm ci` e `npm test`.

## Commits

Use mensagens objetivas no padrão Conventional Commits:

```text
feat: geração de cobranças em lote
fix: cálculo de juros em baixa parcial
docs: atualiza arquitetura
refactor: extrai regra de precedência
test: cobre conciliação CSV
chore: atualiza dependências
```

Um commit deve conter uma alteração coerente. Evite misturar refatoração ampla com correção
funcional.

## Checklist do pull request

- [ ] `npm test` passa.
- [ ] `npm audit` não apresenta vulnerabilidades conhecidas.
- [ ] A alteração tem teste quando muda regra de negócio.
- [ ] Permissões e auditoria foram verificadas no servidor.
- [ ] Documentação foi atualizada quando o comportamento mudou.
- [ ] Nenhum dado real, segredo ou arquivo de `data/` foi incluído.

## Banco de dados

O esquema fica em `src/db.js`. Alterações de estrutura devem ser compatíveis com bancos existentes
e usar o padrão de migração já presente (`garantirColuna`). Preserve os dados durante a atualização.

## Segurança

Não inclua credenciais, tokens, chaves ou dados pessoais em commits, issues ou pull requests.
Para reportar uma vulnerabilidade, siga as orientações de [SECURITY.md](SECURITY.md).
