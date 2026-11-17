import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-prev-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const { regressao, analiseFutura, projetarCenario, resumoAnaliseFutura } = await import('../src/previsao.js');
const { responder } = await import('../src/assistente.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('regressão linear recupera inclinação e intercepto de uma série conhecida', () => {
  const r = regressao([10, 20, 30, 40, 50]);
  assert.ok(Math.abs(r.a - 10) < 1e-9);
  assert.ok(Math.abs(r.b - 10) < 1e-9);
  assert.ok(r.r2 > 0.999);
  assert.equal(regressao([7]).b, 0);
});

test('análise futura devolve indicadores, riscos, recomendações e projeção', () => {
  const a = analiseFutura({ meses: 12, horizonte: 3 });
  assert.equal(a.periodo.meses, 12);
  assert.ok(a.serie.length >= 10);
  assert.ok(a.projecao.length >= 1);
  assert.ok(a.indicadores.receita_media_centavos > 0);
  assert.ok(['alta', 'queda', 'estável'].includes(a.tendencia.receita));
  assert.ok(['alta', 'media', 'baixa'].includes(a.tendencia.confianca));
  assert.ok(a.riscos.length >= 1);
  assert.ok(a.recomendacoes.length >= 1);
  assert.ok(a.base.meses_analisados >= 10);
  assert.ok(a.estresse);
  assert.equal(a.estresse.projecoes.length, a.projecao.length);
  assert.ok(a.estresse.premissas.inadimplencia_pct >= a.indicadores.inadimplencia_pct);
  assert.equal(a.estresse.premissas.vacancia_pct, 10);
  for (const p of a.projecao) {
    assert.ok(p.receita_formatada.startsWith('R$'));
    assert.ok(p.faixa_min_centavos <= p.faixa_max_centavos);
  }
});

test('cenário estressado reduz a receita e o saldo projetado', () => {
  const base = projetarCenario({ meses: 6 });
  const stress = projetarCenario({ meses: 6, inadimplencia_pct: 40, vacancia_pct: 20, aumento_despesa_pct: 30 });
  assert.equal(base.projecoes.length, 6);
  assert.equal(stress.projecoes.length, 6);
  assert.ok(stress.totais.receita_centavos < base.totais.receita_centavos, 'receita deve cair no cenário ruim');
  assert.ok(stress.totais.despesa_centavos > base.totais.despesa_centavos, 'despesa deve subir com pressão de custos');
  assert.ok(stress.totais.resultado_centavos < base.totais.resultado_centavos);
  assert.equal(stress.premissas.inadimplencia_pct, 40);
  assert.equal(stress.premissas.vacancia_pct, 20);
});

test('reajuste positivo eleva a projeção e limites são respeitados', () => {
  const base = projetarCenario({ meses: 3 });
  const reajuste = projetarCenario({ meses: 3, reajuste_pct: 10 });
  assert.ok(reajuste.totais.receita_centavos > base.totais.receita_centavos);
  const extremo = projetarCenario({ meses: 999, inadimplencia_pct: 500, vacancia_pct: -20, reajuste_pct: 999 });
  assert.equal(extremo.projecoes.length, 24);
  assert.equal(extremo.premissas.inadimplencia_pct, 100);
  assert.equal(extremo.premissas.vacancia_pct, 0);
});

test('assistente reconhece perguntas de previsão e risco', () => {
  const previsao = responder('Qual a previsão dos próximos meses?');
  assert.equal(previsao.intencao, 'previsao');
  assert.match(previsao.texto, /projeção|receita média/i);
  const riscos = responder('Quais são os riscos da carteira?');
  assert.equal(riscos.intencao, 'riscos');
  assert.ok(riscos.itens.length >= 1);
  const resumo = resumoAnaliseFutura();
  assert.equal(resumo.intencao, 'previsao');
  assert.ok(resumo.destaques.length >= 3);
});
