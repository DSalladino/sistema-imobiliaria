# API HTTP

A API é interna ao frontend, mas segue um contrato estável o suficiente para
integrações e testes. Ela não é versionada por URL (`/v1`); mudanças incompatíveis
devem ser registradas no [CHANGELOG](../CHANGELOG.md).

## Convenções

| Item | Regra |
|---|---|
| Base | `/api` |
| Formato | JSON UTF-8 (`application/json`) |
| Autenticação | Cookie de sessão `sid` (`HttpOnly`, `SameSite=Lax`) |
| Erros | `{ "erro": "mensagem legível" }` |
| Sucesso | Recurso ou `{ "ok": true }` |
| Datas | `YYYY-MM-DD`; competência `YYYY-MM` |
| Dinheiro | Inteiro em centavos (`180000` = R$ 1.800,00) |
| Cache | `Cache-Control: no-store` nas respostas da API |

### Códigos de status

| Código | Significado |
|---|---|
| `200` | OK |
| `201` | Criado |
| `400` | Dados inválidos ou regra de negócio violada |
| `401` | Não autenticado / credenciais inválidas |
| `403` | Sem permissão ou origem cruzada bloqueada |
| `404` | Recurso ou rota não encontrada |
| `409` | Conflito (mês fechado, cobrança já paga, duplicidade) |
| `413` | Corpo grande demais |
| `415` | `Content-Type` diferente de JSON em escrita |
| `429` | Rate limit; consulte `Retry-After` |
| `500` | Erro interno genérico |
| `502` | Falha de integração externa (ex.: SMTP) |

### CSRF e escrita

Toda requisição `POST`, `PUT`, `PATCH` ou `DELETE` em `/api` precisa:

1. enviar `Content-Type: application/json` (quando houver corpo);
2. não vir de outro site: `Origin` e `Host` devem coincidir e
   `Sec-Fetch-Site: cross-site` é recusado.

O cookie `SameSite=Lax` complementa a proteção. Não há token CSRF separado.

### Rate limit

| Escopo | Limite |
|---|---|
| Login por IP | 10 tentativas / 5 min |
| 2FA por IP | 10 tentativas / 5 min |
| API por IP | 600 requisições / min |
| Importação por IP | 30 / 10 min |
| Comunicação por IP | 30 / 10 min |
| Recuperação de senha por IP | 5 / 15 min |
| Cadastro público por IP | 5 / hora |

## Autenticação e sessão

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/api/health` | público | Status, versão e uptime (verifica o banco) |
| `POST` | `/api/login` | público | E-mail + senha; devolve usuário ou desafio 2FA |
| `POST` | `/api/login/2fa` | público | Código TOTP ou de recuperação |
| `POST` | `/api/logout` | autenticado | Encerra a sessão atual |
| `GET` | `/api/me` | autenticado | Usuário da sessão |
| `POST` | `/api/me/senha` | autenticado | Troca a própria senha |
| `POST` | `/api/esqueci-senha` | público | Cria link de recuperação (resposta genérica) |
| `GET` | `/api/reset/validar?token=` | público | Valida o token de recuperação |
| `POST` | `/api/resetar-senha` | público | Define nova senha com token |
| `GET` | `/api/primeiro-acesso` | público | Dica de primeiro acesso (e-mail do admin) |
| `GET` | `/api/cadastro/status` | público | Se o autocadastro está habilitado |
| `POST` | `/api/cadastro` | público | Solicita acesso (usuário inativo) |
| `GET` | `/api/2fa/status` | autenticado | Se o 2FA está ativo |
| `POST` | `/api/2fa/iniciar` | autenticado | Gera segredo + QR Code |
| `POST` | `/api/2fa/ativar` | autenticado | Confirma código e gera códigos de recuperação |
| `POST` | `/api/2fa/desativar` | autenticado | Desativa com senha + código |
| `POST` | `/api/usuarios/:id/resetar-2fa` | admin | Remove o 2FA de um usuário |
| `POST` | `/api/usuarios/:id/resetar-senha` | admin | Gera senha temporária |
| `GET` | `/api/reset/solicitacoes` | admin | Pedidos de recuperação/cadastro |

### Exemplo de login

```bash
curl -s -c cookies.txt http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@imobiliaria.local","senha":"SuaSenha#2026"}'
```

Resposta sem 2FA:

```json
{
  "usuario": {
    "id": 1,
    "nome": "Administrador",
    "email": "admin@imobiliaria.local",
    "papel": "admin",
    "deve_trocar_senha": false,
    "totp_ativo": true
  }
}
```

Resposta com 2FA:

```json
{ "requer_2fa": true, "desafio": "token-temporario" }
```

Depois:

```bash
curl -s -b cookies.txt http://127.0.0.1:3000/api/dashboard
```

## Permissões

| Ação | admin | operador | consulta |
|---|---|---|---|
| Ler painel, cadastros, contratos, cobranças, repasses | sim | sim | sim |
| Criar/editar/desativar cadastros | sim | sim | não |
| Financeiro (lançamentos, baixas, conciliação, fechamento) | sim | sim | não |
| Calcular/pagar repasses | sim | sim | não |
| Exportar CSV e relatórios | sim | sim | não |
| Enviar e-mail/WhatsApp | sim | sim | não |
| Configurações, usuários, auditoria, LGPD, manutenção, backup | sim | não | não |

A autorização é aplicada no servidor com `exigir(user, acao)`. Esconder um botão
no frontend não é proteção.

## Cadastros (CRUD genérico)

Entidades: `proprietarios`, `imoveis`, `inquilinos`, `contratos`, `excecoes`.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/api/{entidade}` | leitura | Lista registros |
| `POST` | `/api/{entidade}` | escrita | Cria |
| `PUT` | `/api/{entidade}/:id` | escrita | Atualiza campos enviados |
| `DELETE` | `/api/{entidade}/:id` | escrita | Desativa (ou encerra contrato / remove exceção) |

Exemplo:

```bash
curl -s -b cookies.txt http://127.0.0.1:3000/api/proprietarios \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Maria Souza","cpf_cnpj":"123.456.789-00","taxa_admin_pct":6}'
```

Validações relevantes:

- `nome` obrigatório em proprietários e inquilinos;
- `proprietario_id` e `endereco` obrigatórios em imóveis;
- `imovel_id`, `inquilino_id` e `inicio` obrigatórios em contratos;
- taxa entre 0 e 100;
- datas em `YYYY-MM-DD`;
- referências precisam existir;
- exceção exige contrato, competência, valor e motivo.

## Painel e consultas

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/dashboard` | Resumo do mês, saldos, alertas e repasses pendentes |
| `GET` | `/api/analytics?de=&ate=&comparar=1&proprietario_id=` | KPIs, séries, composição, ocupação e cobranças |
| `GET` | `/api/alertas` | Contratos, reajustes, garantias e atrasos |
| `GET` | `/api/saldos` | Saldo dos dois caixas |
| `GET` | `/api/settings` | Configurações editáveis |
| `PUT` | `/api/settings` | Atualiza configurações (admin) |
| `GET` | `/api/auditoria?limite=200` | Auditoria (admin, máximo 1.000) |

## Lançamentos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/lancamentos?competencia=&caixa=&tipo=` | Lista até 500 lançamentos |
| `POST` | `/api/lancamentos` | Cria receita/despesa |
| `POST` | `/api/lancamentos/:id/estornar` | Estorna com motivo |

Regras de integridade:

- `categoria = Aluguel` exige `caixa = proprietarios`;
- `categoria = Taxa de administração` exige `caixa = imobiliaria`;
- `categoria = Repasse ao proprietário` exige `caixa = proprietarios`;
- contrato, imóvel e proprietário, quando informados juntos, precisam ser coerentes;
- competência fechada recusa a escrita.

## Cobranças

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/cobrancas?competencia=&status=&contrato_id=&busca=` | Lista enriquecida com saldo e aging |
| `GET` | `/api/cobrancas/resumo?competencia=` | Totais, aging, vencidas e próximas ações |
| `GET` | `/api/cobrancas/gerar/preview?competencia=` | Prévia da geração mensal |
| `POST` | `/api/cobrancas/gerar` | Gera cobranças (idempotente) |
| `GET` | `/api/cobrancas/:id` | Detalhe, ações e pagamentos |
| `POST` | `/api/cobrancas/:id/pagar` | Baixa total/parcial |
| `POST` | `/api/cobrancas/:id/estornar` | Estorna a baixa |
| `POST` | `/api/cobrancas/:id/cancelar` | Cancela sem pagamento |
| `POST` | `/api/cobrancas/:id/acao` | Registra contato, promessa, acordo etc. |
| `POST` | `/api/cobrancas/:id/status` | Altera o status da régua |

Exemplo de baixa:

```bash
curl -s -b cookies.txt http://127.0.0.1:3000/api/cobrancas/12/pagar \
  -H 'Content-Type: application/json' \
  -d '{"valor_centavos":180000,"data":"2026-11-10","forma":"pix"}'
```

Status de cobrança: `em_aberto`, `pago_parcial`, `pago`, `cancelado`.
Status da régua: `em_cobranca`, `promessa`, `acordo`, `juridico`.

## Conciliação bancária

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/conciliacao/resumo` | Pendentes, conciliados e valores |
| `GET` | `/api/conciliacao?status=pendente` | Lista transações |
| `POST` | `/api/conciliacao/preview` | Importa OFX/CSV/Excel e sugere vínculos |
| `POST` | `/api/conciliacao/:id/confirmar` | Confirma baixa, repasse, vínculo ou lançamento |

Corpo do preview:

```json
{
  "nome": "extrato.ofx",
  "arquivo_base64": "…",
  "mapeamento": { "data": 0, "valor": 1, "descricao": 2 }
}
```

`mapeamento` é opcional para OFX e para CSV com cabeçalho reconhecível.

## Repasses e fechamento

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/repasses?competencia=` | Repasses da competência |
| `POST` | `/api/repasses/calcular` | Calcula/atualiza repasses |
| `GET` | `/api/repasses/:id` | Detalhe com snapshot e dados bancários |
| `POST` | `/api/repasses/:id/pagar` | Paga e gera lançamentos |
| `GET` | `/api/fechamentos` | Competências fechadas |
| `POST` | `/api/fechamentos` | Fecha competência |
| `POST` | `/api/fechamentos/:competencia/reabrir` | Reabre com motivo (admin) |

## Relatórios e exportações

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/relatorios` | Catálogo dos sete relatórios |
| `GET` | `/api/reports/:tipo.:formato` | Gera relatório (`csv`, `xlsx`, `pdf`) |
| `GET` | `/api/export/lancamentos?competencia=` | CSV de lançamentos |
| `GET` | `/api/export/cobrancas?competencia=` | CSV de cobranças |
| `GET` | `/api/export/repasses?competencia=` | CSV de repasses |
| `GET` | `/api/export/contratos` | CSV de contratos |

Tipos de relatório: `resumo-financeiro`, `lancamentos`, `repasses`, `contratos`,
`inadimplencia`, `proprietarios`, `imoveis`.

Parâmetros: `de`, `ate`, `competencia`, `proprietario_id`.

## Importação

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/import/modelos` | Metadados dos modelos |
| `GET` | `/api/import/modelo/:entidade.:formato` | Baixa modelo `.xlsx` ou `.csv` |
| `POST` | `/api/import/preview` | Analisa sem gravar |
| `POST` | `/api/import/commit` | Importa com transação |

Entidades: `proprietarios`, `imoveis`, `inquilinos`, `contratos`.
Limites: 12 MB, 5.000 linhas, 60 colunas.

## Documentos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/documentos?entidade=&entidade_id=` | Lista versões atuais |
| `POST` | `/api/documentos` | Envia arquivo em base64 |
| `GET` | `/api/documentos/:id/versoes` | Histórico de versões |
| `GET` | `/api/documentos/:id/download?inline=1` | Download ou pré-visualização |
| `DELETE` | `/api/documentos/:id` | Remove a versão ativa |

Limite: 10 MB; extensões `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`,
`.doc`, `.docx`, `.xls`, `.xlsx`, `.csv`, `.txt`.

## Comunicação

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/comunicacao/status` | SMTP, remetente, assinatura e modelos |
| `POST` | `/api/comunicacao/email` | Envia e-mail via SMTP |
| `POST` | `/api/comunicacao/whatsapp` | Valida o telefone e devolve URL `wa.me` |

## LGPD e backup

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/api/lgpd/titular?tipo=&id=` | admin | Exporta os dados do titular em JSON |
| `POST` | `/api/lgpd/anonimizar` | admin | Anonimiza com confirmação `ANONIMIZAR` |
| `GET` | `/api/backup/verificar` | admin | Abre o banco exportado e conta registros |
| `GET` | `/api/backup` | admin | ZIP com banco, documentos e chave local |

## Manutenção

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/api/manutencao/status` | admin | Contagens e arquivos |
| `POST` | `/api/manutencao/limpar` | admin | Zera dados operacionais (`ZERAR`) |
| `POST` | `/api/manutencao/demo` | admin | Recarrega demonstração (`DEMO`) |

## Limitações do contrato

- Não há paginação; listas têm limites fixos (500 a 1.000 registros).
- Não há API pública com chave/token; a autenticação é por cookie de sessão.
- Não há webhooks nem eventos.
- O formato de erro é sempre `{ erro }`.
- A API pode mudar entre versões menores enquanto o projeto estiver em `0.x`.
