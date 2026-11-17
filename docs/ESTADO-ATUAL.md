# Estado atual do projeto

Documento de referência técnica: o que está implementado, como executar, onde
fica cada módulo e quais pendências permanecem.

> **Versão:** 0.9.0 · **Última revisão:** novembro de 2026

## Stack e execução

- Node.js 22.13+ (recomendado 24) + SQLite (`node:sqlite`), sem framework.
- Frontend SPA em JavaScript puro (`public/app.js`), gráficos SVG próprios
  (`public/charts.js`) e ícones SVG no `index.html`.
- Dependências: `xlsx` (SheetJS), `pdfkit`, `nodemailer`, `archiver`, `qrcode`;
  `jsdom` em desenvolvimento.
- Rodar: `npm install && npm start` (porta 3000, escuta em `0.0.0.0`).
- Para não conflitar com instâncias antigas: `PORT=3007 npm start`.
- Testes: `npm test` (API, regras, interface jsdom, relatórios, conciliação,
  analytics e seed).
- Sintaxe: `npm run check`; dependência de CDN: `npm run deps:check`.
- Dados de exemplo: exigem **opt-in** (`SEED_DEMO=1`, `npm run demo` ou
  `npm run demo:preparar`). Sem isso a base sobe vazia em qualquer ambiente.
- Demonstração com credenciais conhecidas: `npm run demo:preparar` e
  `npm run demo:servir` (ver [DEMONSTRACAO.md](DEMONSTRACAO.md)).
- Demo estática pública, somente leitura:
  **https://dsalladino.github.io/sistema-imobiliaria/** (`npm run demo:estatico`
  gera o retrato usado pelo GitHub Pages).

## Onde está cada coisa

```
src/
  server.js      HTTP, sessão, CSP, cabeçalhos, estáticos
  api.js         rotas, validação, permissões, auditoria
  db.js          esquema, migrações, settings, seed
  regras.js      repasse, taxas, alertas, saldos, fechamento
  analytics.js   KPIs, séries, comparativos, composição
  assistente.js  assistente interno (consultas em linguagem natural)
  cobrancas.js   geração em lote, baixa, multa/juros, régua
  conciliacao.js OFX/CSV, sugestões, confirmação
  contas.js      contas a pagar/receber, recorrência, previsão de caixa
  comissoes.js   corretagem, liberação, pagamento
  contratos-acoes.js  reajuste em lote e rescisão
  dre.js         DRE por imóvel
  pix.js         BR Code Pix (EMV, CRC16)
  whatsapp.js    link wa.me e Cloud API
  documentos.js  upload, versões, validade, download
  seguranca.js   TOTP, AES do segredo, recovery codes
  email.js       SMTP
  reports.js     CSV, XLSX, PDF
  importacao.js  planilhas e modelos
  manutencao.js  limpeza, demo, backup prévio
  auth.js        hash de senha e token
  permissoes.js  papéis e auditoria
public/
  index.html, app.js, ia.js, demo-estatico.js, boot-guard.js, charts.js,
  core.js, views.js, views-fin.js, styles.css,
  fonts/ (DM Sans e Fraunces servidas localmente)
tests/
  api.test.mjs, rules.test.mjs, seguranca.test.mjs, features.test.mjs,
  ui.test.mjs, seed.test.mjs, relatorios.test.mjs, conciliacao.test.mjs,
  analytics.test.mjs
docs/
  README, PRODUTO, FUNCIONALIDADES, ARQUITETURA, MODELO-DE-DADOS, API,
  QUALIDADE, OPERACAO, DECISOES, ESTUDO-DE-CASO, ESTADO-ATUAL,
  roadmap, checklist-seguranca, DEPLOY-DEMO
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
privacidade/LGPD, 2FA, backup `.zip` + verificação de integridade. Desde a 0.7:
Pix por cobrança, WhatsApp Cloud API, contas a pagar/receber com recorrência e
previsão de caixa, comissões, reajuste em lote, rescisão e DRE por imóvel. A
0.8.0 acrescentou troca de senha exigida no servidor, seed opt-in, paginação com
aviso de truncamento, cache de configurações, fontes locais, health check real e
desligamento gracioso. A 0.8.1 adicionou a análise de segurança do Pix, a
validação de chave/tamanho EMV e o txid como dica de conciliação. A 0.9.0 trouxe
o assistente interno, o novo login, a verificação de ambiente, a proteção contra
tela em branco e os artefatos de demo online (Docker, Render e Fly.io).

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
Operação: `/api/health` (checa banco e escrita de uploads), `/api/manutencao/*`,
`/api/auditoria`.
Assistente (0.9+): `/api/assistente` (GET contexto, POST pergunta) e
`/api/config` (público, identifica o modo demonstração).
Integrações (0.7+): `/api/integracoes/status`, `/api/cobrancas/:id/pix`,
`/api/pix/pendentes`, `/api/cobrancas/:id/whatsapp`, `/api/contas*`,
`/api/comissoes*`, `/api/contratos/reajuste/*`, `/api/contratos/:id/rescindir`,
`/api/relatorios/dre-imovel`.

Listas longas aceitam `limite`, `offset` e `envelope=1`: nesse modo a resposta
vira `{ itens, total, limite, offset }` para a interface avisar quando há dados
truncados. Sem o envelope, o formato continua sendo um array.

O contrato completo está em [API.md](API.md).

## Qualidade

- 84 testes automatizados distribuídos em 11 arquivos.
- CI em Node 22 e 24 (`npm ci`, `npm run deps:check`, `npm run check`,
  `npm test`).
- Testes de UI renderizam as 22 telas em jsdom com dados reais.
- O assistente é testado por intenção, período, busca por nome e conteúdo.
- Cobertura de linhas disponível com `npm run test:coverage` (não é meta).
- Lacunas: sem lint, sem tipos, sem E2E de navegador real e sem teste de carga.
  Ver [QUALIDADE.md](QUALIDADE.md).

## Dívidas técnicas e riscos conhecidos

1. **Single-tenant:** não há `empresa_id`; todas as consultas assumem uma empresa.
   O assistente também assume essa premissa e responde apenas pela base local.
2. **Listas longas:** a API pagina por `limite`/`offset` e informa o total, mas a
   interface ainda não tem controles de página (mostra aviso de truncamento).
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
11. **Dependência de CDN:** `xlsx` vem de `cdn.sheetjs.com`; há guarda de versão e
   integrity (`npm run deps:check`), mas não auditoria automática de CVE.
12. **Mídia da demonstração no Git:** ~7,7 MB em `docs/assets`; mover para LFS
   ou releases se o clone começar a pesar.

## Pendências operacionais

- Publicar com HTTPS e `TRUST_PROXY=1`.
- Testar a restauração do backup periodicamente e registrar.
- Configurar backup externo diário.
- Revisar LGPD e retenção com apoio jurídico.
- Manter `npm audit` limpo e dependências atualizadas.

## Próximos passos técnicos

1. Controles de paginação e busca full-text na interface.
2. Lint/formatador e verificação de tipos.
3. Teste E2E de navegador e acessibilidade automatizada.
4. Logs estruturados, métricas e alertas.
5. Criptografia/antivírus nos uploads e retenção automática da auditoria.
6. Assistente com sinônimos aprendidos e sugestões por tela (mantendo o modo
   local; integração com LLM deve ser opcional e documentada).

O [roadmap](roadmap.md) organiza por fase e impacto.
