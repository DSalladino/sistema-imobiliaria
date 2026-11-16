# Checklist de segurança — 21 pontos

Este documento aplica ao sistema um checklist de 21 pontos de segurança para aplicações web. Os
pontos vão de credenciais e sessão até permissão de banco, upload de arquivo e auditoria final.

Cada ponto abaixo tem **status**, **evidência** e **o que ainda falta**.

Legenda: **OK** · **Corrigido** · **Parcial** · **Pendente** · **Risco aceito**

| # | Ponto | Status | O que foi feito / evidência |
|---|---|---|---|
| 1 | Nenhum segredo no código ou no front-end | **OK** | Não há chaves de API, tokens ou senhas no código. Sessão é server-side; o banco fica em `data/`, fora de `public/` e ignorado pelo Git. Nenhum segredo vai para o JavaScript do navegador. |
| 2 | Credenciais padrão removidas | **Corrigido** | A senha inicial continua existindo para o primeiro acesso, mas o sistema **obriga a troca antes de abrir o painel**. A dica de credenciais foi removida da tela de login. |
| 3 | Hash de senha forte com salt | **OK** | `scrypt` com salt aleatório de 16 bytes e 64 bytes de hash; comparação com `timingSafeEqual`. E-mail inexistente também executa um hash dummy para não vazar tempo de resposta. |
| 4 | Política de senha | **Corrigido** | Mínimo de 8 caracteres; bloqueia senhas comuns (`admin123`, `12345678`, etc.) e senhas que contenham o e-mail. Aplicado no cadastro, na troca e no reset. |
| 5 | Sessão segura | **Corrigido** | Token de 256 bits, cookie `HttpOnly`, `SameSite=Lax`, `Secure` quando HTTPS, validade de 7 dias, invalidação no logout e nas outras sessões ao trocar a senha. Sessões expiradas são apagadas. |
| 6 | Rate limiting | **Corrigido** | Login: 10 tentativas/5 min por IP, com `Retry-After` e auditoria do bloqueio. 2FA: 10 códigos/5 min. API: 600 req/min por IP. Importação: 30/10 min. |
| 7 | Autorização no servidor | **OK** | Papéis `admin`, `operador` e `consulta`; toda rota sensível chama `exigir()` no backend. Esconder botão no front não é a proteção. |
| 8 | Sem IDOR / acesso indevido | **Parcial** | O sistema é single-tenant: todos os usuários autenticados veem os dados da mesma imobiliária, e a escrita é limitada por papel. Para multiempresa será necessário escopar cada consulta por empresa — está no roadmap. |
| 9 | SQL injection | **OK** | Consultas com `?` e parâmetros. Filtros dinâmicos usam apenas IDs numéricos validados (`Number.isFinite`) e nomes de tabela/ordenação fixos no código. |
| 10 | XSS | **OK** | Dados vindos do banco são escapados na renderização; `textContent` em mensagens; CSP sem `unsafe-inline` para scripts. Não há `eval` nem HTML cru de usuário. |
| 11 | CSRF | **Corrigido** | `SameSite=Lax` + exigência de `Content-Type: application/json` + validação de `Origin` em POST/PUT/PATCH/DELETE. Formulário cross-site não consegue enviar JSON. |
| 12 | Cabeçalhos de segurança | **Corrigido** | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` e `Strict-Transport-Security` quando HTTPS. |
| 13 | Erros não vazam detalhes | **Corrigido** | Cliente recebe “Erro interno. Tente novamente.”; o stack trace fica apenas no log do servidor. Erros de validação continuam claros e sem dados internos. |
| 14 | Upload de arquivo seguro | **Corrigido** | Planilhas: limite de 12 MB, 5.000 linhas e 60 colunas, leitura em memória. Documentos: 10 MB por arquivo, extensões permitidas (PDF, imagem, Word, Excel, CSV, TXT), nome interno aleatório, gravação em `data/uploads` (fora de `public/`), download autenticado, versionamento e auditoria. |
| 15 | Validação de entrada | **OK** | Campos obrigatórios, tipos, datas, percentuais entre 0 e 100, valores positivos e referências existentes (proprietário/imóvel) validadas no servidor. |
| 16 | Path traversal | **Corrigido** | Arquivos estáticos resolvidos com `path.resolve` + `path.relative`; qualquer caminho que saia de `public/` é bloqueado. Arquivo inexistente com extensão retorna 404 (não devolve o HTML). |
| 17 | Banco e backup protegidos | **OK** | `data/` fora do diretório público e no `.gitignore`; backup só para admin, em `.zip` com o banco e a pasta de documentos, gerado com `VACUUM INTO`; verificação de integridade abre o banco gerado e confere as tabelas; restauração documentada no README. |
| 18 | Dependências auditadas | **Pendente / risco aceito** | `npm audit` aponta **1 alta no `xlsx` 0.18.5** (prototype pollution e ReDoS, sem correção no npm) e **3 moderadas no `archiver`/`minimatch`** (DoS por glob, usado apenas no backup administrativo sem glob do usuário). Mitigações: limites de planilha, backup restrito ao admin e uso interno. Ação recomendada: migrar para o SheetJS 0.20+ e revisar o `archiver` antes de produção. |
| 19 | Auditoria de ações sensíveis | **OK** | Registra login, falha e bloqueio de login, criação/alteração/desativação, estorno, cálculo e pagamento de repasse, fechamento/reabertura, importação, backup e troca de senha. Tela de auditoria restrita ao admin. |
| 20 | HTTPS, proxy e 2FA | **Parcial** | **2FA TOTP implementado** (QR Code, códigos de recuperação, reset pelo admin, segredo criptografado com `APP_SECRET`/chave local) e códigos mascarados para consulta. Em produção falta publicar atrás de HTTPS (Nginx/Caddy), definir `TRUST_PROXY=1` e ativar HSTS (já automático sob HTTPS). |
| 21 | Backup testado, LGPD e auditoria final | **Parcial** | Backup, verificação de integridade e restauração documentada; exportação e anonimização de dados do titular implementadas; falta **executar o teste de restauração periodicamente** e concluir a revisão jurídica de LGPD. Esta tabela é a auditoria final deste ciclo. |

## O que foi alterado nesta rodada

- Troca de senha obrigatória no primeiro acesso e remoção da dica de credenciais da tela.
- Senha mínima de 6 para 8 caracteres, com bloqueio de senhas comuns e do e-mail.
- Rate limit de login, de API e de importação, com `Retry-After` e auditoria.
- Validação de `Origin`, exigência de JSON e cabeçalhos de segurança/CSP.
- Erros internos genéricos para o cliente.
- Limites de upload e proteção contra path traversal.
- Proteção contra timing attack no login.
- Sessões expiradas limpas e cookie `Secure` sob HTTPS.
- `TRUST_PROXY=1` para deployments atrás de proxy.

## Como repetir a verificação

```bash
npm test          # API, relatórios e interface (inclui login e troca de senha)
npm audit         # dependências
```

Testes manuais recomendados antes de publicar:

1. abrir o login e confirmar que a senha padrão **não** entra direto no painel;
2. errar a senha 10 vezes e confirmar o bloqueio temporário;
3. tentar enviar um formulário de outro domínio e confirmar o 403 de origem;
4. tentar acessar `http://localhost:3000/../data/imobiliaria.db` e confirmar o bloqueio;
5. enviar uma planilha acima de 12 MB e outra com mais de 5.000 linhas;
6. baixar o backup e restaurar em uma cópia, conferindo os totais do painel;
7. rodar `npm audit` e registrar as pendências.

## Roteiro para a próxima auditoria

Verifique e classifique por severidade: segredos no código e no front-end, credenciais padrão, hash e
política de senha, sessão e cookies, rate limiting, autorização em cada rota, IDOR, SQL injection, XSS,
CSRF, CSP e cabeçalhos, vazamento de erros, upload de arquivo, path traversal, dependências
vulneráveis, logs/auditoria, backup e LGPD. Para cada achado, registre arquivo e linha, impacto
prático, evidência e correção mínima. No fim, gere uma tabela com status
OK/Corrigido/Parcial/Pendente e uma lista priorizada do que corrigir primeiro.

## Pendências priorizadas

1. **Atualizar o `xlsx`** para uma versão sem as advisories (alta prioridade).
2. **Publicar com HTTPS** e `TRUST_PROXY=1`, testando HSTS e cookies `Secure`.
3. **Testar a restauração** do backup em uma cópia e registrar o resultado.
4. **2FA** para admin e operadores.
5. **LGPD**: base legal, retenção, exportação/exclusão e revisão jurídica.
6. **Multiempresa**: escopo por empresa em todas as consultas (quando fizer sentido).
