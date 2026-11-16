# Publicar no GitHub — guia passo a passo

O projeto já está com `.gitignore`, documentação, changelog e CI prontos. Falta criar o repositório
na sua conta e enviar.

> **Recomendação:** mantenha o repositório **privado**. É um sistema real de uma empresa familiar.
> Para portfólio, use o `docs/ESTUDO-DE-CASO.md`, a arquitetura e capturas de tela, sem dados reais.

## 1. Antes do primeiro commit

Confira se não há dados, banco, uploads ou segredos:

```bash
git status --short
```

O `.gitignore` já exclui:

- `data/` (banco, uploads, `.app-key`, backup local)
- `node_modules/`
- `.env` e variantes
- logs, cookies, `*.db`, `*.pem`, `*.key`

Se `data/` aparecer, **não faça commit**. Corrija o `.gitignore` primeiro.

## 2. Configurar identidade e criar o repositório local

```bash
cd caminho/do/projeto
git init -b main
git config user.name "Seu Nome"
git config user.email "seu-email@exemplo.com"
```

Use o e-mail que você quer associar aos commits. Se quiser ocultar o e-mail, o GitHub oferece um
endereço `noreply` em **Settings → Emails**.

## 3. Primeiro commit

```bash
git add .
git status --short
git commit -m "feat: sistema de gestão imobiliária com cobranças, conciliação, 2FA e LGPD"
```

Antes de commitar, confira a lista: não deve haver `data/`, `node_modules/`, `.env` nem logs.

## 4. Criar o repositório no GitHub

### Opção A — pelo site
1. GitHub → **New repository**.
2. Nome sugerido: `sistema-imobiliaria`.
3. **Private**.
4. Não marque README, `.gitignore` nem licença (já existem).
5. Crie.

### Opção B — GitHub CLI (se tiver `gh` instalado)

```bash
gh auth login
gh repo create DSalladino/sistema-imobiliaria --private --source=. --remote=origin --push
```

## 5. Conectar e enviar

```bash
git remote add origin https://github.com/DSalladino/sistema-imobiliaria.git
git push -u origin main
```

Se o nome do repositório for outro, troque a URL. O GitHub vai pedir autenticação (token ou login pelo
navegador). **Nunca** coloque token em arquivo do projeto.

## 6. Criar a versão e a release

```bash
git tag -a v0.4.0 -m "Cobranças, conciliação, 2FA, LGPD e documentos versionados"
git push origin v0.4.0
```

No GitHub: **Releases → Draft a new release → escolha a tag v0.4.0**. Cole o trecho correspondente do
`CHANGELOG.md`. Isso mostra a evolução no portfólio.

## 7. CI

O workflow `.github/workflows/ci.yml` roda `npm ci` e `npm test` em cada push/PR para `main`.

Depois do primeiro push, o badge fica em:

```
https://github.com/DSalladino/sistema-imobiliaria/actions/workflows/ci.yml/badge.svg
```

Você pode adicionar no topo do README:

```markdown
![CI](https://github.com/DSalladino/sistema-imobiliaria/actions/workflows/ci.yml/badge.svg)
```

## 8. Rotina de versionamento

- `main`: sempre estável.
- `feat/nome-curto`: nova funcionalidade.
- `fix/nome-curto`: correção.
- Pull Request para `main`; CI precisa passar.
- Commits no padrão Conventional Commits:
  - `feat: geração de cobranças em lote`
  - `fix: cálculo de juros em baixa parcial`
  - `docs: atualiza arquitetura`
  - `refactor: extrai regra de precedência`
  - `test: cobre conciliação CSV`
- Atualize o `CHANGELOG.md` antes de criar a tag.
- Tags: `v0.4.0`, `v0.4.1`, `v0.5.0`.

## 9. O que mostrar no portfólio

- **README** com problema, solução, stack, como rodar e link da documentação.
- **`docs/ESTUDO-DE-CASO.md`**: contexto, restrições, decisões e resultados.
- **`docs/ARQUITETURA.md`**: diagramas Mermaid e fluxos.
- **`docs/FUNCIONALIDADES.md`**: cada módulo explicado.
- **`CHANGELOG.md`**: evolução por versão.
- **Capturas de tela** em `docs/screenshots/` (sem dados reais).
- **CI verde** e testes.
- Uma seção “O que eu faria diferente” ou “Próximos passos” — mostra maturidade.

### Sugestão de descrição do repositório

> Sistema de gestão imobiliária em Node.js + SQLite: cobranças, conciliação OFX/CSV, repasses,
> documentos versionados, 2FA e LGPD. Dashboard analítico e layout mobile.

### Tópicos sugeridos

`nodejs`, `sqlite`, `real-estate`, `property-management`, `fintech`, `dashboard`, `lgpd`, `2fa`,
`vanilla-js`, `portfolio`.

## 10. Se um segredo for commitado por engano

1. Remova do histórico com `git filter-repo` ou BFG.
2. Troque a senha/token imediatamente.
3. Force o push apenas se souber o que está fazendo.
4. Em caso de dúvida, recrie o repositório a partir de uma cópia limpa.

## 11. Colaboração

Para 5 usuários do sistema não é necessário um fluxo complexo. Para desenvolvimento:

- proteja `main` (require PR + CI);
- uma branch por funcionalidade;
- revise o PR;
- faça squash merge;
- tag e release.
