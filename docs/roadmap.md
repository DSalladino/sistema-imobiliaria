# Roadmap

Prioridades de evolução do produto. A ordem combina **impacto operacional**,
**risco** e **esforço**. Itens concluídos saem daqui e entram no
[CHANGELOG](../CHANGELOG.md).

> **Versão atual:** 0.6.0 · **Última revisão:** novembro de 2026

## Onde estamos

Já está pronto e em uso:

- cadastros, contratos e precedência de taxas;
- cobranças com geração em lote, baixa, multa/juros, estorno, aging e régua;
- conciliação bancária OFX/CSV com confirmação humana;
- dois caixas, repasses com snapshot, fechamento mensal;
- documentos versionados com pré-visualização e validade;
- importação de planilhas, relatórios CSV/XLSX/PDF;
- painel analítico, alertas, comunicação manual por WhatsApp/e-mail;
- 2FA, auditoria, LGPD, backup com verificação de integridade.

O trabalho manual que ainda sobra:

1. comunicar reajustes e rescisões com documentos gerados;
2. controlar contas a pagar e prever caixa;
3. acompanhar manutenção e orçamentos;
4. atender proprietários e inquilinos sem acesso ao sistema;
5. operar com permissões mais finas e possibilidade de filiais.

## Fase 1 — Consolidação (0.7)

Foco: fechar ciclos do contrato e reduzir trabalho manual recorrente.

| Item | Por que | Esforço | Status |
|---|---|---|---|
| **Reajuste assistido em lote** | Calcular pelo índice, gerar termo e atualizar contrato com trilha | Médio | planejado |
| **Rescisão de contrato** | Multa, saldo, vistoria, devolução de caução e encerramento correto | Alto | planejado |
| **Contas a pagar/receber** | Vencimentos, recorrência e previsão de caixa de 12 meses | Médio | planejado |
| **Modelos de documento** | Recibo, extrato, termo de reajuste e aviso de rescisão em PDF | Médio | planejado |
| **Notificações automáticas** | Vencimento, atraso e reajuste por e-mail; WhatsApp via API oficial | Médio | planejado |
| **DRE por proprietário/imóvel** | Resultado e rateio de despesas por carteira | Médio | planejado |

## Fase 2 — Transparência (0.8)

Foco: reduzir atendimento e dar autonomia a proprietários e inquilinos.

| Item | Por que | Esforço | Status |
|---|---|---|---|
| **Portal do proprietário** | Extrato, documentos e informe mensal sem pedir por WhatsApp | Alto | planejado |
| **Portal do inquilino** | Segunda via, informe de rendimentos e chamados | Alto | planejado |
| **Central de manutenção** | Orçamento, aprovação acima do limite, fornecedor e ordem de serviço | Médio | planejado |
| **Histórico do imóvel** | Linha do tempo de contratos, reajustes, manutenções e documentos | Baixo | planejado |
| **Dashboard por bairro/tipo** | Decisão de carteira e pipeline de renovação | Baixo | planejado |
| **Acessibilidade e PWA** | Navegação por teclado, contraste, uso offline de leitura | Médio | planejado |

## Fase 3 — Escala e integrações (0.9+)

Foco: atender mais operações e integrar o ecossistema.

| Item | Por que | Esforço | Status |
|---|---|---|---|
| **Multiempresa/filiais** | Separar caixas, usuários e relatórios por unidade | Alto | planejado |
| **Permissões granulares** | Restringir por módulo, proprietário ou carteira | Médio | planejado |
| **Comissões e metas** | Comissão por contrato e painel de metas | Médio | planejado |
| **Assinatura digital** | Clicksign/D4Sign/DocuSign | Médio | planejado |
| **Integração contábil** | Exportação no layout do contador e plano de contas | Médio | planejado |
| **API pública e webhooks** | Integrar site, portais imobiliários e CRM | Médio | planejado |
| **Observabilidade** | Logs estruturados, métricas e alertas de erro | Baixo | planejado |

## Melhorias contínuas (qualquer fase)

- Validar CPF/CNPJ e evitar duplicidade por documento.
- Preencher endereço por CEP.
- Antivírus no upload e criptografia dos arquivos em repouso.
- Backup offsite automático com teste de restauração.
- Testes end-to-end de navegador e acessibilidade automatizada.
- Paginação e busca full-text em listas grandes.
- Lint/formatador e verificação de tipos (JSDoc ou TypeScript).
- Logs de auditoria com diff visual e restauração de registro.

## Não recomendado agora

| Ideia | Motivo |
|---|---|
| **Boleto/Pix próprio** | Exige banco/adquirente, conciliação e responsabilidade financeira. Melhor integrar um provedor especializado quando houver volume. |
| **WhatsApp 100% automático antes da régua** | Automatizar um processo mal definido acelera o erro. Primeiro o fluxo, depois a API paga. |
| **App nativo** | O sistema já é responsivo; um PWA resolve o uso em campo com menos custo. |
| **Microserviços** | Com este volume, um processo Node + SQLite é mais simples, barato e fácil de fazer backup. |
| **Multi-tenant antes de ter clientes** | Complexidade e risco de vazamento entre empresas sem demanda real. |

## Como priorizar uma nova ideia

1. Ela elimina trabalho manual recorrente?
2. Ela reduz risco financeiro ou de conformidade?
3. Ela melhora a confiança do proprietário/inquilino?
4. Ela cabe em uma entrega testável e documentada?
5. Ela mantém a operação simples para uma equipe pequena?

Se a resposta for “não” para a maioria, a ideia entra em “ideias futuras”, não no
roadmap ativo.
