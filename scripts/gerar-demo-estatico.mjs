/**
 * Gera public/demo-data.json para a demonstração estática no GitHub Pages.
 *
 * Sobe uma instância isolada de demonstração, autentica com as credenciais
 * fictícias e captura as respostas reais das telas. O resultado é somente
 * leitura: a demo publicada não escreve em banco nenhum.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SAIDA = path.join(ROOT, 'public', 'demo-data.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-demo-estatico-'));

const compAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const addComp = (comp, delta) => {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function sanitizar(valor, chave = '') {
  if (Array.isArray(valor)) return valor.map(v => sanitizar(v));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      if (['senha_hash', 'totp_secret', 'totp_recovery', 'token', 'token_hash', 'caminho', 'arquivo_base64'].includes(k)) continue;
      out[k] = sanitizar(v, k);
    }
    return out;
  }
  if (typeof valor === 'string' && /(senha|token|secret)/i.test(chave) && valor.length > 80) return '';
  return valor;
}

function iniciarServidor() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['src/demo-server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        DEMO_DATA_DIR: dir,
        DATA_DIR: dir,
        DEMO_MODE: '1',
        DEMO_RESET_HORAS: '0',
        NODE_ENV: 'test',
        SEED_COMPLETO: '0',
        ADMIN_SENHA: 'Demo#2026',
        DEMO_SENHA: 'Demo#2026',
        APP_SECRET: 'demo-estatica-segredo-local-de-teste-2026',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error(`Servidor de demonstração não subiu:\n${saida}`));
    }, 90000);
    proc.stdout.on('data', (d) => {
      saida += d;
      const m = saida.match(/Rodando em http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ proc, porta: Number(m[1]) }); }
    });
    proc.stderr.on('data', (d) => { saida += d; });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Servidor encerrou (${code}):\n${saida}`));
    });
  });
}

const { proc, porta } = await iniciarServidor();
const base = `http://127.0.0.1:${porta}`;
let cookie = '';

async function requisitar(caminho, { method = 'GET', body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + caminho, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  return { res, data };
}

const respostas = {};
const falhas = [];

async function capturar(caminho, opts = {}) {
  const { res, data } = await requisitar(caminho, opts);
  if (res.ok && data && typeof data === 'object') {
    respostas[caminho] = data;
    return data;
  }
  if (res.status !== 404) falhas.push(`${caminho} → ${res.status}`);
  return null;
}

try {
  // Público e login
  const config = await capturar('/api/config');
  const health = await capturar('/api/health');
  await capturar('/api/primeiro-acesso');
  await capturar('/api/cadastro/status');

  const login = await requisitar('/api/login', {
    method: 'POST',
    body: { email: 'admin@imobiliaria.local', senha: 'Demo#2026' },
  });
  if (!login.res.ok) throw new Error(`Login demo falhou: ${login.res.status} ${JSON.stringify(login.data)}`);
  const setCookie = login.res.headers.getSetCookie?.() || [login.res.headers.get('set-cookie')];
  cookie = setCookie.filter(Boolean).map(s => s.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Login demo não devolveu cookie de sessão.');

  const me = await capturar('/api/me');

  // Endpoints fixos
  const fixos = [
    '/api/settings', '/api/dashboard', '/api/alertas', '/api/saldos',
    '/api/integracoes/status', '/api/comunicacao/status', '/api/relatorios',
    '/api/import/modelos', '/api/2fa/status', '/api/manutencao/status',
    '/api/reset/solicitacoes', '/api/usuarios', '/api/auditoria?limite=500',
    '/api/auditoria?envelope=1&limite=500', '/api/auditoria/integridade', '/api/diagnostico',
    '/api/cadastros/opcoes',
    '/api/fechamentos', '/api/conciliacao/resumo', '/api/documentos',
    '/api/contas', '/api/contas/resumo', '/api/contas/previsao?meses=6',
    '/api/comissoes', '/api/comissoes/resumo',
    '/api/proprietarios', '/api/imoveis', '/api/inquilinos',
    '/api/contratos', '/api/excecoes',
    '/api/parceiros', '/api/parceiros?tipo=corretor',
    '/api/categorias?inativas=1', '/api/categorias?inativas=0', '/api/categorias?contexto=lancamento&inativas=0',
    '/api/categorias?contexto=conta_pagar', '/api/categorias?contexto=conta_receber',
  ];
  for (const caminho of fixos) await capturar(caminho);

  // Detalhes de auditoria que o modal abre na demo.
  const auditoriaDemo = respostas['/api/auditoria?envelope=1&limite=500']?.itens
    || respostas['/api/auditoria?limite=500'] || [];
  for (const a of auditoriaDemo.slice(0, 20)) await capturar(`/api/auditoria/${a.id}`);

  for (const status of ['pendente', 'conciliado', 'ignorado']) {
    await capturar(`/api/conciliacao?status=${status}`);
  }

  // 12 meses de cobranças, lançamentos e repasses
  const comp = compAtual();
  const meses = Array.from({ length: 12 }, (_, i) => addComp(comp, -11 + i));
  const statusCobranca = ['', 'abertas', 'vencidas', 'pagas', 'em_cobranca', 'promessa', 'acordo', 'juridico'];
  for (const mes of meses) {
    await capturar(`/api/cobrancas/resumo?competencia=${mes}`);
    for (const status of statusCobranca) {
      await capturar(`/api/cobrancas?competencia=${mes}&status=${status}&envelope=1`);
    }
    await capturar(`/api/repasses?competencia=${mes}`);
    await capturar(`/api/lancamentos?competencia=${mes}&envelope=1`);
    for (const caixa of ['imobiliaria', 'proprietarios']) {
      await capturar(`/api/lancamentos?competencia=${mes}&caixa=${caixa}&envelope=1`);
    }
    for (const tipo of ['receita', 'despesa']) {
      await capturar(`/api/lancamentos?competencia=${mes}&tipo=${tipo}&envelope=1`);
    }
  }

  // Analytics para os cinco recortes do painel
  const [ano] = comp.split('-').map(Number);
  const recortes = [
    [comp, comp],
    [addComp(comp, -5), comp],
    [addComp(comp, -11), comp],
    [`${ano}-01`, comp],
    [`${ano - 1}-01`, `${ano - 1}-12`],
  ];
  for (const [de, ate] of recortes) {
    await capturar(`/api/analytics?de=${de}&ate=${ate}&comparar=1`);
    await capturar(`/api/analytics?de=${de}&ate=${ate}&comparar=0`);
  }
  await capturar(`/api/analytics?de=${comp}&ate=${comp}&comparar=1`);

  // Comissões por status/competência
  for (const status of ['', 'prevista', 'liberada', 'paga', 'cancelada']) {
    await capturar(`/api/comissoes?status=${status}`);
    await capturar(`/api/comissoes?status=${status}&competencia=${comp}`);
  }

  // Detalhes que os modais abrem
  const listaCobrancas = respostas[`/api/cobrancas?competencia=${comp}&status=&envelope=1`]?.itens || [];
  for (const c of listaCobrancas.slice(0, 12)) {
    await capturar(`/api/cobrancas/${c.id}`);
    await capturar(`/api/cobrancas/${c.id}/pix`);
  }
  const listaRepasses = respostas[`/api/repasses?competencia=${comp}`] || [];
  for (const r of listaRepasses) await capturar(`/api/repasses/${r.id}`);

  // Prévia de geração de cobranças (não altera nada)
  await capturar(`/api/cobrancas/gerar/preview?competencia=${comp}`);

  // Assistente: contexto + uma resposta por intenção
  const contexto = await capturar('/api/assistente');
  const perguntas = [
    'resumo do mês', 'como está o mês?', 'quem está inadimplente?',
    'quanto tenho a receber e a pagar?', 'como está a previsão de caixa?',
    'quanto ficou de repasse pendente?', 'qual é o saldo da imobiliária?',
    'quais contratos vencem em 90 dias?', 'quais contratos precisam de reajuste?',
    'qual imóvel rende mais?', 'como está a ocupação dos imóveis?',
    'quanto recebi neste mês?', 'como funciona o pix?',
    'como faço uma baixa parcial?', 'quem é Maria Souza?',
  ];
  const intencoes = {};
  for (const pergunta of perguntas) {
    const { res, data } = await requisitar('/api/assistente', { method: 'POST', body: { pergunta } });
    if (res.ok && data?.intencao && !intencoes[data.intencao]) intencoes[data.intencao] = data;
  }

  const saida = sanitizar({
    gerado_em: new Date().toISOString(),
    gerado_por: 'scripts/gerar-demo-estatico.mjs',
    versao: config?.versao || '',
    config,
    health,
    login: login.data,
    me,
    respostas,
    assistente: { contexto, intencoes },
  });

  fs.writeFileSync(SAIDA, JSON.stringify(saida));
  const tamanho = fs.statSync(SAIDA).size;
  console.log(`\n  Demo estática gerada: ${path.relative(ROOT, SAIDA)}`);
  console.log(`  ${Object.keys(respostas).length} respostas capturadas · ${(tamanho / 1024).toFixed(0)} KB`);
  if (falhas.length) console.log(`  Avisos (${falhas.length}): ${falhas.slice(0, 8).join(' · ')}`);
} finally {
  try { proc.kill('SIGKILL'); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
