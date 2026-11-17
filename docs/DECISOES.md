# Decisões de arquitetura (ADRs)

Registro curto das decisões que mais impactam o projeto. Formato inspirado em
[ADR](https://adr.github.io/): contexto, decisão, consequências e alternativas.

---

## ADR-001 — Monólito Node.js com SQLite

**Status:** aceito

**Contexto:** imobiliária familiar, até ~20 usuários, uma equipe, orçamento de
hospedagem baixo, necessidade de backup simples e operação sem DBA.

**Decisão:** um único processo Node.js, HTTP nativo, SQLite em disco com WAL.
Sem framework web, sem ORM, sem fila, sem banco externo.

**Consequências:**

- deploy = copiar código + `npm ci` + um serviço systemd;
- backup = copiar um arquivo (mais uploads);
- transações ACID locais e latência baixa;
- um único escritor: não rodar duas instâncias no mesmo diretório;
- migrar para PostgreSQL se o volume ou a concorrência crescerem muito.

**Alternativas descartadas:** Express + Postgres (mais peças), serverless
(disco efêmero), microserviços (complexidade sem demanda).

---

## ADR-002 — Frontend SPA sem build

**Status:** aceito

**Contexto:** funcionalidades de formulário e dashboard, tempo de projeto curto,
necessidade de longevidade sem dependência de toolchain.

**Decisão:** HTML/CSS/JavaScript ES Modules servidos diretamente, com roteamento
por hash e componentes em template strings. Sem React/Vue, sem bundler.

**Consequências:**

- zero etapa de build e zero `node_modules` no navegador;
- carregamento simples e depuração direta;
- disciplina manual com escape de HTML e estado;
- sem hot reload sofisticado nem ecossistema de componentes;
- CSP mais restritiva, sem script inline.

**Alternativas descartadas:** React/Vite (build e dependências), SSR (mais
infraestrutura), templates no servidor (interatividade limitada).

---

## ADR-003 — Dinheiro em centavos

**Status:** aceito

**Contexto:** cálculos de aluguel, multa, juros, taxa e repasse com risco de
arredondamento.

**Decisão:** armazenar e calcular tudo em inteiros de centavos. Converter para
real apenas na apresentação e na importação/exportação.

**Consequências:**

- somas exatas e comparações previsíveis;
- arredondamento explícito em percentuais (`Math.round`);
- formulários precisam converter `1.800,00` ↔ `180000`;
- relatórios e CSV formatam no padrão brasileiro.

**Alternativas descartadas:** `REAL`/`FLOAT` (erros binários), `DECIMAL` (não
nativo no SQLite).

---

## ADR-004 — Dois caixas separados

**Status:** aceito

**Contexto:** o aluguel é dinheiro de terceiros; a taxa é receita da imobiliária.
Misturar os dois distorce o resultado e o saldo.

**Decisão:** todo lançamento tem `caixa = 'imobiliaria' | 'proprietarios'`.
Aluguel entra em `proprietarios`, taxa em `imobiliaria`, repasse é saída de
`proprietarios`.

**Consequências:**

- resultado da imobiliária e saldo dos proprietários ficam explícitos;
- relatórios e painel separam as visões;
- lançamentos manuais precisam respeitar a categoria/caixa (validado na API);
- conciliação precisa escolher o caixa correto ao criar lançamento.

**Alternativas descartadas:** um caixa único com plano de contas (mais fácil de
errar), contas bancárias separadas por proprietário (complexidade operacional).

---

## ADR-005 — Precedência de taxas + snapshot

**Status:** aceito

**Contexto:** cada proprietário e imóvel pode ter condição comercial própria;
contratos antigos precisam manter a regra da época.

**Decisão:** resolver a taxa em uma função única com precedência
**contrato > imóvel > proprietário > regra geral**. O repasse grava a taxa, a
origem e o detalhe por contrato em `detalhe_json`.

**Consequências:**

- o extrato explica a regra aplicada;
- mudar uma taxa não reescreve competência já calculada;
- exceção de contrato exige justificativa;
- o snapshot ocupa espaço no banco, mas é pequeno.

**Alternativas descartadas:** recalcular o passado (perde confiança), taxa única
global (não reflete acordos).

---

## ADR-006 — Estorno em vez de exclusão

**Status:** aceito

**Contexto:** auditoria, prestação de contas e obrigação de preservar histórico
financeiro.

**Decisão:** lançamentos não são apagados: recebem `status = 'estornado'` e geram
um lançamento contrário. Cobranças pagas precisam de estorno de baixa. Cadastros
são desativados; contratos são encerrados. Exceções pontuais ainda podem ser
removidas (não são lançamentos).

**Consequências:**

- histórico completo e auditável;
- saldos corretos sem “buracos”;
- mais registros no banco;
- telas precisam deixar claro o que está estornado.

**Alternativas descartadas:** `DELETE` físico (perde trilha), soft delete em tudo
(complexidade de filtro).

---

## ADR-007 — Single-tenant com três papéis

**Status:** aceito (revisitar se houver filiais)

**Contexto:** uma imobiliária, uma base, poucos usuários.

**Decisão:** todos os dados pertencem à mesma empresa. Papéis `admin`,
`operador` e `consulta`; autorização no servidor por ação.

**Consequências:**

- modelo e consultas simples;
- risco de IDOR entre empresas não se aplica enquanto for single-tenant;
- `consulta` vê todos os dados da empresa, incluindo contatos;
- multiempresa exigirá `empresa_id` em todas as tabelas e consultas.

**Alternativas descartadas:** multi-tenant desde o início (complexidade sem
cliente), permissões granulares por módulo (roadmap).

---

## ADR-008 — Sessão por cookie + CSRF por origem

**Status:** aceito

**Contexto:** SPA same-origin, sem API pública, com necessidade de simplicidade.

**Decisão:** token de 256 bits em cookie `HttpOnly`, `SameSite=Lax`, `Secure`
sob HTTPS. No servidor, o token é guardado como hash SHA-256. Escritas exigem
JSON e validação de `Origin`/`Sec-Fetch-Site`.

**Consequências:**

- sem token no JavaScript, reduzindo superfície de XSS;
- logout e troca de senha invalidam sessões;
- integrações externas precisam simular cookie e cabeçalhos;
- não há token CSRF separado.

**Alternativas descartadas:** JWT em `localStorage` (exposto a XSS), Basic Auth
(sem sessão), OAuth (complexidade desnecessária).

---

## ADR-009 — Gráficos SVG próprios

**Status:** aceito

**Contexto:** dashboard com barras, linhas, rosca, gauge e sparkline; evitar
dependência pesada e manter CSP restritiva.

**Decisão:** gerar SVG em `public/charts.js`, sem biblioteca de charts.

**Consequências:**

- bundle pequeno, sem dependência de terceiros;
- controle visual e responsivo;
- acessibilidade e tooltips exigem implementação manual;
- gráficos complexos (mapas, zoom) não são o foco.

**Alternativas descartadas:** Chart.js/D3 (dependência e peso), imagens estáticas
(sem interação).

---

## ADR-010 — Documentos fora da pasta pública

**Status:** aceito

**Contexto:** contratos, documentos pessoais e comprovantes não podem ser
públicos nem indexáveis.

**Decisão:** arquivos em `data/uploads` com nome UUID; download por rota
autenticada, com verificação de caminho e auditoria. Versões agrupadas por
`grupo`/`versao`.

**Consequências:**

- nenhum link público permanente;
- backup precisa incluir a pasta;
- pré-visualização inline só para PDF/imagem;
- sem antivírus nem criptografia em repouso nesta versão (roadmap).

**Alternativas descartadas:** servir de `public/` (vazamento), storage externo
(custo e integração).

---

## ADR-011 — Fechamento mensal com reabertura auditada

**Status:** aceito

**Contexto:** necessidade de “congelar” o mês para prestação de contas, sem
impedir correções legítimas.

**Decisão:** `fechamentos` bloqueia escrita na competência. Só admin reabre, com
motivo. Repasses pendentes impedem o fechamento.

**Consequências:**

- consistência para relatórios e repasses;
- correções exigem processo explícito;
- reabertura fica na auditoria;
- cobranças em aberto não impedem o fechamento (a inadimplência continua).

**Alternativas descartadas:** bloqueio permanente (engessa), nenhum bloqueio
(risco de alteração retroativa).

---

## ADR-012 — Documentação e testes como produto

**Status:** aceito

**Contexto:** projeto de portfólio e de uso real, que precisa ser entendido por
outras pessoas e evoluído ao longo de anos.

**Decisão:** manter documentação viva em `docs/`, ADRs, changelog, checklist de
segurança e testes automatizados no CI. Toda alteração de comportamento atualiza
a documentação.

**Consequências:**

- onboarding mais rápido e decisões explicáveis;
- mais tempo em manutenção;
- documentação pode ficar desatualizada se não for revisada;
- o repositório comunica maturidade técnica.

---

## ADR-013 — Troca de senha exigida no servidor

**Status:** aceito (0.8.0)

**Contexto:** a flag `deve_trocar_senha` só era aplicada pela interface. Qualquer
cliente HTTP usava a senha temporária em todas as rotas.

**Decisão:** o roteador recusa rotas protegidas com `403` enquanto a flag estiver
ativa, liberando apenas sessão, troca de senha e 2FA.

**Consequências:**

- senha temporária deixa de ser um acesso completo;
- testes e integrações precisam trocar a senha antes de operar;
- a interface continua forçando a troca, agora como conveniência.

---

## ADR-014 — Demonstração opt-in

**Status:** aceito (0.8.0)

**Contexto:** o seed rodava em qualquer ambiente que não fosse `production`,
o que injetava dados fictícios em deploys mal configurados.

**Decisão:** `SEED_DEMO=1` é obrigatório; comandos `npm run demo*` definem a
variável por conta própria. Produção e desenvolvimento começam vazios.

**Consequências:**

- um passo explícito para demonstrar;
- testes declaram a variável;
- impossível confundir base fictícia com produção.

---

## ADR-015 — Paginação por envelope opcional

**Status:** aceito (0.8.0)

**Contexto:** listas de cobranças e lançamentos tinham `LIMIT` fixo e escondiam
registros sem avisar; mudar o formato quebraria consumidores existentes.

**Decisão:** aceitar `limite`, `offset` e `envelope=1`. Sem envelope a resposta
continua sendo um array; com envelope vira `{ itens, total, limite, offset }`.

**Consequências:**

- compatibilidade preservada;
- a interface avisa sobre truncamento;
- paginação de verdade (controles de página) fica para o próximo ciclo.

---

## ADR-016 — Configurações em cache de processo

**Status:** aceito (0.8.0)

**Contexto:** multa e juros consultavam `settings` duas vezes por cobrança.

**Decisão:** cache em memória carregado sob demanda, atualizado por `setSetting`
e recarregável por `invalidarCacheSettings()`.

**Consequências:**

- menos consultas por painel e relatório;
- pressupõe um único processo escrevendo no banco (já é a premissa do ADR-001);
- edição externa da tabela exige reinício ou invalidação explícita.

---

## ADR-017 — Fontes servidas localmente

**Status:** aceito (0.8.0)

**Contexto:** DM Sans e Fraunces vinham do Google Fonts, criando dependência
externa, exposição de IP e quebra offline.

**Decisão:** versionar os `woff2` (latin/latin-ext) em `public/fonts`, com licença
OFL registrada e CSP restrita a `'self'`.

**Consequências:**

- nenhum terceiro no navegador;
- ~180 KB de fontes no repositório;
- atualização manual das fontes quando necessário.

---

## ADR-018 — Guarda de dependência fora do npm

**Status:** aceito (0.8.0)

**Contexto:** `xlsx` é instalado por URL do CDN do fornecedor e não aparece no
`npm audit`; o Dependabot o ignora.

**Decisão:** script `npm run deps:check` valida URL, versão e `integrity` do
lockfile e a versão instalada; a CI executa antes dos testes.

**Consequências:**

- troca acidental de origem/versão falha cedo;
- atualização exige revisão consciente;
- não substitui monitoramento de CVE (risco residual R-13).
