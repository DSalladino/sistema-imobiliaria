import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-regras-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';

const { db } = await import('../src/db.js');
const { resolverTaxa, calcularRepasse, gerarRepasses, competenciaAtual, mesFechado } = await import('../src/regras.js');
const { addMesesComp } = await import('../src/analytics.js');
const { hashSenha, verificaSenha } = await import('../src/auth.js');
const { validarSenha } = await import('../src/seguranca.js');
const { gerarCSV } = await import('../src/reports.js');
const { importar } = await import('../src/importacao.js');
const { calcularEncargos } = await import('../src/cobrancas.js');

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

test('CSV neutraliza fórmulas injetadas em campos de texto', () => {
  const rel = {
    empresa: 'Imobiliária', titulo: 'Teste', gerado_em: '01/01/2026',
    colunas: [{ key: 'nome', titulo: 'Nome', tipo: 'text' }],
    linhas: [{ nome: '=HYPERLINK("http://malicioso")' }, { nome: '-1+1' }],
    resumo: [],
  };
  const csv = gerarCSV(rel);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'-1+1"));
  assert.ok(!csv.includes(';=HYPERLINK'));
});

test('CSV escapa ponto e vírgula uma única vez e preserva números negativos', () => {
  const rel = {
    empresa: 'Imobiliária', titulo: 'Teste', gerado_em: '01/01/2026',
    colunas: [
      { key: 'nome', titulo: 'Nome', tipo: 'text' },
      { key: 'saldo', titulo: 'Saldo', tipo: 'money' },
    ],
    linhas: [{ nome: 'Silva; Maria', saldo: -123456 }],
    resumo: [],
  };
  const csv = gerarCSV(rel);
  assert.ok(csv.includes('"Silva; Maria"'));
  assert.ok(!csv.includes('"""Silva; Maria"""'));
  assert.ok(csv.includes(';-1.234,56'));
});

test('repasse inclui contrato encerrado com aluguel recebido e ignora repasse pago', () => {
  const comp = addMesesComp(competenciaAtual(), -2);
  const dono = db.prepare('SELECT id FROM proprietarios ORDER BY id LIMIT 1').get();
  const aluguel = db.prepare(`SELECT id, contrato_id FROM lancamentos
    WHERE proprietario_id = ? AND competencia = ? AND categoria = 'Aluguel' AND status = 'ativo' LIMIT 1`)
    .get(dono.id, comp);
  assert.ok(aluguel, 'o seed deve ter aluguel na competência usada');

  db.prepare("UPDATE contratos SET status = 'encerrado' WHERE id = ?").run(aluguel.contrato_id);
  const antes = calcularRepasse(comp, dono.id);
  assert.ok(antes.aluguel_centavos > 0);
  assert.ok(antes.detalhe.contratos.some(c => c.contrato_id === aluguel.contrato_id));

  db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, repasse_id, status)
    VALUES (?,?,?,?,?,?,?,?,?,'ativo')`).run(`${comp}-05`, comp, 'despesa', 'Repasse ao proprietário', 'teste de snapshot', 5000, 'proprietarios', dono.id, 999);
  const depois = calcularRepasse(comp, dono.id);
  assert.equal(depois.despesas_centavos, antes.despesas_centavos, 'pagamento de repasse não pode virar despesa da apuração');

  db.prepare('DELETE FROM lancamentos WHERE repasse_id = 999').run();
  db.prepare("UPDATE contratos SET status = 'ativo' WHERE id = ?").run(aluguel.contrato_id);
});

test('juros continuam correndo em cobrança paga parcialmente', () => {
  const c = {
    valor_original_centavos: 100000,
    vencimento: '2026-01-01',
    status: 'pago_parcial',
    multa_centavos: 2000,
    juros_centavos: 100,
    valor_pago_centavos: 50000,
  };
  const cinco = calcularEncargos(c, '2026-01-06');
  const dez = calcularEncargos(c, '2026-01-11');
  assert.equal(cinco.dias, 5);
  assert.equal(dez.dias, 10);
  assert.ok(dez.juros > cinco.juros, 'o saldo aberto deve acumular juros');
  assert.ok(cinco.juros > c.juros_centavos, 'não pode congelar no valor da primeira baixa');
});

test('importação reutiliza inquilino criado nas linhas anteriores', () => {
  const dono = db.prepare("SELECT id FROM proprietarios WHERE nome = 'Maria Souza'").get();
  assert.ok(dono);
  const novoImovel = db.prepare('INSERT INTO imoveis (proprietario_id, endereco, numero) VALUES (?,?,?)');
  novoImovel.run(dono.id, 'Rua Importação A', '1');
  novoImovel.run(dono.id, 'Rua Importação B', '2');

  const header = 'Código;Proprietário;Imóvel;Número;Inquilino;Início;Aluguel (R$);Vencimento';
  const linhas = [
    'IMP-1;Maria Souza;Rua Importação A;1;Novo Inquilino;01/01/2026;2000,00;5',
    'IMP-2;Maria Souza;Rua Importação B;2;Novo Inquilino;01/02/2026;2100,00;5',
  ];
  const base64 = Buffer.from('\uFEFF' + [header, ...linhas].join('\r\n')).toString('base64');
  const r = importar({ entidade: 'contratos', arquivo_base64: base64, opcoes: { criar_inquilinos: true }, usuario: { nome: 'teste' } });
  assert.equal(r.erros.length, 0);
  assert.equal(r.inseridos, 2);

  const qtd = db.prepare("SELECT COUNT(*) AS n FROM inquilinos WHERE nome = 'Novo Inquilino'").get().n;
  assert.equal(qtd, 1, 'não pode duplicar o inquilino no mesmo arquivo');

  db.prepare("DELETE FROM contratos WHERE codigo IN ('IMP-1','IMP-2')").run();
  db.prepare("DELETE FROM inquilinos WHERE nome = 'Novo Inquilino'").run();
  db.prepare("DELETE FROM imoveis WHERE endereco LIKE 'Rua Importação %'").run();
});
