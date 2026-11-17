/* Aplicação: autenticação, navegação e composição das telas. */
import {
  $, $$, esc, api, state, icon, toast, openModal, fieldsHtml, collectForm, setting,
} from './core.js';
import {
  viewPainel, viewAlertas, viewProprietarios, viewImoveis, viewInquilinos, viewContratos, viewExcecoes,
  viewParceiros, viewCategorias,
} from './views.js';
import {
  viewCobrancas, viewConciliacao, viewLancamentos, viewRepasses, viewFechamentos, viewDocumentos,
  viewImportacao, viewRelatorios, viewUsuarios, viewAuditoria, viewConfiguracoes, viewLGPD, viewManutencao,
  viewContas, viewComissoes, viewAnalises,
} from './views-fin.js';
import { bindAssistente } from './ia.js';

const VIEWS = {
  painel: viewPainel,
  alertas: viewAlertas,
  proprietarios: viewProprietarios,
  imoveis: viewImoveis,
  inquilinos: viewInquilinos,
  contratos: viewContratos,
  excecoes: viewExcecoes,
  parceiros: viewParceiros,
  categorias: viewCategorias,
  cobrancas: viewCobrancas,
  conciliacao: viewConciliacao,
  lancamentos: viewLancamentos,
  contas: viewContas,
  comissoes: viewComissoes,
  analises: viewAnalises,
  repasses: viewRepasses,
  fechamentos: viewFechamentos,
  documentos: viewDocumentos,
  importacao: viewImportacao,
  relatorios: viewRelatorios,
  configuracoes: viewConfiguracoes,
  usuarios: viewUsuarios,
  auditoria: viewAuditoria,
  lgpd: viewLGPD,
  manutencao: viewManutencao,
};

const META = {
  painel: ['Visão geral', 'Painel'],
  alertas: ['Carteira', 'Alertas'],
  proprietarios: ['Cadastros', 'Proprietários'],
  imoveis: ['Cadastros', 'Imóveis'],
  inquilinos: ['Cadastros', 'Inquilinos'],
  contratos: ['Carteira', 'Contratos'],
  excecoes: ['Financeiro', 'Exceções de repasse'],
  parceiros: ['Cadastros', 'Fornecedores e parceiros'],
  categorias: ['Cadastros', 'Categorias financeiras'],
  cobrancas: ['Financeiro', 'Cobranças'],
  conciliacao: ['Financeiro', 'Conciliação'],
  lancamentos: ['Financeiro', 'Lançamentos'],
  contas: ['Financeiro', 'Contas a pagar/receber'],
  comissoes: ['Financeiro', 'Comissões'],
  analises: ['Visão geral', 'Análises futuras'],
  repasses: ['Financeiro', 'Repasses'],
  fechamentos: ['Financeiro', 'Fechamento'],
  documentos: ['Operação', 'Documentos'],
  importacao: ['Operação', 'Importar planilhas'],
  relatorios: ['Operação', 'Relatórios'],
  configuracoes: ['Conta', 'Configurações'],
  usuarios: ['Administração', 'Usuários'],
  auditoria: ['Administração', 'Auditoria'],
  lgpd: ['Administração', 'Privacidade (LGPD)'],
  manutencao: ['Administração', 'Manutenção'],
};

const NAVEAS = [
  { grupo: 'Visão geral', itens: [['painel', 'Painel', 'painel'], ['analises', 'Análises futuras', 'chart'], ['alertas', 'Alertas', 'bell']] },
  { grupo: 'Carteira', itens: [['proprietarios', 'Proprietários', 'owners'], ['imoveis', 'Imóveis', 'home'], ['inquilinos', 'Inquilinos', 'tenant'], ['contratos', 'Contratos', 'contract'], ['excecoes', 'Exceções', 'receipt']] },
  { grupo: 'Cadastros', itens: [['parceiros', 'Fornecedores e parceiros', 'owners'], ['categorias', 'Categorias financeiras', 'receipt']] },
  { grupo: 'Financeiro', itens: [['cobrancas', 'Cobranças', 'receipt'], ['conciliacao', 'Conciliação', 'bank'], ['lancamentos', 'Lançamentos', 'wallet'], ['contas', 'Contas', 'receipt'], ['comissoes', 'Comissões', 'owners'], ['repasses', 'Repasses', 'send'], ['fechamentos', 'Fechamento', 'check']] },
  { grupo: 'Operação', itens: [['documentos', 'Documentos', 'folder'], ['importacao', 'Importar', 'upload'], ['relatorios', 'Relatórios', 'chart']] },
  { grupo: 'Conta', itens: [['configuracoes', 'Configurações', 'settings']] },
  { grupo: 'Administração', admin: true, itens: [['usuarios', 'Usuários', 'shield'], ['auditoria', 'Auditoria', 'eye'], ['lgpd', 'Privacidade (LGPD)', 'shield'], ['manutencao', 'Manutenção', 'wrench']] },
];

state.viewSeq = 0;
state.desafio2fa = null;
state.config = { demo: false, versao: '' };

function aplicarConfig() {
  const demo = !!state.config.demo;
  document.body.classList.toggle('modo-demo', demo);
  const chip = $('#demo-chip');
  if (chip) chip.hidden = !demo;
  const box = $('#demo-box');
  if (box) box.hidden = !demo;
  if (demo) {
    const ações = $('#topbar-actions');
    if (ações && !ações.querySelector('.demo-chip')) {
      ações.insertAdjacentHTML('afterbegin', '<span class="demo-chip" title="Ambiente de demonstração">Demo</span>');
    }
  }
}

async function carregarConfig() {
  try {
    state.config = await api('/config');
  } catch {
    state.config = { demo: false, versao: '' };
  }
  aplicarConfig();
}

const podeAdmin = () => state.user?.papel === 'admin';

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = NAVEAS
    .filter(g => !g.admin || podeAdmin())
    .map(g => `<div class="nav-group"><div class="nav-label">${esc(g.grupo)}</div>
      ${g.itens.map(([rota, nome, ico]) => `<a href="#/${rota}" data-rota="${rota}">${icon(ico)}<span>${esc(nome)}</span></a>`).join('')}
    </div>`).join('');
  const chip = $('#user-chip');
  const iniciais = String(state.user?.nome || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  chip.innerHTML = `<span class="avatar">${esc(iniciais)}</span><span class="u-meta"><strong>${esc(state.user.nome)}</strong><small>${esc(state.user.papel)}</small></span>`;
}

function marcarNav(rota) {
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.rota === rota));
}

function atualizarTopbar(rota) {
  const [kicker, titulo] = META[rota] || META.painel;
  $('#page-kicker').textContent = kicker;
  $('#page-title').textContent = titulo;
  const brand = setting('imob_nome', 'Imobiliária');
  $('#brand-name').textContent = brand;
  document.title = `${titulo} · ${brand}`;
}

async function carregarSettings() {
  try {
    state.settings = await api('/settings');
    state.settingsMap = Object.fromEntries(state.settings.map(s => [s.chave, s.valor]));
  } catch { /* usa padrões */ }
}

/* ---------------- autenticação ---------------- */
function mostrarPane(nome) {
  ['login', '2fa', 'forgot', 'reset', 'register'].forEach(p => {
    const el = document.getElementById('pane-' + p);
    if (el) el.hidden = p !== nome;
  });
}

function showAuth() {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  document.body.classList.remove('menu-open');
  const ia = $('#ia-root');
  if (ia) ia.hidden = true;
  document.body.classList.remove('ia-open');
  mostrarPane('login');
  carregarDicasLogin();
}

async function carregarDicasLogin() {
  try {
    const r = await api('/primeiro-acesso');
    const el = $('#primeiro-acesso');
    if (r.mostrar && !state.config?.demo) {
      el.hidden = false;
      el.textContent = `Primeiro acesso: entre com ${r.email} e a senha inicial definida na instalação. O sistema exigirá a troca.`;
    } else {
      el.hidden = true;
    }
  } catch { /* silencioso */ }
  try {
    const permitido = state.config?.cadastro !== false;
    const link = document.querySelector('[data-auth="register"]');
    if (link) link.hidden = !permitido;
  } catch { /* silencioso */ }
  if (state.config?.demo) {
    const box = $('#demo-box');
    if (box) box.hidden = false;
  }
}

async function entrar(usuario) {
  state.user = usuario;
  await carregarSettings();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  renderNav();
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/painel';
  await navegar();
  if (usuario.deve_trocar_senha) setTimeout(forcarTrocaSenha, 350);
}

function forcarTrocaSenha() {
  const fields = [
    { name: 'senha_atual', label: 'Senha atual', type: 'password', required: true },
    { name: 'senha_nova', label: 'Nova senha', type: 'password', required: true, hint: 'Mínimo 8 caracteres; não use senhas comuns nem seu e-mail.' },
    { name: 'senha2', label: 'Repetir nova senha', type: 'password', required: true },
  ];
  const { root } = openModal({
    titulo: 'Crie sua senha', subtitulo: 'Antes de abrir o painel, defina uma senha própria.',
    corpo: `<div class="notice">A senha inicial não pode ser mantida. A troca vale para este usuário e encerra as outras sessões.</div>
      <form data-form class="mt-2">${fieldsHtml(fields)}<div class="form-error mt-2" data-erro hidden></div></form>`,
    rodape: '<button class="btn primary" data-ok>Salvar nova senha</button>',
    fecharFora: false, fecharTecla: false,
    onMount(r, close) {
      r.querySelector('[data-close]')?.remove();
      const btn = r.querySelector('[data-ok]');
      const err = r.querySelector('[data-erro]');
      btn.onclick = async () => {
        err.hidden = true;
        try {
          const d = collectForm(r.querySelector('[data-form]'), fields);
          if (d.senha_nova !== d.senha2) throw new Error('As senhas novas não coincidem.');
          await api('/me/senha', { method: 'POST', body: { senha_atual: d.senha_atual, senha_nova: d.senha_nova } });
          state.user.deve_trocar_senha = false;
          close();
          toast('Senha alterada. Bem-vindo(a)!');
        } catch (e) { err.hidden = false; err.textContent = e.message; }
      };
    },
  });
}

async function boot() {
  const anoEl = document.querySelector('.auth-copyright');
  if (anoEl) anoEl.textContent = `Gestão Imobiliária · ${new Date().getFullYear()}`;
  await carregarConfig();

  const hash = location.hash || '';
  if (hash.includes('redefinir')) {
    showAuth();
    const params = new URLSearchParams(hash.split('?')[1] || '');
    await abrirReset(params.get('token'));
    $('#boot').hidden = true;
    return;
  }

  try {
    const me = await api('/me');
    if (me?.usuario) {
      await entrar(me.usuario);
      $('#boot').hidden = true;
      return;
    }
  } catch { /* não autenticado */ }
  showAuth();
  $('#boot').hidden = true;
}

async function abrirReset(token) {
  if (!token) { mostrarPane('forgot'); return; }
  try {
    const r = await api(`/reset/validar?token=${encodeURIComponent(token)}`);
    if (!r.valido) { toast('Link inválido ou expirado. Solicite outro.', 'err'); mostrarPane('forgot'); return; }
    mostrarPane('reset');
    $('#reset-ident').textContent = `Conta: ${r.nome} · ${r.email}`;
    $('#form-reset').dataset.token = token;
  } catch (e) { toast(e.message, 'err'); mostrarPane('forgot'); }
}

function bindAuth() {
  document.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => {
    const alvo = b.dataset.auth;
    if (alvo === 'login') { mostrarPane('login'); history.replaceState(null, '', location.pathname); }
    else mostrarPane(alvo);
  });

  document.querySelector('[data-toggle-senha]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const input = $('#form-login [name=senha]');
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(mostrar));
    btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    input.focus();
  });

  document.querySelector('[data-demo-login]')?.addEventListener('click', () => {
    const form = $('#form-login');
    form.email.value = state.config.demo_email || 'admin@imobiliaria.local';
    form.senha.value = state.config.demo_senha || 'Demo#2026';
    form.senha.focus();
  });

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('#login-error');
    err.hidden = true;
    const btn = form.querySelector('button[type=submit]');
    const rotulo = btn.querySelector('span');
    const textoOriginal = rotulo?.textContent || 'Entrar';
    btn.disabled = true;
    btn.classList.add('carregando');
    if (rotulo) rotulo.textContent = 'Entrando…';
    try {
      const r = await api('/login', { method: 'POST', body: { email: form.email.value, senha: form.senha.value } });
      if (r.requer_2fa) {
        state.desafio2fa = r.desafio;
        mostrarPane('2fa');
        $('#form-2fa').querySelector('[name=codigo]').focus();
        return;
      }
      await entrar(r.usuario);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
      form.senha.focus();
      form.senha.select();
    } finally {
      btn.disabled = false;
      btn.classList.remove('carregando');
      if (rotulo) rotulo.textContent = textoOriginal;
    }
  });

  $('#form-2fa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#tfa-error');
    err.hidden = true;
    try {
      const r = await api('/login/2fa', { method: 'POST', body: { desafio: state.desafio2fa, codigo: e.target.codigo.value } });
      state.desafio2fa = null;
      await entrar(r.usuario);
    } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  });

  $('#form-forgot').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#forgot-msg');
    msg.hidden = true;
    try {
      const r = await api('/esqueci-senha', { method: 'POST', body: { email: e.target.email.value } });
      msg.hidden = false;
      msg.className = 'form-note ok';
      msg.textContent = r.mensagem || 'Se o e-mail estiver cadastrado, enviaremos as instruções.';
    } catch (ex) {
      msg.hidden = false;
      msg.className = 'form-error';
      msg.textContent = ex.message;
    }
  });

  $('#form-reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#reset-msg');
    msg.hidden = true;
    if (form.senha.value !== form.senha2.value) {
      msg.hidden = false; msg.textContent = 'As senhas não coincidem.'; return;
    }
    try {
      await api('/resetar-senha', { method: 'POST', body: { token: form.dataset.token, senha: form.senha.value } });
      toast('Senha redefinida. Entre com a nova senha.');
      history.replaceState(null, '', location.pathname);
      mostrarPane('login');
      $('#form-login').email.value = '';
    } catch (ex) { msg.hidden = false; msg.textContent = ex.message; }
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#register-msg');
    msg.hidden = true;
    try {
      const r = await api('/cadastro', { method: 'POST', body: {
        nome: e.target.nome.value, email: e.target.email.value, senha: e.target.senha.value,
      } });
      msg.hidden = false;
      msg.className = 'form-note ok';
      msg.textContent = r.mensagem;
      e.target.reset();
    } catch (ex) {
      msg.hidden = false;
      msg.className = 'form-error';
      msg.textContent = ex.message;
    }
  });
}

/* ---------------- navegação ---------------- */
async function navegar() {
  if (!state.user) return;
  const raw = location.hash.replace(/^#\/?/, '') || 'painel';
  const [rota, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  if (!VIEWS[rota]) { location.hash = '#/painel'; return; }
  if (['usuarios', 'auditoria', 'lgpd', 'manutencao'].includes(rota) && !podeAdmin()) {
    toast('Apenas administradores acessam esta área.', 'err');
    location.hash = '#/painel';
    return;
  }
  state.viewSeq++;
  const seq = state.viewSeq;
  marcarNav(rota);
  atualizarTopbar(rota);
  const view = $('#view');
  view.innerHTML = '';
  document.body.classList.remove('menu-open');
  try {
    await VIEWS[rota](view, params);
  } catch (e) {
    if (seq !== state.viewSeq) return;
    console.error(e);
    view.innerHTML = `<div class="notice danger">${esc(e.message || 'Não foi possível abrir esta tela.')}</div>`;
  }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function bindShell() {
  $('#user-chip').onclick = () => { location.hash = '#/configuracoes'; };
  document.querySelector('[data-action="logout"]').onclick = async () => {
    try { await api('/logout', { method: 'POST', body: {} }); } catch { /* segue */ }
    state.user = null;
    $('#app').hidden = true;
    showAuth();
  };
  document.querySelector('[data-action="open-menu"]').onclick = () => document.body.classList.add('menu-open');
  document.querySelectorAll('[data-action="close-menu"]').forEach(el => el.onclick = () => document.body.classList.remove('menu-open'));
  window.addEventListener('hashchange', () => {
    if (state.user) navegar();
    else if (location.hash.includes('redefinir')) {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      abrirReset(params.get('token'));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.classList.remove('menu-open');
  });
  // fechar menu ao clicar em um item no mobile
  $('#nav').addEventListener('click', () => document.body.classList.remove('menu-open'));
}

window.__mostrarLogin = showAuth;

bindAuth();
bindShell();
bindAssistente();
boot();
