import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-cad-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';

const { db } = await import('../src/db.js');
const cad = await import('../src/cadastros.js');
const contas = await import('../src/contas.js');
const comissoes = await import('../src/comissoes.js');
const backup = await import('../src/backup.js');
const { hojeISO, competenciaAtual } = await import('../src/regras.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const admin = { id: 1, nome: 'Tester', papel: 'admin' };
const comp = competenciaAtual();

function cenario() {
  const prop = Number(db.prepare('INSERT INTO proprietarios (nome) VALUES (?)').run('Dona Teste').lastInsertRowid);
  const imovel = Number(db.prepare("INSERT INTO imoveis (proprietario_id, endereco, numero, situacao) VALUES (?,?,?, 'alugado')")
    .run(prop, 'Rua de Teste', '10').lastInsertRowid);
  const inq = Number(db.prepare('INSERT INTO inquilinos (nome) VALUES (?)').run('Inquilino Teste').lastInsertRowid);
  const contrato = Number(db.prepare(`INSERT INTO contratos (codigo, imovel_id, inquilino_id, inicio, aluguel_centavos, status)
    VALUES (?,?,?,?,?, 'ativo')`).run('CT-CAD', imovel, inq, hojeISO(), 200000).lastInsertRowid);
  return { prop, imovel, inq, contrato };
}

test('parceiros: cadastro, filtro por tipo, vínculo e duplicidade', () => {
  const corretor = cad.criarParceiro({ tipo: 'corretor', nome: 'Ana Corretora', creci: 'CRECI-SP 1', pix: 'ana@exemplo.com' });
  assert.equal(corretor.tipo, 'corretor');
  assert.equal(corretor.ativo, 1);
  cad.criarParceiro({ tipo: 'fornecedor', nome: 'Oficina Silva' });
  cad.criarParceiro({ tipo: 'ambos', nome: 'Parceiro Total' });

  assert.equal(cad.listarParceiros({ tipo: 'corretor' }).some(p => p.nome === 'Ana Corretora'), true);
  assert.equal(cad.listarParceiros({ tipo: 'corretor' }).some(p => p.nome === 'Parceiro Total'), true);
  assert.equal(cad.listarParceiros({ tipo: 'fornecedor' }).some(p => p.nome === 'Oficina Silva'), true);
  assert.equal(cad.listarParceiros({ busca: 'ana' }).length, 1);

  assert.throws(() => cad.criarParceiro({ tipo: 'corretor', nome: 'Ana Corretora' }), (e) => e.status === 409);
  assert.throws(() => cad.criarParceiro({ tipo: 'outro', nome: 'X' }), /corretor, fornecedor/);

  assert.equal(cad.resolverParceiro({ nome: 'ana corretora', tipo: 'corretor' }).id, corretor.id);
  assert.equal(cad.resolverParceiro({ nome: 'Oficina Silva', tipo: 'cliente' }), null);
  assert.throws(() => cad.resolverParceiro({ id: corretor.id, tipo: 'fornecedor' }), /não está cadastrado como fornecedor/);
});

test('categorias: sementes, contexto, reativação e uso automático', () => {
  const lanc = cad.listarCategorias({ contexto: 'lancamento' });
  assert.ok(lanc.some(c => c.nome === 'Aluguel' && c.caixa === 'proprietarios'));
  assert.ok(lanc.some(c => c.nome === 'Manutenção' && c.tipo === 'despesa'));
  assert.ok(cad.listarCategorias({ contexto: 'conta_pagar' }).some(c => c.nome === 'Ocupação'));

  const nova = cad.criarCategoria({ contexto: 'conta_pagar', nome: 'Frete', tipo: 'despesa', caixa: 'imobiliaria', ordem: 15 });
  assert.equal(nova.nome, 'Frete');
  assert.throws(() => cad.criarCategoria({ contexto: 'conta_pagar', nome: 'Frete' }), (e) => e.status === 409);
  cad.desativarCategoria(nova.id);
  assert.equal(cad.listarCategorias({ contexto: 'conta_pagar' }).some(c => c.nome === 'Frete'), false);
  const reativada = cad.criarCategoria({ contexto: 'conta_pagar', nome: 'frete' });
  assert.equal(reativada.id, nova.id);
  assert.equal(reativada.ativo, 1);

  cad.garantirCategoria('conta_receber', 'Taxa de vistoria', 'receita', 'imobiliaria');
  assert.ok(cad.listarCategorias({ contexto: 'conta_receber' }).some(c => c.nome === 'Taxa de vistoria'));
});

test('contrato guarda corretor vinculado e comissão usa o cadastro', () => {
  const { contrato } = cenario();
  const corretor = cad.criarParceiro({ tipo: 'corretor', nome: 'Bruno Corretor', pix: 'bruno@exemplo.com' });
  db.prepare('UPDATE contratos SET corretor = ?, corretor_id = ? WHERE id = ?').run(corretor.nome, corretor.id, contrato);
  const c = comissoes.criar({ contrato_id: contrato, corretor_id: corretor.id, pct: 10, competencia: comp }, admin);
  assert.equal(c.corretor, 'Bruno Corretor');
  assert.equal(c.corretor_id, corretor.id);
  assert.equal(c.corretor_cadastro, 'Bruno Corretor');
  assert.equal(c.corretor_pix, 'bruno@exemplo.com');
  assert.equal(c.valor_centavos, 20000);
});

test('conta vincula fornecedor cadastrado, registra categoria e aceita novas recorrências', () => {
  const forn = cad.criarParceiro({ tipo: 'fornecedor', nome: 'Hidráulica Central' });
  const conta = contas.criar({
    tipo: 'pagar', descricao: 'Reparo', categoria: 'Reparo emergencial', fornecedor: 'hidráulica central',
    valor_centavos: 30000, vencimento: `${comp}-10`, recorrencia: 'trimestral',
  }, admin);
  assert.equal(conta.parceiro_id, forn.id);
  assert.equal(conta.fornecedor, 'Hidráulica Central');
  assert.ok(cad.listarCategorias({ contexto: 'conta_pagar' }).some(c => c.nome === 'Reparo emergencial'));

  assert.equal(contas.proximoVencimento(`${comp}-10`, 'bimestral') > `${comp}-10`, true);
  const paga = contas.pagar(conta.id, { data: `${comp}-10` }, admin);
  assert.ok(paga.proxima_conta_id);
  const proxima = contas.obter(paga.proxima_conta_id);
  assert.equal(proxima.recorrencia, 'trimestral');
  assert.equal(proxima.parceiro_id, forn.id);
});

test('snapshot grava hash e acusa adulteração', () => {
  const arquivo = backup.criarSnapshot({ prefixo: 'teste-hash' });
  const lista = backup.listarSnapshots();
  const item = lista.find(x => x.nome === path.basename(arquivo));
  assert.ok(item);
  assert.equal(item.hash_ok, true);
  assert.ok(fs.existsSync(`${arquivo}.sha256`));

  fs.appendFileSync(arquivo, Buffer.from('adulterado'));
  const depois = backup.listarSnapshots().find(x => x.nome === path.basename(arquivo));
  assert.equal(depois.hash_ok, false);
});
