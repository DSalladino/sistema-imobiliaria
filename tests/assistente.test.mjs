import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-ia-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';
process.env.NODE_ENV = 'test';

const { db } = await import('../src/db.js');
const { responder, periodoDaPergunta, normalizar, contextoRapido } = await import('../src/assistente.js');
const { competenciaAtual } = await import('../src/regras.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('normaliza acentos e caixa para interpretar a pergunta', () => {
  assert.equal(normalizar('Quem está INADIMPLENTE?'), 'quem esta inadimplente?');
});

test('interpreta mês passado, mês nomeado e últimos meses', () => {
  const comp = competenciaAtual();
  const [ano, mes] = comp.split('-').map(Number);
  const anterior = new Date(ano, mes - 2, 1);
  const compAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;

  assert.equal(periodoDaPergunta('quanto recebi no mês passado', comp).ate, compAnterior);
  assert.equal(periodoDaPergunta('resumo dos últimos 3 meses', comp).de, (() => {
    const d = new Date(ano, mes - 3, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })());
  const porNome = periodoDaPergunta('e outubro?', comp);
  assert.match(porNome.ate, /^\d{4}-10$/);
});

test('resposta de resumo traz números e sugestões', () => {
  const r = responder('como está o mês?');
  assert.equal(r.intencao, 'resumo');
  assert.ok(r.resposta.length > 40);
  assert.ok(r.destaques.length >= 3);
  assert.ok(r.sugestoes.length >= 3);
  assert.ok(r.acoes.every(a => a.rota.startsWith('#/')));
});

test('responde sobre caixa com os dois caixas', () => {
  const r = responder('qual é o saldo da imobiliária e dos proprietários?');
  assert.equal(r.intencao, 'caixa');
  assert.match(r.resposta, /imobiliária/i);
  assert.match(r.resposta, /proprietários/i);
  assert.ok(r.destaques.some(d => /Caixa da imobiliária/i.test(d.rotulo)));
});

test('responde sobre ocupação e imóveis', () => {
  const r = responder('como está a ocupação dos imóveis?');
  assert.equal(r.intencao, 'ocupacao');
  assert.match(r.resposta, /ocupa/i);
  assert.ok(r.destaques.some(d => /Ocupação/i.test(d.rotulo)));
});

test('explica Pix e aponta a tela correta', () => {
  const r = responder('como funciona o pix?');
  assert.equal(r.intencao, 'ajuda');
  assert.match(r.resposta, /BR Code|Pix/i);
  assert.ok(r.acoes.some(a => a.rota === '#/cobrancas'));
});

test('busca por nome encontra proprietário e inquilino', () => {
  const r = responder('fale sobre Maria Souza');
  assert.equal(r.intencao, 'busca');
  assert.ok(r.itens.some(i => /Maria Souza/.test(i.titulo)));
});

test('inadimplência lista cobrança vencida com saldo', () => {
  const contrato = db.prepare("SELECT id FROM contratos WHERE codigo = 'CT-001'").get();
  assert.ok(contrato, 'o seed deve criar o contrato CT-001');
  db.prepare(`INSERT INTO cobrancas (contrato_id, competencia, vencimento, valor_original_centavos, status)
    VALUES (?, '2020-01', '2020-01-10', 180000, 'em_aberto')`).run(contrato.id);
  const r = responder('quem está inadimplente?');
  assert.equal(r.intencao, 'inadimplencia');
  assert.ok(r.itens.length >= 1);
  assert.ok(r.itens.some(i => /R\$/.test(i.valor)));
  assert.ok(r.resposta.includes('vencida'));
});

test('pergunta vazia e pergunta longa são tratadas sem erro', () => {
  assert.equal(responder('').intencao, 'vazio');
  assert.equal(responder('x'.repeat(600)).intencao, 'limite');
});

test('contexto rápido informa competência e sugestões', () => {
  const c = contextoRapido();
  assert.match(c.competencia, /^\d{4}-\d{2}$/);
  assert.ok(c.sugestoes.length >= 4);
  assert.ok(c.vencidas >= 1);
});
