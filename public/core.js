/* Núcleo da SPA: estado, API, utilitários e componentes reutilizáveis. */
import { money, moneyShort } from './charts.js';

export const state = {
  user: null,
  settings: [],
  settingsMap: {},
  booted: false,
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const brl = (centavos) => money(centavos);
export const brlShort = (centavos) => moneyShort(centavos);

export const setting = (chave, padrao = '') => state.settingsMap[chave] ?? padrao;

export function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export const compAtual = () => hojeISO().slice(0, 7);

export function addMesesComp(comp, delta) {
  const [a, m] = String(comp).split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dataBR(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.split('-').reverse().join('/');
}
export function dataHoraBR(iso) {
  if (!iso) return '—';
  const [data, hora] = String(iso).replace('T', ' ').slice(0, 16).split(' ');
  return `${dataBR(data)}${hora ? ` ${hora}` : ''}`;
}
export function compBR(comp) {
  if (!comp) return '—';
  const [a, m] = String(comp).split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m) - 1] || m}/${a}`;
}
export function novoMesInput() {
  return compAtual();
}
export function isoHojeInput() {
  return hojeISO();
}

export function parseNum(v, padrao = null) {
  if (v === '' || v == null) return padrao;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}
export function centavosDe(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const inputCentavos = (c) => (Number(c || 0) / 100).toFixed(2);
export const pct = (n) => `${Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function api(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error('Falha de conexão. Verifique sua rede e tente novamente.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error((data && data.erro) || `Erro ${res.status}`);
    err.status = res.status;
    if (res.status === 401 && state.user) {
      state.user = null;
      if (typeof window.__mostrarLogin === 'function') window.__mostrarLogin();
    }
    throw err;
  }
  return data;
}

export function download(path) {
  const a = document.createElement('a');
  a.href = path.startsWith('/api') ? path : '/api' + path;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function baixarArquivo(nome, conteudo, mime = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',').pop());
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

/* ---------------- ícones ---------------- */
const ICONES = {
  painel: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  owners: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
  tenant: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2Z"/><path d="M8 9h8M8 13h8"/>',
  bank: '<path d="m3 10 9-6 9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 21h18"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-3-3 2.1-2.1Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/>',
  whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4.5-1.1L3 21l2.3-4.4A8.4 8.4 0 1 1 21 11.5Z"/><path d="M8.5 8.9c0 4 3.3 7.2 7.2 7.2.8 0 1.7-.6 1.7-1.4 0-.5-.3-.9-.8-1l-1.8-.6c-.4-.1-.8 0-1.1.3l-.7.7a6 6 0 0 1-2.6-2.6l.7-.7c.3-.3.4-.7.3-1.1l-.6-1.8c-.2-.5-.6-.8-1-.8-.9 0-1.5.9-1.5 1.8Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 8-8M16 3l3 3M19 6l2 2"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3Z"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
};
export function icon(name, size = 18) {
  const p = ICONES[name] || ICONES.doc;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---------------- componentes ---------------- */
export function badge(texto, tom = 'plain') {
  return `<span class="badge ${tom}">${esc(texto)}</span>`;
}

export const STATUS_COBRANCA = {
  em_aberto: ['Em aberto', 'sky'],
  pago_parcial: ['Pago parcial', 'butter'],
  pago: ['Pago', 'sage'],
  cancelado: ['Cancelado', 'plain'],
  em_atraso: ['Em atraso', 'blush'],
  em_cobranca: ['Em cobrança', 'lavender'],
  promessa: ['Promessa', 'butter'],
  acordo: ['Acordo', 'sky'],
  juridico: ['Jurídico', 'blush'],
};
export function badgeCobranca(status) {
  const [txt, tom] = STATUS_COBRANCA[status] || [status || '—', 'plain'];
  return badge(txt, tom);
}

export const TOM_STATUS = {
  ativo: 'sage', encerrado: 'plain', pago: 'sage', calculado: 'butter',
  cancelado: 'blush', pendente: 'butter', conciliado: 'sage', ignorado: 'plain',
  urgente: 'blush', atencao: 'butter', info: 'sky',
};

export function tableHtml(colunas, linhas) {
  if (!linhas.length) return `<div class="empty"><strong>Nada por aqui ainda</strong>Os registros aparecerão nesta lista.</div>`;
  const th = colunas.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const rows = linhas.map((row) => {
    const tds = colunas.map((c) => {
      if (c.acao) {
        return `<td class="row-actions-cell"><div class="row-actions">${c.acao(row)}</div></td>`;
      }
      const valor = c.render ? c.render(row) : esc(row[c.key]);
      return `<td class="${c.num ? 'num' : ''}" data-label="${esc(c.label)}">${valor == null || valor === '' ? '—' : valor}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="cards-mobile"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function emptyState(titulo, texto = '', acao = '') {
  return `<div class="empty"><strong>${esc(titulo)}</strong>${texto ? esc(texto) : ''}${acao ? `<div style="margin-top:14px">${acao}</div>` : ''}</div>`;
}

export function loadingBox(texto = 'Carregando…') {
  return `<div class="empty" style="padding:34px"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:10px"></span>${esc(texto)}</div>`;
}

export function erroBox(e) {
  return `<div class="notice danger">${esc(e?.message || 'Não foi possível carregar os dados.')}</div>`;
}

/* ---------------- toasts e modais ---------------- */
export function toast(msg, tipo = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `${icon(tipo === 'err' ? 'alert' : 'check', 16)}<span>${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, tipo === 'err' ? 6000 : 4200);
}

let modalAtual = null;
export function openModal({ titulo, subtitulo = '', corpo = '', rodape = '', wide = false, narrow = false, fecharFora = true, fecharTecla = true, onMount } = {}) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-head">
        <div><h2>${esc(titulo)}</h2>${subtitulo ? `<p>${esc(subtitulo)}</p>` : ''}</div>
        <button class="icon-btn" type="button" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="modal-body">${corpo}</div>
      ${rodape ? `<div class="modal-foot">${rodape}</div>` : ''}
    </div>`;
  $('#modal-root').appendChild(backdrop);
  const fechar = () => closeModal();
  backdrop.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', fechar));
  if (fecharFora) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) fechar(); });
  const onKey = (e) => { if (fecharTecla && e.key === 'Escape' && backdrop === modalAtual?.backdrop) fechar(); };
  document.addEventListener('keydown', onKey);
  modalAtual = { backdrop, fechar, onKey };
  if (onMount) onMount(backdrop, fechar);
  const focusable = backdrop.querySelector('input, select, textarea, button:not([data-close])');
  if (focusable) setTimeout(() => focusable.focus(), 40);
  return { root: backdrop, close: fechar };
}
export function closeModal() {
  if (!modalAtual) return;
  document.removeEventListener('keydown', modalAtual.onKey);
  modalAtual.backdrop.remove();
  modalAtual = null;
}

export function confirmar({ titulo = 'Confirmar', mensagem = '', textoBotao = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal({
      titulo, narrow: true,
      corpo: `<p style="color:var(--ink-soft)">${esc(mensagem)}</p>`,
      rodape: `<button class="btn" data-no>Cancelar</button><button class="btn ${perigo ? 'danger' : 'primary'}" data-yes>${esc(textoBotao)}</button>`,
      onMount(root) {
        root.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
        root.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
      },
    });
  });
}

export function confirmarTexto({ titulo, mensagem, palavra, textoBotao = 'Confirmar', perigo = true }) {
  return new Promise((resolve) => {
    const { close } = openModal({
      titulo, narrow: true,
      corpo: `<p style="color:var(--ink-soft);margin-bottom:14px">${esc(mensagem)}</p>
        <label class="field"><span>Digite <strong>${esc(palavra)}</strong> para continuar</span>
        <input name="confirmacao" autocomplete="off"></label>
        <div class="form-error mt-2" data-err hidden></div>`,
      rodape: `<button class="btn" data-no>Cancelar</button><button class="btn ${perigo ? 'danger' : 'primary'}" data-yes>${esc(textoBotao)}</button>`,
      onMount(root) {
        root.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
        root.querySelector('[data-yes]').onclick = () => {
          const v = root.querySelector('[name=confirmacao]').value.trim();
          if (v !== palavra) {
            const err = root.querySelector('[data-err]');
            err.hidden = false;
            err.textContent = `Digite exatamente ${palavra}.`;
            return;
          }
          close(); resolve(true);
        };
      },
    });
  });
}

/* ---------------- formulários ---------------- */
function fieldInput(f, valores) {
  const val = valores?.[f.name];
  const req = f.required ? 'required' : '';
  const id = `f-${f.name}`;
  if (f.type === 'select') {
    const opts = (typeof f.options === 'function' ? f.options() : f.options || [])
      .map(o => typeof o === 'object' ? o : { value: o, label: o });
    return `<select id="${id}" name="${esc(f.name)}" ${req}>
      ${f.placeholder !== false ? `<option value="">${esc(f.placeholder || 'Selecione…')}</option>` : ''}
      ${opts.map(o => `<option value="${esc(o.value)}" ${String(val ?? '') === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  }
  if (f.type === 'datalist') {
    const opts = (typeof f.options === 'function' ? f.options() : f.options || [])
      .map(o => typeof o === 'object' ? o : { value: o, label: o });
    const listId = `dl-${f.name}`;
    return `<input id="${id}" name="${esc(f.name)}" list="${listId}" value="${val == null ? '' : esc(val)}" placeholder="${esc(f.placeholder || 'Selecione ou digite…')}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${req}>
      <datalist id="${listId}">${opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</datalist>`;
  }
  if (f.type === 'textarea') {
    return `<textarea id="${id}" name="${esc(f.name)}" ${req} rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(val ?? '')}</textarea>`;
  }
  if (f.type === 'checkbox') {
    return `<label class="check" style="padding-top:4px"><input type="checkbox" name="${esc(f.name)}" ${val ? 'checked' : ''}> ${esc(f.checkLabel || f.label)}</label>`;
  }
  if (f.type === 'money') {
    return `<input id="${id}" name="${esc(f.name)}" inputmode="decimal" value="${val == null ? '' : esc(inputCentavos(val))}" placeholder="0,00" ${req}>`;
  }
  if (f.type === 'percent') {
    return `<input id="${id}" name="${esc(f.name)}" type="number" step="0.01" min="0" max="100" value="${val == null ? '' : esc(val)}" placeholder="${esc(f.placeholder || '8')}" ${req}>`;
  }
  if (f.type === 'number') {
    return `<input id="${id}" name="${esc(f.name)}" type="number" step="${f.step || 1}" ${f.min != null ? `min="${f.min}"` : ''} value="${val == null ? '' : esc(val)}" placeholder="${esc(f.placeholder || '')}" ${req}>`;
  }
  const tipo = f.type || 'text';
  return `<input id="${id}" name="${esc(f.name)}" type="${tipo}" value="${val == null ? '' : esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : ''} ${req}>`;
}

export function fieldsHtml(fields, valores = {}) {
  return `<div class="grid-2">${fields.map((f) => {
    if (f.type === 'checkbox') {
      return `<div class="span-2">${fieldInput(f, valores)}</div>`;
    }
    const span = f.span === 2 || f.type === 'textarea' ? 'span-2' : '';
    return `<label class="field ${span}" ${f.hidden ? 'hidden' : ''}>
      <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
      ${fieldInput(f, valores)}
      ${f.hint ? `<small>${esc(f.hint)}</small>` : ''}
    </label>`;
  }).join('')}</div>`;
}

export function collectForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked ? 1 : 0;
    else if (f.type === 'money') out[f.name] = centavosDe(el.value);
    else if (f.type === 'percent' || f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value === '' ? null : String(el.value).trim();
    if (f.required && (out[f.name] === null || out[f.name] === '')) {
      throw new Error(`Preencha o campo “${f.label}”.`);
    }
  }
  return out;
}

export function formModal({ titulo, subtitulo = '', fields, valores = {}, textoBotao = 'Salvar', wide = false, onSubmit, onMount: aoMontar, extraRodape = '' }) {
  const { root, close } = openModal({
    titulo, subtitulo, wide,
    corpo: `<form data-form novalidate>${fieldsHtml(fields, valores)}<div class="form-error mt-2" data-erro hidden></div></form>`,
    rodape: `${extraRodape}<button class="btn" type="button" data-cancelar>Cancelar</button><button class="btn primary" type="submit" form="" data-salvar>${esc(textoBotao)}</button>`,
    onMount(r, fechar) {
      const form = r.querySelector('[data-form]');
      const btn = r.querySelector('[data-salvar]');
      const err = r.querySelector('[data-erro]');
      const submit = async (e) => {
        e?.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        try {
          const dados = collectForm(form, fields);
          const continuar = await onSubmit(dados, form);
          if (continuar !== false) fechar();
        } catch (ex) {
          err.hidden = false;
          err.textContent = ex.message || 'Não foi possível salvar.';
        } finally {
          btn.disabled = false;
        }
      };
      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);
      r.querySelector('[data-cancelar]').onclick = fechar;
      if (typeof aoMontar === 'function') aoMontar(r, fechar);
    },
  });
  return { root, close };
}

/* ---------------- documentos ---------------- */
export async function abrirDocumentos({ entidade, entidadeId, titulo, podeEditar = true }) {
  const categorias = [
    ['contrato', 'Contrato'], ['documento_pessoal', 'Documento pessoal'], ['comprovante', 'Comprovante'],
    ['garantia', 'Garantia'], ['vistoria', 'Vistoria'], ['nota_fiscal', 'Nota fiscal'], ['outros', 'Outros'],
  ];
  const { root, close } = openModal({
    titulo: 'Documentos',
    subtitulo: titulo,
    wide: true,
    corpo: `<div data-lista>${loadingBox()}</div>
      ${podeEditar ? `<div class="divider"></div>
      <form data-form-doc class="grid-2">
        <label class="field span-2"><span>Arquivo *</span><input type="file" name="arquivo" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt" required>
          <small>PDF, imagem, Word, Excel, CSV ou TXT · até 10 MB.</small></label>
        <label class="field"><span>Categoria</span><select name="categoria">${categorias.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label>
        <label class="field"><span>Validade</span><input type="date" name="validade"></label>
        <label class="field span-2"><span>Descrição</span><input name="descricao" placeholder="Opcional"></label>
        <label class="field span-2"><span>Substituir documento (nova versão)</span><select name="substituir_id"><option value="">Enviar como novo documento</option></select></label>
        <div class="span-2" style="display:flex;justify-content:flex-end"><button class="btn soft" type="submit">Enviar documento</button></div>
        <div class="form-error span-2" data-erro hidden></div>
      </form>` : ''}`,
    rodape: `<button class="btn" data-close>Fechar</button>`,
  });

  const lista = root.querySelector('[data-lista]');
  const carregar = async () => {
    try {
      const docs = await api(`/documentos?entidade=${encodeURIComponent(entidade)}&entidade_id=${entidadeId}`);
      if (!docs.length) {
        lista.innerHTML = emptyState('Nenhum documento', 'Envie contratos, comprovantes, vistorias e garantias.');
      } else {
        lista.innerHTML = docs.map(d => `
          <div class="doc">
            <div class="doc-ico">${icon('doc')}</div>
            <div class="doc-meta">
              <strong>${esc(d.nome)}</strong>
              <small>${esc((d.categoria || 'documento').replace('_', ' '))} · v${d.versao} · ${(Number(d.tamanho || 0) / 1024).toFixed(0)} KB · ${dataBR(d.criado_em)}${d.validade ? ` · validade ${dataBR(d.validade)}` : ''}</small>
              ${d.descricao ? `<small>${esc(d.descricao)}</small>` : ''}
            </div>
            <div class="doc-actions">
              ${['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(d.mime) ? `<a class="icon-btn" href="/api/documentos/${d.id}/download?inline=1" target="_blank" rel="noopener" title="Visualizar">${icon('eye')}</a>` : ''}
              <a class="icon-btn" href="/api/documentos/${d.id}/download" title="Baixar">${icon('download')}</a>
              ${d.total_versoes > 1 ? `<button class="icon-btn" data-versoes="${d.id}" title="Versões">${icon('folder')}</button>` : ''}
              ${podeEditar ? `<button class="icon-btn" data-remover="${d.id}" title="Remover">${icon('trash')}</button>` : ''}
            </div>
          </div>`).join('');
        lista.querySelectorAll('[data-remover]').forEach(b => b.onclick = async () => {
          if (!await confirmar({ titulo: 'Remover documento', mensagem: 'O arquivo sai da lista ativa; as versões anteriores permanecem no histórico. Continuar?', textoBotao: 'Remover', perigo: true })) return;
          try { await api(`/documentos/${b.dataset.remover}`, { method: 'DELETE' }); toast('Documento removido.'); carregar(); } catch (e) { toast(e.message, 'err'); }
        });
        lista.querySelectorAll('[data-versoes]').forEach(b => b.onclick = async () => {
          try {
            const versoes = await api(`/documentos/${b.dataset.versoes}/versoes`);
            openModal({
              titulo: 'Versões do documento', narrow: true,
              corpo: versoes.map(v => `<div class="doc"><div class="doc-ico">${icon('doc')}</div><div class="doc-meta"><strong>v${v.versao} ${v.atual ? '(atual)' : ''}</strong><small>${dataBR(v.criado_em)} · ${esc(v.nome)}</small></div><a class="icon-btn" href="/api/documentos/${v.id}/download">${icon('download')}</a></div>`).join(''),
              rodape: '<button class="btn" data-close>Fechar</button>',
            });
          } catch (e) { toast(e.message, 'err'); }
        });
      }
      // preenche o select de substituição
      const sel = root.querySelector('[name=substituir_id]');
      if (sel) sel.innerHTML = '<option value="">Enviar como novo documento</option>' + docs.map(d => `<option value="${d.id}">${esc(d.nome)} (v${d.versao})</option>`).join('');
    } catch (e) {
      lista.innerHTML = erroBox(e);
    }
  };
  await carregar();

  const form = root.querySelector('[data-form-doc]');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('[data-erro]');
      err.hidden = true;
      const file = form.elements.arquivo.files[0];
      if (!file) { err.hidden = false; err.textContent = 'Escolha um arquivo.'; return; }
      if (file.size > 10 * 1024 * 1024) { err.hidden = false; err.textContent = 'O arquivo passa de 10 MB.'; return; }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api('/documentos', { method: 'POST', body: {
          entidade, entidade_id: entidadeId, nome: file.name, mime: file.type || 'application/octet-stream',
          arquivo_base64: await lerArquivo(file), categoria: form.elements.categoria.value,
          descricao: form.elements.descricao.value, validade: form.elements.validade.value || null,
          substituir_id: form.elements.substituir_id.value ? Number(form.elements.substituir_id.value) : null,
        } });
        toast('Documento enviado.');
        form.reset();
        carregar();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
      } finally { btn.disabled = false; }
    });
  }
  return close;
}

/* ---------------- comunicação ---------------- */
export async function abrirMensagem({ entidade, entidadeId, destinatarios = [], contexto = '' }) {
  let cfg = { templates: {}, assinatura: '', whatsapp_empresa: '' };
  try { cfg = await api('/comunicacao/status'); } catch { /* segue com padrões */ }
  const pessoas = destinatarios.filter(d => d && (d.telefone || d.email));
  if (!pessoas.length) {
    toast('Cadastre telefone ou e-mail para enviar mensagens.', 'err');
    return;
  }
  const { root, close } = openModal({
    titulo: 'Enviar mensagem',
    subtitulo: contexto || 'WhatsApp ou e-mail',
    corpo: `
      <div class="tabs" data-canal-tabs>
        <button class="active" data-canal="whatsapp" type="button">WhatsApp</button>
        <button data-canal="email" type="button">E-mail</button>
      </div>
      <div class="stack">
        <label class="field"><span>Destinatário</span>
          <select name="destinatario">${pessoas.map((p, i) => `<option value="${i}">${esc(p.nome)} — ${esc(p.telefone || p.email)}</option>`).join('')}</select>
        </label>
        <div class="grid-2">
          <label class="field"><span>Modelo</span>
            <select name="modelo">
              <option value="">Mensagem livre</option>
              <option value="cobranca">Cobrança</option>
              <option value="lembrete">Lembrete de vencimento</option>
              <option value="reajuste">Aviso de reajuste</option>
            </select>
          </label>
          <label class="field" data-assunto-wrap hidden><span>Assunto</span><input name="assunto" value="Mensagem de ${esc(setting('imob_nome', 'Imobiliária'))}"></label>
        </div>
        <label class="field"><span>Mensagem</span><textarea name="mensagem" rows="7" maxlength="5000"></textarea>
          <small data-contador>0 / 2.000 caracteres no WhatsApp</small></label>
        <div class="form-error" data-erro hidden></div>
      </div>`,
    rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-enviar>Enviar</button>`,
  });

  let canal = 'whatsapp';
  const tabs = root.querySelectorAll('[data-canal]');
  const msg = root.querySelector('[name=mensagem]');
  const modelo = root.querySelector('[name=modelo]');
  const assuntoWrap = root.querySelector('[data-assunto-wrap]');
  const contador = root.querySelector('[data-contador]');
  const err = root.querySelector('[data-erro]');

  const atualizarContador = () => {
    contador.textContent = canal === 'whatsapp' ? `${msg.value.length} / 2.000 caracteres no WhatsApp` : `${msg.value.length} caracteres`;
  };
  const preencher = () => {
    const p = pessoas[Number(root.querySelector('[name=destinatario]').value)] || {};
    const tpl = cfg.templates?.[modelo.value] || '';
    if (!tpl) return;
    msg.value = tpl
      .replaceAll('{inquilino}', p.nome || '')
      .replaceAll('{proprietario}', p.nome || '')
      .replaceAll('{imovel}', p.imovel || '')
      .replaceAll('{competencia}', p.competencia || '')
      .replaceAll('{vencimento}', p.vencimento ? dataBR(p.vencimento) : '')
      .replaceAll('{valor}', p.valor_centavos != null ? brl(p.valor_centavos) : '')
      .replaceAll('{indice}', p.indice || '')
      .replaceAll('{data}', p.data ? dataBR(p.data) : '');
    atualizarContador();
  };
  tabs.forEach(t => t.onclick = () => {
    canal = t.dataset.canal;
    tabs.forEach(x => x.classList.toggle('active', x === t));
    assuntoWrap.hidden = canal !== 'email';
    atualizarContador();
  });
  modelo.onchange = preencher;
  root.querySelector('[name=destinatario]').onchange = preencher;
  msg.addEventListener('input', atualizarContador);
  preencher();
  if (cfg.assinatura && !msg.value) { msg.value = cfg.assinatura; atualizarContador(); }
  if (!cfg.email_configurado && cfg.templates) {
    // sem SMTP o e-mail falhará; o servidor devolve mensagem clara.
  }

  root.querySelector('[data-enviar]').onclick = async () => {
    err.hidden = true;
    const p = pessoas[Number(root.querySelector('[name=destinatario]').value)] || {};
    const texto = msg.value.trim();
    if (!texto) { err.hidden = false; err.textContent = 'Escreva a mensagem.'; return; }
    const btn = root.querySelector('[data-enviar]');
    btn.disabled = true;
    try {
      if (canal === 'whatsapp') {
        const r = await api('/comunicacao/whatsapp', { method: 'POST', body: {
          telefone: p.telefone, mensagem: texto, entidade, entidade_id: entidadeId,
          destinatario_nome: p.nome,
        } });
        window.open(r.url, '_blank', 'noopener');
        toast('WhatsApp aberto em nova aba.');
        close();
      } else {
        await api('/comunicacao/email', { method: 'POST', body: {
          para: p.email, assunto: root.querySelector('[name=assunto]').value, mensagem: texto,
          entidade, entidade_id: entidadeId, destinatario_nome: p.nome,
        } });
        toast('E-mail enviado.');
        close();
      }
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    } finally { btn.disabled = false; }
  };
  return close;
}
