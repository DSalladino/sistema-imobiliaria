# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
semântico ([SemVer](https://semver.org/lang/pt-BR/)).

## [Não publicado]

### Planejado
- Reajuste assistido em lote, rescisão de contrato e contas a pagar/receber.
- Portal do proprietário/inquilino e central de manutenção.

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
