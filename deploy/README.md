# Publicação em produção — guia prático

Sistema: Node.js + SQLite + arquivos em disco. Precisa de **um servidor com disco persistente**.
Vercel/serverless não serve (disco temporário, sem banco compartilhado, plano Hobby não comercial).

## Resumo da recomendação

| Caminho | Custo | Indicado quando |
|---|---|---|
| **VPS pequena (1 GB RAM, 25 GB)** | ~US$ 4–6/mês (R$ 25–35) | Você quer o menor risco e publicação hoje |
| **Oracle Cloud Always Free** | R$ 0 | Você aceita 2–4 h de configuração e a dependência da Oracle |
| Computador da empresa + túnel | R$ 0 | Já existe um PC que fica ligado 24h e você aceita o risco de queda |
| Vercel | — | **Não serve** para este sistema |

Para “não quebrar”, a VPS paga é a opção mais previsível. Se o custo precisar ser zero, use a Oracle
Always Free com backup externo.

## Custos

- **Servidor:** US$ 4–6/mês (DigitalOcean, Linode, Vultr, Hetzner) ou R$ 0 na Oracle Free.
- **Domínio:** R$ 0 usando `seu-nome.duckdns.org` ou `191-123-45-67.sslip.io`.
- **HTTPS:** R$ 0 (Let's Encrypt via Caddy).
- **Backup:** R$ 0 até 10 GB (Backblaze B2 ou Cloudflare R2) ou Google Drive (15 GB).
- **Monitoramento:** R$ 0 (UptimeRobot).
- **Total:** R$ 0 (Oracle) ou ~R$ 30/mês (VPS).

Um domínio `.com.br` custa cerca de R$ 40/ano, mas não é obrigatório para começar.

---

## Passo a passo — VPS Ubuntu 24.04

### 1. Criar o servidor
- 1 GB de RAM, 25 GB de disco, Ubuntu 24.04.
- Anote o IP público.
- Se for Oracle: libere as portas **80** e **443** na Security List/NSG da VCN.

### 2. Criar o endereço gratuito
**Opção A — DuckDNS:** crie `sua-imobiliaria.duckdns.org` apontando para o IP.
**Opção B — sslip.io:** use `IP-COM-HIFENS.sslip.io` (ex.: `191-123-45-67.sslip.io`), sem cadastro.

Teste: `ping seu-endereco` deve responder o IP do servidor.

### 3. Instalar Node, Caddy e utilitários

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs caddy sqlite3 rclone ufw
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
```

### 4. Criar usuário e copiar o projeto

```bash
sudo useradd -r -m -d /opt/imobiliaria -s /usr/sbin/nologin imobiliaria
# envie o projeto para /opt/imobiliaria (git clone, scp ou zip)
sudo chown -R imobiliaria:imobiliaria /opt/imobiliaria
cd /opt/imobiliaria
sudo -u imobiliaria npm ci --omit=dev
```

> **Produção começa limpa.** Não copie o banco de demonstração. Se já houver dados reais, copie
> `data/imobiliaria.db` e `data/uploads/` com o serviço parado.

### 5. Configurar variáveis

Crie `/etc/imobiliaria.env` (somente root):

```bash
sudo tee /etc/imobiliaria.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=1
APP_SECRET=TROQUE-POR-UMA-FRASE-LONGA-E-ALEATORIA
# SMTP (opcional para enviar e-mail)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
sudo chmod 600 /etc/imobiliaria.env
```

Gere o `APP_SECRET` com:

```bash
openssl rand -hex 32
```

Guarde esse valor no gerenciador de senhas. Sem ele, os segredos de 2FA não são recuperáveis.

### 6. Serviço systemd

Copie `deploy/imobiliaria.service` para `/etc/systemd/system/`:

```bash
sudo cp deploy/imobiliaria.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now imobiliaria
sudo systemctl status imobiliaria
```

### 7. HTTPS com Caddy

Copie `deploy/Caddyfile` para `/etc/caddy/Caddyfile` e troque o domínio:

```bash
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/SEU-DOMINIO/seu-endereco.duckdns.org/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Abra `https://seu-endereco.duckdns.org`. O certificado é emitido automaticamente.

### 7.1 Domínio próprio (Hostinger ou outro registrador)

Pode usar um domínio pago normalmente. O VPS e o domínio não precisam ser do mesmo fornecedor.

1. Registre o domínio (`.com.br` ~R$ 40/ano; `.com` ~R$ 60–80/ano). Na Hostinger, o domínio fica no hPanel.
2. Crie um subdomínio, por exemplo `sistema.seudominio.com.br` (mais organizado que usar a raiz).
3. No DNS, crie um registro **A** apontando para o IP do VPS:
   - `sistema` → IP do VPS
   - `www` ou `@` → IP do VPS (se quiser a raiz também)
4. Se o domínio estiver na Hostinger, use **hPanel → Domínios → DNS / Nameservers**. Se estiver em outro
   registrador, faça o mesmo no painel de DNS dele.
5. Aguarde a propagação (de minutos a algumas horas): `ping sistema.seudominio.com.br`.
6. Troque o domínio no Caddyfile:

```bash
sudo sed -i 's/SEU-DOMINIO/sistema.seudominio.com.br/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O Caddy emite o certificado HTTPS sozinho. Não é preciso comprar SSL.

**Se usar Cloudflare na frente do domínio:**
- no início, deixe o registro em **DNS only** (nuvem cinza) para o Caddy emitir o certificado;
- depois pode ativar o proxy (nuvem laranja) com SSL/TLS em **Full (strict)**;
- mantenha `TRUST_PROXY=1` no `.env` para o rate limit usar o IP real via `X-Forwarded-For`.

**E-mail profissional:** se usar o e-mail da Hostinger, configure o SMTP em `/etc/imobiliaria.env`:

```ini
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=contato@seudominio.com.br
SMTP_PASS=sua-senha
SMTP_FROM=contato@seudominio.com.br
```

O endereço de `SMTP_FROM` precisa ser do domínio e estar autorizado no provedor (SPF/DKIM).

### 8. Primeiro acesso

- Login: `admin@imobiliaria.local` / `admin123`
- O sistema exige a criação de uma senha nova.
- Crie os demais usuários em **Usuários**.
- Recomendado: 2 administradores, 2 operadores e 1 consulta. Quatro admins funciona, mas aumenta o risco.

### 9. Backup automático

Copie `deploy/backup.sh` para `/usr/local/bin/imobiliaria-backup.sh`:

```bash
sudo cp deploy/backup.sh /usr/local/bin/imobiliaria-backup.sh
sudo chmod 700 /usr/local/bin/imobiliaria-backup.sh
```

Configure o `rclone` (Backblaze B2, Cloudflare R2 ou Google Drive):

```bash
sudo -u imobiliaria rclone config
```

Depois edite o topo do script com o nome do remote e rode uma vez:

```bash
sudo /usr/local/bin/imobiliaria-backup.sh
```

Agende diariamente às 2h15:

```bash
(crontab -l 2>/dev/null; echo "15 2 * * * /usr/local/bin/imobiliaria-backup.sh >> /var/log/imobiliaria-backup.log 2>&1") | sudo crontab -
```

### 9.1 Recuperação do administrador

Se ninguém conseguir entrar:

```bash
cd /opt/imobiliaria
npm run admin:reset -- --email admin@imobiliaria.local
```

O comando gera uma senha temporária, desativa o 2FA, invalida as sessões e força a troca no login.
Para usar o fluxo “Esqueci minha senha”, configure o SMTP e o e-mail de recuperação em
**Configurações → Segurança**.

No Gmail, use uma senha de aplicativo:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=seu-email@gmail.com
SMTP_PASS=senha-de-app
SMTP_FROM=seu-email@gmail.com
```

### 10. Monitoramento

Crie um monitor HTTP gratuito no UptimeRobot para `https://seu-endereco/` com intervalo de 5 min.
Se cair, você recebe e-mail.

---

## Oracle Cloud Always Free (custo zero)

1. Crie uma conta (exige cartão para verificação).
2. Compute → Instance → Ubuntu 24.04, shape **VM.Standard.E2.1.Micro** (AMD) ou Ampere A1.
3. Libere 80/443 na Security List e no firewall da instância.
4. Siga os passos 3–10 acima.
5. Ative o backup externo: a Oracle não é backup. Use B2/R2/Drive.
6. Cuidado: capacidade ARM pode faltar e recursos Always Free podem ser reclamados se ficarem ociosos.
   Para um sistema de baixo tráfego, mantenha o backup externo em dia.

## Computador da empresa (custo zero)

- Use um mini PC ligado 24h, com nobreak.
- Instale o sistema como acima.
- Exponha via **Cloudflare Tunnel** (grátis, mas exige um domínio no Cloudflare) ou **Tailscale**
  (privado; o plano gratuito tem limite de usuários).
- Não abra a porta 3000 direto na internet.
- Mantenha backup externo diário.

---

## O que nunca fazer

- Publicar em HTTP puro.
- Rodar duas instâncias do sistema no mesmo arquivo SQLite.
- Guardar o banco em pasta de rede (OneDrive/Google Drive) com o servidor rodando.
- Usar Vercel/Render free/serverless com disco temporário.
- Confiar em backup que nunca foi restaurado.

## Restauração (teste mensal)

1. Pare o serviço: `sudo systemctl stop imobiliaria`.
2. Baixe o backup do dia (`imobiliaria-AAAA-MM-DD.db`) e o `uploads-....tar.gz`.
3. Substitua `data/imobiliaria.db` e remova `data/imobiliaria.db-wal`/`-shm`.
4. Extraia `uploads/` em `data/`.
5. `sudo chown -R imobiliaria:imobiliaria /opt/imobiliaria/data`.
6. Suba o serviço e confira: login, totais do painel, um contrato, um documento e um PDF.
7. Registre data, responsável e resultado.

## Checklist de go-live

- [ ] Servidor com disco persistente
- [ ] HTTPS funcionando
- [ ] `APP_SECRET` definido e guardado
- [ ] Senha do admin trocada
- [ ] Usuários criados com papéis corretos
- [ ] SMTP configurado (se for usar e-mail)
- [ ] Backup diário rodando e enviado para fora
- [ ] Restauração testada
- [ ] UptimeRobot ativo
- [ ] Celular testado
- [ ] Dados de demonstração removidos
