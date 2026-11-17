import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-bkp-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const {
  integridadeBanco, contarTabelas, criarSnapshot, listarSnapshots,
  testarRestauracao, expurgarSnapshots, snapshotTemporario,
} = await import('../src/backup.js');
const { expurgarRetencao } = await import('../src/manutencao.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('banco vivo passa em integrity_check e foreign_key_check', () => {
  const r = integridadeBanco();
  assert.equal(r.ok, true);
  assert.deepEqual(r.foreign_keys, []);
});

test('snapshot é um banco íntegro e preserva as contagens', () => {
  const arquivo = criarSnapshot({ prefixo: 'teste' });
  try {
    assert.ok(fs.existsSync(arquivo));
    const integ = integridadeBanco(arquivo);
    assert.equal(integ.ok, true);
    assert.deepEqual(contarTabelas(arquivo), contarTabelas());
    assert.ok(listarSnapshots().some(s => s.nome === path.basename(arquivo)));
  } finally {
    try { fs.unlinkSync(arquivo); } catch {}
  }
});

test('ensaio de restauração abre a cópia, compara contagens e limpa o temporário', () => {
  const antes = listarSnapshots().length;
  const r = testarRestauracao();
  assert.equal(r.ok, true);
  assert.equal(r.divergencias.length, 0);
  assert.ok(r.contagens.proprietarios > 0);
  assert.ok(r.duracao_ms >= 0);
  assert.equal(listarSnapshots().length, antes, 'o snapshot do ensaio não deve ficar para trás');
});

test('expurgo por retenção mantém snapshots recentes', () => {
  const arquivo = criarSnapshot({ prefixo: 'retencao' });
  assert.ok(fs.existsSync(arquivo));
  const removidos = expurgarSnapshots();
  assert.equal(typeof removidos, 'number');
  assert.ok(fs.existsSync(arquivo), 'snapshot recém-criado não pode ser expurgado');
  fs.unlinkSync(arquivo);
});

test('expurgo LGPD em modo simulação não apaga nada e informa os limites', () => {
  const r = expurgarRetencao({ confirmar: false });
  assert.equal(r.simulado, true);
  assert.ok(r.limites.auditoria);
  assert.ok(r.limites.comunicacoes);
  assert.equal(typeof r.auditoria, 'number');
  assert.equal(typeof r.comunicacoes, 'number');
  assert.equal(typeof r.password_resets, 'number');
});

test('snapshot temporário para inspeção externa é removível', () => {
  const arquivo = snapshotTemporario();
  try {
    assert.ok(fs.existsSync(arquivo));
    assert.equal(integridadeBanco(arquivo).ok, true);
  } finally {
    try { fs.unlinkSync(arquivo); } catch {}
  }
});
