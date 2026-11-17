# Qualidade e testes

## Filosofia

O projeto prioriza **testes de comportamento** e **regras de negócio testáveis**
em vez de cobertura artificial de linhas. A suíte usa o test runner nativo do
Node.js (`node:test`), sem framework externo, e bancos temporários — nenhum teste
toca a base real.

## Como executar

```bash
npm ci
npm run check       # sintaxe de todos os .js/.mjs
npm test            # API, regras, interface e seed
npm run test:coverage
npm audit
```

## Arquivos de teste

| Arquivo | Cobertura |
|---|---|
| `tests/api.test.mjs` | Login, troca de senha, sessão hash, CSRF, CRUD, autorização, precedência de taxa, cobrança, baixa, repasse, PDF, backup, fechamento e proteção do último admin |
| `tests/rules.test.mjs` | Precedência de taxas, snapshot do repasse, política de senha, CSV, repasse com contrato encerrado, juros em baixa parcial e importação sem duplicar inquilino |
| `tests/seguranca.test.mjs` | Vetores do RFC 6238 para TOTP, base32, cifragem AES-256-GCM (ida e volta e adulteração), códigos de recuperação de uso único (v1 e v2), política de senha e hash de token de sessão |
| `tests/ui.test.mjs` | Renderiza as 22 telas com dados reais em jsdom e verifica conteúdo |
| `tests/features.test.mjs` | Pix (CRC/EMV), WhatsApp (link e API), contas e recorrência, previsão de caixa, reajuste em lote, rescisão e comissões, DRE por imóvel e geração de CSV |
| `tests/seed.test.mjs` | Primeira execução completa a demonstração com cobranças e repasses |

### O que cada suíte protege

**API**

- `/api/health` responde sem autenticação e verifica o banco;
- credenciais inválidas retornam 401;
- primeiro login exige troca de senha;
- token de sessão é gravado como hash, não em claro;
- cookie de sessão funciona e a senha antiga deixa de valer;
- criação de proprietário, imóvel, inquilino e contrato com auditoria;
- segundo contrato ativo para o mesmo imóvel é rejeitado;
- taxa fora do intervalo e referência inexistente são rejeitadas;
- `Origin` cruzada é bloqueada;
- geração de cobranças, baixa, cálculo e pagamento de repasse;
- relatório PDF responde com `application/pdf`;
- backup ZIP e verificação de integridade;
- mês fechado bloqueia novo lançamento;
- último administrador não pode ser rebaixado.

**Regras**

- contrato > imóvel > proprietário > geral;
- repasse pago mantém snapshot mesmo após alterar a taxa;
- Scrypt e política mínima de senha;
- CSV neutraliza fórmulas, não escapa ponto e vírgula duas vezes e preserva números negativos;
- repasse inclui contrato encerrado que teve aluguel recebido;
- pagamento de repasse não é descontado de nova apuração;
- juros continuam correndo depois de uma baixa parcial;
- importação reutiliza inquilino criado nas linhas anteriores.

**Interface**

- todas as rotas do menu renderizam com dados reais;
- não caem no estado de erro;
- conteúdo esperado aparece em cada tela.

## Estratégia de banco de teste

Cada suíte cria um diretório temporário e define `DATA_DIR` antes de importar
`src/db.js`. O banco é criado do zero, com seed de demonstração. Ao final, o
diretório é removido. O servidor de teste sobe em `PORT=0` (porta aleatória) e é
encerrado no `after`.

Variáveis usadas nos testes:

```bash
DATA_DIR=/tmp/...
PORT=0
SEED_COMPLETO=0
ADMIN_SENHA=admin123
APP_SECRET=segredo-de-teste-com-mais-de-32-caracteres
```

## CI

O workflow `.github/workflows/ci.yml` executa em `push` e `pull_request` para
`main`:

- matriz Node **22** e **24**;
- `npm ci`;
- `npm run check`;
- `npm test`.

O CI não publica artefatos nem faz deploy. A publicação é manual e está em
[deploy/README.md](../deploy/README.md).

## Checklist manual antes de publicar

- [ ] Login com senha inicial exige troca.
- [ ] 2FA ativa, entra com código e com código de recuperação.
- [ ] Criar proprietário, imóvel, inquilino e contrato.
- [ ] Gerar competência e conferir a prévia.
- [ ] Dar baixa total e parcial; conferir saldo e lançamento.
- [ ] Estornar baixa e conferir o lançamento contrário.
- [ ] Calcular repasse e comparar o extrato com os lançamentos.
- [ ] Pagar repasse e conferir os dois caixas.
- [ ] Importar OFX/CSV e conciliar uma transação.
- [ ] Enviar documento, criar nova versão, baixar e remover.
- [ ] Gerar os sete relatórios em CSV, XLSX e PDF.
- [ ] Fechar competência e tentar lançar novamente (deve bloquear).
- [ ] Reabrir com motivo como admin.
- [ ] Exportar e anonimizar um titular de teste.
- [ ] Baixar backup, restaurar em cópia e conferir totais.
- [ ] Testar em celular (360 px) e com teclado.
- [ ] Rodar `npm audit`.

## Lacunas conhecidas

- **Sem lint/formatador** (ESLint/Prettier) configurado.
- **Sem verificação de tipos** (JSDoc ou TypeScript).
- **Sem testes end-to-end de navegador real**; a UI é testada em jsdom.
- **Sem teste automatizado de restauração de backup** (só verificação de
  integridade).
- **Sem teste de carga** ou métrica de performance.
- **Sem teste de acessibilidade automatizado** (axe/pa11y).
- **Sem teste de upload de arquivo real**; o fluxo é coberto por código e teste
  manual.
- **Cobertura de linhas não é meta**; o comando existe para medir tendência, não
  para bloquear merge.

## Regressões cobertas nesta versão

| Regressão | Teste |
|---|---|
| Repasse ignorava contrato encerrado com aluguel recebido | `rules.test.mjs` |
| Pagamento de repasse entrava como despesa de nova apuração | `rules.test.mjs` |
| CSV escapava ponto e vírgula duas vezes | `rules.test.mjs` |
| Importação duplicava inquilino repetido no mesmo arquivo | `rules.test.mjs` |
| Sistema podia ficar sem administrador ativo | `api.test.mjs` |
| Imóvel podia receber dois contratos ativos e gerar cobrança duplicada | `api.test.mjs` |
| Importação podia criar dois contratos ativos para o mesmo imóvel | `importacao.js` + teste manual |
| Juros congelavam após baixa parcial | `rules.test.mjs` |
| Data podia recuar um dia em fuso positivo | revisão de código + helpers locais |

## Padrão para novos testes

1. Prefira testar o comportamento público (API ou função exportada).
2. Use banco temporário; nunca dependa de `data/`.
3. Um teste deve falhar por um motivo claro.
4. Não use `sleep` se puder aguardar um evento.
5. Inclua um caso de sucesso e um de erro para cada regra nova.
6. Se o teste alterar dados globais, restaure-os ao final.
