# Segurança e vulnerabilidades

Documento de referência sobre o modelo de segurança do **Sistema de Gestão
Imobiliária**, com análise específica do fluxo **Pix**. Ele complementa o
[checklist de segurança](checklist-seguranca.md) (controles ponto a ponto) e a
[AUDITORIA](AUDITORIA.md) (achados e correções).

> **Versão:** 0.8.1 · **Última revisão:** novembro de 2026
>
> Este documento é uma **revisão interna de código e comportamento**. Não é um
> teste de penetração independente, nem uma certificação. Achados marcados como
> “residual” continuam válidos até serem tratados.

## 1. Resumo executivo

- A superfície de ataque é pequena: um processo Node.js, SQLite local, SPA sem
  build e nenhum endpoint público de escrita além de login, recuperação de senha
  e solicitação de acesso.
- Os controles de autenticação, sessão, CSRF, XSS, SQL injection, upload e
  backup estão implementados e cobertos por testes.
- **O Pix é estático (BR Code) e não tem integração com PSP.** Não existe webhook
  de pagamento, confirmação automática nem baixa por comprovante. A fronteira de
  segurança é o **extrato bancário + conciliação com confirmação humana**.
- O `txid` é previsível e **não é prova de pagamento**; ele serve como dica de
  conciliação e nunca dispensa a conferência de valor.
- O risco mais relevante do Pix é **operacional/engenharia social**: QR adulterado
  ou comprovante falso. Nenhum software resolve isso sozinho; o documento traz
  checklist e runbook para a operação.

## 2. Escopo e método

| Item | Descrição |
|---|---|
| Revisão | Leitura de `src/`, `public/`, testes, scripts de deploy e documentação |
| Execução | `npm run check`, `npm run deps:check`, `npm test`, `npm audit`, exercício manual da API |
| Fluxos revisados | Login/2FA/recuperação, CRUD, cobranças, baixa, repasse, conciliação, Pix, WhatsApp, uploads, backup, LGPD |
| Fora do escopo | Pentest, teste de carga, revisão jurídica, segurança da VPS/proxy, segurança física, PSP/bancos |

## 3. Modelo de ameaças

### 3.1 Ativos

1. Credenciais, sessões e segredos de 2FA.
2. Dados pessoais: CPF/CNPJ, endereço, telefone, e-mail, documentos.
3. Dados financeiros: cobranças, baixas, repasses, lançamentos, comissões.
4. **Chave Pix e códigos de cobrança** (payload/QR).
5. Integridade dos saldos e da trilha de auditoria.
6. Backups (`imobiliaria.db`, `data/uploads`, `.app-key`).

### 3.2 Atores

| Ator | Acesso |
|---|---|
| Visitante | Login, recuperação, solicitação de cadastro, `/api/health` |
| `consulta` | Leitura autenticada de toda a operação (single-tenant) |
| `operador` | Leitura + escrita + financeiro + repasses |
| `admin` | Tudo, incluindo usuários, auditoria, LGPD, backup e manutenção |
| Inquilino/pagador | Recebe o Pix; não acessa o sistema |
| Atacante externo | Sem credencial; tenta login, CSRF, injeção, DoS |
| Insiders | Operador/admin mal-intencionado ou negligente |

### 3.3 Superfícies

- `/api/login`, `/api/login/2fa`, `/api/esqueci-senha`, `/api/cadastro`.
- API autenticada (CRUD, financeiro, relatórios, importação, documentos).
- Uploads e download autenticado de documentos.
- Integrações de saída: SMTP, WhatsApp (link `wa.me` ou Cloud API).
- **Pix**: geração de BR Code/QR/copia e cola e envio por WhatsApp.
- Conciliação de extrato OFX/CSV/XLSX enviado pelo usuário.
- Backup ZIP e restauração manual.
- Banco SQLite e diretório `data/` no sistema operacional.

## 4. Controles implementados

| Camada | Controle | Evidência |
|---|---|---|
| Senha | `scrypt` com salt, `timingSafeEqual`, hash dummy para e-mail inexistente | `src/auth.js`, `src/api.js` |
| Política | Mínimo 8, bloqueio de senhas comuns e do e-mail; troca obrigatória aplicada no servidor | `src/seguranca.js`, `src/api.js` |
| Sessão | Token de 256 bits, só hash no banco, `HttpOnly`, `SameSite=Lax`, `Secure` sob HTTPS, invalidação em troca/reset | `src/auth.js`, `src/server.js` |
| 2FA | TOTP RFC 6238, segredo cifrado (AES-256-GCM), códigos de recuperação de uso único | `src/seguranca.js` |
| Autorização | Papéis no servidor (`exigir`), proteção do último admin, escrita por perfil | `src/permissoes.js`, `src/api.js` |
| CSRF | `Origin` + `Host` + `Sec-Fetch-Site` + JSON obrigatório + `SameSite` | `src/server.js` |
| XSS | Escape na renderização, `textContent` em mensagens, CSP sem script inline | `public/core.js`, `src/server.js` |
| SQL | Consultas parametrizadas; filtros dinâmicos só com IDs numéricos | `src/*.js` |
| Upload | 10 MB, extensões permitidas, nome aleatório, storage fora de `public/`, download autenticado, `nosniff` | `src/documentos.js` |
| Planilhas | 12–16 MB, 5.000 linhas, 60 colunas | `src/importacao.js`, `src/conciliacao.js` |
| Rate limit | Login, 2FA, API, importação, comunicação, recuperação e cadastro | `src/api.js` |
| Cabeçalhos | CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, COOP/CORP | `src/server.js` |
| Auditoria | Login, CRUD, baixa, estorno, repasse, fechamento, conciliação, importação, backup, LGPD | `src/permissoes.js` |
| LGPD | Exportação do titular, anonimização preservando financeiro, mascaramento de CPF para `consulta` | `src/api.js` |
| Operação | `secure_delete`, permissões `0700/0600`, backup com `VACUUM INTO` + integridade, desligamento gracioso | `src/db.js`, `src/server.js` |
| Documento | CPF/CNPJ validados por dígito verificador; duplicidade bloqueada (configurável) | `src/validacao.js`, `src/api.js` |
| Auditoria | Trilha encadeada por SHA-256: edição direta no banco quebra a verificação | `src/auditoria.js`, `GET /api/auditoria/integridade` |
| Sessão | Expiração por inatividade (padrão 12h) além da expiração absoluta | `src/server.js`, `setting sessao_horas` |
| Backups | `VACUUM INTO`, `integrity_check`, `foreign_key_check`, comparação de contagens e ensaio de restauração | `src/backup.js`, `scripts/verificar-restauracao.mjs` |
| Retenção | Expurgo de logs/comunicações/resets com backup prévio e reencadeamento da auditoria | `src/manutencao.js`, `POST /api/manutencao/retencao` |
| Dependências | `npm audit` limpo; `npm run deps:check` para o `xlsx` de CDN | `scripts/verificar-dependencias.mjs` |

### 4.1 Rodada 0.10 (novembro de 2026)

Controles adicionados e cobertos por `tests/seguranca-avancada.test.mjs`:

- validação de CPF/CNPJ e bloqueio de duplicidade;
- auditoria com hash encadeado e endpoint de verificação;
- expiração de sessão por inatividade;
- ensaio real de restauração de backup, não apenas criação do ZIP;
- inventário LGPD por categoria, base legal e retenção;
- RBAC exercitado por perfil `consulta` (leitura sim, escrita/auditoria/exportação não);
- injeção em filtros de busca, travessia de diretório no estático e CSRF.

Riscos residuais que continuam válidos: dados sensíveis sem criptografia em
repouso no SQLite/uploads; retenção ainda não agendada automaticamente; a
projeção é estatística simples e não substitui decisão humana.

## 5. Pix — arquitetura e fronteira de confiança

### 5.1 Como funciona

```text
cobrança em aberto
      │
      ▼
pixDaCobranca(id) ──► saldo (original + multa + juros − pago)
      │                 txid = IMOB<id><AAAAMM>
      ▼
payload EMV (BR Code) ──► CRC16
      │
      ├── QR Code (gerado localmente com a lib qrcode)
      ├── copia e cola (exibido/copiado)
      └── mensagem de WhatsApp (link wa.me ou Cloud API)
      │
      ▼
pagador paga no app do banco
      │
      ▼
extrato bancário (OFX/CSV/XLSX) ──► conciliação sugere vínculo
      │
      ▼
confirmação humana ──► baixa da cobrança + lançamento + auditoria
```

**Não existe retorno automático do banco/PSP.** O sistema não recebe webhook,
não consulta status de Pix e não confirma pagamento sozinho. Isso reduz a
superfície de ataque (nenhum endpoint público que aceite “pagamento”) e desloca
a garantia para o processo de conciliação.

### 5.2 O que vai no payload

| Campo EMV | Conteúdo | Sensibilidade |
|---|---|---|
| `00` | `01` (payload format) | pública |
| `01` | `12` (Pix estático reutilizável) | pública |
| `26/00` | `br.gov.bcb.pix` | pública |
| `26/01` | chave Pix do recebedor | pública para pagamento; pode ser CPF/telefone (dado pessoal) |
| `26/02` | descrição (`ALUGUEL CT-001`) | pública |
| `52`/`53` | moeda BRL | pública |
| `54` | valor = **saldo atual** da cobrança | pública |
| `58`–`60` | país, nome do recebedor, cidade | pública |
| `62/05` | txid `IMOB<id><AAAAMM>` | previsível, sem dado pessoal |
| `63` | CRC16 | integridade |

O payload **não contém** nome do inquilino, CPF do inquilino, endereço do imóvel
nem qualquer segredo. A mensagem de WhatsApp e o registro em `comunicacoes`
contêm o nome do inquilino e o payload completo.

### 5.3 O que o sistema deliberadamente não faz

- Não é PSP nem substitui a conciliação bancária.
- Não confirma pagamento por comprovante, foto ou PDF.
- Não trata MED (Mecanismo Especial de Devolução) nem estorno de Pix.
- Não valida assinatura digital do comprovante.
- Não envia o payload a terceiros; o QR é gerado no próprio servidor.
- Não usa o `txid` como prova de pagamento.

### 5.4 Ameaças e mitigações

| # | Ameaça | Vetor | Impacto | Controle atual | Risco residual | Recomendação |
|---|---|---|---|---|---|---|
| P-01 | **QR/chave adulterados (phishing)** | Inquilino recebe QR falso por WhatsApp/e-mail com chave do golpista | Pagamento vai para terceiro; cobrança continua aberta | Nenhum controle técnico no sistema; o payload legítimo mostra o nome do recebedor | **Alto** (fora do software) | Conferir o nome do recebedor no app do banco; enviar cobrança só por canal oficial; usar chave EVP dedicada e divulgá-la nos canais da imobiliária; orientar inquilinos |
| P-02 | **Comprovante falso** | Inquilino envia comprovante editado e pede baixa | Perda financeira se o operador confiar no comprovante | O sistema não tem fluxo de baixa por comprovante; baixa exige ação humana e fica auditada | Médio (processo) | Baixar somente após conferir o extrato/OFX; preferir conciliação a baixa manual; dupla conferência em valores altos |
| P-03 | **Txid previsível** | `IMOB<id><competência>` é dedutível | Nenhum direto; o txid não autentica pagamento | txid usado apenas como **dica** na conciliação; valor precisa conferir (≤5%) | Baixo | Manter confirmação humana; se houver PSP no futuro, validar txid/valor no retorno assinado do PSP |
| P-04 | **Memo forjado com txid de outra cobrança** | Pagador escreve o txid de outra cobrança no Pix | Sugestão de vínculo errada | A sugestão exige que o valor confira; a confirmação é humana e auditada | Baixo | Na conferência, comparar também competência/valor; não confirmar em lote sem revisar |
| P-05 | **Colisão de txid** | Dois registros com mesmo `id` + competência | Ambiguidade na conciliação | `id` é `AUTOINCREMENT`; txid inclui competência; unicidade efetiva por cobrança | Muito baixo | Manter `AUTOINCREMENT`; se migrar dados, preservar IDs |
| P-06 | **Valor desatualizado no QR** | QR gerado antes do vencimento e pago depois, com multa/juros maiores | Pagamento parcial involuntário | O valor é recalculado a cada geração; baixa parcial é suportada | Baixo | Gerar/enviar o QR no dia da cobrança; reenviar após o vencimento |
| P-07 | **Chave Pix exposta** | `/api/integracoes/status`, tela de configuração e payload | Chave é de recebimento (não permite débito); pode revelar CPF/telefone | Exige autenticação; single-tenant | Baixo | Usar chave EVP aleatória em vez de CPF/telefone; restringir a tela a perfis financeiros se o time crescer |
| P-08 | **Injeção no payload** | Nome/cidade/chave com caracteres de controle ou multibyte | BR Code inválido ou adulterado | `textoPix` normaliza e remove especiais; chave validada como ASCII ≤77 bytes; campos medidos em bytes; CRC16 | Baixo | Testes cobrem chave inválida; manter validação ao adicionar campos EMV |
| P-09 | **Dois pagamentos para o mesmo QR** | Inquilino paga duas vezes | Crédito duplicado; devolução manual | Pix estático não impede reuso; conciliação sugere uma única cobrança | Médio (operacional) | Conferir extrato; devolver via MED/banco; não reutilizar QR já quitado (o endpoint bloqueia cobrança paga) |
| P-10 | **Cobrança paga/cancelada gerando Pix** | Chamada direta à API | Cobrança indevida | `pixDaCobranca` retorna `409` para paga/cancelada/saldo zero | Muito baixo | — |
| P-11 | **Abuso do gerador de QR** | Requisições repetidas autenticadas | Consumo de CPU | Rate limit global 600 req/min por IP; geração local | Baixo | Monitorar 429; limitar por usuário se necessário |
| P-12 | **Payload persistido em comunicações** | Mensagem de WhatsApp com copia e cola salva em `comunicacoes` | Código de pagamento fica no histórico | Acesso autenticado; retenção configurável (sem job automático) | Baixo | Definir retenção; evitar payload em logs de aplicação |
| P-13 | **Conciliação com arquivo malicioso** | OFX/CSV/XLSX enviado pelo usuário | DoS/parsing (biblioteca SheetJS) no processo principal | Limites de tamanho/linhas; `xlsx` fixado e verificado; sem execução de macros | Baixo/Médio | Processar em worker; monitorar CVE do SheetJS (R-13) |
| P-14 | **Baixa manual sem extrato** | Operador confia em mensagem do inquilino | Perda financeira | Ação exige `financeiro`, gera lançamento e auditoria; não há aprovação dupla | Médio (processo) | Política de conferência no extrato; revisão semanal de baixas manuais |

### 5.5 Checklist operacional do Pix

- [ ] Chave cadastrada é **EVP aleatória** (preferencial) ou institucional, não
      CPF pessoal de um funcionário.
- [ ] Nome do recebedor e cidade conferem com a conta bancária.
- [ ] O inquilino foi orientado a conferir o **nome do recebedor** no app antes
      de pagar.
- [ ] O QR é gerado no dia do envio e reenviado após o vencimento.
- [ ] Nenhuma baixa é feita com base em foto/print de comprovante.
- [ ] Toda baixa manual é conferida no extrato no mesmo dia.
- [ ] Conciliação é revisada por uma segunda pessoa em valores acima do limite
      interno da imobiliária.
- [ ] Devoluções e MED são tratados diretamente no banco, com registro manual no
      sistema.
- [ ] Pagamentos em duplicidade são identificados na conciliação e devolvidos.
- [ ] A chave Pix é trocada imediatamente se houver suspeita de vazamento.

### 5.6 Runbook de incidentes Pix

**QR adulterado / suspeita de golpe**

1. Não confirme pagamento e não dê baixa.
2. Peça ao inquilino o comprovante e o ID (E2E) da transação.
3. Confira o extrato; se o dinheiro não entrou, oriente o inquilino a registrar
   BO e acionar o banco.
4. Reenvie o QR por canal oficial e alerte os demais inquilinos.
5. Registre o ocorrido na auditoria (observação em cobrança).

**Comprovante falso**

1. Não dê baixa.
2. Confira o extrato pelo valor, data e ID/E2E.
3. Se não houver crédito, comunique o inquilino por escrito.
4. Se houver reincidência, escale para o jurídico.

**Pagamento em duplicidade**

1. Identifique os dois créditos no extrato e os IDs E2E.
2. Não confirme os dois na conciliação.
3. Solicite devolução pelo banco/MED; registre a devolução como lançamento.
4. Se um dos pagamentos já foi conciliado, estorne a baixa (não apague).

**Chave Pix comprometida**

1. Troque a chave no banco e em **Configurações → Integrações**.
2. Regenere os QRs pendentes e reenvie.
3. Verifique a auditoria de acesso e os logs do proxy.
4. Comunique proprietários e inquilinos.

**Suspeita de fraude interna**

1. Preserve o banco e os backups; não edite registros.
2. Exporte a auditoria e os lançamentos do período.
3. Acione o responsável legal; a trilha de auditoria é a evidência primária.

## 6. Vulnerabilidades e riscos residuais

Além dos riscos específicos de Pix (P-01…P-14), permanecem os riscos gerais
registrados em [AUDITORIA.md](AUDITORIA.md#riscos-conhecidos-que-permanecem):

| ID | Risco | Severidade | Mitigação / próxima ação |
|---|---|---|---|
| R-01 | Sem antivírus nos uploads | Média | Extensões, download autenticado e `nosniff`; adicionar scan |
| R-02 | Documentos sem criptografia em repouso | Média | Permissões `0700/0600`; roadmap |
| R-03 | Rate limit de login por IP | Média | Adicionar limite por conta + alerta |
| R-04 | 2FA opcional (inclusive admin) | Média | Exigir 2FA para admin em produção |
| R-05 | Auditoria sem expurgo automático | Baixa | Job de retenção |
| R-06 | Single-tenant | Média | Não expor para múltiplas imobiliárias |
| R-07 | Sem controles de página na UI | Baixa | API pagina; interface avisa truncamento |
| R-08 | Sem observabilidade estruturada | Baixa | Logs + `/api/health`; evoluir para métricas |
| R-09 | Restauração de backup não automatizada | Média | Teste mensal; automatizar em staging |
| R-10 | Revisão jurídica de LGPD pendente | Média | Controles técnicos prontos |
| R-11 | Sem E2E de navegador real | Baixa | jsdom cobre renderização; adicionar Playwright |
| R-12 | Sem lint/tipos | Baixa | `npm run check` + testes |
| R-13 | `xlsx` de CDN sem CVE automatizado | Média | `deps:check`; revisão manual |
| R-14 | Interface sem navegação de páginas | Baixa | Aviso de truncamento |
| R-15 | Mídia de demonstração no Git | Informativa | LFS/release quando pesar |

## 7. Testes de segurança automatizados

| Suíte | O que cobre |
|---|---|
| `tests/seguranca.test.mjs` | TOTP (RFC 6238), base32, AES-GCM (ida/volta e adulteração), recovery de uso único, política de senha, hash de token |
| `tests/api.test.mjs` | 401/403, CSRF por `Origin`, troca de senha exigida no servidor, último admin, auditoria, bloqueio de cadastro com contrato ativo, paginação com total |
| `tests/rules.test.mjs` | Precedência de taxas, snapshot de repasse, CSV injection, juros em baixa parcial |
| `tests/features.test.mjs` | CRC16/EMV do Pix, txid, saldo no Pix, chave inválida, WhatsApp, recorrência, reajuste, rescisão, comissões, DRE |
| `tests/conciliacao.test.mjs` | OFX/CSV, deduplicação por FITID, sugestão por valor/data, **txid como dica**, valor obrigatório, confirmação e bloqueio de repetição |
| `tests/relatorios.test.mjs` | Fórmula em CSV, `;` e acentos, XLSX relido, PDF válido com e sem dados |

## 8. Recomendações priorizadas

1. **Exigir 2FA para administradores** em produção (R-04).
2. **Limite de login por conta além do IP** e alerta de bloqueio (R-03).
3. **Política de dupla conferência** para baixas manuais e conciliações acima de
   um limite (P-02/P-14).
4. **Chave Pix EVP dedicada** e revisão da exposição em `/api/integracoes/status`
   (P-07).
5. **Job de retenção** de auditoria e de `comunicacoes` (R-05/P-12).
6. **Processar planilhas em worker** e acompanhar CVE do SheetJS (P-13/R-13).
7. **Antivírus/criptografia** nos uploads (R-01/R-02).
8. **Teste de restauração** mensal automatizado (R-09).

## 9. Divulgação responsável

Não abra issue pública para vulnerabilidades. Siga a
[SECURITY.md](../SECURITY.md): relato privado ao mantenedor, com versão/commit,
impacto, reprodução e evidência. Não acesse, altere ou divulgue dados de
terceiros durante a verificação. Após a correção, o caso é registrado no
`CHANGELOG.md` sem detalhes que facilitem exploração.

## 10. Histórico de revisões

| Versão | Data | Mudança |
|---|---|---|
| 0.8.1 | 2026-11 | Documento criado; capítulo Pix (P-01…P-14), validação de chave/tamanho EMV, txid como dica de conciliação e runbook |
| 0.8.0 | 2026-11 | Endurecimento: troca de senha no servidor, seed opt-in, health real, fontes locais, guarda do `xlsx` |
| 0.6.0 | 2026-11 | Revisão técnica inicial (A-01…A-14 e R-01…R-12) |
