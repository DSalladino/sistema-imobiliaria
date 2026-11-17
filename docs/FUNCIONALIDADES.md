# Funcionalidades do sistema

Documento de referência funcional e de evolução. Cada seção explica **o problema**, **como
funciona**, **as regras** e **onde encontrar** no sistema.

## Visão geral

Sistema de gestão para uma imobiliária familiar de pequeno porte. Centraliza proprietários, imóveis,
inquilinos, contratos, cobranças, repasses, documentos e relatórios. Foi desenhado para **5 usuários**,
acesso por navegador (computador e celular) e operação com baixo custo.

Perfis: **admin**, **operador** e **consulta**. Toda regra crítica é aplicada no servidor.

---

## 1. Painel analítico

**Problema:** a informação estava espalhada em planilhas e mensagens; não havia visão consolidada.

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

**Regras:** desativação é lógica (o histórico permanece) e **não é permitida enquanto houver contrato ativo** vinculado ao cadastro (retorna conflito e pede o encerramento). CPF/CNPJ é mascarado para o perfil consulta. Toda alteração vai para a auditoria.

**Onde:** menus **Proprietários**, **Imóveis** e **Inquilinos**.

### Parceiros e categorias de apoio

**Problema:** corretor, fornecedor e cliente eram texto livre; o mesmo nome aparecia com grafias
diferentes e não havia onde guardar CRECI ou Pix de quem recebe comissão.

**Como funciona:** a tela **Corretores e parceiros** cadastra pessoa física ou jurídica como
corretor, fornecedor, cliente ou ambos, com CPF/CNPJ, CRECI, contato, endereço, Pix e observações.
Comissões, contratos e contas a pagar/receber passam a oferecer esses nomes na seleção, sem impedir
um nome novo. A tela **Categorias financeiras** mantém as opções de lançamentos, contas a pagar e
contas a receber, com tipo (receita/despesa) e caixa sugerido; uma categoria digitada pela primeira
vez entra automaticamente no dicionário.

**Regras:** nomes de parceiros ativos não se repetem; desativar preserva o histórico; o CPF/CNPJ de
parceiro segue a mesma máscara do perfil consulta; o vínculo por `corretor_id`/`parceiro_id` é
mantido quando o nome corresponde ao cadastro.

**Onde:** menu **Corretores e parceiros** e **Categorias financeiras**; backend em `src/cadastros.js`.

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
editada depois. Contrato encerrado não entra em novas cobranças. Um imóvel não pode ter dois contratos
ativos ao mesmo tempo, e o código do contrato é único na base.

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
- **Pix por cobrança:** gera BR Code estático (payload EMV com CRC16), QR Code e copia e cola, com txid determinístico usado como dica na conciliação. A chave precisa ser ASCII (CPF/CNPJ, e-mail, telefone ou EVP) e o valor é o saldo atual da cobrança. Exige a chave em **Configurações → Integrações**. Não há confirmação automática de pagamento: a baixa vem do extrato + conciliação humana.

**Regras:** mês fechado não gera cobrança; cobrança paga não é apagada; correção por estorno. O status exibido prioriza o **atraso** sobre o rótulo da régua (promessa, acordo, jurídico); a régua continua visível no detalhe da cobrança. O Pix é estático, sem PSP: o `txid` é só uma dica na conciliação e o valor do BR Code é o saldo no momento da geração. A análise de segurança do Pix está em [SEGURANCA.md](SEGURANCA.md).
Vencimento em fim de semana pode ser prorrogado (configurável). Contrato que começa no meio do mês pode
ser proporcional (configurável). Pagamento parcial continua contando como inadimplência enquanto houver
saldo — nos alertas e no relatório de inadimplência, o sistema compara **valores**, não a quantidade
de lançamentos. Multa e juros continuam sendo recalculados sobre o saldo em aberto até a quitação.

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

**Problema:** contratos e documentos espalhados em pastas e mensagens.

**Como funciona:** upload vinculado a proprietário, imóvel, inquilino ou contrato; categorias;
**versões** (v1, v2…), validade, pré-visualização de PDF/imagem, download e exclusão.

**Regras:** arquivos ficam em `data/uploads` (fora da pasta pública), download exige login e é auditado.
Limite de 10 MB; extensões permitidas. Nova versão preserva a anterior. Ao remover a versão atual, a
versão anterior volta a ser a ativa — o histórico não é apagado; a interface avisa isso antes de
confirmar. Para remover todas as versões, remova uma a uma.

**Onde:** menu **Documentos** e botão **Docs** em cada cadastro.

---

## 10. Comunicação

**Problema:** avisar inquilinos e proprietários manualmente, sem histórico.

**Como funciona:** botão **Mensagem** em proprietários, inquilinos e contratos. Escolhe destinatário,
modelo (cobrança, lembrete, reajuste) e edita o texto.
- **WhatsApp:** dois modos. **Link** abre o WhatsApp Web/Desktop com a mensagem pronta (`wa.me`).
  **API oficial** (Cloud API) envia direto pelo servidor com `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID`;
  o modo é escolhido em **Configurações → Integrações** e cai para link se faltar credencial.
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

**Como funciona:** doze relatórios (resumo financeiro, lançamentos, repasses, cobranças, fluxo de
caixa, comissões, contas, contratos, inadimplência, proprietários, imóveis e DRE por imóvel) em
**CSV, Excel e PDF**. O PDF tem cabeçalho, KPIs, tabela e paginação. O Excel tem totais, autofiltro,
resumo numérico e aba de parâmetros. Há também exportações CSV rápidas de lançamentos, cobranças,
repasses e contratos.

**Regras:** filtros por período/proprietário; perfil consulta não exporta. CSV protegido contra injeção
de fórmula.

**Onde:** menu **Relatórios**.

---

## 19. Contas a pagar e a receber

**Problema:** condomínio, IPTU, software, comissões e recebíveis avulsos viviam fora do sistema, então
não havia previsão de caixa confiável.

**Como funciona:** cada conta tem tipo (**pagar** ou **receber**), categoria, fornecedor, valor,
vencimento, caixa de destino e **recorrência** (única, semanal, mensal, bimestral, trimestral,
semestral ou anual, com data de término). O fornecedor/cliente pode vir do cadastro de parceiros,
inclusive com Pix.
A baixa gera o lançamento financeiro correspondente e, quando a conta é recorrente, cria automaticamente
a próxima parcela. A tela mostra a **previsão de caixa** dos próximos 6 meses, somando contas em aberto
e a projeção das recorrências, com saldo mensal e acumulado.

**Regras:** só conta em aberto pode ser editada, baixada ou cancelada; a baixa não pode ser maior que o
valor da conta; não se cria conta duplicada (mesma descrição, vencimento e valor); recorrência preserva
o dia do vencimento e corta no fim do mês (31/01 → 28/02).

**Onde:** menu **Contas**; backend em `src/contas.js`.

---

## 20. Comissões de corretagem

**Problema:** a comissão do corretor era combinada por WhatsApp e paga sem vínculo com o contrato.

**Como funciona:** a comissão é criada por contrato e corretor, com percentual (do contrato, da regra
padrão ou informado) sobre o aluguel. O corretor é escolhido no cadastro de parceiros (com CRECI e
Pix), mas um nome novo ainda pode ser digitado. Percorre os estados **prevista → liberada → paga**
(ou cancelada).
A geração em lote cria as comissões da competência para todos os contratos ativos com corretor.
O pagamento lança uma despesa no caixa da imobiliária, na categoria *Comissão de corretagem*.

**Regras:** não existe comissão duplicada para o mesmo contrato, competência e corretor; comissão paga
não é cancelada (estorne o lançamento); percentual entre 0 e 100.

**Onde:** menu **Comissões**; backend em `src/comissoes.js`.

---

## 21. Reajuste em lote e rescisão

**Problema:** reajustar contrato a contrato e encerrar contrato sem perder cobranças em aberto.

**Como funciona:**
- **Reajuste em lote:** a prévia lista os contratos com aniversário vencido, o aluguel atual e o novo.
  A aplicação grava o histórico na tabela reajustes, atualiza o último reajuste e o aluguel, e corrige as
  cobranças **em aberto** com vencimento a partir da data. Cobranças pagas mantêm o valor histórico.
- **Rescisão:** encerra o contrato na data informada, cancela as cobranças futuras ainda em aberto,
  marca o imóvel como vago quando não há outro contrato ativo, registra motivo e multa e, se houver
  caução, gera a **devolução** como conta a pagar (descontando a multa).

**Regras:** reajuste só em contrato ativo; percentual maior que −100%; rescisão exige motivo e data
posterior ao início; contrato já encerrado não é rescindido duas vezes.

**Onde:** menu **Contratos** → botões **Reajuste em lote** e **Rescisão**; backend em `src/contratos-acoes.js`.

---

## 22. DRE por imóvel

**Problema:** saber se um imóvel dá lucro exige cruzar aluguel, taxa, despesas e comissão.

**Como funciona:** para o período escolhido, calcula por imóvel os aluguéis recebidos, a taxa de
administração (pela precedência de regras), as despesas do proprietário, as comissões e dois resultados:
o do **proprietário** (aluguel − taxa − despesas) e o da **imobiliária** (taxa − comissões), com margem.

**Regras:** só entram lançamentos ativos; comissões canceladas são ignoradas; a taxa segue a mesma
precedência do repasse (contrato > imóvel > proprietário > geral).

**Onde:** **Relatórios → DRE por imóvel** (CSV, XLSX e PDF); backend em `src/dre.js`.

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

**Como funciona:** download em `.zip` com banco + documentos + `.app-key` (quando existir); verificação
de integridade que abre o banco gerado e confere as tabelas. Em produção, um script diário envia o
backup para fora do servidor.

**Regras:** backup só para admin; restaurar em cópia/staging; testar mensalmente. Guardar `APP_SECRET`
separadamente. O ZIP contém dados pessoais e possivelmente a chave que decifra o 2FA; trate-o como
segredo e guarde-o criptografado.

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
e-mail depende do SMTP configurado; sem SMTP, a solicitação aparece em **Usuários → Solicitações de
acesso e recuperação** para o admin atender.

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

## 23. Assistente interno de gestão

**Problema:** os números existem, mas nem todo mundo sabe onde encontrá-los ou como interpretar a
carteira sem abrir várias telas.

**Como funciona:**
- Botão **Assistente** no topo ou atalho `Ctrl K` abre um painel lateral.
- Perguntas em português são interpretadas no servidor: “quem está inadimplente?”, “quanto recebi em
  outubro?”, “quais contratos vencem em 90 dias?”, “qual imóvel rende mais?”.
- A resposta traz um texto curto, destaques numéricos, os principais registros e atalhos para a tela
  correspondente.
- Também explica rotinas (baixa parcial, Pix, conciliação, reajuste, relatórios, LGPD e backup).
- Tudo é calculado no SQLite local; nenhum dado é enviado a LLM ou serviço externo.

**Regras:** exige usuário autenticado com permissão de leitura, limita 60 perguntas por minuto e
500 caracteres por pergunta. Quando não entende, devolve um resumo executivo em vez de inventar
informação. A confirmação de qualquer ação continua sendo humana.

**Onde:** botão **Assistente** na barra superior, em qualquer tela; documentação técnica em
[API.md](API.md#assistente-interno).

## 24. Análises futuras e projeções

**Problema:** decidir com base no passado sem enxergar tendência, risco e efeito de um cenário.

**Como funciona:**
- A tela **Análises futuras** calcula, sobre os últimos 12 meses, receita/despesa/resultado médios,
  margem, inadimplência, ocupação, meses de caixa, concentração da carteira e renovações em 90 dias.
- A tendência e a projeção usam regressão linear, com R², inclinação mensal e faixa de erro.
- O simulador permite informar inadimplência, vacância extra, reajuste médio e pressão de despesa,
  devolvendo receita, despesa, resultado e saldo acumulado mês a mês.
- Um **teste de estresse automático** aplica inadimplência +10 p.p., vacância extra de 10% e despesa
  +10%, mostrando saldo final e em quantos meses o caixa acumulado ficaria negativo (runway).
- Riscos e recomendações são derivados dos indicadores; o assistente também responde “qual a previsão?”
  e “quais são os riscos da carteira?”.

**Regras:** nenhum dado sai do servidor; a projeção é estatística simples e não substitui decisão humana.
O histórico, as premissas e o teste de estresse ficam visíveis para que o número possa ser explicado.

**Onde:** menu **Visão geral → Análises futuras** e assistente.
