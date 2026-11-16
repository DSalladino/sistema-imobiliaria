# Política de segurança

## Versões suportadas

Correções de segurança são aplicadas na versão estável publicada em `main`.

| Versão | Suporte |
|---|---|
| 0.6.x | Sim |
| Anteriores | Recomenda-se atualizar |

## Como reportar uma vulnerabilidade

Não abra uma issue pública para vulnerabilidades. Envie um relato privado ao mantenedor do
repositório com:

- versão ou commit afetado;
- descrição do problema e impacto;
- passos para reproduzir;
- evidência ou prova de conceito, quando aplicável;
- sugestão de correção, se houver.

O relato será analisado e respondido com prazo estimado de correção. Evite acessar, alterar ou
divulgar dados de terceiros durante a verificação.

## Escopo

Fazem parte do escopo:

- autenticação, sessões, recuperação de senha e 2FA;
- autorização por perfil e isolamento de dados;
- injeção de SQL, XSS, CSRF, path traversal e upload de arquivos;
- exposição de dados pessoais, documentos e backups;
- configuração de produção, HTTPS e cabeçalhos de segurança;
- dependências com vulnerabilidades conhecidas.

## Práticas adotadas

- Senhas com `scrypt` e comparação em tempo constante.
- Política mínima de senha e bloqueio de senhas comuns.
- Sessão com token de 256 bits, armazenado no banco apenas como hash.
- Cookie `HttpOnly`, `SameSite=Lax` e `Secure` sob HTTPS.
- 2FA TOTP opcional, com segredo cifrado e códigos de recuperação protegidos.
- Rate limit para login, 2FA, API, importação e recuperação de senha.
- Validação de `Origin` e `Sec-Fetch-Site` para requisições que alteram estado.
- Consultas SQL parametrizadas e validação de referências.
- Escape de saída no frontend e Content Security Policy restritiva.
- Upload com limite de tamanho, extensões permitidas, nome aleatório e download autenticado.
- Banco, uploads e backups com permissões restritas no sistema operacional.
- Backup em ZIP inclui banco, documentos e, quando existir, `.app-key`; o arquivo é tratado como confidencial.
- Auditoria de login, alterações, estornos, fechamentos, importações, backups e LGPD.
- Exportações CSV protegidas contra injeção de fórmula.

## Recomendações de produção

- Publicar atrás de HTTPS (Caddy ou proxy equivalente).
- Manter `HOST=127.0.0.1` e usar `TRUST_PROXY=1` somente atrás do proxy.
- Definir `APP_SECRET` forte e guardá-lo no gerenciador de senhas. Se não for
  definido, o sistema cria `data/.app-key`; perder esse arquivo quebra o 2FA.
- Configurar `PUBLIC_URL` para os links de recuperação de senha.
- Executar backup externo diário e testar a restauração periodicamente.
- Manter `npm audit` limpo e atualizar dependências.
- Revisar os fluxos de LGPD e a retenção de dados com apoio jurídico.

## Divulgação

Após a correção, o problema pode ser documentado no `CHANGELOG.md` sem expor dados sensíveis ou
detalhes que facilitem exploração.
