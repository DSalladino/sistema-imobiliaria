# Estudo de caso — Sistema de Gestão da Imobiliária

> Sistema desenvolvido para uma imobiliária familiar de pequeno porte, com o objetivo de substituir
> planilhas e mensagens por uma fonte única, auditável e acessível pelo celular.

## Cenário

A empresa administra imóveis de terceiros, calcula repasses e precisa prestar contas aos proprietários.
O processo anterior dependia de planilhas, mensagens e conhecimento tácito: taxas diferentes por
proprietário, contratos antigos com condições próprias e repasses difíceis de explicar.

## Problema

- Informação espalhada e sem fonte única.
- Renovações e reajustes descobertos em cima da hora.
- Repasse manual, sujeito a erro e sem extrato claro.
- Nenhuma trilha de quem alterou o quê.
- Nenhuma visão consolidada de receita, inadimplência e ocupação.

## Restrições

- Até **5 usuários**, a maioria administrativa.
- Uso em **computadores e celulares**, pela internet.
- **Sem perda de informação**.
- Custo de hospedagem o mais baixo possível.
- Regras de negócio precisam ser editáveis sem programador.

## Solução

Um sistema web com:

- cadastros e contratos com **precedência de taxas** (geral → proprietário → imóvel → contrato);
- **dois caixas** separados (imobiliária e proprietários);
- **cobranças** mensais com baixa, multa/juros, régua e aging;
- **repasse** com snapshot e extrato explicando cada valor;
- **conciliação bancária** OFX/CSV;
- documentos com versões e pré-visualização;
- alertas, relatórios PDF/Excel, importação de planilhas e dashboard analítico;
- 2FA, LGPD, auditoria e backup com verificação de integridade.

## Decisões técnicas e por quê

| Decisão | Motivo |
|---|---|
| Node.js + SQLite | Um processo, um arquivo, backup simples; suficiente para 5 usuários |
| Monólito | Menos partes para operar; deploy e diagnóstico simples |
| Dinheiro em centavos | Evita erro de arredondamento em valores financeiros |
| Snapshot do repasse | Taxa futura não reescreve competência passada |
| Estorno em vez de exclusão | Histórico confiável e auditável |
| SPA sem framework | Longevidade, zero build, carregamento leve |
| Gráficos SVG próprios | Sem dependência de biblioteca de charts |
| Caddy + HTTPS | Certificado automático, configuração mínima |
| Backup externo diário | Banco e documentos sobrevivem à perda do servidor |

## Desafios

### Precedência de regras
O maior risco era aplicar a taxa errada. A solução foi resolver a precedência em uma função única,
testada, e gravar a origem da taxa em cada repasse. O extrato mostra “Regra do proprietário” ou
“Exceção do contrato”, o que torna o cálculo explicável.

### Dois caixas
Misturar aluguel de terceiros com receita própria distorce o resultado. Separar os caixas e tratar o
repasse como saída do caixa dos proprietários resolveu a contabilidade e a confiança no saldo.

### Fechamento sem apagar
Fechar o mês bloqueia alterações; reabrir exige admin e motivo. Correções usam estorno, preservando o
histórico. Isso foi mais importante do que qualquer tela bonita.

### Cobranças
O sistema registrava só o que entrava. A camada de cobranças permitiu saber o que **deveria** entrar,
calcular inadimplência real, gerar em lote e conciliar o extrato.

### Segurança
O sistema passou por um checklist de 21 pontos: credenciais padrão, política de senha, sessão, rate
limit, CSRF, CSP, upload, path traversal, dependências, auditoria e LGPD. O resultado está em
`docs/checklist-seguranca.md`.

### Mobile
Tabelas largas não funcionam no celular. Cobranças e conciliação usam cartões; as demais tabelas têm
rolagem horizontal; os gráficos reduzem rótulos em telas estreitas.

## Resultados

- Fluxo único para cadastro, cobrança, caixa, repasse e relatório.
- Repasse explicável linha a linha.
- Inadimplência medida por cobrança, com aging.
- Histórico de alterações e estornos.
- Operação possível pelo navegador do celular.
- Implantação de baixo custo (VPS pequena + backup externo).

## Lições aprendidas

- Regra de negócio bem modelada vale mais que tela.
- “Nada se apaga” simplifica auditoria e confiança.
- Dinheiro em centavos e snapshot evitam discussões futuras.
- Segurança precisa ser checklist, não inspiração.
- Documentação e testes são parte do produto, não extras.

## Próximos passos

Contas a pagar/receber com previsão de caixa, reajuste em lote, rescisão, DRE, comissões, manutenção,
permissões granulares, notificações automáticas, portal do proprietário e OCR de documentos. O roadmap
está em `docs/roadmap.md`; o estado atual, em `docs/ESTADO-ATUAL.md`.
