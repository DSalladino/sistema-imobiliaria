# Demo online

O sistema é um monólito Node.js + SQLite: não roda em hospedagem estática
(GitHub Pages, Vercel sem disco, etc.). Para colocar uma demonstração pública no
ar, use um serviço que execute um processo Node e aceite escrita em disco — nem
que seja temporária.

Há três caminhos prontos neste repositório. Todos usam a **mesma base fictícia**,
com senha conhecida e reset automático. A base de produção nunca é tocada.

| Caminho | Melhor para | Persistência | Custo |
|---|---|---|---|
| **Render** (`render.yaml`) | Demo rápida para o time | Efêmera (`/tmp`) | Plano free |
| **Fly.io** (`fly.toml`) | Demo estável, com volume | Volume de 1 GB | Pago por uso |
| **Docker** (`Dockerfile`) | VPS, NAS ou máquina local | Volume Docker | Infra própria |

## Credenciais (demonstração)

| Campo | Valor |
|---|---|
| E-mail | `admin@imobiliaria.local` |
| Senha | `Demo#2026` |

A tela de login detecta o modo demonstração e mostra o botão **Preencher acesso
demo**. A base é restaurada a cada `DEMO_RESET_HORAS` (padrão: 6 horas) e sempre
que o serviço reinicia.

---

## 1. Render — um clique pelo blueprint

1. Faça push deste repositório no GitHub.
2. No [Render](https://render.com), escolha **New → Blueprint**.
3. Conecte o repositório. O Render lê o `render.yaml` e cria o serviço
   `sistema-imobiliaria-demo`.
4. Aguarde o build (`npm ci`) e o health check em `/api/health`.
5. A URL pública aparece no painel, no formato
   `https://sistema-imobiliaria-demo.onrender.com`.

O plano gratuito hiberna após inatividade; o primeiro acesso pode levar alguns
segundos. Como não há disco persistente, a base fica em `/tmp` e é recriada a
cada deploy/restart. Para uma demo com dados persistentes, adicione um disco no
plano pago e aponte `DEMO_DATA_DIR` para o ponto de montagem.

Para atualizar automaticamente a cada push, mantenha `autoDeploy: true` (padrão
do `render.yaml`). Também é possível usar um Deploy Hook do Render em CI; veja a
seção “Deploy automático” abaixo.

### Testar localmente o mesmo comando do Render

```bash
npm ci
DEMO_MODE=1 DEMO_DATA_DIR=/tmp/imobiliaria-demo DEMO_RESET_HORAS=6 npm run demo:servir
```

## 2. Fly.io — demo com volume

Pré-requisito: `flyctl` autenticado.

```bash
# Ajuste o nome do app no fly.toml se ele já estiver em uso.
fly launch --no-deploy            # aprove a região do fly.toml
fly volumes create demo_data --size 1 --region gru
fly deploy
fly open
```

O volume `demo_data` monta em `/data`, então os dados sobrevivem a restarts. O
reset periódico continua valendo; reduza `DEMO_RESET_HORAS` ou defina `0` para
desligar (nesse caso, proteja a demo com uma senha própria).

## 3. Docker / VPS

```bash
docker compose up -d --build
```

Acesse `http://localhost:3009`. Para publicar em um domínio, coloque um proxy
com TLS (Caddy ou Nginx) na frente e defina `TRUST_PROXY=1` conforme o
[guia de deploy](../deploy/README.md).

Para uma instalação real (não demo), use a mesma imagem trocando o comando:

```bash
docker run -d --name imobiliaria \
  -p 3000:3000 \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e NODE_ENV=production \
  -e APP_SECRET='troque-por-um-segredo-forte' \
  -v imobiliaria-data:/app/data \
  sistema-imobiliaria npm start
```

Nesse modo não há senha publicada: a senha inicial é gerada e exibida uma única
vez no log do container (`docker logs imobiliaria`).

---

## Variáveis da demonstração

| Variável | Padrão | Para que serve |
|---|---|---|
| `DEMO_MODE=1` | — | Ativa a faixa de demo, o botão de preenchimento e `noindex` |
| `DEMO_DATA_DIR` | `./data-demo` | Pasta isolada do banco e dos uploads |
| `DEMO_RESET_HORAS` | `6` | Intervalo de restauração; `0` desliga |
| `DEMO_EMAIL` | `admin@imobiliaria.local` | E-mail mostrado/preenchido na demo |
| `DEMO_SENHA` | `Demo#2026` | Senha da demo; troque se a URL for divulgada |
| `PORT` | `3009` no demo | Porta HTTP (o Render injeta a dele) |
| `HOST` | `0.0.0.0` | Interface de escuta |

> **Não use a senha da demo em produção.** Em produção, `DEMO_MODE` deve ficar
> desligado e `DATA_DIR` deve apontar para um volume persistente e com backup.

## Deploy automático

O `render.yaml` já liga o auto-deploy do Render. Se preferir disparar por CI,
crie um Deploy Hook no Render e salve a URL como segredo `RENDER_DEPLOY_HOOK_URL`
no GitHub. Depois use:

```bash
curl -fsS -X POST "$RENDER_DEPLOY_HOOK_URL"
```

## Checklist antes de divulgar a URL

- [ ] A URL responde `/api/health` com `{"ok":true}`.
- [ ] O login demo preenche e entra sem pedir troca de senha.
- [ ] O assistente responde “resumo do mês” com números da base fictícia.
- [ ] A demo está com `DEMO_MODE=1` e `X-Robots-Tag: noindex`.
- [ ] O reset automático está ligado (ou a senha foi trocada).
- [ ] Nenhum dado real foi copiado para `DEMO_DATA_DIR`.

## 4. GitHub Pages — demo estática (somente leitura)

Esta é a opção sem conta externa, usada pelo link público
**https://dsalladino.github.io/sistema-imobiliaria/**.

Como o sistema real é Node + SQLite, o Pages não executa o backend. O workflow
`.github/workflows/pages.yml` faz o seguinte:

1. sobe uma instância isolada de demonstração;
2. captura respostas reais das telas (painel, cobranças, repasses, relatórios,
   contas, assistente etc.);
3. gera `public/demo-data.json` (~380 KB) com dados fictícios sanitizados;
4. publica `public/` no GitHub Pages.

No navegador, `public/demo-estatico.js` intercepta `/api/*` e responde com esse
retrato. Login, navegação, filtros, modais e o assistente funcionam. Escritas
(cadastros, baixas, conciliação, configurações) retornam uma mensagem explicando
que a demo é somente leitura. Exportações e downloads também ficam desabilitados.

### Limitações (propositais)

- Não grava nada: recarregar a página volta ao retrato original.
- A base é um retrato do dia do deploy; o workflow roda semanalmente para manter
  competências, vencimentos e indicadores atuais.
- Para testar escrita de verdade, use Render/Fly/Docker ou rode localmente.

### Testar a demo estática localmente

```bash
npm ci
npm run demo:estatico
npx serve public
# abra http://localhost:3000/?demo=1
```

O parâmetro `?demo=1` só ativa o modo estático em `localhost`/`127.0.0.1`. Em
produção, a mesma página continua usando a API real.

### Segurança

- Apenas dados fictícios da base demo entram no JSON.
- Senhas, hashes, tokens e segredos são removidos na geração.
- O workflow não recebe credenciais de produção; usa `ADMIN_SENHA`/`DEMO_SENHA`
  locais ao runner.
- O link do Pages é público e indexável; não coloque dados reais nele.
