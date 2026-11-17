/* Assistente interno: conversa com o endpoint /api/assistente.
 * As respostas são sempre texto + dados estruturados vindos do servidor.
 * Todo conteúdo dinâmico passa por esc() antes de entrar no DOM. */
import { $, $$, esc, api, state } from './core.js';

let contexto = null;
let ocupado = false;
let inicializado = false;

const painel = () => $('#ia-root');
const mensagens = () => $('#ia-mensagens');
const sugestoes = () => $('#ia-sugestoes');

function abrir() {
  if (!state.user) return;
  const root = painel();
  if (!root) return;
  root.hidden = false;
  document.body.classList.add('ia-open');
  if (!inicializado) { inicializado = true; boasVindas(); }
  setTimeout(() => $('#ia-pergunta')?.focus(), 60);
  carregarContexto();
}

function fechar() {
  painel().hidden = true;
  document.body.classList.remove('ia-open');
}

function alternar() {
  if (painel().hidden) abrir();
  else fechar();
}

function rolar() {
  const box = mensagens();
  box.scrollTop = box.scrollHeight;
}

function bolha(tipo, html) {
  const el = document.createElement('div');
  el.className = `ia-msg ${tipo}`;
  el.innerHTML = html;
  mensagens().appendChild(el);
  rolar();
  return el;
}

function digitando() {
  return bolha('bot', `<div class="ia-typing" aria-label="Consultando"><span></span><span></span><span></span></div>`);
}

function boasVindas() {
  bolha('bot', `<p>Olá, ${esc((state.user?.nome || '').split(' ')[0] || 'tudo bem')}! Eu consulto a carteira e explico as rotinas do sistema.</p>
    <p class="small muted">Pergunte sobre inadimplência, caixa, repasses, contratos, reajustes, ocupação, comissões ou contas a pagar/receber.</p>`);
  if (!contexto) {
    sugestoes().innerHTML = ['Resumo do mês', 'Quem está inadimplente?', 'Quanto tenho a receber e a pagar?', 'Quais contratos vencem em 90 dias?']
      .map(s => `<button type="button" class="ia-chip">${esc(s)}</button>`).join('');
    ligarSugestoes();
  }
}

async function carregarContexto() {
  if (contexto) return;
  try {
    contexto = await api('/assistente');
    if (!contexto?.sugestoes) return;
    sugestoes().innerHTML = contexto.sugestoes
      .map(s => `<button type="button" class="ia-chip">${esc(s)}</button>`).join('');
    ligarSugestoes();
    const aviso = $('#ia-contexto');
    if (aviso) {
      aviso.textContent = `${contexto.vencidas} cobrança(s) vencida(s) · ${contexto.alertas_urgentes} alerta(s) urgente(s)`;
    }
  } catch { /* o assistente ainda funciona sem o resumo */ }
}

function ligarSugestoes() {
  $$('#ia-sugestoes .ia-chip').forEach(b => {
    b.onclick = () => enviar(b.textContent);
  });
}

function destaques(d) {
  if (!d.destaques?.length) return '';
  return `<div class="ia-destaques">${d.destaques.map(x => `
    <div><span>${esc(x.rotulo)}</span><strong>${esc(x.valor)}</strong></div>`).join('')}</div>`;
}

function itens(d) {
  if (!d.itens?.length) return '';
  return `<ul class="ia-itens">${d.itens.map(x => `
    <li>
      <div><strong>${esc(x.titulo)}</strong>${x.detalhe ? `<small>${esc(x.detalhe)}</small>` : ''}</div>
      ${x.valor ? `<span class="ia-valor">${esc(x.valor)}</span>` : ''}
      ${x.rota ? `<a href="${esc(x.rota)}" class="ia-link" data-ia-navegar aria-label="Abrir">↗</a>` : ''}
    </li>`).join('')}</ul>`;
}

function acoes(d) {
  if (!d.acoes?.length) return '';
  return `<div class="ia-acoes">${d.acoes.map(a => `<a class="btn sm" href="${esc(a.rota)}" data-ia-navegar>${esc(a.rotulo)}</a>`).join('')}</div>`;
}

function renderResposta(d) {
  const el = bolha('bot', `
    <p>${esc(d.resposta).replace(/\n/g, '<br>')}</p>
    ${destaques(d)}
    ${itens(d)}
    ${acoes(d)}`);
  el.querySelectorAll('[data-ia-navegar]').forEach(a => a.addEventListener('click', () => fechar()));
  sugestoes().innerHTML = (d.sugestoes || []).map(s => `<button type="button" class="ia-chip">${esc(s)}</button>`).join('');
  ligarSugestoes();
}

async function enviar(texto) {
  const pergunta = String(texto || '').trim();
  if (!pergunta || ocupado) return;
  ocupado = true;
  const input = $('#ia-pergunta');
  const btn = $('#ia-form button[type=submit]');
  input.value = '';
  input.disabled = true;
  btn.disabled = true;
  bolha('user', esc(pergunta));
  const espera = digitando();
  try {
    const d = await api('/assistente', { method: 'POST', body: { pergunta } });
    espera.remove();
    renderResposta(d);
  } catch (e) {
    espera.remove();
    bolha('bot erro', `<p>${esc(e.message || 'Não foi possível consultar agora.')}</p>`);
  } finally {
    ocupado = false;
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }
}

export function bindAssistente() {
  document.querySelectorAll('[data-ia-abrir]').forEach(b => b.addEventListener('click', abrir));
  document.querySelectorAll('[data-ia-close]').forEach(b => b.addEventListener('click', fechar));
  $('#ia-form').addEventListener('submit', (e) => {
    e.preventDefault();
    enviar($('#ia-pergunta').value);
  });
  $('#ia-pergunta').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enviar(e.target.value);
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (state.user) alternar();
    }
    if (e.key === 'Escape' && !painel().hidden) fechar();
  });
}
