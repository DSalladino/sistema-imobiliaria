# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
semântico ([SemVer](https://semver.org/lang/pt-BR/)).

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
