# Estado atual do projeto

Documento de referência técnica: o que está implementado, como executar, onde
fica cada módulo e quais pendências permanecem.

> **Versão:** 0.6.0 · **Última revisão:** novembro de 2026

## Stack e execução

- Node.js 22.13+ (recomendado 24) + SQLite (`node:sqlite`), sem framework.
- Frontend SPA em JavaScript puro (`public/app.js`), gráficos SVG próprios
  (`public/charts.js`) e ícones SVG no `index.html`.
- Dependências: `xlsx` (SheetJS), `pdfkit`, `nodemailer`, `archiver`, `qrcode`;
  `jsdom` em desenvolvimento.
- Rodar: `npm install && npm start` (porta 3000).
- Para não conflitar com instâncias antigas: `PORT=3007 npm start`.
- Testes: `npm test` (API, regras, interface jsdom e seed).
- Sintaxe: `npm run check`.
- Dados de exemplo: `npm run demo` (12 meses, cobranças e repasses).
- Demonstração com credenciais conhecidas: `npm run demo:preparar` e
  `npm run demo:servir` (ver [DEMONSTRACAO.md](DEMONSTRACAO.md)).

## Onde está cada coisa

```
src/
  server.js      HTTP, sessão, CSP, cabeçalhos, estáticos
  api.js         rotas, validação, permissões, auditoria
  db.js          esquema, migrações, settings, seed
  regras.js      repasse, taxas, alertas, saldos, fechamento
  analytics.js   KPIs, séries, comparativos, composição
  cobrancas.js   geração em lote, baixa, multa/juros, régua
  conciliacao.js OFX/CSV, sugestões, confirmação
  documentos.js  upload, versões, validade, download
  seguranca.js   TOTP, AES do segredo, recovery codes
  email.js       SMTP
  reports.js     CSV, XLSX, PDF
  importacao.js  planilhas e modelos
  manutencao.js  limpeza, demo, backup prévio
  auth.js        hash de senha e token
  permissoes.js  papéis e auditoria
public/
  index.html, app.js, charts.js, core.js, views.js, views-fin.js, styles.css
tests/
  api.test.mjs, rules.test.mjs, ui.test.mjs, seed.test.mjs
docs/
  README, PRODUTO, FUNCIONALIDADES, ARQUITETURA, MODELO-DE-DADOS, API,
  QUALIDADE, OPERACAO, DECISOES, ESTUDO-DE-CASO, ESTADO-ATUAL,
  roadmap, checklist-seguranca
deploy/
  README, Caddyfile, imobiliaria.service, imobiliaria.env.example, backup.sh
```

## Modelo de dados (resumo)

- `usuarios`, `sessoes`, `auditoria`, `password_resets`, `settings`.
- `proprietarios`, `imoveis`, `inquilinos`, `contratos`, `excecoes`.
- `lancamentos` (dois caixas: `imobiliaria` e `proprietarios`; `cobranca_id`,
  `repasse_id`).
- `cobrancas` (competência, vencimento, valores, status, `cobranca_status`,
  próxima ação) e `cobranca_acoes`.
- `conciliacoes` (OFX/CSV, sugestão, status).
- `repasses`, `fechamentos`.
- `documentos` (grupo, versão, atual, validade) e `comunicacoes`.

Convenções: dinheiro em centavos (inteiro), percentual `REAL`, datas ISO
`YYYY-MM-DD`, competência `YYYY-MM`. Toda escrita relevante chama
`registrar()`/auditoria. Permissões no servidor com `exigir(user, acao)`.
Detalhes em [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md).

## Módulos prontos

Painel analítico, alertas, cobranças + régua + aging, conciliação OFX/CSV,
proprietários, imóveis, inquilinos, contratos, lançamentos, repasses,
importação de planilhas, documentos com versões/preview, comunicação manual
(WhatsApp/e-mail), relatórios CSV/XLSX/PDF, configurações, usuários, auditoria,
privacidade/LGPD, 2FA, backup `.zip` + verificação de integridade.

## Rotas principais

Auth: `/api/login`, `/api/login/2fa`, `/api/logout`, `/api/me`, `/api/me/senha`,
`/api/2fa/*`, `/api/esqueci-senha`, `/api/resetar-senha`, `/api/cadastro`.

Dados: CRUD em `/api/proprietarios|imoveis|inquilinos|contratos|excecoes`.
Painel: `/api/dashboard`, `/api/analytics`, `/api/alertas`, `/api/saldos`.
Financeiro: `/api/lancamentos`, `/api/cobrancas*`, `/api/conciliacao*`,
`/api/repasses*`, `/api/fechamentos*`.
Relatórios: `/api/reports/:tipo.:formato`, `/api/export/*`, `/api/relatorios`.
Importação: `/api/import/*`.
Documentos/comunicação/LGPD/backup: `/api/documentos*`, `/api/comunicacao/*`,
`/api/lgpd/*`, `/api/backup*`.
Operação: `/api/health`, `/api/manutencao/*`, `/api/auditoria`.

O contrato completo está em [API.md](API.md).

## Qualidade

- 20 testes automatizados distribuídos em 4 arquivos.
- CI em Node 22 e 24 (`npm ci`, `npm run check`, `npm test`).
- Testes de UI renderizam as 20 telas em jsdom com dados reais.
- Cobertura de linhas disponível com `npm run test:coverage` (não é meta).
- Lacunas: sem lint, sem tipos, sem E2E de navegador real e sem teste de carga.
  Ver [QUALIDADE.md](QUALIDADE.md).

## Dívidas técnicas e riscos conhecidos

1. **Single-tenant:** não há `empresa_id`; todas as consultas assumem uma empresa.
2. **Listas sem paginação:** limites fixos de 500 a 1.000 registros.
3. **Sem concorrência otimista:** edições simultâneas podem sobrescrever.
4. **PDF/e-mail síncronos:** podem segurar uma requisição por alguns segundos.
5. **Sem antivírus/criptografia em repouso** nos uploads.
6. **Sem backup offsite nativo:** depende do cron + rclone do deploy.
7. **Auditoria sem retenção automática:** o prazo é configurável, mas não há job
   de expurgo.
8. **CPF/CNPJ não é validado por dígito verificador**, apenas formatado/mascarado.
9. **Importação limitada a 5.000 linhas e 60 colunas**, sem processamento em
   streaming.
10. **Sem observabilidade estruturada:** logs em texto e monitor HTTP externo.

## Pendências operacionais

- Publicar com HTTPS e `TRUST_PROXY=1`.
- Testar a restauração do backup periodicamente e registrar.
- Configurar backup externo diário.
- Revisar LGPD e retenção com apoio jurídico.
- Manter `npm audit` limpo e dependências atualizadas.

## Próximos passos técnicos

1. Reajuste assistido e rescisão de contrato.
2. Contas a pagar/receber e previsão de caixa.
3. Paginação e busca full-text.
4. Lint/formatador e verificação de tipos.
5. Teste E2E de navegador e acessibilidade automatizada.
6. Logs estruturados, métricas e alertas.

O [roadmap](roadmap.md) organiza por fase e impacto.
