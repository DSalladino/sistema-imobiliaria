# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
semântico ([SemVer](https://semver.org/lang/pt-BR/)).

## [0.10.0] — 2026-11

### Adicionado
- **Análises futuras** (`src/previsao.js`, `#/analises`, `/api/analises` e `/api/analises/projecao`): regressão linear sobre o histórico, tendência, faixa de erro, riscos da carteira, recomendações e simulador de cenário (inadimplência, vacância, reajuste e pressão de despesa). Tudo calculado no SQLite local.
- **Assistente com previsão e riscos**: novas intenções para “previsão”, “próximos meses”, “cenário” e “riscos da carteira”.
- **Auditoria encadeada por hash** (`src/auditoria.js`): cada registro guarda o hash do anterior, permitindo detectar edição direta no banco. Inclui verificação de integridade, filtros com envelope, detalhe com diff antes/depois e reencadeamento após expurgo legal.
- **Validação real de CPF/CNPJ** (`src/validacao.js`): dígito verificador, normalização e bloqueio de documento duplicado em proprietários e inquilinos (configurável).
- **Backup com ensaio de restauração** (`src/backup.js` + `scripts/verificar-restauracao.mjs`): snapshot por `VACUUM INTO`, `integrity_check`, `foreign_key_check`, comparação de contagens e limpeza automática por retenção.
- **Retenção LGPD operacional**: expurgo de logs, comunicações e resets antigos com backup prévio, reencadeamento da auditoria e inventário de dados por categoria/base legal.
- **Novos relatórios e Excel melhorado**: cobranças, fluxo de caixa, comissões e contas; XLSX com totais, autofiltro, resumo numérico e aba de parâmetros.
- **Detalhes financeiros**: endpoint e modal de lançamento com vínculos (contrato, cobrança, repasse, estorno), comissão com trilha de auditoria e extrato de repasse já existente.
- **Sessão com expiração por inatividade** (padrão 12h, configurável) e gravação de último uso.
- Testes: `validacao`, `auditoria`, `previsao`, `backup` e `seguranca-avancada` (120 testes no total).

### Alterado
- **Mobile**: campos com 16px (sem zoom no iOS), alvos de toque de 42–46px, modais em folha inferior, respeito a `safe-area`, foco visível, redução de movimento e tabelas que não estouram a tela.
- **XLSX**: valores monetários com formato `R$ #,##0.00`, linha de TOTAL, autofiltro e aba “Parâmetros”.
- **Auditoria**: a tela agora filtra por ação/entidade/período, abre o diff e verifica a cadeia.
- **Manutenção**: painel com snapshots, integridade, ensaio de restauração e expurgo de retenção.
- **Privacidade**: inventário de dados com categoria, base legal, retenção e volume.
- Dados de demonstração atualizados para CPF/CNPJ com dígito verificador válido.

## [0.9.0] — 2026-11

### Adicionado
- **Assistente interno de gestão** (`src/assistente.js` + painel na interface):
  responde em português sobre inadimplência, cobranças, repasses, caixa,
  contratos a vencer, reajustes, ocupação, rentabilidade, comissões, contas e
  rotinas do sistema. Usa somente o SQLite local, não envia dados para fora e
  devolve destaques, itens e atalhos para a tela certa. Atalho `Ctrl K`.
- **Endpoint `POST /api/assistente`** e `GET /api/assistente` (contexto e
  sugestões), com permissão de leitura, limite de perguntas e teste automatizado.
- **Modo demonstração detectável**: `GET /api/config`, faixa “Demonstração”,
  botão “Preencher acesso demo” e credenciais públicas apenas no demo.
- **Deploy de demo online**: `Dockerfile`, `docker-compose.yml`, `render.yaml`,
  `fly.toml` e [docs/DEPLOY-DEMO.md](docs/DEPLOY-DEMO.md), com reset automático
  (`DEMO_RESET_HORAS`) e `X-Robots-Tag: noindex`.
- **Verificação de ambiente** (`scripts/verificar-ambiente.mjs`) executada antes
  de `start`, `dev` e das tarefas de demo: valida Node 22.13+, `node:sqlite` e
  escrita na pasta de dados, com mensagens acionáveis.
- **Rede de segurança da interface** (`public/boot-guard.js`): se o JavaScript
  não carregar, o spinner vira um diagnóstico com recarregar e `/api/health`.
- **Novo login**: painel ilustrado com cenário, cartões de recursos, métricas,
  revelar senha, estado de carregamento, foco e layout mobile revisado.
- Testes `tests/assistente.test.mjs` e cobertura de `/api/config` e do assistente
  na API (84 testes no total).

### Alterado
- `HOST` padrão passa a ser `0.0.0.0`, permitindo abrir pelo celular na mesma
  rede, em Docker e em PaaS; para acesso só local use `HOST=127.0.0.1`.
- `demo-server.js` respeita `PORT` injetada pela plataforma, ativa `DEMO_MODE`,
  restaura a senha demo no reset e não sobrescreve a porta de produção.
- `npm start` falha cedo e explica o problema quando a porta está ocupada ou o
  ambiente é incompatível.
- Documentação de execução, demonstração, testes e publicação atualizada.

## [0.8.1] — 2026-11

### Adicionado
- **`docs/SEGURANCA.md`**: modelo de ameaças, controles por camada, capítulo do Pix (P-01…P-14), checklist operacional, runbook de incidentes e riscos residuais.
- **Conciliação usa o txid como dica**: um Pix com `txid` no memo é sugerido mesmo fora da janela de 20 dias, mas **o valor continua obrigatório** (≤5% de diferença).
- Testes para chave Pix inválida e para o vínculo por txid (com e sem valor compatível).

### Corrigido
- **Campos EMV medidos em bytes** (`Buffer.byteLength`), não em caracteres: chave ou texto multibyte não gera mais BR Code com tamanho inválido.
- **Chave Pix validada**: recusa caracteres não-ASCII e chave acima de 77 bytes com mensagem clara.
- **`/api/pix/pendentes` não falha mais em lote** quando uma cobrança é paga/cancelada entre a consulta e a geração.
- **`SECURITY.md`** atualizado para 0.8.x, com escopo de Pix e recomendações operacionais.

## [0.8.0] — 2026-11

### Corrigido
- **Troca de senha exigida no servidor**: usuário com senha temporária recebe `403` em rotas protegidas até trocar a senha (antes a regra existia só na interface).
- **Seed de demonstração opt-in**: dados fictícios só entram com `SEED_DEMO=1`; não há mais seed automático fora de produção.
- **Atraso não fica mais escondido pela régua**: `em_atraso` tem precedência e a régua é exposta em `regua_status`.
- **Desativar cadastro com contrato ativo** agora retorna `409` em vez de esconder o imóvel/proprietário.
- **Health check real**: `/api/health` valida banco e escrita em `data/uploads` e responde `503` quando algo falha.
- **Versões da documentação** alinhadas à versão do pacote.

### Adicionado
- `limite`, `offset` e `envelope=1` em cobranças e lançamentos, com aviso de truncamento na interface; exportações CSV sem limite.
- Cache de configurações em processo, invalidado por `setSetting`/`invalidarCacheSettings`.
- Fontes DM Sans e Fraunces servidas localmente em `public/fonts` (OFL), com CSP restrita a `'self'`.
- `npm run deps:check` e execução na CI para versão, origem e `integrity` do `xlsx` de CDN.
- Desligamento gracioso em `SIGTERM`/`SIGINT`, com fechamento do SQLite.
- Aviso no log quando `X-Forwarded-For` chega sem `TRUST_PROXY=1`.
- Testes `relatorios.test.mjs`, `conciliacao.test.mjs` e `analytics.test.mjs` (69 testes no total).

### Alterado
- Base começa vazia em qualquer ambiente sem `SEED_DEMO=1`.
- Schemas de health e de paginação documentados em `docs/API.md`.
- `docs/AUDITORIA.md` ganhou adendo da revisão 0.7/0.8 (B-01 a B-10, R-13 a R-15).

## [0.7.0] — 2026-11

### Adicionado
- **Pix automático por cobrança**: BR Code estático (EMV) com CRC16, QR Code e copia e cola, txid determinístico (`IMOB<id><competência>`) para conciliação e listagem de Pix pendentes da competência.
- **WhatsApp pela API oficial** (Cloud API), com modo `link` (`wa.me`) como padrão e fallback; envio registrado em `comunicacoes` e botão de cobrança direto na listagem.
- **Contas a pagar e a receber** com recorrência (mensal, semanal, anual), baixa que gera lançamento no caixa correto, criação automática da próxima parcela e **previsão de caixa** de 6 a 24 meses.
- **Reajuste em lote** com prévia por contrato, aplicação do percentual, histórico em `reajustes` e atualização das cobranças em aberto.
- **Rescisão de contrato**: encerramento com data, motivo, multa, cancelamento de cobranças futuras e devolução de caução como conta a pagar.
- **Comissões de corretagem** por contrato: prevista, liberada, paga e cancelada, com geração em lote e lançamento de despesa da imobiliária.
- **DRE por imóvel**: aluguéis, taxa de administração, despesas, comissões e resultados por imóvel, disponível como relatório (CSV, XLSX e PDF).
- Configurações de **Integrações** (chave Pix, recebedor, cidade e modo do WhatsApp) e campos de corretor/comissão no contrato.
- Variáveis `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` e `WHATSAPP_API_VERSION`.
- `tests/features.test.mjs` (17 testes) e subteste de API para Pix, WhatsApp, contas, comissões, reajuste e rescisão.
- Suíte `tests/seguranca.test.mjs` (10 testes) para TOTP (vetores do RFC 6238), base32, AES-256-GCM e códigos de recuperação.
- Base de demonstração com **credenciais conhecidas** (`Demo#2026`) e sem troca obrigatória de senha, isolada em `data-demo/`.
- `docs/DEMONSTRACAO.md` com roteiro de avaliação, conteúdo da base de exemplo e limites da demonstração.
- Scripts `midia:capturar` e `midia:video` e capturas em `docs/assets/telas/` (Playwright opcional, fora das dependências do produto).

## [0.6.0] — 2026-11

### Adicionado
- Exportação CSV de **cobranças** da competência (`/api/export/cobrancas`).
- Endpoint público `/api/health` com versão, uptime e verificação do banco.
- Script `npm run check` para verificação de sintaxe de `src`, `public`, `tests` e `scripts`.
- Script `npm run test:coverage` com cobertura experimental do Node.
- Templates de issue, pull request, código de conduta, licença MIT e metadados do pacote.
- CI em matriz Node 22 e 24, com `npm run check` antes dos testes.
- Documentação reorganizada: produto, modelo de dados, API, qualidade, operação e ADRs.
- Banner e índice de documentação com trilhas de leitura por perfil.

### Corrigido
- Repasse agora inclui contrato encerrado que teve aluguel recebido na competência.
- Pagamento de repasse não é mais descontado como despesa em uma nova apuração.
- Repasse pendente é zerado quando não há mais movimentos na competência.
- Alertas e relatório de inadimplência consideram pagamento parcial pelo valor, não pela quantidade de lançamentos.
- Multa e juros continuam sendo recalculados em cobranças pagas parcialmente.
- Relatório de inadimplência lista apenas vencimentos já atrasados e mostra o saldo em aberto.
- CSV não escapa ponto e vírgula duas vezes e preserva números negativos.
- Importação reutiliza inquilino criado nas linhas anteriores da mesma planilha.
- Sistema não permite remover/rebaixar o último administrador ativo.
- Backup inclui `.app-key` quando existir, evitando perder o acesso ao 2FA na restauração.
- Datas de vencimento e seed usam componentes locais, sem recuar um dia em fusos positivos.
- Lançamentos manuais validam categoria/caixa e coerência entre contrato, imóvel e proprietário.
- Contrato com código duplicado ou segundo contrato ativo para o mesmo imóvel é rejeitado.
- Limite da auditoria é validado (1 a 1.000 registros).

### Alterado
- README reescrito para portfólio: banner, badges, tour do produto, arquitetura, stack e trilhas de documentação.
- `deploy/backup.sh` passa a gerar `dados-*.tar.gz` com uploads e `.app-key`.
- Guia de operação ganhou runbooks de incidente, atualização e teste de restauração.
- Checklist de segurança atualizado com o estado real do 2FA, backup e pendências.
- Versão do pacote elevada para 0.6.0.

### Documentação
- README revisado, com banner, badges, tour do produto e índice de documentação.
- Adicionados `docs/README.md`, `docs/PRODUTO.md`, `docs/MODELO-DE-DADOS.md`, `docs/API.md`, `docs/QUALIDADE.md`, `docs/OPERACAO.md`, `docs/DECISOES.md` e `docs/AUDITORIA.md`.
- Adicionados `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE` e templates do GitHub.
- Guia interno de publicação removido; o conteúdo operacional permanece em `deploy/README.md`.

### Segurança
- Senha inicial do administrador gerada aleatoriamente (ou definida por `ADMIN_SENHA`), sem credencial publicada.
- Produção começa com base vazia; demonstração exige `SEED_DEMO=1`.
- Tokens de sessão gravados no banco apenas como hash SHA-256.
- Códigos de recuperação de 2FA protegidos com HMAC da chave da aplicação.
- Validação de `Sec-Fetch-Site`, permissões `0700`/`0600` para banco, uploads e backups.
- Validação de referências, datas, taxas e valores antes de gravar cadastros e lançamentos.
- Neutralização de fórmulas em exportações CSV.
- Anonimização LGPD remove documentos pessoais e detalhes de auditoria do titular.
- Dependências atualizadas (`xlsx` 0.20.3, `nodemailer` 10.x, `archiver` 8.x); `npm audit` sem vulnerabilidades.

## [0.5.0] — 2026-11

### Adicionado
- **Recuperação de senha** por link de uso único, com validade configurável e envio ao e-mail de recuperação.
- Página **Manutenção** para carregar demonstração ou zerar dados operacionais, com backup prévio automático.
- **CLI de recuperação do administrador** (`npm run admin:reset`), que desativa 2FA e força nova senha.
- **Instância de demonstração separada** (`npm run demo:servir`) com banco em `data-demo/`.
- Reset de senha temporária pelo administrador na tela de usuários.

## [0.4.0] — 2026-11

### Adicionado
- Camada de **cobranças** com status, vencimento, multa/juros, baixa total/parcial, estorno e cancelamento.
- **Geração mensal em lote**, com prévia, idempotência, mês fechado e vencimento em dia útil.
- **Régua de cobrança**: responsável, próxima ação, data e histórico.
- **Aging** de inadimplência e card de cobranças no painel.
- **Conciliação OFX/CSV** com mapeamento, sugestões, confirmação e detecção de duplicidade.
- **2FA TOTP** com QR Code, códigos de recuperação e reset pelo admin.
- **Documentos versionados** com pré-visualização de PDF/imagem e validade.
- **LGPD**: exportação do titular, anonimização, CPF mascarado e página de privacidade.
- **Backup em `.zip`** com banco + documentos e verificação de integridade.
- Pacote de deploy (`deploy/`) com systemd, Caddy, backup e guia.
- Layout mobile em cartões para cobranças e conciliação.

### Alterado
- Dashboard agora inclui resumo real de cobranças.
- Painel ganhou **resumo fixo do mês atual** e filtro "Mês atual".
- Primeira execução de uma base vazia carrega a demonstração completa, com 12 meses de cobranças e repasses.
- Testes cobrem cobranças, conciliação, 2FA, LGPD, documentos e backup.

## [0.3.0] — 2026-11

### Adicionado
- Checklist de segurança de 21 pontos e endurecimento de login/sessão/CSRF/CSP.
- Troca de senha obrigatória no primeiro acesso.
- Rate limit de login, 2FA, API e importação.
- Documentos com upload privado e download autenticado.
- Comunicação manual por WhatsApp (`wa.me`) e e-mail (SMTP).
- Backup com banco + documentos.
- Página de privacidade/LGPD e auditoria de exportação.

## [0.2.0] — 2026-11

### Adicionado
- Redesign visual em tons pastéis, login em duas colunas, ícones SVG e tema responsivo.
- Dashboard analítico com KPIs, comparativos, insights e gráficos SVG.
- Importação de planilhas com modelos, prévia e atualização.
- Relatórios em CSV, XLSX e PDF com cabeçalho e paginação.
- Relatórios de resumo financeiro, lançamentos, repasses, contratos, inadimplência, proprietários e imóveis.

## [0.1.0] — 2026-11

### Adicionado
- Estrutura inicial: Node.js + SQLite, sessão, perfis admin/operador/consulta e auditoria.
- Cadastros de proprietários, imóveis, inquilinos e contratos.
- Motor de regras de taxa com precedência e snapshot.
- Financeiro com dois caixas, estorno e fechamento mensal.
- Cálculo de repasse com extrato.
- Alertas de vencimento, reajuste, garantia e atraso.
- Configurações editáveis e dados de exemplo.
