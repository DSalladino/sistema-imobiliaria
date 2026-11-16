import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-regras-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

const { db } = await import('../src/db.js');
const { resolverTaxa, calcularRepasse, gerarRepasses, competenciaAtual, mesFechado } = await import('../src/regras.js');
const { hashSenha, verificaSenha } = await import('../src/auth.js');
const { validarSenha } = await import('../src/seguranca.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('precedência de taxa: contrato > imóvel > proprietário > geral', () => {
  const contrato = { taxa_admin_pct: 4, justificativa_taxa: 'Acordo' };
  const imovel = { taxa_admin_pct: 5 };
  const prop = { taxa_admin_pct: 6 };
  assert.equal(resolverTaxa(contrato, imovel, prop).origem, 'Exceção do contrato');
  assert.equal(resolverTaxa({ taxa_admin_pct: null }, imovel, prop).origem, 'Regra do imóvel');
  assert.equal(resolverTaxa({}, { taxa_admin_pct: null }, prop).origem, 'Regra do proprietário');
  const geral = resolverTaxa({}, {}, {});
  assert.equal(geral.origem, 'Regra geral');
  assert.equal(geral.pct, 8);
});

test('repasses guardam snapshot e não recalculam competência paga', () => {
  const comp = competenciaAtual();
  const antes = db.prepare('SELECT COUNT(*) n FROM lancamentos').get().n;
  assert.ok(antes > 0, 'seed deve criar lançamentos');

  const reps = gerarRepasses(comp, 'teste');
  assert.ok(reps.length >= 1);
  const rep = reps.find(r => r.aluguel_centavos > 0);
  assert.ok(rep);

  const prop = db.prepare('SELECT * FROM proprietarios WHERE id = ?').get(rep.proprietario_id);
  db.prepare('UPDATE proprietarios SET taxa_admin_pct = 99 WHERE id = ?').run(prop.id);

  const salvo = db.prepare('SELECT * FROM repasses WHERE id = ?').get(rep.id);
  assert.equal(saldoIgual(salvo), true);
  const detalhe = JSON.parse(salvo.detalhe_json);
  assert.ok(detalhe.contratos.length >= 1);
  assert.ok(detalhe.contratos.every(c => c.taxa_pct !== 99));

  // restaura para não afetar outras asserções
  db.prepare('UPDATE proprietarios SET taxa_admin_pct = ? WHERE id = ?').run(prop.taxa_admin_pct, prop.id);
});

function saldoIgual(rep) {
  return rep.valor_centavos === rep.aluguel_centavos - rep.taxa_centavos - rep.despesas_centavos - rep.descontos_centavos + rep.acrescimos_centavos;
}

test('senha usa scrypt e política mínima', () => {
  const hash = hashSenha('SenhaForte#2026');
  assert.ok(hash.includes(':'));
  assert.equal(verificaSenha('SenhaForte#2026', hash), true);
  assert.equal(verificaSenha('outra', hash), false);
  assert.throws(() => validarSenha('12345678', 'a@b.com'), /senha|Senha/);
  assert.doesNotThrow(() => validarSenha('UmaSenhaBoa#2026', 'a@b.com'));
});

test('competência atual começa aberta', () => {
  assert.equal(mesFechado(competenciaAtual()), false);
});
