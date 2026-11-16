# Funcionalidades do sistema

Documento de referência para estudo, portfólio e evolução. Cada seção explica **o problema**, **como
funciona**, **as regras** e **onde encontrar** no sistema.

## Visão geral

Sistema de gestão para uma imobiliária familiar de pequeno porte. Centraliza proprietários, imóveis,
inquilinos, contratos, cobranças, repasses, documentos e relatórios. Foi desenhado para **5 usuários**,
acesso por navegador (computador e celular) e operação com baixo custo.

Perfis: **admin**, **operador** e **consulta**. Toda regra crítica é aplicada no servidor.

---

## 1. Painel analítico

**Problema:** a informação estava espalhada em planilhas e conversas; não havia visão consolidada.

**Como funciona:**
- KPIs de receita da imobiliária, aluguéis administrados, repasses, inadimplência, taxa média e carteira.
- Cada KPI compara com o período anterior e mostra uma sparkline.
- Insights automáticos: melhor mês, variação de receita e situação da inadimplência.
- Gráficos: movimento financeiro, composição das receitas, previsto x recebido, evolução dos saldos,
  repasses por proprietário, ocupação e aging de cobranças.
- Filtros de 6/12 meses, ano atual e ano anterior, com comparação.

**Regras:** os valores vêm dos lançamentos e das cobranças; o painel não recalcula regras de negócio.
Períodos sem dados mostram estado vazio, não erro.

**Onde:** menu **Painel**. Backend em `src/analytics.js` e `src/cobrancas.js`.

---

## 2. Alertas

**Problema:** vencimentos e reajustes apareciam só quando o inquilino avisava.

**Como funciona:** o servidor calcula, a cada consulta, contratos vencendo (90/60/30 dias), reajustes,
fim de garantia e aluguéis em atraso. Cada alerta tem nível, responsável e atalhos de WhatsApp/e-mail.

**Regras:** os prazos são configuráveis em **Configurações → Alertas**. O atraso usa o dia de
vencimento do contrato e a ausência de receita de aluguel na competência.

**Onde:** menu **Alertas** e card no painel.

---

## 3. Cadastros

**Problema:** dados de proprietários, imóveis e inquilinos sem padrão e sem histórico.

**Como funciona:** CRUD com busca, campos editáveis, links de documentos, conta bancária/Pix e
observações. Proprietários e imóveis podem ter taxa própria.

**Regras:** desativação é lógica (o histórico permanece). CPF/CNPJ é mascarado para o perfil consulta.
Toda alteração vai para a auditoria.

**Onde:** menus **Proprietários**, **Imóveis** e **Inquilinos**.

---

## 4. Contratos e motor de regras

**Problema:** cada proprietário tinha uma condição de taxa diferente; mudar uma taxa não podia alterar
o passado.

**Como funciona:**
- Precedência: **regra geral → proprietário → imóvel → exceção do contrato**.
- A regra mais específica vence.
- Cada repasse guarda um **snapshot** do cálculo (taxa aplicada e origem).
- Contrato tem vigência, aluguel, vencimento, índice e data de reajuste, garantia e link do PDF.

**Regras:** exceção de contrato exige justificativa. Competência já calculada não muda quando a taxa é
editada depois. Contrato encerrado não entra em novas cobranças.

**Onde:** menu **Contratos**; cálculo em `src/regras.js`.

---

## 5. Cobranças e régua de cobrança

**Problema:** o sistema registrava o aluguel só quando entrava; não existia “o que deveria ter entrado”.

**Como funciona:**
- **Gerar competência** cria uma cobrança por contrato ativo, com prévia e idempotência.
- Baixa integral ou parcial gera lançamento de receita no caixa dos proprietários.
- Multa e juros são calculados pelas configurações.
- Estorno de baixa e cancelamento com motivo.
- Régua: responsável, próxima ação, data e histórico de contatos.
- Aging: 0–30, 31–60, 61–90, 90+.

**Regras:** mês fechado não gera cobrança; cobrança paga não é apagada; correção por estorno.
Vencimento em fim de semana pode ser prorrogado (configurável). Contrato que começa no meio do mês pode
ser proporcional (configurável).

**Onde:** menu **Cobranças**; backend em `src/cobrancas.js`.

---

## 6. Conciliação bancária

**Problema:** digitar cada recebimento contrato a contrato e conferir extrato manualmente.

**Como funciona:** importa **OFX** ou **CSV/Excel**; para cada transação sugere uma cobrança, um repasse
ou um lançamento existente, com confiança. O usuário confirma, cria lançamento ou ignora.

**Regras:** nada é conciliado automaticamente. Duplicidade é detectada por FITID ou por data + valor +
descrição. CSV pede mapeamento de colunas na primeira importação.

**Onde:** menu **Conciliação**; backend em `src/conciliacao.js`.

---

## 7. Financeiro

**Problema:** misturar dinheiro da imobiliária com dinheiro dos proprietários.

**Como funciona:** dois caixas separados (`imobiliaria` e `proprietarios`), lançamentos por competência,
saldo, receitas, despesas e resultado. Erros são corrigidos por **estorno**, nunca por exclusão.

**Regras:** lançamento estornado permanece no histórico; um lançamento contrário é criado. Mês fechado
bloqueia novos lançamentos.

**Onde:** menu **Lançamentos**.

---

## 8. Repasses

**Problema:** calcular e explicar o repasse de cada proprietário era trabalhoso e sujeito a erro.

**Como funciona:** calcula aluguéis recebidos − taxa − despesas − descontos + acréscimos. Gera extrato
com a origem da taxa por contrato. O pagamento cria o lançamento do repasse e da taxa de administração.

**Regras:** repasse pago não é recalculado; competências passadas mantêm o snapshot. Exceções pontuais
(desconto/acréscimo) valem só para a competência, com motivo.

**Onde:** menu **Repasses**.

---

## 9. Documentos

**Problema:** contratos e documentos espalhados em pastas e conversas.

**Como funciona:** upload vinculado a proprietário, imóvel, inquilino ou contrato; categorias;
**versões** (v1, v2…), validade, pré-visualização de PDF/imagem, download e exclusão.

**Regras:** arquivos ficam em `data/uploads` (fora da pasta pública), download exige login e é auditado.
Limite de 10 MB; extensões permitidas. Nova versão preserva a anterior.

**Onde:** menu **Documentos** e botão **Docs** em cada cadastro.

---

## 10. Comunicação

**Problema:** avisar inquilinos e proprietários manualmente, sem histórico.

**Como funciona:** botão **Mensagem** em proprietários, inquilinos e contratos. Escolhe destinatário,
modelo (cobrança, lembrete, reajuste) e edita o texto.
- **WhatsApp:** abre o WhatsApp Web/Desktop com a mensagem pronta (`wa.me`). Sem API oficial, o envio
  sai pelo número conectado na máquina.
- **E-mail:** enviado pelo SMTP da imobiliária, com assunto, assinatura e histórico.

**Regras:** é preciso ter telefone/e-mail cadastrado. SMTP é configurado por variáveis de ambiente.
Mensagens de WhatsApp são limitadas a 2.000 caracteres.

**Onde:** botão **Mensagem** nos cadastros; configuração em **Configurações → Comunicação**.

---

## 11. Importação de planilhas

**Problema:** começar do zero digitando centenas de registros.

**Como funciona:** modelos em Excel/CSV para proprietários, imóveis, inquilinos e contratos. Upload com
prévia linha a linha (novo, atualizar, erro), detecção de duplicidade e criação automática de inquilinos.

**Regras:** o cabeçalho precisa seguir o modelo; o proprietário e o imóvel precisam existir para
contratos. Datas em `dd/mm/aaaa` e valores em reais são convertidos.

**Onde:** menu **Importar planilhas**.

---

## 12. Relatórios

**Problema:** prestar contas ao proprietário e ao contador.

**Como funciona:** sete relatórios (resumo financeiro, lançamentos, repasses, contratos, inadimplência,
proprietários e imóveis) em **CSV, Excel e PDF**. O PDF tem cabeçalho, KPIs, tabela e paginação.

**Regras:** filtros por período/proprietário; perfil consulta não exporta. CSV protegido contra injeção
de fórmula.

**Onde:** menu **Relatórios**.

---

## 13. Segurança e auditoria

**Como funciona:** senha com `scrypt` + salt; sessão `HttpOnly`/`SameSite`/`Secure` sob HTTPS; rate limit
de login/API/importação; **2FA TOTP** com QR Code e códigos de recuperação; CSP e cabeçalhos; validação
de origem e JSON; erros genéricos; auditoria de ações sensíveis.

**Regras:** 2FA é opcional por usuário; admin pode resetar. CPF mascarado para consulta. Toda escrita
relevante é auditada.

**Onde:** menu **Usuários**, **Auditoria**, botão **2FA**.

---

## 14. LGPD

**Como funciona:** área **Privacidade (LGPD)** para admin com:
- exportação dos dados de um titular em JSON;
- anonimização de nome/CPF/contato, remoção dos documentos pessoais e limpeza dos detalhes de auditoria, preservando contratos e financeiro;
- configuração de encarregado, e-mail e prazos de retenção;
- checklist do que o sistema apoia.

**Regras:** a anonimização remove dados pessoais e arquivos vinculados, mas não apaga o histórico
financeiro (obrigação legal). A revisão jurídica e a política de privacidade são responsabilidade da
empresa.

**Onde:** menu **Privacidade (LGPD)** e **Configurações → LGPD**.

---

## 15. Backup e continuidade

**Como funciona:** download em `.zip` com banco + documentos; verificação de integridade que abre o
banco gerado e confere as tabelas. Em produção, um script diário envia o backup para fora do servidor.

**Regras:** backup só para admin; restaurar em cópia/staging; testar mensalmente. Guardar `APP_SECRET`
separadamente (criptografa segredos de 2FA).

**Onde:** menu **Relatórios → Backup**.

---

## 16. Configurações

**Como funciona:** tudo o que é regra de negócio é editável: empresa, taxa padrão, dia de repasse,
índice, multa/juros, prazos de alerta, mensagens, comunicação e LGPD.

**Regras:** mudanças valem para novos cálculos; competências já calculadas não mudam.

**Onde:** menu **Configurações**.

---

## 17. Recuperação de senha

**Problema:** o administrador pode perder a senha ou o celular do 2FA.

**Como funciona:**
- Na tela de login, **Esqueci minha senha** cria um link de uso único, válido por 30 minutos (configurável).
- O link é enviado ao **e-mail de recuperação** cadastrado em Configurações → Segurança.
- O usuário define a nova senha; todas as sessões antigas são invalidadas.
- O administrador também pode gerar uma senha temporária em **Usuários → Resetar senha**.
- Se ninguém conseguir entrar, o comando `npm run admin:reset` no servidor redefine o primeiro admin,
  desativa o 2FA e força a troca.

**Regras:** o link é de uso único, o token é gravado como hash e o pedido tem rate limit. O envio de
e-mail depende do SMTP configurado; sem SMTP, a solicitação aparece em **Manutenção**.

## 18. Manutenção e base de demonstração

**Problema:** limpar a base para começar a usar de verdade e manter um modelo para apresentar ao cliente.

**Como funciona:**
- **Carregar demonstração:** substitui os dados pelo exemplo completo (12 meses, cobranças e repasses).
- **Zerar dados operacionais:** remove cadastros, contratos, financeiro, documentos e histórico, mantendo
  usuários e configurações.
- Antes de qualquer ação, o sistema cria um backup do banco em `data/backups/`.
- Para apresentar sem risco, use uma instância separada: `npm run demo:servir` (banco em `data-demo/`,
  porta 3009). A produção continua intacta.

**Regras:** ações restritas ao admin e com confirmação digitada (`DEMO`/`ZERAR`). O backup prévio não
substitui o backup externo diário.
