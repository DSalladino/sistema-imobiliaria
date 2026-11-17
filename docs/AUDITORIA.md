# Revisão técnica e achados

> Esta é uma **revisão interna de código e comportamento**, não uma auditoria de
> segurança independente nem um teste de penetração formal. O objetivo é
> registrar o que foi encontrado, o que foi corrigido e o que permanece como
> risco conhecido.

**Versão revisada:** 0.6.0 (corpo) e 0.7/0.8 (adendo) · **Data:** novembro de 2026

## Método

- Leitura do backend (`src/`), frontend (`public/`), testes, scripts de deploy e
  documentação.
- Execução de `npm run check`, `npm test` e `npm audit`.
- Revisão de fluxos financeiros: cobrança → baixa → repasse → fechamento.
- Revisão de autenticação, sessão, autorização, CSRF, upload e backup.
- Verificação de coerência entre documentação e código.

## Resumo

| Severidade | Encontrados | Corrigidos nesta versão | Permanecem |
|---|---:|---:|---:|
| Crítica | 0 | 0 | 0 |
| Alta | 4 | 4 | 0 |
| Média | 6 | 6 | 0 |
| Baixa | 4 | 4 | 0 |
| **Total** | **14** | **14** | **0** |

Nenhuma falha crítica de execução remota, vazamento direto de arquivos ou
bypass de autenticação foi identificada. Os achados de maior impacto estavam em
**regras financeiras** e **integridade de dados**, não em RCE/SQLi.

## Achados corrigidos

### A-01 — Repasse ignorava contrato encerrado com aluguel recebido

**Severidade:** alta · **Status:** corrigido

O cálculo de repasse listava apenas contratos com `status = 'ativo'`. Se um
contrato fosse encerrado depois do recebimento do aluguel, o valor pago ao
proprietário não entrava na apuração da competência.

**Correção:** o cálculo parte das receitas de aluguel da competência e inclui o
contrato independentemente do status atual. O filtro real é a existência de
receita.

**Teste:** `tests/rules.test.mjs` — “repasse inclui contrato encerrado com aluguel
recebido e ignora repasse pago”.

---

### A-02 — Pagamento de repasse era descontado como despesa em nova apuração

**Severidade:** alta · **Status:** corrigido

O pagamento do repasse gera uma despesa no caixa dos proprietários. A consulta de
despesas do cálculo não excluía lançamentos com `repasse_id`, então uma nova
apuração poderia descontar o repasse já pago, reduzindo ou zerando o valor devido.

**Correção:** despesas com `repasse_id IS NOT NULL` são ignoradas no cálculo.

**Teste:** mesmo teste de A-01 verifica que a despesa de repasse não altera o
total.

---

### A-03 — Juros congelavam após baixa parcial

**Severidade:** alta · **Status:** corrigido

`calcularEncargos` usava `c.juros_centavos || jurosCalculado`. Depois da primeira
baixa parcial, o valor armazenado prevalecia e os juros paravam de correr, mesmo
com saldo em aberto.

**Correção:** multa e juros são recalculados até a data de referência enquanto a
cobrança não estiver paga/cancelada. O valor pago continua sendo abatido do total.

**Teste:** `tests/rules.test.mjs` — “juros continuam correndo em cobrança paga
parcialmente”.

---

### A-04 — Imóvel podia ter dois contratos ativos

**Severidade:** alta · **Status:** corrigido

A API permitia criar um segundo contrato ativo para o mesmo imóvel, gerando duas
cobranças na mesma competência e um repasse ambíguo. A importação também não
bloqueava o caso.

**Correção:** a API valida que o imóvel não tenha outro contrato ativo (exceto o
próprio, em edição) e que o código do contrato seja único. A importação aplica a
mesma regra.

**Teste:** `tests/api.test.mjs` — tentativa de segundo contrato retorna 400.

---

### A-05 — CSV escapava ponto e vírgula duas vezes

**Severidade:** média · **Status:** corrigido

`gerarCSV` escapava cada célula e depois escapava a linha inteira novamente.
Texto como `Silva; Maria` virava `"""Silva; Maria"""` no arquivo.

**Correção:** o escape acontece uma única vez, no final. A proteção contra
fórmulas foi refinada para não transformar números negativos legítimos em texto.

**Teste:** `tests/rules.test.mjs` — “CSV escapa ponto e vírgula uma única vez e
preserva números negativos”.

---

### A-06 — Importação duplicava inquilino repetido no mesmo arquivo

**Severidade:** média · **Status:** corrigido

As referências de inquilinos eram carregadas uma vez, antes do processamento.
Quando a primeira linha criava um inquilino novo, as linhas seguintes não o
encontravam e criavam duplicatas.

**Correção:** o mapa de referências é atualizado após cada criação, por nome e
documento.

**Teste:** `tests/rules.test.mjs` — “importação reutiliza inquilino criado nas
linhas anteriores”.

---

### A-07 — Sistema podia ficar sem administrador ativo

**Severidade:** média · **Status:** corrigido

Um admin podia rebaixar ou desativar a si mesmo (ou ao último admin), deixando o
sistema sem acesso administrativo. A recuperação exigiria CLI no servidor.

**Correção:** a API impede rebaixar/desativar o último administrador ativo.

**Teste:** `tests/api.test.mjs` — “não permite ficar sem administrador ativo”.

---

### A-08 — Backup não incluía a chave local de 2FA

**Severidade:** média · **Status:** corrigido

Quando `APP_SECRET` não era definido, os segredos de 2FA eram cifrados com
`data/.app-key`. O backup incluía banco e documentos, mas não essa chave; uma
restauração em outro servidor tornaria o 2FA indecifrável.

**Correção:** o ZIP inclui `.app-key` quando existir e um aviso de
confidencialidade. O script de backup também passou a incluir a chave.

**Risco residual:** o ZIP agora contém um segredo. Deve ser armazenado
criptografado e com acesso restrito.

---

### A-09 — Datas podiam recuar um dia em fusos positivos

**Severidade:** média · **Status:** corrigido

`addMeses` e o ajuste de vencimento usavam `toISOString()` sobre uma data local.
Em servidores com fuso positivo, isso pode retornar o dia anterior.

**Correção:** formatação por componentes locais (`getFullYear`, `getMonth`,
`getDate`) nesses pontos.

---

### A-10 — Lançamento manual podia usar categoria e caixa incoerentes

**Severidade:** média · **Status:** corrigido

Era possível lançar “Aluguel” no caixa da imobiliária, fazendo o valor
desaparecer do repasse do proprietário.

**Correção:** a API valida categoria/caixa para `Aluguel`, `Taxa de
administração` e `Repasse ao proprietário`, normaliza a grafia das categorias
conhecidas e valida a coerência entre contrato, imóvel e proprietário.

---

### A-11 — Versão de documento podia ser vinculada a outro cadastro

**Severidade:** baixa · **Status:** corrigido

O endpoint de upload aceitava `substituir_id` de um documento de outra entidade,
misturando históricos de versão.

**Correção:** a API exige que o documento substituído pertença à mesma entidade e
ao mesmo registro.

---

### A-12 — Exportação de cobranças apontava para lançamentos

**Severidade:** baixa · **Status:** corrigido

O botão “CSV” da tela de cobranças baixava `/export/lancamentos`. Além de
surpreender o usuário, não existia exportação de cobranças.

**Correção:** novo endpoint `/api/export/cobrancas` com os campos da cobrança,
status, saldo e régua; o botão foi atualizado.

---

### A-13 — Documentação desatualizada em pontos operacionais

**Severidade:** baixa · **Status:** corrigido

Havia referências a teste inexistente (`tests/relatorios.test.mjs`), a solicitação
de recuperação aparecendo em “Manutenção” (o correto é “Usuários”) e itens já
entregues listados como pendentes no roadmap.

**Correção:** documentação revisada e indexada; roadmap separado por fases;
comandos e caminhos conferidos com o código.

---

### A-14 — Limite de auditoria aceitava valores inválidos

**Severidade:** baixa · **Status:** corrigido

`limite=abc` podia gerar erro 500 e valores negativos não eram normalizados.

**Correção:** limite convertido para inteiro e restrito a 1–1.000.

## Adendo — revisão 0.7/0.8 (novembro de 2026)

Esta seção cobre os módulos entregues depois da revisão 0.6 e as correções de
endurecimento da 0.8.0. Mesmo método: leitura de código, execução da suíte,
`npm audit` e exercício manual da API.

### Escopo acrescentado

Pix (BR Code/CRC16), WhatsApp Cloud API, contas a pagar/receber com recorrência,
previsão de caixa, comissões, reajuste em lote, rescisão, DRE por imóvel,
paginação de listas, cache de configurações, fontes locais e ciclo de vida do
processo.

### Achados e correções da 0.8.0

#### B-01 — Senha temporária dava acesso total à API

**Severidade:** média · **Status:** corrigido

`deve_trocar_senha` era imposto apenas pelo `app.js`. Com a senha temporária
(criada pelo admin ou por reset) era possível chamar qualquer rota protegida por
`curl` — inclusive exportar relatórios — sem trocar a senha. Reproduzido: login
com senha inicial e `POST /api/proprietarios` retornava `201`.

**Correção:** o roteador responde `403` em rotas protegidas enquanto a flag
estiver ativa; só sessão, troca de senha e 2FA seguem liberados.

**Teste:** `tests/api.test.mjs` (dashboard e escrita bloqueados antes da troca).

#### B-02 — Seed de demonstração automático fora de produção

**Severidade:** média · **Status:** corrigido

O seed rodava quando `NODE_ENV !== 'production'`. Um deploy sem a variável no
processo recebia 12 meses de dados fictícios. Agora o seed exige `SEED_DEMO=1`
em qualquer ambiente; `npm run demo*` continua funcionando e os testes declaram
a variável explicitamente.

**Teste:** `tests/seed.test.mjs` com `SEED_DEMO=1`.

#### B-03 — Atraso escondido pelo rótulo da régua

**Severidade:** baixa · **Status:** corrigido

`statusEfetivo` retornava `promessa`/`acordo` antes de avaliar vencimento, então
uma cobrança vencida podia aparecer sem o selo de atraso enquanto o aging a
contava como vencida. O atraso agora tem precedência e a régua vai em campo
próprio (`regua_status`), exibido no detalhe.

#### B-04 — Cadastro com contrato ativo podia ser desativado

**Severidade:** baixa · **Status:** corrigido

Desativar proprietário, imóvel ou inquilino com contrato ativo escondia o
cadastro das listas mantendo a cobrança. A API agora responde `409` com a
contagem de contratos ativos.

**Teste:** `tests/api.test.mjs`.

#### B-05 — Listas truncadas sem aviso

**Severidade:** baixa · **Status:** corrigido

Cobranças (1.000) e lançamentos (500) cortavam a resposta em silêncio. A API
aceita `limite`, `offset` e `envelope=1` (com `total`), a interface mostra aviso
de truncamento e as exportações CSV percorrem a competência inteira.

**Teste:** `tests/api.test.mjs` (envelope e deslocamento).

#### B-06 — N+1 de configurações em laço de cobranças

**Severidade:** baixa · **Status:** corrigido

Cada cobrança preparava e executava duas consultas a `settings` para multa e
juros. Em 3.600 cobranças isso somava milhares de consultas por painel. As
configurações passaram a ser cacheadas em memória, com invalidação em
`setSetting` e função explícita de recarga.

**Teste:** `tests/analytics.test.mjs` (cache e invalidação).

#### B-07 — Fontes carregadas do Google

**Severidade:** baixa · **Status:** corrigido

O `index.html` buscava DM Sans e Fraunces em `fonts.googleapis.com`, o que
contradiz o discurso de dados sob controle, quebra o uso offline e expõe o IP do
usuário a terceiros. Os arquivos `woff2` (latin/latin-ext) agora são servidos por
`/fonts`, com CSP restrita a `'self'`.

#### B-08 — Dependência de CDN sem verificação

**Severidade:** baixa · **Status:** mitigado

`xlsx` vem de `cdn.sheetjs.com`, fora do `npm audit` e ignorado pelo Dependabot.
`npm run deps:check` (executado na CI) confere versão, URL e `integrity` do
lockfile antes de instalar/testar. Continua sem monitoramento automático de CVE.

#### B-09 — Health raso e encerramento abrupto

**Severidade:** baixa · **Status:** corrigido

`/api/health` só executava `SELECT 1`. Agora valida o banco e a escrita em
`data/uploads`, retornando `503` quando algo está errado. O processo trata
`SIGTERM`/`SIGINT`, para de aceitar conexões, fecha o SQLite e força saída após
10 s.

#### B-10 — Módulos da 0.7 sem teste direto

**Severidade:** média · **Status:** corrigido

Relatórios, conciliação e analytics eram exercitados apenas indiretamente. Foram
adicionados `tests/relatorios.test.mjs`, `tests/conciliacao.test.mjs` e
`tests/analytics.test.mjs` (CSV/XLSX/PDF, fórmula, acentos, período vazio, OFX,
CSV, deduplicação, sugestão, KPIs e cache).

### Pix: o txid determinístico é um problema?

O `txid` é `IMOB<id><competência>`, portanto previsível. Ele **não** é tratado
como prova de pagamento: a conciliação usa valor/data para sugerir um vínculo e,
desde a 0.8.1, usa o txid presente no memo apenas como **dica** para reconhecer
pagamento fora da janela de 20 dias — sempre exigindo que o valor confira (≤5%).
Não há webhook de PSP nem baixa automática; a confirmação é humana e auditada. O
risco residual é de sugestão errada (operacional), não de fraude lógica. Se no
futuro houver baixa automática por PSP, o txid deve vir do retorno assinado do
PSP e a confirmação deve validar o valor pago.

O capítulo completo do Pix (P-01…P-14, checklist e runbook) está em
[SEGURANCA.md](SEGURANCA.md).

### Riscos residuais acrescentados

| ID | Risco | Impacto | Mitigação / próxima ação |
|---|---|---|---|
| R-13 | `xlsx` de CDN sem CVE automatizado | Dependência vulnerável passar despercebida | Guarda de versão/integrity; revisão manual a cada atualização |
| R-14 | Interface sem controles de página | Usuário precisa refinar filtros | Aviso de truncamento e API paginada; adicionar navegação |
| R-15 | Mídia de demonstração no histórico | Clone pesado | Documentado em `OPERACAO.md`; mover para LFS/release quando necessário |

## Riscos conhecidos que permanecem

| ID | Risco | Impacto | Mitigação atual / próxima ação |
|---|---|---|---|
| R-01 | Sem antivírus/scan nos uploads | Arquivo malicioso armazenado | Extensões permitidas, download autenticado e `nosniff`; adicionar scan assíncrono |
| R-02 | Sem criptografia dos documentos em repouso | Acesso ao disco lê arquivos | Permissões `0700`/`0600`; criptografia é roadmap |
| R-03 | Rate limit de login por IP, não por conta | Ataque distribuído de senha | Adicionar limite por e-mail + IP e alerta de bloqueio |
| R-04 | 2FA é opcional, sem política obrigatória para admin | Conta admin só com senha | Exigir 2FA para admins em produção |
| R-05 | Retenção de auditoria não tem job automático | Crescimento e retenção além do prazo | Configurar expurgo periódico |
| R-06 | Single-tenant | Sem isolamento por empresa | Não expor para múltiplas imobiliárias até implementar `empresa_id` |
| R-07 | Sem paginação em listas grandes | Consumo de memória/tempo | Limites fixos; implementar paginação |
| R-08 | Sem observabilidade estruturada | Diagnóstico manual | Logs em texto + `/api/health`; evoluir para métricas |
| R-09 | Teste de restauração não é automatizado | Backup pode falhar na volta | Runbook + teste mensal manual; automatizar em staging |
| R-10 | Revisão jurídica de LGPD pendente | Risco de conformidade | Documentação e controles técnicos prontos; falta validação jurídica |
| R-11 | Sem E2E de navegador real | Regressões de interação | jsdom cobre renderização; adicionar Playwright |
| R-12 | Sem lint/tipos | Erros simples podem passar | `npm run check` + testes; adicionar ESLint/JSDoc |

## O que foi verificado e está adequado

- Consultas SQL parametrizadas; filtros dinâmicos usam apenas IDs numéricos.
- Escape de saída no frontend e CSP sem script inline.
- Sessão com hash no banco, cookie `HttpOnly`/`SameSite`, invalidação em troca de
  senha e logout.
- CSRF por origem + JSON + `SameSite`.
- Rate limit em login, 2FA, API, importação, comunicação e recuperação.
- Upload com nome aleatório, limite, extensões e storage fora de `public/`.
- Backup com `VACUUM INTO` e verificação de integridade.
- Auditoria de ações sensíveis.
- `npm audit` sem vulnerabilidades conhecidas na data da revisão.

## Como reproduzir

```bash
npm ci
npm run check
npm test
npm audit
```

Os testes usam bancos temporários e não tocam em `data/`. Para validar os
achados corrigidos, consulte os testes indicados em cada item.
