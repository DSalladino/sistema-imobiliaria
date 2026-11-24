import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function esperarServidor(proc, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let saida = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não subiu:\n${saida}`)), timeoutMs);
    proc.stdout.on('data', (d) => {
      saida += d;
      const m = saida.match(/Rodando em http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.stderr.on('data', (d) => { saida += d; });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Servidor encerrou (${code}):\n${saida}`)); });
  });
}

test('rodada avançada de segurança e validação', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-seg2-'));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, DATA_DIR: dir, PORT: '0', SEED_COMPLETO: '0', SEED_DEMO: '1',
      HOST: '127.0.0.1', APP_SECRET: 'teste-seguranca-avancada-32-caracteres', ADMIN_SENHA: 'admin123',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { proc.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const port = await esperarServidor(proc);
  const base = `http://127.0.0.1:${port}`;

  const req = async (caminho, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined) h['content-type'] = h['content-type'] || 'application/json';
    const res = await fetch(base + caminho, {
      method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { res, data, ct };
  };

  const login = async (email, senha) => {
    const r = await req('/api/login', { method: 'POST', body: { email, senha } });
    assert.equal(r.res.status, 200, `login ${email}`);
    const setCookie = r.res.headers.getSetCookie?.()[0] || r.res.headers.get('set-cookie');
    return { cookie: setCookie.split(';')[0], setCookie, data: r.data };
  };

  await t.test('cabeçalhos de segurança estão presentes e não vazam tecnologia', async () => {
    const { res } = await req('/');
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.doesNotMatch(res.headers.get('content-security-policy') || '', /script-src[^;]*unsafe-inline/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.ok(res.headers.get('permissions-policy')?.includes('camera=()'));
  });

  await t.test('travessia de diretório no estático é bloqueada', async () => {
    const r = await req('/%2e%2e/package.json');
    assert.ok([403, 404].includes(r.res.status), `status ${r.res.status}`);
    assert.ok(!String(r.data).includes('sistema-imobiliaria'), 'não pode servir package.json');
    const r2 = await req('/..%5c..%5cpackage.json');
    assert.ok([403, 404].includes(r2.res.status));
  });

  await t.test('rotas sensíveis exigem autenticação', async () => {
    for (const rota of ['/api/lancamentos', '/api/analises', '/api/auditoria', '/api/auditoria/integridade', '/api/backup', '/api/backup/verificar', '/api/lgpd/inventario', '/api/manutencao/status', '/api/usuarios', '/api/settings', '/api/documentos']) {
      const r = await req(rota);
      assert.ok([401, 403].includes(r.res.status), `${rota} deveria exigir login (status ${r.res.status})`);
      assert.ok(!String(r.data.erro || '').includes('Trace'), `${rota} não pode vazar stack`);
    }
  });

  await t.test('CSRF e tipo de conteúdo são rejeitados antes do login', async () => {
    const csrf = await req('/api/login', {
      method: 'POST',
      body: { email: 'admin@imobiliaria.local', senha: 'admin123' },
      headers: { origin: 'https://malicioso.example', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(csrf.res.status, 403);
    const tipo = await req('/api/login', {
      method: 'POST',
      body: 'email=admin@imobiliaria.local&senha=admin123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(tipo.res.status, 415);
  });

  let adminCookie = '';
  await t.test('login inicial define cookie seguro e exige troca de senha', async () => {
    const r = await login('admin@imobiliaria.local', 'admin123');
    adminCookie = r.cookie;
    assert.match(r.setCookie, /HttpOnly/i);
    assert.match(r.setCookie, /SameSite=Lax/i);
    assert.match(r.setCookie, /Path=\//);
    assert.equal(r.data.usuario.deve_trocar_senha, true);
    const bloqueado = await req('/api/lancamentos', { cookie: adminCookie });
    assert.equal(bloqueado.res.status, 403);
    assert.match(bloqueado.data.erro, /Troque a senha/);
    const troca = await req('/api/me/senha', {
      method: 'POST', cookie: adminCookie,
      body: { senha_atual: 'admin123', senha_nova: 'Forte#2026Seguro' },
    });
    assert.equal(troca.res.status, 200);
  });

  await t.test('validação de CPF/CNPJ e duplicidade', async () => {
    const invalido = await req('/api/proprietarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome: 'Documento Inválido', cpf_cnpj: '111.444.777-36' },
    });
    assert.equal(invalido.res.status, 400);
    assert.match(invalido.data.erro, /não é válido/);

    const valido = await req('/api/proprietarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome: 'Documento Válido', cpf_cnpj: '52998224725' },
    });
    assert.equal(valido.res.status, 201);
    assert.equal(valido.data.cpf_cnpj, '529.982.247-25', 'documento deve ser normalizado');

    const duplicado = await req('/api/proprietarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome: 'Outro Nome', cpf_cnpj: '529.982.247-25' },
    });
    assert.equal(duplicado.res.status, 400);
    assert.match(duplicado.data.erro, /já está cadastrado/);

    const cnpj = await req('/api/proprietarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome: 'Empresa Válida', cpf_cnpj: '11.222.333/0001-81' },
    });
    assert.equal(cnpj.res.status, 201);
    assert.equal(cnpj.data.cpf_cnpj, '11.222.333/0001-81');
  });

  await t.test('perfil consulta não escreve, não audita e não exporta', async () => {
    const criado = await req('/api/usuarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome: 'Consulta', email: 'consulta@exemplo.com', senha: 'Leitura#2026Inicial', papel: 'consulta' },
    });
    assert.equal(criado.res.status, 201);
    const c = await login('consulta@exemplo.com', 'Leitura#2026Inicial');
    const troca = await req('/api/me/senha', {
      method: 'POST', cookie: c.cookie,
      body: { senha_atual: 'Leitura#2026Inicial', senha_nova: 'Leitura#2026Segura' },
    });
    assert.equal(troca.res.status, 200);
    const cookie = c.cookie;

    const leitura = await req('/api/lancamentos', { cookie });
    assert.equal(leitura.res.status, 200);
    const escrita = await req('/api/lancamentos', {
      method: 'POST', cookie,
      body: { tipo: 'despesa', categoria: 'Teste', valor_centavos: 100, caixa: 'imobiliaria' },
    });
    assert.equal(escrita.res.status, 403);
    const auditoria = await req('/api/auditoria', { cookie });
    assert.equal(auditoria.res.status, 403);
    const relatorio = await req('/api/reports/lancamentos.csv', { cookie });
    assert.equal(relatorio.res.status, 403);
    // Configuração filtrada por papel: consulta recebe apenas as chaves
    // públicas usadas pela interface comum.
    const settingsConsulta = await req('/api/settings', { cookie });
    assert.equal(settingsConsulta.res.status, 200);
    const chaves = settingsConsulta.data.map(s => s.chave);
    assert.deepEqual(chaves.sort(), ['imob_nome', 'indice_reajuste_padrao']);
    const settingsAdmin = await req('/api/settings', { cookie: adminCookie });
    assert.ok(settingsAdmin.data.length > chaves.length, 'admin vê a configuração completa');
    // Status de comunicação (remetente SMTP, WhatsApp, templates) exige escrita.
    const comunicacaoConsulta = await req('/api/comunicacao/status', { cookie });
    assert.equal(comunicacaoConsulta.res.status, 403);
    const comunicacaoAdmin = await req('/api/comunicacao/status', { cookie: adminCookie });
    assert.equal(comunicacaoAdmin.res.status, 200);
    // Backup antigo por GET foi removido: só existe via POST confirmado.
    const backupGet = await req('/api/backup', { cookie: adminCookie });
    assert.equal(backupGet.res.status, 404);
  });

  await t.test('filtros e buscas não sofrem injeção de SQL', async () => {
    const alvos = [
      '/api/cobrancas?busca=%27%20OR%201%3D1--',
      '/api/comissoes?corretor=%27%3B%20DROP%20TABLE%20lancamentos%3B--',
      '/api/contas?busca=%25%27%20OR%20%271%27%3D%271',
      '/api/lancamentos?caixa=imobiliaria%27--',
    ];
    for (const alvo of alvos) {
      const r = await req(alvo, { cookie: adminCookie });
      assert.equal(r.res.status, 200, alvo);
    }
    const aindaVivo = await req('/api/health');
    assert.equal(aindaVivo.res.status, 200);
    assert.equal(aindaVivo.data.banco, 'ok');
  });

  await t.test('conteúdo hostil é devolvido como dado JSON, não como HTML', async () => {
    const nome = '<img src=x onerror=alert(1)>';
    const r = await req('/api/proprietarios', {
      method: 'POST', cookie: adminCookie,
      body: { nome, cpf_cnpj: '390.533.447-05' },
    });
    assert.equal(r.res.status, 201);
    assert.equal(r.data.nome, nome);
    assert.match(r.ct, /application\/json/);
  });

  await t.test('análises futuras, auditoria encadeada e ensaio de backup funcionam', async () => {
    const a = await req('/api/analises?meses=12&horizonte=3', { cookie: adminCookie });
    assert.equal(a.res.status, 200);
    assert.ok(a.data.projecao.length >= 1);
    assert.ok(a.data.indicadores);
    const s = await req('/api/analises/projecao', {
      method: 'POST', cookie: adminCookie,
      body: { meses: 6, inadimplencia_pct: 15, vacancia_pct: 5, reajuste_pct: 3, aumento_despesa_pct: 2 },
    });
    assert.equal(s.res.status, 200);
    assert.equal(s.data.premissas.inadimplencia_pct, 15);

    const integ = await req('/api/auditoria/integridade', { cookie: adminCookie });
    assert.equal(integ.res.status, 200);
    assert.equal(integ.data.ok, true);

    const bkp = await req('/api/backup/verificar', { cookie: adminCookie });
    assert.equal(bkp.res.status, 200);
    assert.equal(bkp.data.ok, true);
    assert.equal(bkp.data.divergencias.length, 0);

    const ret = await req('/api/manutencao/retencao', { cookie: adminCookie });
    assert.equal(ret.res.status, 200);
    assert.equal(ret.data.simulado, true);
  });

  await t.test('rate limit de login responde 429 sem revelar existência de e-mail', async () => {
    let ultimo = null;
    for (let i = 0; i < 16; i++) {
      ultimo = await req('/api/login', { method: 'POST', body: { email: `naoexiste${i}@exemplo.com`, senha: 'Errada#123' } });
      if (ultimo.res.status === 429) break;
      assert.equal(ultimo.res.status, 401);
      assert.equal(ultimo.data.erro, 'E-mail ou senha inválidos.');
    }
    assert.equal(ultimo.res.status, 429);
    assert.ok(ultimo.res.headers.get('retry-after'));
  });
});
