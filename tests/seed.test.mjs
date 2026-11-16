import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function esperar(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(out || 'timeout')), 30000);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/Rodando em http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`saiu ${c}: ${out}`)); });
  });
}

test('primeira execução completa a demonstração com cobranças e repasses', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-seed-'));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', APP_SECRET: 'seed-completo-36-caracteres-de-teste' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { proc.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  const port = await esperar(proc);
  const base = `http://127.0.0.1:${port}`;

  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@imobiliaria.local', senha: 'admin123' }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.getSetCookie?.()[0] || '').split(';')[0];

  const req = async (url) => {
    const res = await fetch(base + url, { headers: { cookie } });
    return res.json();
  };
  const comp = new Date().toISOString().slice(0, 7);
  const mes = await req(`/api/analytics?de=${comp}&ate=${comp}`);
  assert.ok(mes.kpis.alugueis > 0, 'aluguéis do mês');
  assert.ok(mes.kpis.taxa > 0, 'taxa de administração do mês (repasses pagos)');
  assert.ok(mes.kpis.repasses > 0, 'repasses do mês');

  const cobs = await req(`/api/cobrancas?competencia=${comp}`);
  assert.equal(cobs.length, 4, 'uma cobrança por contrato ativo');
  const pagas = cobs.filter(c => c.status === 'pago').length;
  assert.equal(pagas, 2, 'duas cobranças pagas e duas em aberto no mês de demonstração');

  const reps = await req(`/api/repasses?competencia=${comp}`);
  assert.ok(reps.length >= 1, 'repasses calculados para o mês');
});
