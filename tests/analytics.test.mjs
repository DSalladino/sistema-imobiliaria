import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-analytics-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const {
  addMesesComp, mesesEntre, serieMensal, ocupacao, composicao,
  repassesPorProprietario, topContratos, analytics,
} = await import('../src/analytics.js');
const { competenciaAtual, getSetting, setSetting, invalidarCacheSettings } = await import('../src/regras.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const comp = competenciaAtual();
const de = addMesesComp(comp, -11);

test('mesesEntre cobre o intervalo e limita a 240 meses', () => {
  assert.equal(mesesEntre('2025-01', '2025-03').join(','), '2025-01,2025-02,2025-03');
  assert.ok(mesesEntre('2000-01', '2030-01').length <= 240);
  assert.deepEqual(mesesEntre('2025-03', '2025-01'), [], 'intervalo invertido não inventa meses');
});

test('serieMensal devolve uma linha por mês com as chaves do painel', () => {
  const serie = serieMensal(de, comp);
  assert.equal(serie.length, 12);
  for (const mes of serie) {
    assert.match(mes.mes, /^\d{4}-\d{2}$/);
    for (const chave of ['alugueis', 'taxa', 'repasses', 'resultado_imob', 'inadimplencia', 'previsto', 'saldo_imob', 'saldo_prop']) {
      assert.equal(typeof mes[chave], 'number', `${mes.mes}: ${chave} deve ser número`);
    }
  }
  const total = serie.reduce((s, m) => s + m.alugueis, 0);
  assert.ok(total > 0, 'o seed deve gerar aluguéis no período');
});

test('serieMensal respeita o filtro de proprietário', () => {
  const dono = db.prepare('SELECT id FROM proprietarios ORDER BY id LIMIT 1').get();
  const doDono = serieMensal(de, comp, dono.id);
  const geral = serieMensal(de, comp);
  const somaDono = doDono.reduce((s, m) => s + m.alugueis, 0);
  const somaGeral = geral.reduce((s, m) => s + m.alugueis, 0);
  assert.ok(somaDono > 0);
  assert.ok(somaDono < somaGeral, 'o filtro deve excluir os demais proprietários');
  assert.equal(serieMensal(de, comp, 999999).reduce((s, m) => s + m.alugueis, 0), 0);
});

test('ocupacao, composicao e topContratos refletem a carteira', () => {
  const oc = ocupacao();
  assert.equal(oc.total, 4);
  assert.equal(oc.alugado, 4);
  assert.equal(oc.vago, 0);
  assert.equal(Math.round(oc.ocupacao_pct), 100);

  const receitas = composicao(de, comp, 'receita');
  const aluguel = receitas.find(c => c.nome === 'Aluguel');
  assert.ok(aluguel && aluguel.valor > 0);
  assert.ok(!receitas.some(c => c.nome === 'Taxa de administração') || receitas.length >= 1);

  const despesas = composicao(de, comp, 'despesa');
  assert.ok(!despesas.some(c => c.nome === 'Repasse ao proprietário'), 'repasse não é despesa operacional');

  const top = topContratos();
  assert.ok(top.length > 0 && top.length <= 8);
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].aluguel_centavos >= top[i].aluguel_centavos, 'ordenado por aluguel desc');
  }

  const reps = repassesPorProprietario(addMesesComp(comp, -11), comp);
  assert.ok(Array.isArray(reps));
  for (const r of reps) {
    assert.equal(r.valor, r.pago + r.pendente);
  }
});

test('analytics entrega KPIs, comparativo e séries consistentes', () => {
  const dados = analytics({ de, ate: comp, comparar: true });
  assert.equal(dados.periodo.de, de);
  assert.equal(dados.periodo.ate, comp);
  assert.equal(dados.periodo.meses, 12);
  assert.ok(dados.kpis.alugueis > 0);
  assert.ok(dados.kpis.contratos_ativos >= 4);
  assert.ok(dados.kpis.imoveis_total >= 4);
  assert.ok(dados.serie.length === 12);
  assert.ok(Array.isArray(dados.serie_anterior), 'comparar=1 devolve a série anterior');
  assert.equal(dados.serie_anterior.length, 12);
  assert.ok(dados.comparativo.alugueis.atual === dados.kpis.alugueis);
  assert.ok(Array.isArray(dados.composicao_receitas));
  assert.ok(Array.isArray(dados.composicao_despesas));
  assert.ok(Array.isArray(dados.top_contratos));
  assert.ok(Array.isArray(dados.atividades));
  assert.ok(dados.cobrancas && typeof dados.cobrancas.abertas === 'number');
  assert.match(dados.gerado_em, /^\d{4}-\d{2}-\d{2}$/);
});

test('analytics normaliza parâmetros inválidos e inverte períodos', () => {
  const invertido = analytics({ de: comp, ate: de });
  assert.equal(invertido.periodo.de, de);
  assert.equal(invertido.periodo.ate, comp);
  const padrao = analytics({});
  assert.match(padrao.periodo.ate, /^\d{4}-\d{2}$/);
  assert.equal(padrao.serie_anterior, null, 'sem comparar, não calcula série anterior');
  const comPropInvalido = analytics({ de, ate: comp, propId: 'abc' });
  assert.ok(comPropInvalido.kpis.alugueis > 0, 'proprietário inválido é ignorado');
});

test('cache de configurações é invalidado ao gravar e ao limpar', () => {
  const original = getSetting('imob_nome');
  setSetting('imob_nome', 'Imobiliária Cache');
  assert.equal(getSetting('imob_nome'), 'Imobiliária Cache', 'setSetting mantém o cache coerente');

  db.prepare("UPDATE settings SET valor = 'Alterado direto no banco' WHERE chave = 'imob_nome'").run();
  assert.equal(getSetting('imob_nome'), 'Imobiliária Cache', 'cache evita nova consulta');
  invalidarCacheSettings();
  assert.equal(getSetting('imob_nome'), 'Alterado direto no banco', 'invalidação recarrega do banco');

  setSetting('imob_nome', original);
});
