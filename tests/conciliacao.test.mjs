import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-conc-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';

const { db } = await import('../src/db.js');
const { parseOFX, parseCSV, previewConciliacao, listarPendentes, resumoConciliacao, confirmarConciliacao } = await import('../src/conciliacao.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const usuario = { id: 1, nome: 'Tester', papel: 'admin' };

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260310<TRNAMT>1000.00<FITID>ABC123<MEMO>PIX recebido</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260312<TRNAMT>-50.00<FITID>ABC124<MEMO>Tarifa</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>sem-data<TRNAMT>10.00<FITID>IGNORAR</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

function cenario() {
  const prop = Number(db.prepare("INSERT INTO proprietarios (nome, taxa_admin_pct) VALUES ('Dona Conciliação', 8)").run().lastInsertRowid);
  const imovel = Number(db.prepare("INSERT INTO imoveis (proprietario_id, endereco, numero) VALUES (?, 'Rua Conc', '1')").run(prop).lastInsertRowid);
  const inq = Number(db.prepare("INSERT INTO inquilinos (nome) VALUES ('Inquilino Conc')").run().lastInsertRowid);
  const contrato = Number(db.prepare(`INSERT INTO contratos (codigo, imovel_id, inquilino_id, inicio, aluguel_centavos, dia_vencimento, status)
    VALUES ('CT-CONC', ?, ?, '2026-01-01', 100000, 10, 'ativo')`).run(imovel, inq).lastInsertRowid);
  const cobranca = Number(db.prepare(`INSERT INTO cobrancas (contrato_id, competencia, vencimento, valor_original_centavos, status)
    VALUES (?, '2026-03', '2026-03-10', 100000, 'em_aberto')`).run(contrato).lastInsertRowid);
  return { prop, imovel, inq, contrato, cobranca };
}

test('parseOFX lê transações e ignora linhas sem data', () => {
  const t = parseOFX(OFX);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], {
    data: '2026-03-10', valor_centavos: 100000, descricao: 'PIX recebido', fitid: 'ABC123', origem: 'ofx',
  });
  assert.equal(t[1].valor_centavos, -5000);
});

test('parseOFX de arquivo sem transações devolve lista vazia', () => {
  assert.deepEqual(parseOFX('<OFX></OFX>'), []);
});

test('parseCSV sugere colunas e converte datas/valores com mapeamento', () => {
  const csv = '\uFEFFData;Valor;Descrição\r\n10/03/2026;1.234,56;PIX de aluguel\r\n11/03/2026;-20,00;Tarifa\r\n';
  const base64 = Buffer.from(csv).toString('base64');

  const semMapa = parseCSV(base64);
  assert.equal(semMapa.precisa_mapeamento, true);
  assert.deepEqual(semMapa.sugestao, { data: 0, valor: 1, descricao: 2 });

  const comMapa = parseCSV(base64, { data: 0, valor: 1, descricao: 2 });
  assert.equal(comMapa.transacoes.length, 2);
  assert.equal(comMapa.transacoes[0].valor_centavos, 123456);
  assert.equal(comMapa.transacoes[0].data, '2026-03-10');
  assert.equal(comMapa.transacoes[1].valor_centavos, -2000);
});

test('preview importa uma vez, evita duplicidade e sugere a cobrança', () => {
  const { cobranca } = cenario();
  const arquivo = Buffer.from(OFX).toString('base64');

  const primeiro = previewConciliacao({ arquivo_base64: arquivo, nome: 'extrato.ofx' });
  assert.equal(primeiro.importadas, 2);
  assert.equal(primeiro.duplicadas, 0);

  const segundo = previewConciliacao({ arquivo_base64: arquivo, nome: 'extrato.ofx' });
  assert.equal(segundo.importadas, 0);
  assert.equal(segundo.duplicadas, 2, 'FITID evita importar a mesma transação duas vezes');

  const pendentes = listarPendentes('pendente');
  const credito = pendentes.find(p => p.valor_centavos === 100000);
  assert.equal(credito.sugestao_tipo, 'cobranca');
  assert.equal(credito.sugestao_id, cobranca);

  const resumo = resumoConciliacao();
  assert.equal(resumo.pendentes, 2);
  assert.equal(resumo.entradas, 100000);
  assert.equal(resumo.saidas, 5000);

  const r = confirmarConciliacao(credito.id, { acao: 'cobranca' }, usuario);
  assert.equal(r.status, 'conciliado');
  const paga = db.prepare('SELECT status, valor_pago_centavos FROM cobrancas WHERE id = ?').get(cobranca);
  assert.equal(paga.status, 'pago');
  assert.equal(paga.valor_pago_centavos, 100000);
});

test('ignorar transação remove da fila e não pode ser tratada duas vezes', () => {
  const pendente = listarPendentes('pendente')[0];
  assert.ok(pendente);
  const r = confirmarConciliacao(pendente.id, { acao: 'ignorar' }, usuario);
  assert.equal(r.status, 'ignorado');
  assert.throws(() => confirmarConciliacao(pendente.id, { acao: 'ignorar' }, usuario), (e) => e.status === 409);
});

test('arquivo sem transações reconhecidas falha com 400', () => {
  assert.throws(() => previewConciliacao({ arquivo_base64: Buffer.from('nada aqui').toString('base64'), nome: 'x.csv' }),
    (e) => e.status === 400);
});

test('valor maior que o saldo não é sugerido como pagamento de cobrança', () => {
  const ofx = `<OFX><STMTTRN><DTPOSTED>20260410<TRNAMT>5000.00<FITID>ALTO1<MEMO>PIX</STMTTRN></OFX>`;
  previewConciliacao({ arquivo_base64: Buffer.from(ofx).toString('base64'), nome: 'x.ofx' });
  const pendente = listarPendentes('pendente').find(p => p.descricao === 'PIX');
  assert.ok(pendente);
  // Não existe cobrança em aberto com saldo suficiente para 5.000,00.
  assert.notEqual(pendente.sugestao_tipo, 'cobranca');
});
