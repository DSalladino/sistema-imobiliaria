/*
 * Modo demonstração estática (GitHub Pages).
 *
 * O sistema real é um servidor Node + SQLite. Para publicar uma demonstração
 * navegável em hospedagem estática, este arquivo intercepta as chamadas /api e
 * responde com um retrato real da base de demonstração, gerado por
 * scripts/gerar-demo-estatico.mjs. Nenhuma escrita altera dados: a demo é
 * somente leitura e informa isso claramente.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const pages = /\.github\.io$/i.test(location.hostname);
  const ativo = pages || (local && params.has('demo'));
  if (!ativo) return;

  window.__DEMO_ESTATICO__ = true;

  const fetchNativo = window.fetch.bind(window);
  const CHAVE_AUTH = 'imob-demo-estatico-auth';

  const dadosPromise = fetchNativo('demo-data.json', { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('demo-data.json não encontrado');
    return r.json();
  });

  const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

  const autenticado = () => {
    try { return sessionStorage.getItem(CHAVE_AUTH) === '1'; } catch { return false; }
  };
  const marcarAuth = (valor) => {
    try {
      if (valor) sessionStorage.setItem(CHAVE_AUTH, '1');
      else sessionStorage.removeItem(CHAVE_AUTH);
    } catch { /* modo privado */ }
  };

  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function aviso(msg) {
    let el = document.getElementById('demo-aviso');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-aviso';
      el.className = 'demo-aviso';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(aviso._t);
    aviso._t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function banner() {
    if (document.getElementById('demo-static-banner')) return;
    const el = document.createElement('div');
    el.id = 'demo-static-banner';
    el.className = 'demo-static-banner';
    el.innerHTML = '<strong>Demo estática</strong><span>Navegação e consultas liberadas. Cadastros e baixas estão desabilitados; rode o projeto localmente para testar escritas.</span><button type="button" aria-label="Fechar aviso">×</button>';
    el.querySelector('button').onclick = () => el.remove();
    document.body.appendChild(el);
  }

  function melhorResposta(dados, path, search) {
    const exata = dados.respostas[path + search];
    if (exata !== undefined) return exata;

    const alvo = new URLSearchParams(search);
    const querEnvelope = alvo.get('envelope') === '1';
    const candidatos = [];
    for (const [chave, valor] of Object.entries(dados.respostas)) {
      const [chavePath, chaveSearch = ''] = chave.split('?');
      if (chavePath !== path) continue;
      candidatos.push({ params: new URLSearchParams(chaveSearch), valor });
    }

    // Listas completas: a demo antiga pode só ter recortes (por contexto ou
    // inativas=1). Para os cadastros usados em seletores, devolvemos a união,
    // evitando que o formulário abra sem categorias/fornecedores.
    if (path === '/api/categorias' || path === '/api/parceiros') {
      const ids = new Set();
      const uniao = [];
      for (const c of candidatos) {
        if (!Array.isArray(c.valor)) continue;
        for (const item of c.valor) {
          const id = item && typeof item === 'object' ? item.id : null;
          if (id != null) { if (ids.has(id)) continue; ids.add(id); }
          uniao.push(item);
        }
      }
      if (uniao.length) {
        const somenteAtivos = path === '/api/categorias' && alvo.get('inativas') === '0';
        return somenteAtivos ? uniao.filter(x => !x || x.ativo !== 0) : uniao;
      }
    }

    // Auditoria: se a interface pediu envelope mas o retrato salvo é uma lista
    // simples, adaptamos para { itens, total } em vez de devolver o tipo errado.
    if (path === '/api/auditoria' && querEnvelope) {
      const lista = candidatos.find(c => Array.isArray(c.valor))?.valor;
      if (Array.isArray(lista)) return { itens: lista, total: lista.length, limite: lista.length, offset: 0 };
      const envelope = candidatos.find(c => c.valor && Array.isArray(c.valor.itens))?.valor;
      if (envelope) return envelope;
    }

    let melhor = null;
    let melhorNota = -Infinity;
    for (const { params: candidato, valor } of candidatos) {
      let nota = 0;
      for (const [k, v] of alvo) {
        if (!v) continue;
        if (candidato.get(k) === v) nota += 3;
        else if (k === 'competencia' || k === 'status') nota -= 2;
      }
      for (const [k, v] of candidato) {
        if (alvo.get(k) === v) nota += 1;
      }
      if (nota > melhorNota) { melhorNota = nota; melhor = valor; }
    }
    return melhor;
  }

  function respostaAssistente(dados, pergunta) {
    const t = normalizar(pergunta);
    const mapa = [
      [/inadimpl|atras|vencid|quem deve|nao pagou/, 'inadimplencia'],
      [/repasse/, 'repasses'],
      [/saldo|caixa|quanto tenho|disponivel/, 'caixa'],
      [/conta.*(pagar|receber)|previsao|fluxo/, 'contas'],
      [/reajuste|dissidio|igp|ipca/, 'reajustes'],
      [/contrato.*(venc|termin|garantia)/, 'contratos'],
      [/ocupacao|vago|alugado|imoveis/, 'ocupacao'],
      [/rend|rentab|dre|melhor imovel|margem/, 'rentabilidade'],
      [/comissao|corretor/, 'comissoes'],
      [/cobranca|recebi|receita|aluguel|faturamento/, 'cobrancas'],
      [/pix|whatsapp|baixa|concili|relatorio|backup|lgpd|ajuda|como/, 'ajuda'],
    ];
    const achado = mapa.find(([regex]) => regex.test(t));
    if (achado && dados.assistente?.intencoes?.[achado[1]]) return dados.assistente.intencoes[achado[1]];
    if (dados.assistente?.intencoes?.resumo) return dados.assistente.intencoes.resumo;
    return {
      intencao: 'indisponivel',
      resposta: 'Esta é a demonstração estática. Consulte o painel e as telas do menu; para perguntas livres com dados atualizados, rode o projeto localmente.',
      destaques: [],
      itens: [],
      acoes: [{ rotulo: 'Abrir painel', rota: '#/painel' }],
      sugestoes: ['Resumo do mês', 'Quem está inadimplente?', 'Quanto tenho a receber e a pagar?'],
    };
  }

  window.fetch = async (entrada, init = {}) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href);
    if (!url.pathname.startsWith('/api')) return fetchNativo(entrada, init);

    let dados;
    try {
      dados = await dadosPromise;
    } catch (e) {
      return json({ erro: 'Dados da demonstração não carregaram. Recarregue a página.' }, 503);
    }

    const metodo = String(init.method || entrada?.method || 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/api/health') return json(dados.health || { ok: true, banco: 'demo', uploads: 'demo' });
    if (path === '/api/config') {
      return json({ ...(dados.config || {}), demo: true, demo_email: 'admin@imobiliaria.local', demo_senha: 'Demo#2026' });
    }
    if (path === '/api/me') {
      return autenticado() && dados.me ? json(dados.me) : json({ erro: 'Não autenticado.' }, 401);
    }
    if (path === '/api/login' && metodo === 'POST') {
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch {}
      const email = String(body.email || '').toLowerCase().trim();
      const senha = String(body.senha || '');
      if (email === 'admin@imobiliaria.local' && senha === 'Demo#2026' && dados.login) {
        marcarAuth(true);
        return json(dados.login);
      }
      return json({ erro: 'Na demonstração, use admin@imobiliaria.local e Demo#2026 (ou clique em “Preencher acesso demo”).' }, 401);
    }
    if (path === '/api/login/2fa') return json({ erro: '2FA não é usado nesta demonstração.' }, 400);
    if (path === '/api/logout') { marcarAuth(false); return json({ ok: true }); }
    if (path === '/api/assistente' && metodo === 'POST') {
      if (!autenticado()) return json({ erro: 'Não autenticado.' }, 401);
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch {}
      return json(respostaAssistente(dados, body.pergunta));
    }
    if (path === '/api/assistente') {
      if (!autenticado()) return json({ erro: 'Não autenticado.' }, 401);
      return json(dados.assistente?.contexto || { competencia: '', vencidas: 0, alertas_urgentes: 0, sugestoes: [] });
    }

    if (!autenticado()) return json({ erro: 'Não autenticado.' }, 401);

    if (metodo !== 'GET') {
      return json({
        erro: 'Demonstração estática: alterações estão desabilitadas. Rode o projeto localmente para cadastrar, baixar e conciliar.',
      }, 409);
    }

    const achado = melhorResposta(dados, path, url.search);
    if (achado !== undefined && achado !== null) return json(achado);
    return json({ erro: 'Esta consulta não foi capturada na demonstração estática.' }, 404);
  };

  // Links diretos de exportação/documento não passam por fetch. Avisamos em vez
  // de abrir uma página 404 no GitHub Pages.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    aviso('Exportações e downloads estão desabilitados na demonstração estática.');
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', banner);
  } else {
    banner();
  }
})();
