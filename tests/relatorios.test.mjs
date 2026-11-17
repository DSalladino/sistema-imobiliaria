import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-rel-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const { RELATORIOS, construirRelatorio, gerarCSV, gerarXLSX, gerarPDF } = await import('../src/reports.js');
const { competenciaAtual } = await import('../src/regras.js');
const { addMesesComp } = await import('../src/analytics.js');
const XLSX_MOD = await import('xlsx');
const XLSX = XLSX_MOD.default || XLSX_MOD;

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const comp = competenciaAtual();
const de = addMesesComp(comp, -11);

test('todos os relatórios constroem com o período da base', () => {
  assert.ok(RELATORIOS.length >= 8);
  for (const meta of RELATORIOS) {
    const rel = construirRelatorio(meta.id, { de, ate: comp, competencia: comp });
    assert.ok(rel.titulo.length > 0, `${meta.id}: sem título`);
    assert.ok(rel.colunas.length > 0, `${meta.id}: sem colunas`);
    assert.ok(Array.isArray(rel.linhas), `${meta.id}: linhas não é array`);
    assert.ok(rel.resumo.length > 0, `${meta.id}: sem resumo`);
    assert.ok(rel.empresa.length > 0);
    assert.match(rel.gerado_em, /^\d{2}\/\d{2}\/\d{4}$/);
  }
});

test('relatório desconhecido falha com 404', () => {
  assert.throws(() => construirRelatorio('nao-existe', { de, ate: comp }), (e) => e.status === 404);
});

test('CSV tem BOM, cabeçalho e resumo', () => {
  const rel = construirRelatorio('resumo-financeiro', { de, ate: comp });
  const csv = gerarCSV(rel);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Resumo financeiro'));
  assert.ok(csv.includes('Competência'));
  assert.ok(csv.includes('Resumo'));
  assert.ok(csv.split('\r\n').length > rel.linhas.length);
});

test('CSV neutraliza fórmula e escapa ponto e vírgula em dado real', () => {
  db.prepare("INSERT INTO proprietarios (nome, cpf_cnpj) VALUES ('=HYPERLINK(\"http://malicioso\")', '1')").run();
  db.prepare("INSERT INTO proprietarios (nome, cpf_cnpj) VALUES ('Silva; Maria', '2')").run();
  const csv = gerarCSV(construirRelatorio('proprietarios', {}));
  assert.ok(csv.includes("'=HYPERLINK"), 'fórmula deve ser neutralizada');
  assert.ok(!csv.includes(';=HYPERLINK'), 'fórmula não pode começar célula crua');
  assert.ok(csv.includes('"Silva; Maria"'), 'ponto e vírgula precisa de aspas');
  assert.ok(!csv.includes('"""Silva; Maria"""'), 'não pode escapar duas vezes');
  db.prepare("DELETE FROM proprietarios WHERE cpf_cnpj IN ('1','2')").run();
});

test('XLSX abre de volta e preserva texto com acento e ponto e vírgula', () => {
  db.prepare("INSERT INTO proprietarios (nome, cpf_cnpj) VALUES ('José; Ação', '77')").run();
  const rel = construirRelatorio('proprietarios', {});
  const buf = gerarXLSX(rel);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'xlsx é um zip');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  const texto = linhas.flat().join('|');
  assert.ok(texto.includes('José; Ação'));
  db.prepare("DELETE FROM proprietarios WHERE cpf_cnpj = '77'").run();
});

test('PDF é válido com dados e também com período vazio', async () => {
  const comDados = await gerarPDF(construirRelatorio('resumo-financeiro', { de, ate: comp }));
  assert.ok(Buffer.isBuffer(comDados));
  assert.equal(comDados.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(comDados.length > 1000, 'PDF com dados não pode ser vazio');
  assert.ok(comDados.subarray(-32).toString('latin1').includes('%%EOF'));

  const vazio = await gerarPDF(construirRelatorio('inadimplencia', { competencia: '1990-01', de: '1990-01', ate: '1990-01' }));
  assert.equal(vazio.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(vazio.length > 500, 'PDF vazio ainda precisa ter capa e resumo');
  assert.ok(vazio.subarray(-32).toString('latin1').includes('%%EOF'));
});

test('DRE por imóvel soma aluguéis e taxa por contrato', () => {
  const rel = construirRelatorio('dre-imovel', { de, ate: comp });
  const t = rel.resumo.find(r => r.rotulo === 'Aluguéis administrados');
  assert.ok(t.bruto > 0, 'o seed deve ter aluguéis no período');
  const soma = rel.linhas.reduce((s, l) => s + l.alugueis_centavos, 0);
  assert.equal(soma, t.bruto, 'soma das linhas deve fechar com o resumo');
});
