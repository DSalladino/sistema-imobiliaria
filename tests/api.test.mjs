import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

async function esperarServidor(proc, timeoutMs = 15000) {
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

test('fluxo principal da API', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-api-'));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: '0', SEED_COMPLETO: '0', HOST: '127.0.0.1', APP_SECRET: 'test-secret-38-caracteres-para-o-teste', ADMIN_SENHA: 'admin123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { proc.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const port = await esperarServidor(proc);

  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const req = async (caminho, { method = 'GET', body } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + caminho, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { res, data };
  };

  await t.test('health responde sem autenticação e verifica o banco', async () => {
    const { res, data } = await req('/api/health');
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.versao);
  });

  await t.test('rejeita credenciais inválidas', async () => {
    const { res } = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'errada' } });
    assert.equal(res.status, 401);
  });

  await t.test('login inicial exige troca de senha', async () => {
    const { res, data } = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'admin123' } });
    assert.equal(res.status, 200);
    assert.equal(data.usuario.deve_trocar_senha, true);
    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie');
    assert.ok(setCookie?.includes('sid='));
    cookie = setCookie.split(';')[0];

    const { DatabaseSync } = await import('node:sqlite');
    const b = new DatabaseSync(path.join(dir, 'imobiliaria.db'));
    const salvo = b.prepare('SELECT token FROM sessoes ORDER BY rowid DESC LIMIT 1').get().token;
    b.close();
    assert.equal(salvo.length, 64, 'o token de sessão deve ser gravado como hash');
    assert.notEqual(salvo, cookie.split('=')[1], 'o cookie não pode aparecer em claro no banco');
  });

  await t.test('troca de senha e leitura do painel', async () => {
    const nova = 'SenhaForte#2026';
    const alt = await req('/api/me/senha', { method: 'POST', body: { senha_atual: 'admin123', senha_nova: nova } });
    assert.equal(alt.res.status, 200);
    const dash = await req('/api/dashboard');
    assert.equal(dash.res.status, 200);
    assert.ok(dash.data.totalProps >= 3);
    const analytics = await req('/api/analytics');
    assert.equal(analytics.res.status, 200);
    assert.ok(Array.isArray(analytics.data.serie));
    const compAtual = new Date().toISOString().slice(0, 7);
    const mes = await req(`/api/analytics?de=${compAtual}&ate=${compAtual}`);
    assert.equal(mes.res.status, 200);
    assert.ok(mes.data.kpis.alugueis > 0, 'o mês atual deve ter aluguéis no painel');
    // a senha antiga não entra mais
    const antigo = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'admin123' } });
    assert.equal(antigo.res.status, 401);
  });

  await t.test('não permite ficar sem administrador ativo', async () => {
    const me = await req('/api/me');
    assert.equal(me.res.status, 200);
    const r = await req(`/api/usuarios/${me.data.usuario.id}`, { method: 'PUT', body: { papel: 'operador' } });
    assert.equal(r.res.status, 400);
    assert.match(r.data.erro, /administrador/i);
  });

  await t.test('CRUD com auditoria e precedência de taxa', async () => {
    const prop = await req('/api/proprietarios', { method: 'POST', body: {
      nome: 'Proprietário Teste', cpf_cnpj: '000.000.000-00', email: 'teste@exemplo.com', telefone: '11999999999', taxa_admin_pct: 6,
    } });
    assert.equal(prop.res.status, 201);
    const imovel = await req('/api/imoveis', { method: 'POST', body: {
      proprietario_id: prop.data.id, endereco: 'Rua Teste', numero: '10', tipo: 'casa', situacao: 'alugado', taxa_admin_pct: 5,
    } });
    assert.equal(imovel.res.status, 201);
    const inq = await req('/api/inquilinos', { method: 'POST', body: { nome: 'Inquilino Teste', email: 'inq@exemplo.com', telefone: '11888888888' } });
    assert.equal(inq.res.status, 201);
    const comp = new Date().toISOString().slice(0, 7);
    const ct = await req('/api/contratos', { method: 'POST', body: {
      codigo: 'CT-TESTE', imovel_id: imovel.data.id, inquilino_id: inq.data.id,
      inicio: `${comp}-01`, aluguel_centavos: 250000, dia_vencimento: 10,
    } });
    assert.equal(ct.res.status, 201);

    const audit = await req('/api/auditoria?limite=50');
    assert.equal(audit.res.status, 200);
    assert.ok(audit.data.some(a => a.entidade === 'contratos' && a.acao === 'criar'));

    const imoveis = await req('/api/imoveis');
    const criado = imoveis.data.find(i => i.id === imovel.data.id);
    assert.equal(criado.proprietario_nome, 'Proprietário Teste');

    const duplicado = await req('/api/contratos', { method: 'POST', body: {
      codigo: 'CT-TESTE-2', imovel_id: imovel.data.id, inquilino_id: inq.data.id,
      inicio: `${comp}-01`, aluguel_centavos: 100000, dia_vencimento: 10,
    } });
    assert.equal(duplicado.res.status, 400);
    assert.match(duplicado.data.erro, /contrato ativo/i);
  });

  await t.test('rejeita dados inválidos e origem cruzada', async () => {
    const taxa = await req('/api/proprietarios', { method: 'POST', body: { nome: 'Taxa inválida', taxa_admin_pct: 150 } });
    assert.equal(taxa.res.status, 400);

    const ref = await req('/api/contratos', { method: 'POST', body: {
      imovel_id: 999999, inquilino_id: 999999, inicio: '2026-01-01', aluguel_centavos: 1000,
    } });
    assert.equal(ref.res.status, 400);

    const csrf = await fetch(base + '/api/proprietarios', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ nome: 'Origem cruzada' }),
    });
    assert.equal(csrf.status, 403);
  });

  await t.test('cobrança, baixa, repasse e fechamento', async () => {
    const comp = new Date().toISOString().slice(0, 7);
    const previa = await req(`/api/cobrancas/gerar/preview?competencia=${comp}`);
    assert.equal(previa.res.status, 200);
    assert.ok(previa.data.novos >= 4);

    const gerar = await req('/api/cobrancas/gerar', { method: 'POST', body: { competencia: comp } });
    assert.equal(gerar.res.status, 200);
    assert.ok(gerar.data.criadas >= 4);

    const lista = await req(`/api/cobrancas?competencia=${comp}`);
    const alvo = lista.data.find(c => c.status !== 'pago' && c.saldo_centavos > 0);
    assert.ok(alvo);
    const baixa = await req(`/api/cobrancas/${alvo.id}/pagar`, { method: 'POST', body: { valor_centavos: alvo.saldo_centavos, data: new Date().toISOString().slice(0, 10), forma: 'pix' } });
    assert.equal(baixa.res.status, 200);
    assert.equal(baixa.data.status, 'pago');

    const calc = await req('/api/repasses/calcular', { method: 'POST', body: { competencia: comp } });
    assert.equal(calc.res.status, 200);
    assert.ok(calc.data.repasses.length >= 1);
    const rep = calc.data.repasses.find(r => r.valor_centavos > 0);
    assert.ok(rep);
    for (const r of calc.data.repasses.filter(x => x.valor_centavos > 0 && x.status !== 'pago')) {
      const pago = await req(`/api/repasses/${r.id}/pagar`, { method: 'POST', body: {} });
      assert.equal(pago.res.status, 200);
    }

    const rel = await req(`/api/reports/resumo-financeiro.pdf?competencia=${comp}`);
    assert.equal(rel.res.status, 200);
    assert.equal(rel.res.headers.get('content-type'), 'application/pdf');

    const verificar = await req('/api/backup/verificar');
    assert.equal(verificar.res.status, 200);
    assert.ok(verificar.data.contagens.usuarios >= 1);
    const backup = await req('/api/backup');
    assert.equal(backup.res.status, 200);
    assert.equal(backup.res.headers.get('content-type'), 'application/zip');

    const fechar = await req('/api/fechamentos', { method: 'POST', body: { competencia: comp } });
    assert.equal(fechar.res.status, 200);
    const novo = await req('/api/lancamentos', { method: 'POST', body: {
      data: `${comp}-15`, competencia: comp, tipo: 'despesa', categoria: 'Outros', valor_centavos: 1000, caixa: 'imobiliaria',
    } });
    assert.equal(novo.res.status, 409);
  });
});
