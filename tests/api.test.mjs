import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

async function esperarServidor(proc, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let saida = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não subiu:\n${saida}`)), timeoutMs);
    proc.stdout.on('data', (d) => {
      saida += d;
      const m = saida.match(/Rodando em http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.stderr.on('data', (d) => { saida += d; });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Servidor encerrou (${code}):\n${saida}`)); });
  });
}

test('fluxo principal da API', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-api-'));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: '0', SEED_COMPLETO: '0', SEED_DEMO: '1', HOST: '127.0.0.1', APP_SECRET: 'test-secret-38-caracteres-para-o-teste', ADMIN_SENHA: 'admin123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { proc.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const port = await esperarServidor(proc);

  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const req = async (caminho, { method = 'GET', body } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + caminho, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { res, data };
  };

  await t.test('health responde sem autenticação e verifica o banco', async () => {
    const { res, data } = await req('/api/health');
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.versao);
    assert.equal(data.banco, 'ok', 'health deve checar o banco');
    assert.equal(data.uploads, 'ok', 'health deve checar a escrita dos uploads');
  });

  await t.test('configuração pública identifica o ambiente', async () => {
    const { res, data } = await req('/api/config');
    assert.equal(res.status, 200);
    assert.equal(data.demo, false);
    assert.ok(data.versao);
    assert.equal(data.demo_senha, null, 'fora do demo não expõe credenciais');
  });

  await t.test('rejeita credenciais inválidas', async () => {
    const { res } = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'errada' } });
    assert.equal(res.status, 401);
  });

  await t.test('login inicial exige troca de senha', async () => {
    const { res, data } = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'admin123' } });
    assert.equal(res.status, 200);
    assert.equal(data.usuario.deve_trocar_senha, true);
    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie');
    assert.ok(setCookie?.includes('sid='));
    cookie = setCookie.split(';')[0];

    const { DatabaseSync } = await import('node:sqlite');
    const b = new DatabaseSync(path.join(dir, 'imobiliaria.db'));
    const salvo = b.prepare('SELECT token FROM sessoes ORDER BY rowid DESC LIMIT 1').get().token;
    b.close();
    assert.equal(salvo.length, 64, 'o token de sessão deve ser gravado como hash');
    assert.notEqual(salvo, cookie.split('=')[1], 'o cookie não pode aparecer em claro no banco');
  });

  await t.test('troca de senha e leitura do painel', async () => {
    // Antes de trocar, a senha temporária não pode operar a API.
    const bloqueado = await req('/api/dashboard');
    assert.equal(bloqueado.res.status, 403);
    assert.match(bloqueado.data.erro, /senha/i);
    const bloqueadoEscrita = await req('/api/proprietarios', { method: 'POST', body: { nome: 'Bypass' } });
    assert.equal(bloqueadoEscrita.res.status, 403);

    const nova = 'SenhaForte#2026';
    const alt = await req('/api/me/senha', { method: 'POST', body: { senha_atual: 'admin123', senha_nova: nova } });
    assert.equal(alt.res.status, 200);
    const dash = await req('/api/dashboard');
    assert.equal(dash.res.status, 200);
    assert.ok(dash.data.totalProps >= 3);
    const analytics = await req('/api/analytics');
    assert.equal(analytics.res.status, 200);
    assert.ok(Array.isArray(analytics.data.serie));
    const compAtual = new Date().toISOString().slice(0, 7);
    const mes = await req(`/api/analytics?de=${compAtual}&ate=${compAtual}`);
    assert.equal(mes.res.status, 200);
    assert.ok(mes.data.kpis.alugueis > 0, 'o mês atual deve ter aluguéis no painel');
    // a senha antiga não entra mais
    const antigo = await req('/api/login', { method: 'POST', body: { email: 'admin@imobiliaria.local', senha: 'admin123' } });
    assert.equal(antigo.res.status, 401);
  });

  await t.test('não permite ficar sem administrador ativo', async () => {
    const me = await req('/api/me');
    assert.equal(me.res.status, 200);
    const r = await req(`/api/usuarios/${me.data.usuario.id}`, { method: 'PUT', body: { papel: 'operador' } });
    assert.equal(r.res.status, 400);
    assert.match(r.data.erro, /administrador/i);
  });

  await t.test('assistente responde com dados e exige autenticação', async () => {
    const semSessao = await fetch(base + '/api/assistente', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pergunta: 'resumo' }),
    });
    assert.equal(semSessao.status, 401);
    const { res, data } = await req('/api/assistente', { method: 'POST', body: { pergunta: 'quem está inadimplente?' } });
    assert.equal(res.status, 200);
    assert.equal(data.intencao, 'inadimplencia');
    assert.ok(data.resposta);
    assert.ok(Array.isArray(data.destaques));
    const vazia = await req('/api/assistente', { method: 'POST', body: { pergunta: '' } });
    assert.equal(vazia.res.status, 400);
  });

  await t.test('CRUD com auditoria e precedência de taxa', async () => {
    const prop = await req('/api/proprietarios', { method: 'POST', body: {
      nome: 'Proprietário Teste', cpf_cnpj: '390.533.447-05', email: 'teste@exemplo.com', telefone: '11999999999', taxa_admin_pct: 6,
    } });
    assert.equal(prop.res.status, 201);
    const imovel = await req('/api/imoveis', { method: 'POST', body: {
      proprietario_id: prop.data.id, endereco: 'Rua Teste', numero: '10', tipo: 'casa', situacao: 'alugado', taxa_admin_pct: 5,
    } });
    assert.equal(imovel.res.status, 201);
    const inq = await req('/api/inquilinos', { method: 'POST', body: { nome: 'Inquilino Teste', email: 'inq@exemplo.com', telefone: '11888888888' } });
    assert.equal(inq.res.status, 201);
    const comp = new Date().toISOString().slice(0, 7);
    const ct = await req('/api/contratos', { method: 'POST', body: {
      codigo: 'CT-TESTE', imovel_id: imovel.data.id, inquilino_id: inq.data.id,
      inicio: `${comp}-01`, aluguel_centavos: 250000, dia_vencimento: 10,
    } });
    assert.equal(ct.res.status, 201);

    const audit = await req('/api/auditoria?limite=50');
    assert.equal(audit.res.status, 200);
    assert.ok(audit.data.some(a => a.entidade === 'contratos' && a.acao === 'criar'));

    const imoveis = await req('/api/imoveis');
    const criado = imoveis.data.find(i => i.id === imovel.data.id);
    assert.equal(criado.proprietario_nome, 'Proprietário Teste');

    // Cadastro com contrato ativo não pode ser desativado.
    const bloqImovel = await req(`/api/imoveis/${imovel.data.id}`, { method: 'DELETE' });
    assert.equal(bloqImovel.res.status, 409);
    assert.match(bloqImovel.data.erro, /contrato/i);
    const bloqProp = await req(`/api/proprietarios/${prop.data.id}`, { method: 'DELETE' });
    assert.equal(bloqProp.res.status, 409);
    const bloqInq = await req(`/api/inquilinos/${inq.data.id}`, { method: 'DELETE' });
    assert.equal(bloqInq.res.status, 409);

    const duplicado = await req('/api/contratos', { method: 'POST', body: {
      codigo: 'CT-TESTE-2', imovel_id: imovel.data.id, inquilino_id: inq.data.id,
      inicio: `${comp}-01`, aluguel_centavos: 100000, dia_vencimento: 10,
    } });
    assert.equal(duplicado.res.status, 400);
    assert.match(duplicado.data.erro, /contrato ativo/i);
  });

  await t.test('rejeita dados inválidos e origem cruzada', async () => {
    const taxa = await req('/api/proprietarios', { method: 'POST', body: { nome: 'Taxa inválida', taxa_admin_pct: 150 } });
    assert.equal(taxa.res.status, 400);

    const ref = await req('/api/contratos', { method: 'POST', body: {
      imovel_id: 999999, inquilino_id: 999999, inicio: '2026-01-01', aluguel_centavos: 1000,
    } });
    assert.equal(ref.res.status, 400);

    const csrf = await fetch(base + '/api/proprietarios', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ nome: 'Origem cruzada' }),
    });
    assert.equal(csrf.status, 403);
  });

  await t.test('cobrança, baixa, repasse e fechamento', async () => {
    const comp = new Date().toISOString().slice(0, 7);
    const previa = await req(`/api/cobrancas/gerar/preview?competencia=${comp}`);
    assert.equal(previa.res.status, 200);
    assert.ok(previa.data.novos >= 4);

    const gerar = await req('/api/cobrancas/gerar', { method: 'POST', body: { competencia: comp } });
    assert.equal(gerar.res.status, 200);
    assert.ok(gerar.data.criadas >= 4);

    const lista = await req(`/api/cobrancas?competencia=${comp}`);
    const alvo = lista.data.find(c => c.status !== 'pago' && c.saldo_centavos > 0);
    assert.ok(alvo);

    // Envelope informa o total e permite paginar sem esconder linhas.
    const env = await req(`/api/cobrancas?competencia=${comp}&envelope=1&limite=1`);
    assert.equal(env.data.itens.length, 1);
    assert.ok(env.data.total >= 4);
    assert.equal(env.data.limite, 1);
    const env2 = await req(`/api/cobrancas?competencia=${comp}&envelope=1&limite=1&offset=1`);
    assert.equal(env2.data.itens.length, 1);
    assert.notEqual(env2.data.itens[0].id, env.data.itens[0].id);
    const baixa = await req(`/api/cobrancas/${alvo.id}/pagar`, { method: 'POST', body: { valor_centavos: alvo.saldo_centavos, data: new Date().toISOString().slice(0, 10), forma: 'pix' } });
    assert.equal(baixa.res.status, 200);
    assert.equal(baixa.data.status, 'pago');

    const calc = await req('/api/repasses/calcular', { method: 'POST', body: { competencia: comp } });
    assert.equal(calc.res.status, 200);
    assert.ok(calc.data.repasses.length >= 1);
    const rep = calc.data.repasses.find(r => r.valor_centavos > 0);
    assert.ok(rep);
    for (const r of calc.data.repasses.filter(x => x.valor_centavos > 0 && x.status !== 'pago')) {
      const pago = await req(`/api/repasses/${r.id}/pagar`, { method: 'POST', body: {} });
      assert.equal(pago.res.status, 200);
    }

    const rel = await req(`/api/reports/resumo-financeiro.pdf?competencia=${comp}`);
    assert.equal(rel.res.status, 200);
    assert.equal(rel.res.headers.get('content-type'), 'application/pdf');

    const verificar = await req('/api/backup/verificar');
    assert.equal(verificar.res.status, 200);
    assert.ok(verificar.data.contagens.usuarios >= 1);
    const backup = await req('/api/backup');
    assert.equal(backup.res.status, 200);
    assert.equal(backup.res.headers.get('content-type'), 'application/zip');

    const fechar = await req('/api/fechamentos', { method: 'POST', body: { competencia: comp } });
    assert.equal(fechar.res.status, 200);
    const novo = await req('/api/lancamentos', { method: 'POST', body: {
      data: `${comp}-15`, competencia: comp, tipo: 'despesa', categoria: 'Outros', valor_centavos: 1000, caixa: 'imobiliaria',
    } });
    assert.equal(novo.res.status, 409);
  });

  await t.test('contas, comissões, Pix, WhatsApp, reajuste e rescisão pela API', async () => {
    const comp = new Date().toISOString().slice(0, 7);
    // Integrações: chave Pix e modo link (sem chamada externa).
    const cfg = await req('/api/settings', { method: 'PUT', body: { itens: {
      pix_chave: 'financeiro@imobiliaria.local', pix_recebedor: 'Imobiliaria Teste', pix_cidade: 'Sao Paulo', whatsapp_modo: 'link',
    } } });
    assert.equal(cfg.res.status, 200);
    const status = await req('/api/integracoes/status');
    assert.equal(status.data.pix.configurado, true);
    assert.equal(status.data.whatsapp.modo, 'link');

    const cobrancas = await req(`/api/cobrancas?competencia=${comp}&status=abertas`);
    const cobranca = cobrancas.data[0];
    assert.ok(cobranca, 'precisa haver cobrança em aberto');
    const pix = await req(`/api/cobrancas/${cobranca.id}/pix`);
    assert.equal(pix.res.status, 200);
    assert.ok(pix.data.payload.startsWith('000201'));
    assert.ok(pix.data.qr.startsWith('data:image/png;base64,'));
    assert.ok(pix.data.txid.startsWith('IMOB' + cobranca.id));

    const zap = await req(`/api/cobrancas/${cobranca.id}/whatsapp`, { method: 'POST', body: {} });
    assert.equal(zap.res.status, 200);
    assert.equal(zap.data.modo, 'link');
    assert.ok(zap.data.link.startsWith('https://wa.me/'));

    const contasCriadas = [];
    const conta = await req('/api/contas', { method: 'POST', body: {
      tipo: 'pagar', descricao: 'Condomínio do mês', categoria: 'Ocupação', valor_centavos: 45000,
      vencimento: `${comp}-20`, recorrencia: 'mensal',
    } });
    assert.equal(conta.res.status, 201);
    contasCriadas.push(conta.data.id);
    const receber = await req('/api/contas', { method: 'POST', body: {
      tipo: 'receber', descricao: 'Taxa de vistoria', categoria: 'Serviços', valor_centavos: 30000, vencimento: `${comp}-25`,
    } });
    assert.equal(receber.res.status, 201);

    const listaContas = await req('/api/contas?status=abertas');
    assert.equal(listaContas.res.status, 200);
    assert.ok(listaContas.data.some(c => c.id === conta.data.id));
    const resumoContas = await req('/api/contas/resumo');
    assert.equal(resumoContas.res.status, 200);
    assert.ok(resumoContas.data.a_pagar >= 45000);

    const baixaConta = await req(`/api/contas/${conta.data.id}/pagar`, { method: 'POST', body: { data: `${comp}-20` } });
    assert.equal(baixaConta.res.status, 200);
    assert.ok(baixaConta.data.proxima_conta_id, 'recorrência cria a próxima parcela');
    const previsao = await req('/api/contas/previsao?meses=3');
    assert.equal(previsao.res.status, 200);
    assert.equal(previsao.data.meses.length, 3);

    const contratosAbertos = await req('/api/contratos');
    const alvo = contratosAbertos.data.find(c => c.status === 'ativo');
    const comissao = await req('/api/comissoes', { method: 'POST', body: {
      contrato_id: alvo.id, corretor: 'Corretor API', pct: 10, competencia: comp,
    } });
    assert.equal(comissao.res.status, 201);
    assert.ok(comissao.data.valor_centavos > 0);
    const pagarComissao = await req(`/api/comissoes/${comissao.data.id}/pagar`, { method: 'POST', body: {} });
    assert.equal(pagarComissao.res.status, 200);
    const lote = await req('/api/comissoes/gerar-lote', { method: 'POST', body: { competencia: comp } });
    assert.equal(lote.res.status, 200);

    const previa = await req(`/api/contratos/reajuste/preview?data=${comp}-01&percentual=8`);
    assert.equal(previa.res.status, 200);
    assert.ok(Array.isArray(previa.data.linhas));
    const reajuste = await req('/api/contratos/reajustar-lote', { method: 'POST', body: {
      contrato_ids: [alvo.id], percentual: 8, indice: 'IPCA', data: `${comp}-01`,
    } });
    assert.equal(reajuste.res.status, 200);
    assert.equal(reajuste.data.aplicados.length, 1);
    assert.ok(reajuste.data.total_novo_centavos > reajuste.data.total_anterior_centavos);

    const dre = await req(`/api/reports/dre-imovel.pdf?de=${comp}&ate=${comp}`);
    assert.equal(dre.res.status, 200);
    assert.equal(dre.res.headers.get('content-type'), 'application/pdf');

    const rescisao = await req(`/api/contratos/${alvo.id}/rescindir`, { method: 'POST', body: {
      data: `${comp}-15`, motivo: 'Devolução do imóvel', multa_centavos: 10000,
    } });
    assert.equal(rescisao.res.status, 200);
    assert.equal(rescisao.data.contrato_id, alvo.id);
    const contratosDepois = await req('/api/contratos');
    assert.equal(contratosDepois.data.find(c => c.id === alvo.id).status, 'encerrado');
  });
});
