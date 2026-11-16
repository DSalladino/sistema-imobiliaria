# Análise de funcionalidades — o que acrescentar e em que ordem

Este documento parte do que o sistema já faz e propõe o que traz mais retorno para uma imobiliária
de pequeno/médio porte. A ordem combina **impacto operacional**, **risco** e **esforço**.

## Onde o sistema está hoje

Já resolvido: cadastros, contratos com precedência de taxas, dois caixas, repasses com extrato,
fechamento mensal, alertas, auditoria, dashboard analítico com gráficos comparativos, importação de
planilhas, relatórios em Excel/PDF, documentos com versionamento/preview, envio manual de
WhatsApp/e-mail, **cobranças com geração em lote e régua**, **conciliação OFX/CSV**, **2FA**, e
**exportação/anonimização LGPD**.

O que ainda gera trabalho manual todos os meses:

1. lançar os aluguéis recebidos contrato a contrato;
2. conferir o extrato bancário;
3. calcular e comunicar reajustes;
4. cobrar inadimplentes sem uma régua organizada;
5. anexar e versionar documentos;
6. avisar proprietários e inquilinos.

As prioridades abaixo atacam exatamente esses pontos.

## Entregue nesta rodada

- Camada de **cobranças** com geração mensal em lote, baixa integral/parcial, multa e juros,
  estorno, cancelamento, aging e régua de cobrança com próxima ação.
- **Conciliação OFX/CSV** com sugestão de cobrança/repasse/lançamento e confirmação humana.
- **2FA TOTP** com QR Code, códigos de recuperação e reset pelo admin.
- **Documentos** com versões, pré-visualização de PDF/imagem e validade.
- **LGPD**: exportação do titular em JSON, anonimização preservando o financeiro e CPF mascarado
  para o perfil consulta.
- **Backup** em `.zip` com banco + documentos e verificação de integridade.

## Prioridades que continuam abertas

| # | Funcionalidade | Por que | Esforço |
|---|---|---|---|
| 1 | **Geração mensal de aluguéis em lote** | Hoje cada recebimento é lançado manualmente. Um botão “gerar competência” cria as parcelas previstas de todos os contratos ativos, e a baixa é feita uma a uma. | Baixo |
| 2 | **Baixa e conciliação de pagamentos** | Marcar “pago” com data, valor e forma; base para inadimplência confiável. | Baixo |
| 3 | **Régua de cobrança** | Status por contrato (a vencer, vencido, em cobrança, acordo, jurídico), histórico de contatos e próxima ação. Transforma alerta em processo. | Médio |
| 4 | **Multa e juros no cálculo** | As configurações já existem, mas ainda não entram no valor devido. Fecha o ciclo financeiro. | Baixo |
| 5 | **Reajuste assistido** | Informar o índice do período, calcular o novo aluguel, gerar o termo e atualizar o contrato com trilha. | Médio |
| 6 | **Anexos com versionamento e pré-visualização** | O upload já existe por proprietário, imóvel, inquilino e contrato. Falta versionar, visualizar PDF/imagem no navegador e permitir anexar no e-mail. | Médio |
| 7 | **Backup automático agendado** | Backup manual depende de alguém lembrar. Agendar, enviar para storage externo e avisar falha. | Baixo |

## Prioridade 1 — 60 a 90 dias

| # | Funcionalidade | Por que | Esforço |
|---|---|---|---|
| 8 | **Contas a pagar e a receber** | Hoje o financeiro é por competência. Vencimentos, parcelas e previsão de caixa mudam a gestão. | Médio |
| 9 | **Importação de extrato bancário (OFX/CSV)** | Conciliação semiautomática: o sistema sugere o contrato pelo valor e nome. Reduz digitação e erro. | Médio |
| 10 | **Portal do proprietário** | Extrato, documentos e informe mensal sem pedir por WhatsApp. Reduz atendimento e aumenta transparência. | Alto |
| 11 | **Portal do inquilino** | Segunda via, informe de rendimentos, abertura de chamados e histórico. | Alto |
| 12 | **Manutenção com aprovação digital** | Orçamento, aprovação do proprietário acima do limite, fornecedor e ordem de serviço. O limite já está configurado. | Médio |
| 13 | **Comissões e metas** | Se houver corretores: comissão por contrato, repasse e painel de metas. | Médio |
| 14 | **Notificações automáticas** | O envio manual de WhatsApp/e-mail já funciona. A automação (vencimento, atraso e reajuste) ainda exige e-mail transacional e API oficial do WhatsApp. | Médio |
| 15 | **Relatórios comparativos avançados** | Ano a ano, por bairro, tipo de imóvel, proprietário e inadimplência por carteira. | Baixo |
| 16 | **Previsão de receita e caixa** | Projeção com base nos contratos ativos, reajustes e despesas recorrentes. Ajuda a decidir com antecedência. | Médio |

## Prioridade 2 — evolução estrutural

| # | Funcionalidade | Por que | Esforço |
|---|---|---|---|
| 17 | **Multiempresa / filiais** | Separar caixas, usuários e relatórios por unidade. Muda o modelo de dados. | Alto |
| 18 | **Aplicativo/PWA** | Uso em campo, vistoria com fotos e assinatura offline. | Alto |
| 19 | **Assinatura digital de contratos** | Integração com provedor (Clicksign, D4Sign, DocuSign). Reduz papel e prazo. | Médio/Alto |
| 20 | **Integração contábil** | Exportação no layout do contador, conciliação de contas e plano de contas. | Médio |
| 21 | **API pública e webhooks** | Integrar site, portais imobiliários e CRM. | Médio |
| 22 | **2FA e políticas de acesso** | Segundo fator, expiração de sessão, política de senha e bloqueio por tentativas. | Médio |
| 23 | **LGPD operacional** | Base legal, consentimento, retenção, exportação e exclusão de dados, registro de tratamento. | Médio |
| 24 | **Auditoria com diff visual e restauração** | Ver o antes/depois de cada campo e restaurar um registro. Hoje o log já guarda o JSON. | Baixo/Médio |

## Melhorias de produto que valem a pena

- **Qualidade de dados**: validar CPF/CNPJ, evitar duplicidade por documento e preencher endereço por CEP.
- **Central de pendências**: uma tela que junta contrato vencendo, aluguel em aberto, garantia
  acabando e repasse não pago, com responsável e prazo.
- **Modelos de documentos**: recibo, extrato, termo de reajuste e aviso de rescisão em PDF.
- **Histórico do imóvel**: contratos anteriores, reajustes, manutenções e documentos em uma linha do tempo.
- **Acessibilidade**: navegação por teclado, contraste e textos alternativos nos gráficos.
- **Modo offline de leitura** para consulta de contratos e vencimentos em campo.

## O que eu não recomendaria fazer agora

- **Boleto/Pix próprio**: exige banco/adquirente, conciliação e responsabilidade financeira. Melhor
  integrar um provedor especializado quando houver volume.
- **WhatsApp 100% automático antes da régua de cobrança**: automatizar um processo mal definido só
  acelera o erro. Primeiro o fluxo, depois a automação paga.
- **App nativo**: o sistema já é responsivo. Um PWA resolve o uso em campo com muito menos custo.
- **Microserviços**: com este volume, um processo Node + SQLite é mais simples, barato e fácil de
  fazer backup. Separar só quando houver necessidade real de escala ou times distintos.

## Sequência sugerida

**30 dias** — geração mensal em lote, baixa de pagamentos, multa/juros e backup automático.
Isso reduz a operação manual e torna a inadimplência confiável.

**60 dias** — régua de cobrança, reajuste assistido, anexos versionados e contas a receber.
Isso organiza o ciclo completo do contrato.

**90 dias** — conciliação bancária, portal do proprietário e notificações automáticas.
Isso diminui atendimento e aumenta a percepção de profissionalismo.

Cada entrega deve vir com teste automatizado e uso em paralelo com a planilha, como já previsto no
plano de implantação.
