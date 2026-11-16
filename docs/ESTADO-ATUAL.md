# Estado atual do projeto

Documento de referência técnica: o que está implementado, como executar, onde fica cada
módulo e quais pendências permanecem.

## Stack e execução

- Node.js 22.13+ (recomendado 24) + SQLite (`node:sqlite`), sem framework.
- Frontend SPA em JavaScript puro (`public/app.js`), gráficos SVG próprios (`public/charts.js`) e ícones SVG no `index.html`.
- Dependências: `xlsx` (SheetJS), `pdfkit`, `nodemailer`, `archiver`, `qrcode`; `jsdom` em desenvolvimento.
- Rodar: `npm install && npm start` (porta 3000). Para não conflitar com instâncias antigas: `PORT=3007 npm start`.
- Testes: `npm test` (API, regras, interface jsdom e seed). Use um banco temporário via `DATA_DIR`.
- Dados de exemplo: `node src/demo.js` (12 meses, 36 cobranças, documentos e 2FA desligado).

## Onde está cada coisa

```
src/
  server.js      HTTP, sessão, CSP, cabeçalhos, estáticos
  api.js         rotas, validação, permissões, auditoria
  db.js          esquema, migrações, settings, seed
  regras.js      repasse, alertas, saldos, fechamento
  analytics.js   KPIs, séries, comparativos, composição
  cobrancas.js   geração em lote, baixa, multa/juros, régua
  conciliacao.js OFX/CSV, sugestões, confirmação
  documentos.js  upload, versões, validade, download
  seguranca.js   TOTP, AES do segredo, recovery codes
  email.js       SMTP
  reports.js     CSV, XLSX, PDF
  importacao.js  planilhas e modelos
  demo.js        recarrega exemplo
public/
  index.html, app.js, charts.js, core.js, views.js, views-fin.js, styles.css
tests/
  api.test.mjs, rules.test.mjs, ui.test.mjs, seed.test.mjs
docs/
  roadmap.md, checklist-seguranca.md, ESTADO-ATUAL.md
```

## Modelo de dados (resumo)

- `usuarios`, `sessoes`, `auditoria`, `settings`.
- `proprietarios`, `imoveis`, `inquilinos`, `contratos`, `excecoes`.
- `lancamentos` (dois caixas: `imobiliaria` e `proprietarios`; `cobranca_id`).
- `cobrancas` (competência, vencimento, valores, status, `cobranca_status`, próxima ação) e `cobranca_acoes`.
- `conciliacoes` (OFX/CSV, sugestão, status).
- `repasses`, `fechamentos`.
- `documentos` (grupo, versão, atual, validade) e `comunicacoes`.
- `settings` guarda regras editáveis; segredos só em variáveis de ambiente (`APP_SECRET`, SMTP).

Convenções: dinheiro em centavos (inteiro), percentual `REAL`, datas ISO `YYYY-MM-DD`, competência
`YYYY-MM`. Toda escrita relevante chama `registrar()`/auditoria. Permissões no servidor com
`exigir(user, acao)`.

## Módulos prontos

Painel analítico, alertas, cobranças + régua + aging, conciliação OFX/CSV, proprietários, imóveis,
inquilinos, contratos, lançamentos, repasses, importação de planilhas, documentos com versões/preview,
comunicação manual (WhatsApp/e-mail), relatórios CSV/XLSX/PDF, configurações, usuários, auditoria,
privacidade/LGPD, 2FA, backup `.zip` + verificação de integridade.

## Rotas principais

Auth: `/api/login`, `/api/login/2fa`, `/api/logout`, `/api/me`, `/api/me/senha`, `/api/2fa/*`.
Dados: CRUD em `/api/proprietarios|imoveis|inquilinos|contratos|excecoes`.
Financeiro: `/api/lancamentos`, `/api/cobrancas*`, `/api/conciliacao*`, `/api/repasses*`, `/api/fechamentos*`.
Dados/relatórios: `/api/import/*`, `/api/reports/:tipo.:formato`, `/api/export/*`.
Documentos/comunicação/LGPD/backup: `/api/documentos*`, `/api/comunicacao/*`, `/api/lgpd/*`, `/api/backup*`.

## Backlog técnico

1. **Reajuste em lote** por índice, com termo e atualização do contrato.
2. **Contas a pagar/receber + previsão de caixa 12 meses**.
3. **Rescisão de contrato** com multa, saldo, vistoria e caução.
4. **DRE por proprietário/imóvel e rateio**.
5. **Comissões e metas**.
6. **Central de manutenção** com orçamento/aprovação/fotos.
7. **Histórico do imóvel em linha do tempo**.
8. **Dashboard por bairro/tipo, metas e pipeline de renovação**.
9. **Permissões granulares por módulo/proprietário**.
10. **Criptografia dos arquivos em repouso + antivírus no upload + backup offsite**.
11. **Notificações automáticas** (SMTP + API oficial WhatsApp).
12. **Checklist de documentos por contrato + OCR**.
13. **Portal do proprietário/inquilino**.

## Convenções de manutenção

- Uma funcionalidade por alteração, com testes direcionados durante o trabalho e `npm test` no fim.
- Manter o padrão atual: valores em centavos, auditoria, permissões no servidor, layout mobile em
  cartões e testes em `tests/`.
- Atualizar este documento e o `CHANGELOG.md` ao concluir cada etapa.

## Pendências técnicas conhecidas

- `npm audit` sem vulnerabilidades conhecidas após atualização de `xlsx`, `nodemailer` e `archiver`.
- Produção: HTTPS, `TRUST_PROXY=1`, backup offsite e teste de restauração.
- `APP_SECRET` criptografa os segredos de 2FA; guarde junto com o backup.
