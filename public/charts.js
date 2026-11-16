/* Gráficos SVG próprios — sem biblioteca externa. */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const money = (centavos) =>
  (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function moneyShort(centavos) {
  const v = Number(centavos || 0) / 100;
  const abs = Math.abs(v);
  if (abs >= 1000000) return `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

const labelMes = (mes) => {
  if (!/^\d{4}-\d{2}/.test(String(mes))) return String(mes);
  const [a, m] = String(mes).slice(0, 7).split('-');
  return `${m}/${a.slice(2)}`;
};

function empty(altura = 160, msg = 'Sem dados no período') {
  return `<div class="chart-empty" style="min-height:${altura}px;display:grid;place-items:center">${esc(msg)}</div>`;
}

const CORES = ['#3d6350', '#35596e', '#5a4a79', '#7a6425', '#8a4238', '#4f5c58'];

/* ---------------- sparkline ---------------- */
export function sparkline(valores = [], cor = '#3d6350', largura = 96, altura = 30) {
  const nums = valores.map(v => Number(v) || 0);
  if (nums.length < 2) return '';
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (largura - 3) + 1.5;
    const y = altura - 3 - ((v - min) / span) * (altura - 6);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${(largura - 1.5).toFixed(1)},${altura - 1} L1.5,${altura - 1} Z`;
  return `<svg class="spark" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" aria-hidden="true">
    <path d="${area}" fill="${cor}" opacity=".10"/>
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.2" fill="${cor}"/>
  </svg>`;
}

/* ---------------- barras agrupadas ---------------- */
export function barChart({ labels = [], series = [], altura = 230, formato = moneyShort, rotuloEixo = '' } = {}) {
  if (!labels.length || !series.some(s => s.valores?.some(v => Number(v)))) {
    return empty(altura);
  }
  const W = 640, H = altura, pad = { t: 12, r: 10, b: 30, l: 54 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const valores = series.flatMap(s => (s.valores || []).map(v => Number(v) || 0));
  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  const topo = max || 1;
  const base = min < 0 ? min : 0;
  const escala = (v) => pad.t + ih - ((v - base) / (topo - base || 1)) * ih;
  const grupo = iw / labels.length;
  const barraW = Math.max(3, Math.min(18, (grupo - 10) / Math.max(series.length, 1)));
  const gap = 2;
  const totalW = series.length * barraW + (series.length - 1) * gap;
  const yZero = escala(0);
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = base + (topo - base) * (i / 4);
    const y = escala(v);
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#e5e0d6" stroke-width="1" ${i ? '' : 'stroke-opacity="1"'}/>
      <text x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#7d8a85">${esc(formato(v))}</text>`;
  }
  let barras = '';
  labels.forEach((lab, i) => {
    const x0 = pad.l + i * grupo + (grupo - totalW) / 2;
    series.forEach((s, j) => {
      const v = Number(s.valores?.[i]) || 0;
      const y = escala(Math.max(v, base));
      const h = Math.max(Math.abs(yZero - escala(v)), 0.6);
      const yTop = v >= 0 ? y : yZero;
      barras += `<rect x="${(x0 + j * (barraW + gap)).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barraW}" height="${h.toFixed(1)}" rx="2.5" fill="${esc(s.cor || CORES[j])}" opacity=".92"><title>${esc(s.nome)} ${esc(lab)}: ${esc(formato(v))}</title></rect>`;
    });
    if (labels.length <= 14 || i % 2 === 0) {
      barras += `<text x="${(pad.l + i * grupo + grupo / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9.5" fill="#7d8a85">${esc(labelMes(lab))}</text>`;
    }
  });
  const legenda = series.map((s, j) => `<span><i style="background:${esc(s.cor || CORES[j])}"></i>${esc(s.nome)}</span>`).join('');
  return `<div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rotuloEixo || 'Gráfico de barras')}" preserveAspectRatio="xMidYMid meet">
      ${grid}${barras}
    </svg>
    <div class="legend" style="margin-top:4px">${legenda}</div>
  </div>`;
}

/* ---------------- linhas ---------------- */
export function lineChart({ labels = [], series = [], altura = 240, area = true, formato = moneyShort } = {}) {
  if (!labels.length || !series.some(s => s.valores?.some(v => Number(v)))) return empty(altura);
  const W = 640, H = altura;
  const ultimoRotulo = labels.length > 1;
  const pad = { t: 14, r: 14, b: 30, l: 56 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const todas = series.flatMap(s => (s.valores || []).map(v => Number(v) || 0));
  let max = Math.max(...todas, 0);
  let min = Math.min(...todas, 0);
  if (max === min) max = min + 1;
  if (max > 0) max *= 1.08;
  if (min < 0) min *= 1.08;
  const px = (i) => pad.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const py = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * (i / 4);
    const y = py(v);
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#e5e0d6" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#7d8a85">${esc(formato(v))}</text>`;
  }
  let linhas = '';
  series.forEach((s, j) => {
    const valores = (s.valores || []).map(v => Number(v) || 0);
    const cor = s.cor || CORES[j];
    const d = valores.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    if (area && series.length === 1) {
      linhas += `<path d="${d} L${px(valores.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${px(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z" fill="${cor}" opacity=".10"/>`;
    }
    linhas += `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 5" opacity=".7"' : ''}/>`;
    valores.forEach((v, i) => {
      linhas += `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="${labels.length > 24 ? 1.6 : 2.6}" fill="#fff" stroke="${cor}" stroke-width="1.8"><title>${esc(s.nome)} ${esc(labels[i])}: ${esc(formato(v))}</title></circle>`;
    });
  });
  let eixo = '';
  labels.forEach((lab, i) => {
    if (labels.length <= 14 || i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1) {
      eixo += `<text x="${px(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9.5" fill="#7d8a85">${esc(labelMes(lab))}</text>`;
    }
  });
  const legenda = series.map((s, j) => `<span><i style="background:${esc(s.cor || CORES[j])}"></i>${esc(s.nome)}</span>`).join('');
  return `<div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linhas" preserveAspectRatio="xMidYMid meet">
      ${grid}${linhas}${eixo}
    </svg>
    ${series.length > 1 ? `<div class="legend" style="margin-top:4px">${legenda}</div>` : ''}
  </div>`;
}

/* ---------------- rosca ---------------- */
export function donut(items = [], { tamanho = 170, centro = '', formato = moneyShort } = {}) {
  const validos = items.filter(i => Number(i.valor) > 0);
  const total = validos.reduce((s, i) => s + Number(i.valor), 0);
  if (!total) return empty(150);
  const r = 54;
  const c = 2 * Math.PI * r;
  let off = 0;
  let aneis = '';
  validos.forEach((item, i) => {
    const frac = Number(item.valor) / total;
    const cor = item.cor || CORES[i % CORES.length];
    const dash = Math.max(frac * c - 2.5, 0.5);
    aneis += `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${esc(cor)}" stroke-width="20"
      stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 80 80)" stroke-linecap="butt"><title>${esc(item.nome)}: ${esc(formato(item.valor))}</title></circle>`;
    off += frac * c;
  });
  const legenda = validos.slice(0, 6).map((item, i) => `
    <div style="display:flex;align-items:center;gap:7px;font-size:.78rem;color:var(--muted);padding:2px 0">
      <i style="width:8px;height:8px;border-radius:3px;background:${esc(item.cor || CORES[i % CORES.length])};flex:none"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.nome)}</span>
      <strong style="color:var(--ink-soft);font-weight:600">${esc(formato(item.valor))}</strong>
    </div>`).join('');
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
    <svg viewBox="0 0 160 160" width="${tamanho}" height="${tamanho}" role="img" aria-label="Composição">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="#f0ece3" stroke-width="20"/>
      ${aneis}
      ${centro ? `<text x="80" y="76" text-anchor="middle" font-size="10" fill="#7d8a85">${esc(centro)}</text>
      <text x="80" y="92" text-anchor="middle" font-size="12" font-weight="600" fill="#2c3634">${esc(formato(total))}</text>` : ''}
    </svg>
    <div style="flex:1;min-width:150px">${legenda}</div>
  </div>`;
}

/* ---------------- barras horizontais ---------------- */
export function hbar(items = [], { formato = moneyShort, cor = '#3d6350' } = {}) {
  const validos = items.filter(i => Number(i.valor) > 0).slice(0, 8);
  if (!validos.length) return empty(120);
  const max = Math.max(...validos.map(i => Number(i.valor)), 1);
  return `<div style="display:grid;gap:10px">${validos.map((item, i) => `
    <div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:.78rem;margin-bottom:4px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.nome)}</span>
        <strong style="font-weight:600;color:var(--ink-soft);white-space:nowrap">${esc(formato(item.valor))}</strong>
      </div>
      <div style="height:7px;background:var(--bg-soft);border-radius:20px;overflow:hidden">
        <div style="height:100%;width:${Math.max((Number(item.valor) / max) * 100, 1.5).toFixed(1)}%;background:${esc(item.cor || cor)};border-radius:20px;opacity:${1 - i * 0.07}"></div>
      </div>
    </div>`).join('')}</div>`;
}

/* ---------------- gauge ---------------- */
export function gauge(pct = 0, { tamanho = 160, rotulo = 'Ocupação' } = {}) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 54;
  const c = Math.PI * r;
  const dash = (v / 100) * c;
  return `<div style="text-align:center">
    <svg viewBox="0 0 160 92" width="${tamanho}" height="${tamanho * .58}" role="img" aria-label="${esc(rotulo)}">
      <path d="M26 80 A54 54 0 0 1 134 80" fill="none" stroke="#f0ece3" stroke-width="16" stroke-linecap="round"/>
      <path d="M26 80 A54 54 0 0 1 134 80" fill="none" stroke="#3d6350" stroke-width="16" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"/>
      <text x="80" y="68" text-anchor="middle" font-size="19" font-weight="600" fill="#2c3634">${v.toFixed(0)}%</text>
      <text x="80" y="84" text-anchor="middle" font-size="8.5" fill="#7d8a85">${esc(rotulo)}</text>
    </svg>
  </div>`;
}
