import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');

function esperar(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(out || 'timeout')), 15000);
    proc.stdout.on('data', d => { out += d; const m = out.match(/Rodando em http:\/\/[^:]+:(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => { clearTimeout(t); reject(new Error(`saiu ${c}: ${out}`)); });
  });
}

test('todas as telas renderizam com dados reais', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-ui-'));
  let base = '';
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: '0', SEED_COMPLETO: '0', SEED_DEMO: '1', HOST: '127.0.0.1', APP_SECRET: 'teste-ui-36-caracteres-aleatorios-x', ADMIN_SENHA: 'admin123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { proc.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  const port = await esperar(proc);
  base = `http://127.0.0.1:${port}`;

  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@imobiliaria.local', senha: 'admin123' }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.getSetCookie?.()[0] || '').split(';')[0];
  assert.ok(cookie.startsWith('sid='));

  // A senha inicial é temporária; a API exige a troca antes de liberar as telas.
  const troca = await fetch(base + '/api/me/senha', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ senha_atual: 'admin123', senha_nova: 'SenhaForte#2026' }),
  });
  assert.equal(troca.status, 200);

  const nodeFetch = globalThis.fetch;
  const apiFetch = (url, opts = {}) => nodeFetch(base + url, {
    ...opts,
    headers: { ...(opts.headers || {}), cookie },
  });
  global.fetch = apiFetch;

  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="toast-root"></div><div id="modal-root"></div>
    <aside><nav id="nav"></nav></aside>
    <header><p id="page-kicker"></p><h1 id="page-title"></h1><strong id="brand-name"></strong></header>
    <main id="view"></main>
  </body></html>`, { url: base + '/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.FileReader = dom.window.FileReader;

  const core = await import('../public/core.js');
  const views = await import('../public/views.js');
  const fin = await import('../public/views-fin.js');
  core.state.user = { id: 1, nome: 'Administrador', email: 'admin@imobiliaria.local', papel: 'admin', deve_trocar_senha: true, totp_ativo: false };
  core.state.settings = await core.api('/settings');
  core.state.settingsMap = Object.fromEntries(core.state.settings.map(s => [s.chave, s.valor]));

  const rotas = [
    ['painel', views.viewPainel, 'Dados do mês'],
    ['alertas', views.viewAlertas, 'Vencimentos, reajustes'],
    ['proprietarios', views.viewProprietarios, 'Cadastro, conta bancária'],
    ['imoveis', views.viewImoveis, 'Carteira, situação'],
    ['inquilinos', views.viewInquilinos, 'Contatos para cobrança'],
    ['contratos', views.viewContratos, 'Vigência, aluguel'],
    ['excecoes', views.viewExcecoes, 'Descontos e acréscimos'],
    ['cobrancas', fin.viewCobrancas, 'Geração mensal'],
    ['conciliacao', fin.viewConciliacao, 'Importe OFX'],
    ['lancamentos', fin.viewLancamentos, 'Dois caixas'],
    ['contas', fin.viewContas, 'Compromissos, recorrências'],
    ['comissoes', fin.viewComissoes, 'Corretagem prevista'],
    ['repasses', fin.viewRepasses, 'Aluguéis recebidos'],
    ['fechamentos', fin.viewFechamentos, 'bloqueia lançamentos'],
    ['documentos', fin.viewDocumentos, 'Arquivos vinculados'],
    ['importacao', fin.viewImportacao, 'prévia linha a linha'],
    ['relatorios', fin.viewRelatorios, 'Resumo financeiro'],
    ['usuarios', fin.viewUsuarios, 'Perfis admin'],
    ['auditoria', fin.viewAuditoria, 'Trilha encadeada'],
    ['analises', fin.viewAnalises, 'Análises futuras'],
    ['configuracoes', fin.viewConfiguracoes, 'Regras editáveis'],
    ['lgpd', fin.viewLGPD, 'Exportação do titular'],
    ['manutencao', fin.viewManutencao, 'Base de demonstração'],
  ];

  // formModal precisa montar e fechar sem erro de inicialização.
  core.formModal({
    titulo: 'Teste',
    fields: [{ name: 'nome', label: 'Nome' }],
    onSubmit: async () => {},
  });
  assert.ok(document.querySelector('.modal'), 'formModal deve abrir');
  document.querySelector('[data-cancelar]').click();
  assert.equal(document.querySelector('.modal'), null, 'Cancelar deve fechar o modal');

  for (const [nome, view, esperado] of rotas) {
    const raiz = document.createElement('div');
    document.body.appendChild(raiz);
    await view(raiz, new URLSearchParams());
    const texto = raiz.textContent || '';
    assert.ok(texto.length > 100, `${nome}: renderização vazia`);
    assert.ok(!texto.includes('Não foi possível carregar'), `${nome}: caiu no estado de erro`);
    assert.ok(!/Cannot read|is not a function|undefined is not/.test(texto), `${nome}: erro de JavaScript visível na tela`);
    assert.ok(texto.includes(esperado), `${nome}: conteúdo esperado não encontrado (${esperado})`);
    raiz.remove();
  }
});
