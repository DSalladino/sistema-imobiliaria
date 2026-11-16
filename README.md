# Sistema de Gestão da Imobiliária

[![CI](https://github.com/DSalladino/sistema-imobiliaria/actions/workflows/ci.yml/badge.svg)](https://github.com/DSalladino/sistema-imobiliaria/actions/workflows/ci.yml)

Sistema web para gestão de proprietários, imóveis, inquilinos, contratos, financeiro, repasses e
relatórios — com dashboard analítico, importação de planilhas e exportação em Excel/PDF.

Interface em tons pastéis, gráficos próprios em SVG (sem biblioteca de charts) e layout responsivo.
Backend em **Node.js + SQLite** (`node:sqlite`), com `xlsx`, `pdfkit`, `nodemailer`, `archiver` e `qrcode`.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/FUNCIONALIDADES.md`](docs/FUNCIONALIDADES.md) | Cada funcionalidade explicada: problema, regras e onde encontrar |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Diagramas, modelo de dados, fluxos e decisões técnicas |
| [`docs/ESTUDO-DE-CASO.md`](docs/ESTUDO-DE-CASO.md) | Cenário, decisões técnicas e resultados |
| [`docs/ESTADO-ATUAL.md`](docs/ESTADO-ATUAL.md) | Estado atual, módulos, rotas e pendências técnicas |
| [`docs/roadmap.md`](docs/roadmap.md) | Próximas funcionalidades e prioridades |
| [`docs/checklist-seguranca.md`](docs/checklist-seguranca.md) | Checklist de 21 pontos de segurança |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Ambiente de desenvolvimento, testes e fluxo de contribuição |
| [`SECURITY.md`](SECURITY.md) | Política de segurança e canal de reporte |
| [`deploy/README.md`](deploy/README.md) | Publicação em VPS, domínio, HTTPS, backup e restauração |
| [`CHANGELOG.md`](CHANGELOG.md) | Evolução por versão (SemVer) |

## Como rodar

Requisito: **Node.js 22.13 ou superior** (recomendado 24+). O módulo `node:sqlite` só fica disponível sem flag a partir dessa versão.

```bash
npm install
npm start
```

Abra http://127.0.0.1:3000

**Acesso inicial**
- E-mail: `admin@imobiliaria.local`
- Senha: gerada automaticamente na primeira execução e exibida **uma única vez** no terminal.

Para definir a senha inicial em uma instalação automatizada, use a variável `ADMIN_SENHA` antes do
primeiro `npm start`. No primeiro login o sistema **obriga a criação de uma senha própria** (mínimo
8 caracteres). Não existe senha padrão publicada.

### Recuperação de senha

Na tela de login há **Esqueci minha senha**. O pedido gera um link de uso único, válido por 30 minutos, e
envia para o **e-mail de recuperação** configurado em Configurações → Segurança. O envio depende do SMTP
e da **URL pública** (`url_publica` em Configurações → Segurança ou `PUBLIC_URL` no ambiente); sem ela o
sistema não usa o cabeçalho `Host` por segurança. Sem SMTP, a solicitação fica registrada em
**Manutenção** para outro administrador atender.

Se ninguém conseguir entrar, o administrador do servidor pode redefinir pelo terminal:

```bash
npm run admin:reset -- --email admin@imobiliaria.local
```

O comando gera uma senha temporária, desativa o 2FA desse usuário, invalida as sessões e força a troca
no próximo login.

### Base de demonstração separada

Para apresentar ao cliente **sem tocar nos dados reais**:

```bash
npm run demo:servir     # cria/usa data-demo e sobe em http://127.0.0.1:3009
```

O banco de demonstração fica em `data-demo/`, separado de `data/`. A instância usa a mesma aplicação e
pode rodar ao mesmo tempo que a produção, em outra porta ou subdomínio. Em produção (`NODE_ENV=production`)
a base começa vazia; dados de exemplo só entram com `SEED_DEMO=1` ou pelos comandos de demonstração.

Dentro do sistema, **Manutenção** permite carregar a demonstração ou zerar os dados operacionais. Antes
de qualquer uma dessas ações, o sistema cria um backup do banco em `data/backups/`.

Para abrir no celular na mesma rede:

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

No Windows (PowerShell):

```powershell
$env:HOST="0.0.0.0"; npm start
```

## O que está pronto

### Painel analítico
- **Resumo fixo do mês atual**: receita, aluguéis, repasses, inadimplência, cobranças e saldo em aberto
- Filtro **Mês atual** além de 6 meses, 12 meses, ano atual e ano anterior
- 6 KPI cards com comparação automática com o período anterior e mini-gráficos
- Receita da imobiliária, aluguéis administrados, repasses, inadimplência, taxa média e carteira
- **Insights automáticos** (melhor mês, variação de receita, situação da inadimplência)
- Gráficos: movimento financeiro, composição das receitas, previsto x recebido, evolução dos
  saldos (com opção de comparar com o ano anterior), repasses por proprietário e ocupação
- Filtros de 6 meses, 12 meses, ano atual, ano anterior e comparação
- Alertas e atividade recente no mesmo painel
- Dados de exemplo com **12 meses de histórico**

### Importação de planilhas
- Modelos prontos para **proprietários, imóveis, inquilinos e contratos** (`.xlsx` e `.csv`)
- Upload de `.xlsx`, `.xls` e `.csv` (até 12 MB)
- **Prévia antes de gravar**: mostra linha a linha o que será criado, atualizado ou rejeitado
- Detecção de duplicidade e opção de atualizar registros existentes
- Criação automática de inquilinos que ainda não existem ao importar contratos
- Datas em `dd/mm/aaaa` e valores em reais (`1.800,00`) convertidos automaticamente

### Documentos
- Upload de arquivos vinculados a **proprietários, imóveis, inquilinos e contratos**
- PDF, imagens, Word, Excel, CSV e TXT · até 10 MB por arquivo
- Categorias (contrato, documento pessoal, comprovante, garantia, vistoria, nota fiscal, outros)
- **Versionamento**: nova versão preserva a anterior no histórico
- **Pré-visualização** de PDF e imagens no navegador
- Validade (garantia, seguro, alvará) com data
- Arquivos ficam em `data/uploads/`, **fora da pasta pública**; download exige login e fica na auditoria
- Acesso pelo menu **Documentos** ou pelo botão **Docs** em cada cadastro

### Comunicação (WhatsApp e e-mail)
- Botão **Mensagem** em proprietários, inquilinos e contratos
- Escolha do destinatário (no contrato, inquilino ou proprietário)
- Modelos prontos: cobrança, lembrete de vencimento e reajuste, com variáveis preenchidas
- **WhatsApp:** abre o WhatsApp Web/Desktop com a mensagem pronta para o número do destinatário.
  Para sair pelo número da imobiliária, mantenha esse número conectado no WhatsApp da máquina.
- **E-mail:** enviado pelo servidor SMTP da imobiliária para o e-mail cadastrado, com assunto,
  mensagem e assinatura. O histórico de envios fica registrado.

Para habilitar o e-mail, defina no ambiente (não ficam no banco nem no navegador):

```bash
SMTP_HOST=smtp.seudominio.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=contato@imobiliaria.com
SMTP_PASS=sua-senha-ou-app-password
SMTP_FROM=contato@imobiliaria.com
```

No Gmail, use uma senha de aplicativo. Depois de configurar, reinicie o servidor. O nome do
remetente, o e-mail de envio, a assinatura e o WhatsApp da empresa são editáveis em
**Configurações → Comunicação**.

### Cobranças e régua
- Geração mensal em lote a partir dos contratos ativos, com prévia e idempotência
- Baixa integral ou parcial, com multa e juros calculados pelas configurações
- Estorno de baixa e cancelamento com trilha de auditoria
- Status: em aberto, pago parcial, pago, em atraso, em cobrança, promessa, acordo, jurídico, cancelado
- Régua por cobrança: responsável, próxima ação, data e histórico de contatos
- Aging (0–30, 31–60, 61–90, 90+) no painel e na página de cobranças
- Layout em cartões, pensado para celular

### Conciliação bancária
- Importação de **OFX** e **CSV/Excel**, com mapeamento de colunas
- Sugestão automática de vínculo com cobranças, repasses ou lançamentos já existentes
- Confirmação humana antes de baixar; nada é conciliado sozinho
- Detecção de duplicidade por identificador do banco ou data + valor + descrição
- Criação de lançamento direto da transação

### Segurança e privacidade
- **2FA (TOTP)** com QR Code, códigos de recuperação e reset pelo admin
- Exportação dos dados de um titular em JSON (LGPD)
- Anonimização de dados pessoais preservando o histórico financeiro
- CPF/CNPJ mascarado para o perfil consulta
- Verificação de integridade do backup (abre o banco gerado e confere as tabelas)

### Relatórios
Sete relatórios, com filtros de período e proprietário:

1. Resumo financeiro (mês a mês)
2. Lançamentos
3. Repasses
4. Carteira de contratos
5. Inadimplência
6. Proprietários
7. Imóveis

Cada um pode ser baixado em **CSV**, **Excel (.xlsx)** ou **PDF**. O PDF sai com cabeçalho da
imobiliária, indicadores do período, tabela formatada e numeração de páginas — pronto para
apresentação ao proprietário ou ao contador.

### Gestão
- Proprietários com conta bancária, Pix, link de documentos e taxa própria
- Imóveis com situação, tipo e taxa própria
- Inquilinos
- Contratos com vigência, reajuste, garantia, link do contrato assinado e exceção de taxa
- Busca rápida em todas as listas

### Regras de taxa com precedência
1. Regra geral da imobiliária
2. Regra do proprietário
3. Regra do imóvel
4. Exceção do contrato (com justificativa)

A regra mais específica vence. Cada repasse guarda um **snapshot** do cálculo: mudar uma taxa depois
não altera competências passadas.

### Financeiro e repasses
- Dois caixas separados: **imobiliária** e **proprietários**
- Lançamentos por competência, com correção por **estorno** (nada é apagado)
- Cálculo automático do repasse, extrato explicando cada valor e impressão/PDF
- Exceções pontuais de desconto/acréscimo por competência, com motivo
- Fechamento mensal com reabertura só pelo admin e motivo registrado

### Alertas
- Vencimento de contrato em 90/60/30 dias (prazos editáveis)
- Reajuste anual, fim de garantia e aluguel em atraso
- Atalhos de **WhatsApp** e **e-mail** com o modelo de mensagem configurável

### Controles
- Perfis **admin**, **operador** e **consulta**
- Auditoria de criação, alteração, estorno, pagamento, fechamento, importação, exportação e backup
- Backup do banco em um clique (Relatórios → Backup)
- Configurações editáveis: empresa, regras, prazos, mensagens e segurança

## Estrutura

```
src/
  server.js       HTTP, sessão, estáticos e limite de upload
  api.js          rotas, validação, permissões e auditoria
  db.js           esquema SQLite, configurações e dados de exemplo
  regras.js       cálculo de repasse, alertas, saldos e fechamento
  analytics.js    KPIs, séries mensais, comparativos e composição
  cobrancas.js    cobranças, geração em lote, baixa, multa/juros e régua
  conciliacao.js  OFX/CSV, sugestões e confirmação de conciliação
  seguranca.js    TOTP, criptografia do segredo e códigos de recuperação
  reports.js      geração de CSV, XLSX e PDF
  importacao.js   leitura de planilhas, prévia, importação e modelos
  auth.js         hash de senha e sessão
  permissoes.js   papéis e auditoria
  demo.js         recarrega dados de exemplo (12 meses)
public/
  index.html      shell, login e telas de recuperação
  styles.css      tema pastel e componentes responsivos
  charts.js       gráficos SVG (barras, linha, rosca, gauge, sparkline)
  core.js         estado, API, ícones, modais, formulários e utilitários
  views.js        painel, alertas e cadastros
  views-fin.js    financeiro, documentos, relatórios e administração
  app.js          autenticação, navegação e composição das telas
tests/
  api.test.mjs    API, permissões, cobranças, repasses, relatórios e backup
  rules.test.mjs  precedência de taxas, snapshot e política de senha
  ui.test.mjs     renderiza todas as telas com dados reais em jsdom
data/
  imobiliaria.db      (gerado; não versionar)
```

## Segurança

O sistema passa por um checklist de 21 pontos de segurança para aplicações web. O resultado completo,
com evidências e pendências, está em [`docs/checklist-seguranca.md`](docs/checklist-seguranca.md).

Implementado: troca de senha obrigatória no primeiro acesso, `scrypt` com salt, política de senha,
sessão `HttpOnly`/`SameSite`/`Secure` sob HTTPS, rate limit de login/API/importação, autorização por
papel no servidor, SQL parametrizado, escape de saída, proteção CSRF por origem e JSON, CSP e
cabeçalhos de segurança, erros genéricos, limites de upload, proteção contra path traversal e
auditoria de ações sensíveis.

Pendências conhecidas: publicar com HTTPS/`TRUST_PROXY`, testar a restauração do backup periodicamente,
revisar os fluxos de LGPD com apoio jurídico e manter as dependências atualizadas (`npm audit`).

Variáveis de ambiente relevantes:

| Variável | Para que serve |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `HOST` | Interface de escuta (padrão `127.0.0.1`; use `0.0.0.0` para rede local) |
| `DATA_DIR` | Pasta do banco (padrão `./data`) |
| `TRUST_PROXY=1` | Usa `X-Forwarded-For`/`X-Forwarded-Proto` atrás de Nginx/Caddy |
| `APP_SECRET` | Chave que criptografa os segredos de 2FA e os códigos de recuperação. Guarde com o backup |
| `ADMIN_SENHA` | Senha inicial do administrador na primeira execução (opcional) |
| `PUBLIC_URL` | URL pública usada nos links de e-mail (ex.: `https://imobiliaria.exemplo.com`) |

## Testes

```bash
npm test
```

- `tests/api.test.mjs`: API, permissões, precedência de taxas, estorno, fechamento, analytics,
  relatórios em PDF, cobranças, repasses, backup e verificação de integridade
- `tests/rules.test.mjs`: precedência de taxa, snapshot do repasse e política de senha
- `tests/ui.test.mjs`: renderiza as telas com dados reais em jsdom e confere o conteúdo
- `tests/seed.test.mjs`: valida a base de demonstração da primeira execução

## Backup e restauração

- **Backup:** Relatórios → “Baixar backup do banco”. O arquivo `.zip` inclui o banco e a pasta de documentos.
- **Restauração:** pare o servidor, substitua `data/imobiliaria.db` pelo arquivo `imobiliaria.db` e copie
  a pasta `documentos/` para `data/uploads`. Suba o servidor novamente.
- Guarde o arquivo fora do servidor e teste a restauração periodicamente.

## Publicação

O sistema precisa de **um servidor com disco persistente** (Node + SQLite + arquivos). Vercel e
hospedagem compartilhada não servem. O guia completo está em [`deploy/README.md`](deploy/README.md).

- **Menor custo com persistência:** VPS pequena (1 GB RAM) ou Oracle Cloud Always Free.
- **Domínio:** pode ser um domínio pago da Hostinger ou outro registrador; aponte um registro A para o
  IP do VPS. HTTPS é automático com Caddy.
- **Sem domínio:** use `seu-nome.duckdns.org` ou `191-123-45-67.sslip.io`.
- **Backup:** diário, externo, com teste de restauração.

## Antes de colocar em produção

1. Trocar a senha do admin e criar usuários individuais.
2. Rodar atrás de HTTPS (Nginx/Caddy).
3. Automatizar backup offsite e testar a restauração.
4. Revisar as regras de taxa com a imobiliária e validar com casos reais.
5. Revisar LGPD e contratos com apoio jurídico.
6. Rodar `npm audit` e manter as dependências atualizadas. O `xlsx` usa a distribuição oficial do
   SheetJS (0.20.3), fora do pacote congelado do npm.

## O que ainda não está incluído

- Boleto/Pix automáticos e API oficial paga do WhatsApp (há atalho `wa.me` e envio manual)
- Contas a pagar/receber com vencimentos e recorrência (as cobranças cobrem o contas a receber de aluguel)
- Previsão de caixa de 12 meses
- Reajuste em lote pelo índice, com termo gerado
- Rescisão de contrato com multa, vistoria e caução
- DRE por proprietário/imóvel e comissões de corretores
- Central de manutenção com orçamento e aprovação
- Portal do proprietário/inquilino
- Assinatura digital e integração contábil
- Checklist de documentos por contrato e OCR de PDF
- Antivírus no upload, criptografia dos arquivos em repouso e backup offsite automático
- Permissões granulares por módulo/proprietário

O roadmap completo está em [`docs/roadmap.md`](docs/roadmap.md).
