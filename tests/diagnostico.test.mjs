import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-diag-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const { diagnosticoBase } = await import('../src/diagnostico.js');
const {
  inserirAuditoria, verificarIntegridadeAuditoria, sincronizarAncoraAuditoria, reencadearAuditoria,
} = await import('../src/auditoria.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('diagnóstico devolve verificações e resumo consistente', () => {
  const d = diagnosticoBase();
  assert.ok(Array.isArray(d.checagens));
  assert.ok(d.checagens.length >= 10);
  assert.equal(typeof d.resumo.criticas, 'number');
  assert.equal(typeof d.resumo.total_ocorrencias, 'number');
  assert.ok(d.banco.ok, 'banco de demonstração deve passar no integrity_check');
  assert.ok(d.auditoria.ok, 'auditoria recém-criada deve estar íntegra');
  assert.equal(typeof d.ok, 'boolean');
});

test('diagnóstico encontra duplicidades e baixas sem lançamento', () => {
  const prop = db.prepare("INSERT INTO proprietarios (nome, cpf_cnpj) VALUES ('Duplicado A', '111.222.333-96')").run();
  db.prepare("INSERT INTO proprietarios (nome, cpf_cnpj) VALUES ('Duplicado B', '111.222.333-96')").run();
  assert.ok(Number(prop.lastInsertRowid) > 0);

  db.prepare("INSERT INTO parceiros (tipo, nome, cpf_cnpj) VALUES ('fornecedor', 'Fornecedor Um', '11.222.333/0001-81')").run();
  db.prepare("INSERT INTO parceiros (tipo, nome, cpf_cnpj) VALUES ('fornecedor', 'Fornecedor Dois', '11222333000181')").run();
  db.prepare("INSERT INTO categorias (contexto, nome, tipo, caixa) VALUES ('conta_pagar', 'Frete', 'despesa', 'imobiliaria')").run();
  db.prepare("INSERT INTO categorias (contexto, nome, tipo, caixa) VALUES ('conta_pagar', 'frete', 'despesa', 'imobiliaria')").run();

  const imovel = db.prepare("INSERT INTO imoveis (proprietario_id, endereco) VALUES (?, 'Rua Diagnóstico')")
    .run(Number(prop.lastInsertRowid)).lastInsertRowid;
  const inq = db.prepare("INSERT INTO inquilinos (nome) VALUES ('Inquilino Diagnóstico')").run().lastInsertRowid;
  const contrato = db.prepare(`INSERT INTO contratos (imovel_id, inquilino_id, inicio, aluguel_centavos, status)
    VALUES (?, ?, '2026-01-01', 100000, 'ativo')`).run(imovel, inq).lastInsertRowid;
  db.prepare(`INSERT INTO contratos (imovel_id, inquilino_id, inicio, aluguel_centavos, status)
    VALUES (?, ?, '2026-02-01', 100000, 'ativo')`).run(imovel, inq);
  db.prepare(`INSERT INTO contas (tipo, descricao, categoria, valor_centavos, vencimento, competencia, status, pago_em)
    VALUES ('pagar', 'Conta paga sem lançamento', 'Manutenção', 1000, '2026-01-10', '2026-01', 'paga', '2026-01-10')`).run();
  assert.ok(contrato > 0);

  const d = diagnosticoBase();
  const porId = Object.fromEntries(d.checagens.map(c => [c.id, c]));
  assert.ok(porId.pessoas_documento.total >= 1, 'CPF repetido em proprietários');
  assert.ok(porId.parceiros_documento.total >= 1, 'CNPJ repetido em parceiros');
  assert.ok(porId.categorias_duplicadas.total >= 1, 'categoria repetida ignorando caixa');
  assert.ok(porId.contratos_ativos_imovel.total >= 1, 'dois contratos ativos no mesmo imóvel');
  assert.ok(porId.contas_pagas_sem_lancamento.total >= 1, 'baixa sem lançamento');
  assert.ok(d.resumo.criticas > 0);
  assert.equal(d.ok, false);
});

test('âncora detecta remoção das últimas linhas da auditoria', () => {
  inserirAuditoria({ usuario_nome: 'Teste', acao: 'teste_ancora', entidade: 'sistema' });
  const antes = verificarIntegridadeAuditoria();
  assert.equal(antes.ok, true);
  const ultimo = db.prepare('SELECT id FROM auditoria ORDER BY id DESC LIMIT 1').get();
  db.prepare('DELETE FROM auditoria WHERE id = ?').run(ultimo.id);
  const depois = verificarIntegridadeAuditoria();
  assert.equal(depois.ok, false);
  assert.match(depois.problema.motivo, /truncada|âncora|não confere/i);
  reencadearAuditoria();
  assert.equal(verificarIntegridadeAuditoria().ok, true);
});

test('sincronizar âncora reflete o estado real da trilha', () => {
  inserirAuditoria({ usuario_nome: 'Teste', acao: 'teste_sincronizar', entidade: 'sistema' });
  const r = sincronizarAncoraAuditoria();
  assert.ok(r.total >= 1);
  assert.ok(typeof r.ultimo_hash === 'string' && r.ultimo_hash.length === 64);
  assert.equal(verificarIntegridadeAuditoria().ok, true);
});
