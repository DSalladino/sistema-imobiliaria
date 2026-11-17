import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-feat-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';
process.env.SEED_DEMO = '1';

const { db } = await import('../src/db.js');
const { hojeISO, competenciaAtual, addMeses, setSetting } = await import('../src/regras.js');
const pix = await import('../src/pix.js');
const contas = await import('../src/contas.js');
const acoes = await import('../src/contratos-acoes.js');
const comissoes = await import('../src/comissoes.js');
const { drePorImovel, construirRelatorioDre } = await import('../src/dre.js');
const { construirRelatorio, gerarCSV } = await import('../src/reports.js');
const whatsapp = await import('../src/whatsapp.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const admin = { id: 1, nome: 'Tester', papel: 'admin' };
const comp = competenciaAtual();

/** Cenário isolado: um proprietário, um imóvel, um inquilino e um contrato. */
function cenario({ caução = 0, aluguel = 200000, ultimoReajuste = null } = {}) {
  const prop = Number(db.prepare(`INSERT INTO proprietarios (nome, taxa_admin_pct) VALUES (?, 8)`).run('Dona Teste').lastInsertRowid);
  const imovel = Number(db.prepare(`INSERT INTO imoveis (proprietario_id, endereco, numero, situacao) VALUES (?,?,?, 'alugado')`)
    .run(prop, 'Rua de Teste', '10').lastInsertRowid);
  const inq = Number(db.prepare('INSERT INTO inquilinos (nome, telefone) VALUES (?,?)').run('Inquilino Teste', '(11) 99999-0000').lastInsertRowid);
  const contrato = Number(db.prepare(`INSERT INTO contratos (codigo, imovel_id, inquilino_id, inicio, aluguel_centavos,
      dia_vencimento, ultimo_reajuste, garantia_tipo, garantia_valor_centavos, status)
      VALUES (?,?,?,?,?,5,?,?,?, 'ativo')`)
    .run('CT-T1', imovel, inq, addMeses(hojeISO(), -18), aluguel, ultimoReajuste, caução ? 'caucao' : 'nenhuma', caução).lastInsertRowid);
  return { prop, imovel, inq, contrato };
}

function cobranca(contrato, { vencimento, valor = 200000, status = 'em_aberto', competencia = null } = {}) {
  return Number(db.prepare(`INSERT INTO cobrancas (contrato_id, competencia, vencimento, valor_original_centavos, status)
    VALUES (?,?,?,?,?)`).run(contrato, competencia || String(vencimento).slice(0, 7), vencimento, valor, status).lastInsertRowid);
}

/* ---------------------------- Pix ---------------------------- */

test('CRC16 do Pix confere com o vetor oficial CCITT-FALSE', () => {
  assert.equal(pix.crc16('123456789'), '29B1');
});

test('payload Pix tem os campos EMV obrigatórios e valor formatado', () => {
  const payload = pix.pixPayload({
    chave: 'financeiro@imobiliaria.com', nome: 'Imobiliária Ação', cidade: 'São Paulo',
    valorCentavos: 180050, txid: 'IMOB-42/2026',
  });
  assert.ok(payload.startsWith('000201'));
  assert.ok(payload.includes('0014br.gov.bcb.pix'));
  assert.ok(payload.includes('0107') || payload.includes('financeiro@imobiliaria.com'));
  assert.ok(payload.includes('5303986'));
  assert.ok(payload.includes('54071800.50'), 'valor com duas casas decimais');
  assert.ok(payload.includes('5916IMOBILIARIA ACAO'), 'nome sem acento');
  assert.ok(payload.includes('6009SAO PAULO'));
  assert.ok(payload.includes('62140510IMOB422026'), 'txid sem pontuação');
  assert.equal(payload.slice(-8, -4), '6304');
  assert.equal(payload.slice(-4), pix.crc16(payload.slice(0, -4)));
  assert.ok(!/[\u00C0-\u017F]/.test(payload), 'payload é ASCII');
});

test('valor zero não vai no payload e txid vazio vira ***', () => {
  const payload = pix.pixPayload({ chave: '11999990000', nome: 'X', cidade: 'Y', valorCentavos: 0, txid: '' });
  assert.ok(!payload.includes('5406'), 'sem campo de valor');
  assert.ok(payload.includes('0503***'));
});

test('Pix da cobrança usa o saldo e exige chave configurada', () => {
  const { contrato } = cenario();
  const id = cobranca(contrato, { vencimento: '2026-12-10', valor: 150000, competencia: '2026-12' });
  assert.throws(() => pix.pixDaCobranca(id), /chave Pix/);

  setSetting('pix_chave', 'imob@exemplo.com');
  setSetting('pix_recebedor', 'Imob Teste');
  setSetting('pix_cidade', 'Campinas');
  const p = pix.pixDaCobranca(id);
  assert.equal(p.valor_centavos, 150000);
  assert.ok(p.txid.startsWith(`IMOB${id}`));
  assert.ok(p.payload.includes('54071500.00'));
  assert.ok(p.mensagem.includes(p.payload));

  db.prepare("UPDATE cobrancas SET status='pago', valor_pago_centavos=150000 WHERE id=?").run(id);
  assert.throws(() => pix.pixDaCobranca(id), /quitada/);
});

/* -------------------------- WhatsApp -------------------------- */

test('telefone e link do WhatsApp são normalizados', () => {
  assert.equal(whatsapp.normalizarTelefone('(11) 98888-7777'), '5511988887777');
  assert.equal(whatsapp.normalizarTelefone('+55 11 98888-7777'), '5511988887777');
  assert.equal(whatsapp.normalizarTelefone('11988887777'), '5511988887777');
  assert.equal(whatsapp.normalizarTelefone(''), '');
  assert.equal(whatsapp.linkWhatsapp('11988887777', 'Olá, tudo bem?'),
    'https://wa.me/5511988887777?text=Ol%C3%A1%2C%20tudo%20bem%3F');
  assert.equal(whatsapp.linkWhatsapp('', 'x'), `https://wa.me/?text=${encodeURIComponent('x')}`);
});

test('modo link devolve wa.me e modo api usa a Cloud API', async () => {
  setSetting('whatsapp_modo', 'link');
  const r = await whatsapp.enviarWhatsapp({ telefone: '11988887777', mensagem: 'Cobrança de teste' });
  assert.equal(r.modo, 'link');
  assert.ok(r.link.startsWith('https://wa.me/5511988887777'));

  setSetting('whatsapp_modo', 'api');
  assert.equal(whatsapp.modoWhatsapp(), 'link', 'sem credenciais cai para link');

  process.env.WHATSAPP_TOKEN = 'token-de-teste';
  process.env.WHATSAPP_PHONE_ID = '123456';
  try {
    assert.equal(whatsapp.modoWhatsapp(), 'api');
    let chamada = null;
    const fetchFake = async (url, opcoes) => {
      chamada = { url, opcoes };
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }) };
    };
    const envio = await whatsapp.enviarWhatsapp({ telefone: '(11) 98888-7777', mensagem: 'Oi', fetchImpl: fetchFake });
    assert.equal(envio.modo, 'api');
    assert.equal(envio.id, 'wamid.1');
    assert.ok(chamada.url.includes('/123456/messages'));
    assert.equal(chamada.opcoes.headers.Authorization, 'Bearer token-de-teste');
    const corpo = JSON.parse(chamada.opcoes.body);
    assert.equal(corpo.to, '5511988887777');
    assert.equal(corpo.text.body, 'Oi');

    const falha = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'número inválido' } }) });
    await assert.rejects(() => whatsapp.enviarWhatsapp({ telefone: '11988887777', mensagem: 'x', fetchImpl: falha }), /número inválido/);
  } finally {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_ID;
    setSetting('whatsapp_modo', 'link');
  }
});

/* -------------------- Contas a pagar/receber -------------------- */

test('conta recorrente calcula o próximo vencimento sem estourar o mês', () => {
  assert.equal(contas.proximoVencimento('2026-01-31', 'mensal'), '2026-02-28');
  assert.equal(contas.proximoVencimento('2026-02-28', 'mensal'), '2026-03-28');
  assert.equal(contas.proximoVencimento('2026-01-10', 'semanal'), '2026-01-17');
  assert.equal(contas.proximoVencimento('2026-02-29'.replace('29', '28'), 'anual'), '2027-02-28');
  assert.throws(() => contas.proximoVencimento('2026-01-10', 'diaria'), /Recorrência inválida/);
});

test('conta a pagar recorrente: baixa gera lançamento e cria a próxima parcela', () => {
  const { prop, imovel } = cenario();
  const c = contas.criar({
    tipo: 'pagar', descricao: 'Aluguel do escritório', categoria: 'Ocupação',
    valor_centavos: 250000, vencimento: '2026-03-05', recorrencia: 'mensal',
    recorrencia_fim: '2026-06-05', proprietario_id: prop, imovel_id: imovel,
  }, admin);
  assert.equal(c.competencia, '2026-03');
  assert.equal(c.status, 'aberta');
  assert.equal(c.recorrencia_label, 'Mensal');

  assert.throws(() => contas.criar({
    tipo: 'pagar', descricao: 'Aluguel do escritório', categoria: 'Ocupação',
    valor_centavos: 250000, vencimento: '2026-03-05',
  }, admin), /Já existe uma conta/);

  const lancAntes = db.prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE categoria = 'Ocupação'").get().n;
  const r = contas.pagar(c.id, { data: '2026-03-05' }, admin);
  assert.equal(r.valor_centavos, 250000);
  assert.ok(r.proxima_conta_id, 'criou a parcela seguinte');
  const proxima = contas.obter(r.proxima_conta_id);
  assert.equal(proxima.vencimento, '2026-04-05');
  assert.equal(proxima.status, 'aberta');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE categoria = 'Ocupação'").get().n, lancAntes + 1);
  const lanc = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(r.lancamento_id);
  assert.equal(lanc.tipo, 'despesa');
  assert.equal(lanc.caixa, 'imobiliaria');
  assert.equal(lanc.competencia, '2026-03');

  assert.throws(() => contas.pagar(c.id, {}, admin), /já está baixada/);
  assert.throws(() => contas.pagar(proxima.id, { valor_centavos: 999999 }, admin), /não pode ser maior/);
});

test('conta a receber, filtros, cancelamento e resumo', () => {
  const c = contas.criar({
    tipo: 'receber', descricao: 'Taxa de vistoria', categoria: 'Serviços',
    valor_centavos: 30000, vencimento: '2026-03-20',
  }, admin);
  const abertas = contas.listar({ tipo: 'receber', status: 'abertas' });
  assert.ok(abertas.some(x => x.id === c.id));
  assert.ok(contas.listar({ busca: 'vistoria' }).some(x => x.id === c.id));

  const cancelada = contas.cancelar(c.id, 'Cliente desistiu', admin);
  assert.equal(cancelada.status, 'cancelada');
  assert.ok(!contas.listar({ tipo: 'receber', status: 'abertas' }).some(x => x.id === c.id));
  assert.throws(() => contas.pagar(c.id, {}, admin), /cancelada/);

  const resumo = contas.resumo();
  assert.ok(Object.prototype.hasOwnProperty.call(resumo, 'a_pagar'));
  assert.ok(Object.prototype.hasOwnProperty.call(resumo, 'saldo_previsto_centavos'));
});

test('previsão de caixa projeta recorrências mês a mês', () => {
  const proximoMes = addMeses(`${comp}-01`, 1).slice(0, 7);
  contas.criar({ tipo: 'pagar', descricao: 'Internet', valor_centavos: 10000, vencimento: `${proximoMes}-10`, recorrencia: 'mensal' }, admin);
  contas.criar({ tipo: 'receber', descricao: 'Consultoria', valor_centavos: 40000, vencimento: `${proximoMes}-15` }, admin);
  const prev = contas.previsaoCaixa({ meses: 3 });
  assert.equal(prev.meses.length, 3);
  assert.ok(prev.meses[0].saidas === 0, 'mês atual sem contas futuras');
  assert.ok(prev.meses[1].saidas >= 10000);
  assert.ok(prev.meses[1].entradas >= 40000);
  assert.ok(prev.meses[2].saidas >= 10000, 'recorrência projetada no mês seguinte');
  assert.equal(prev.meses[1].saldo, prev.meses[1].entradas - prev.meses[1].saidas);
  assert.equal(prev.meses[2].saldo_acumulado, prev.meses[0].saldo + prev.meses[1].saldo + prev.meses[2].saldo);
});

/* ---------------------- Reajuste em lote ---------------------- */

test('prévia de reajuste lista contratos com aniversário vencido', () => {
  const { contrato } = cenario({ aluguel: 100000, ultimoReajuste: addMeses(hojeISO(), -13) });
  const previa = acoes.previewReajuste({ data: hojeISO(), percentual: 5, indice: 'IPCA' });
  const linha = previa.linhas.find(l => l.contrato_id === contrato);
  assert.ok(linha, 'contrato elegível aparece na prévia');
  assert.equal(linha.aluguel_novo_centavos, 105000);
  assert.equal(linha.diferenca_centavos, 5000);
  assert.ok(previa.resumo.contratos >= 1);
});

test('reajuste em lote atualiza contrato, histórico e cobrança em aberto', () => {
  const { contrato } = cenario({ aluguel: 100000, ultimoReajuste: addMeses(hojeISO(), -13) });
  const aberta = cobranca(contrato, { vencimento: addMeses(hojeISO(), 1), valor: 100000 });
  const paga = cobranca(contrato, { vencimento: addMeses(hojeISO(), -2), valor: 100000, status: 'pago' });

  const r = acoes.aplicarReajuste({ contrato_ids: [contrato], percentual: 7.5, indice: 'IGP-M', data: hojeISO() }, admin);
  assert.equal(r.aplicados.length, 1);
  assert.equal(db.prepare('SELECT aluguel_centavos FROM contratos WHERE id = ?').get(contrato).aluguel_centavos, 107500);
  assert.equal(db.prepare('SELECT valor_original_centavos FROM cobrancas WHERE id = ?').get(aberta).valor_original_centavos, 107500);
  assert.equal(db.prepare('SELECT valor_original_centavos FROM cobrancas WHERE id = ?').get(paga).valor_original_centavos, 100000);
  assert.equal(acoes.historicoReajustes(contrato).length, 1);

  db.prepare("UPDATE contratos SET status='encerrado' WHERE id = ?").run(contrato);
  assert.throws(() => acoes.aplicarReajuste({ contrato_ids: [contrato], percentual: 5 }, admin), /não está ativo/);
  assert.throws(() => acoes.aplicarReajuste({ contrato_ids: [], percentual: 5 }, admin), /ao menos um/);
});

/* --------------------------- Rescisão --------------------------- */

test('rescisão encerra contrato, cancela cobranças futuras e devolve caução', () => {
  const { contrato, imovel } = cenario({ caução: 300000 });
  const futura = cobranca(contrato, { vencimento: addMeses(hojeISO(), 2) });
  const passada = cobranca(contrato, { vencimento: addMeses(hojeISO(), -1) });

  const r = acoes.rescindir(contrato, {
    data: hojeISO(), motivo: 'Devolução do imóvel', multa_centavos: 100000, devolver_caucao: true,
  }, admin);

  assert.equal(r.caucao_devolucao_centavos, 200000);
  assert.deepEqual(r.cobrancas_canceladas, [futura]);
  assert.equal(db.prepare('SELECT status FROM cobrancas WHERE id = ?').get(futura).status, 'cancelado');
  assert.equal(db.prepare('SELECT status FROM cobrancas WHERE id = ?').get(passada).status, 'em_aberto');
  const ct = db.prepare('SELECT status, fim FROM contratos WHERE id = ?').get(contrato);
  assert.equal(ct.status, 'encerrado');
  assert.equal(ct.fim, hojeISO());
  assert.equal(db.prepare('SELECT situacao FROM imoveis WHERE id = ?').get(imovel).situacao, 'vago');
  assert.equal(acoes.obterRescisao(contrato).motivo, 'Devolução do imóvel');

  const contaCaucao = db.prepare("SELECT * FROM contas WHERE contrato_id = ? AND categoria = 'Devolução de caução'").get(contrato);
  assert.equal(contaCaucao.tipo, 'pagar');
  assert.equal(contaCaucao.valor_centavos, 200000);
  assert.equal(contaCaucao.caixa, 'proprietarios');
  const contaMulta = db.prepare("SELECT * FROM contas WHERE contrato_id = ? AND categoria = 'Multa rescisória'").get(contrato);
  assert.equal(contaMulta.tipo, 'receber');
  assert.equal(contaMulta.valor_centavos, 100000);

  assert.throws(() => acoes.rescindir(contrato, { motivo: 'de novo' }, admin), /já está encerrado/);
});

test('rescisão exige motivo e data válida', () => {
  const { contrato } = cenario();
  assert.throws(() => acoes.rescindir(contrato, { motivo: '' }, admin), /motivo/);
  assert.throws(() => acoes.rescindir(contrato, { motivo: 'ok', data: '2000-01-01' }, admin), /anterior ao início/);
});

/* -------------------------- Comissões -------------------------- */

test('comissão é calculada sobre o aluguel, paga como despesa e não duplica', () => {
  const { contrato } = cenario({ aluguel: 200000 });
  const c = comissoes.criar({ contrato_id: contrato, corretor: 'Ana Corretora', pct: 10, competencia: comp }, admin);
  assert.equal(c.valor_centavos, 20000);
  assert.equal(c.status, 'prevista');

  assert.throws(() => comissoes.criar({ contrato_id: contrato, corretor: 'Ana Corretora', pct: 10, competencia: comp }, admin), /Já existe comissão/);
  assert.throws(() => comissoes.criar({ contrato_id: contrato, corretor: '', pct: 10, competencia: comp }, admin), /corretor/);
  assert.throws(() => comissoes.criar({ contrato_id: contrato, corretor: 'X', pct: 0, competencia: comp }, admin), /entre 0 e 100/);

  const liberada = comissoes.atualizarStatus(c.id, 'liberada', admin);
  assert.equal(liberada.status, 'liberada');

  const pago = comissoes.pagar(c.id, { data: hojeISO() }, admin);
  assert.ok(pago.lancamento_id);
  const lanc = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(pago.lancamento_id);
  assert.equal(lanc.tipo, 'despesa');
  assert.equal(lanc.categoria, 'Comissão de corretagem');
  assert.equal(lanc.caixa, 'imobiliaria');

  assert.throws(() => comissoes.pagar(c.id, {}, admin), /já paga/);
  assert.throws(() => comissoes.cancelar(c.id, 'x', admin), /não pode ser cancelada/);

  const resumo = comissoes.resumo(comp);
  assert.ok(resumo.pagas_centavos >= 20000);
  assert.ok(resumo.corretores.includes('Ana Corretora'));
});

test('geração de comissões em lote respeita corretor e percentual', () => {
  const { contrato } = cenario({ aluguel: 300000 });
  db.prepare('UPDATE contratos SET corretor = ?, comissao_pct = 5 WHERE id = ?').run('Bruno Corretor', contrato);
  const r = comissoes.gerarLote({ competencia: '2026-08' }, admin);
  assert.ok(r.criadas >= 1);
  const criada = r.comissoes.find(x => x.contrato_id === contrato);
  assert.equal(criada.corretor, 'Bruno Corretor');
  assert.equal(criada.valor_centavos, 15000);
  const semCorretor = r.ignoradas.filter(i => i.motivo === 'sem corretor');
  assert.ok(Array.isArray(semCorretor));
});

/* ----------------------- DRE por imóvel ----------------------- */

test('DRE por imóvel soma aluguel, taxa, despesa e comissão', () => {
  const { contrato, imovel, prop } = cenario({ aluguel: 100000 });
  const c = { competencia: comp, tipo: 'receita', categoria: 'Aluguel', caixa: 'proprietarios' };
  db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, imovel_id, contrato_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(hojeISO(), c.competencia, c.tipo, c.categoria, 'Aluguel teste', 100000, c.caixa, prop, imovel, contrato);
  db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, imovel_id)
    VALUES (?,?,'despesa','Manutenção','Reparo',?, 'proprietarios', ?, ?)`)
    .run(hojeISO(), comp, 20000, prop, imovel);
  comissoes.criar({ contrato_id: contrato, corretor: 'Ana Corretora', pct: 10, competencia: comp }, admin);

  const dre = drePorImovel({ de: comp, ate: comp });
  const linha = dre.linhas.find(l => l.imovel_id === imovel);
  assert.ok(linha);
  assert.equal(linha.alugueis_centavos, 100000);
  assert.equal(linha.taxa_centavos, 8000);
  assert.equal(linha.despesas_centavos, 20000);
  assert.equal(linha.comissoes_centavos, 10000);
  assert.equal(linha.resultado_proprietario_centavos, 72000);
  assert.equal(linha.resultado_imobiliaria_centavos, -2000);

  const rel = construirRelatorio('dre-imovel', { de: comp, ate: comp });
  assert.equal(rel.titulo, 'DRE por imóvel');
  assert.ok(rel.colunas.length >= 8);
  assert.ok(rel.linhas.length >= 1);
  assert.ok(rel.resumo.some(r => r.rotulo === 'Resultado da imobiliária'));
  const csv = gerarCSV(rel);
  assert.ok(csv.includes('DRE por imóvel'));
  assert.ok(construirRelatorioDre({ de: comp, ate: comp }).linhas.length >= 1);
});
