# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
semântico ([SemVer](https://semver.org/lang/pt-BR/)).

## [Não publicado]

### Planejado
- Contas a pagar/receber com recorrência e previsão de caixa de 12 meses.
- Reajuste em lote pelo índice, com termo gerado.
- Rescisão de contrato, vistoria e devolução de caução.
- DRE por proprietário/imóvel, rateio e comissões.
- Central de manutenção com orçamento e aprovação.
- Histórico do imóvel em linha do tempo.
- Dashboard por bairro/tipo, metas e pipeline de renovação.
- Permissões granulares por módulo/proprietário.
- Criptografia dos documentos em repouso e antivírus no upload.
- Notificações automáticas e portal do proprietário/inquilino.

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
