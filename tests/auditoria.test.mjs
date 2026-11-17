import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-aud-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';

const { db } = await import('../src/db.js');
const { auditar } = await import('../src/permissoes.js');
const {
  verificarIntegridadeAuditoria, consultarAuditoria, detalharAuditoria,
  diffAuditoria, reencadearAuditoria, hashAuditoria,
} = await import('../src/auditoria.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const user = { id: 1, nome: 'Admin' };

test('cada registro encadeia o hash do anterior', () => {
  auditar(user, 'criar', 'proprietarios', 10, { nome: 'Maria' }, '127.0.0.1');
  auditar(user, 'alterar', 'proprietarios', 10, { antes: { nome: 'Maria' }, depois: { nome: 'Maria Souza' } }, '127.0.0.1');
  auditar(user, 'remover', 'proprietarios', 10, null, '127.0.0.1');

  const linhas = db.prepare('SELECT * FROM auditoria ORDER BY id').all();
  assert.ok(linhas.length >= 3);
  for (let i = 1; i < linhas.length; i++) {
    assert.equal(linhas[i].hash_anterior, linhas[i - 1].hash, `linha ${i} deve apontar para a anterior`);
    assert.equal(linhas[i].hash, hashAuditoria(linhas[i - 1].hash, linhas[i]));
  }
  const r = verificarIntegridadeAuditoria();
  assert.equal(r.ok, true);
  assert.equal(r.total, linhas.length);
});

test('adulterar um registro antigo quebra a verificação', () => {
  const alvo = db.prepare("SELECT id FROM auditoria WHERE acao = 'criar' ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE auditoria SET detalhe = ? WHERE id = ?').run('{"nome":"Atacante"}', alvo.id);
  const r = verificarIntegridadeAuditoria();
  assert.equal(r.ok, false);
  assert.equal(r.problema.id, alvo.id);
  assert.match(r.problema.motivo, /não confere/);
});

test('reencadear restaura a integridade após manutenção legítima', () => {
  const r = reencadearAuditoria();
  assert.ok(r.registros >= 3);
  const verificado = verificarIntegridadeAuditoria();
  assert.equal(verificado.ok, true);
});

test('consultarAuditoria filtra e devolve envelope com total', () => {
  const r = consultarAuditoria({ usuario: 'Admin', acao: 'alterar', limite: 10, envelope: true });
  assert.ok(r.itens.length >= 1);
  assert.ok(r.total >= r.itens.length);
  assert.ok(r.itens.every(x => x.acao === 'alterar'));
  const sem = consultarAuditoria({ busca: 'inexistente-xyz', envelope: true });
  assert.equal(sem.total, 0);
});

test('detalhe separa alterações antes/depois', () => {
  const alvo = db.prepare("SELECT id FROM auditoria WHERE acao = 'alterar' ORDER BY id DESC LIMIT 1").get();
  const d = detalharAuditoria(alvo.id);
  assert.equal(d.alteracoes.length, 1);
  assert.equal(d.alteracoes[0].campo, 'nome');
  assert.equal(d.alteracoes[0].antes, 'Maria');
  assert.equal(d.alteracoes[0].depois, 'Maria Souza');
  assert.equal(detalharAuditoria(999999), null);
});

test('diffAuditoria ignora detalhes sem antes/depois ou inválidos', () => {
  assert.deepEqual(diffAuditoria(null), []);
  assert.deepEqual(diffAuditoria('texto'), []);
  assert.deepEqual(diffAuditoria('{"nome":"x"}'), []);
  assert.equal(diffAuditoria({ antes: { a: 1 }, depois: { a: 1 } }).length, 0);
});
