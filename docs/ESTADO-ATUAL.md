# Estado atual do projeto — handoff

Documento para continuar o desenvolvimento em uma nova conversa sem precisar reler todo o histórico.

## Stack e execução

- Node.js 24 + SQLite (`node:sqlite`), sem framework.
- Frontend SPA em JavaScript puro (`public/app.js`), gráficos SVG próprios (`public/charts.js`) e ícones SVG no `index.html`.
- Dependências: `xlsx`, `pdfkit`, `nodemailer`, `archiver`, `qrcode`; `jsdom` em dev.
- Rodar: `npm install && npm start` (porta 3000). Para não conflitar com instâncias antigas: `PORT=3007 npm start`.
- Testes: `npm test` (API, relatórios e interface jsdom). Sempre use banco temporário via `DATA_DIR`.
- Dados de exemplo: `node src/demo.js` (12 meses, 36 cobranças, documentos e 2FA desligado).

## Onde está cada coisa

```
src/
  server.js      HTTP, sessão, CSP, headers, estáticos
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
  index.html, app.js, charts.js, styles.css
tests/
  api.test.mjs, relatorios.test.mjs, ui.test.mjs
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

Convenções: dinheiro em centavos (inteiro), percentual REAL, datas ISO `YYYY-MM-DD`, competência `YYYY-MM`. Toda escrita relevante chama `registrar()`/auditoria. Permissões no servidor com `exigir(user, acao)`.

## Módulos prontos

Painel analítico, alertas, cobranças + régua + aging, conciliação OFX/CSV, proprietários, imóveis, inquilinos, contratos, lançamentos, repasses, importação de planilhas, documentos com versões/preview, comunicação manual (WhatsApp/e-mail), relatórios CSV/XLSX/PDF, configurações, usuários, auditoria, privacidade/LGPD, 2FA, backup `.zip` + verificação de integridade.

## Rotas principais

Auth: `/api/login`, `/api/login/2fa`, `/api/logout`, `/api/me`, `/api/me/senha`, `/api/2fa/*`.
Dados: CRUD em `/api/proprietarios|imoveis|inquilinos|contratos|excecoes`.
Financeiro: `/api/lancamentos`, `/api/cobrancas*`, `/api/conciliacao*`, `/api/repasses*`, `/api/fechamentos*`.
Dados/relatórios: `/api/import/*`, `/api/reports/:tipo.:formato`, `/api/export/*`.
Documentos/comunicação/LGPD/backup: `/api/documentos*`, `/api/comunicacao/*`, `/api/lgpd/*`, `/api/backup*`.

## O que falta (ordem sugerida)

1. **Reajuste em lote** por índice, com termo e atualização do contrato. Médio. Depende de contratos.
2. **Contas a pagar/receber + previsão de caixa 12 meses**. Médio/alto. Criar `contas` com recorrência e projetar a partir de contratos/despesas.
3. **Rescisão de contrato** com multa, saldo, vistoria e caução. Médio.
4. **DRE por proprietário/imóvel e rateio**. Médio.
5. **Comissões e metas**. Médio.
6. **Central de manutenção** com orçamento/aprovação/fotos. Alto.
7. **Histórico do imóvel em linha do tempo**. Baixo/médio. Reutiliza `auditoria`/documentos.
8. **Dashboard por bairro/tipo, metas e pipeline de renovação**. Médio.
9. **Permissões granulares por módulo/proprietário**. Alto (toca todas as rotas).
10. **Criptografia dos arquivos em repouso + antivírus no upload + backup offsite**. Médio (ops).
11. **Notificações automáticas** (SMTP + API oficial WhatsApp). Alto/externo.
12. **Checklist de documentos por contrato + OCR**. Médio/alto.
13. **Portal do proprietário/inquilino**. Muito alto; tratar como fase separada.

## Como continuar em uma nova conversa

Prompt sugerido:

> Leia `docs/ESTADO-ATUAL.md`, `docs/roadmap.md` e os arquivos diretamente envolvidos. Implemente **[funcionalidade]**. Mantenha o padrão atual (centavos, auditoria, permissões no servidor, layout mobile em cartões, testes em `tests/`). Rode `npm test` no fim e mostre o que foi alterado.

Boas práticas para economizar contexto:
- Uma funcionalidade por conversa (ou um par pequeno).
- Não cole arquivos inteiros; peça para ler caminhos específicos.
- Rode testes direcionados durante o trabalho e `npm test` no fim.
- Atualize este documento ao concluir cada etapa.

## Pendências técnicas conhecidas

- `npm audit`: `xlsx` (alta, sem correção no npm) e `archiver/minimatch` (moderadas).
- Produção: HTTPS, `TRUST_PROXY=1`, backup offsite e teste de restauração.
- `APP_SECRET` criptografa os segredos de 2FA; guarde junto com o backup.
