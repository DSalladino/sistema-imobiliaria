/* Telas: painel, alertas e cadastros. */
import {
  $, esc, brl, brlShort, api, state, setting, icon, badge, tableHtml,
  emptyState, loadingBox, erroBox, toast, openModal, confirmar, formModal,
  dataBR, compBR, compAtual, addMesesComp, abrirDocumentos, abrirMensagem,
} from './core.js';
import { sparkline, barChart, lineChart, donut, hbar, gauge } from './charts.js';

const podeEscrever = () => ['admin', 'operador'].includes(state.user?.papel);
const isAdmin = () => state.user?.papel === 'admin';

function head(titulo, texto, acoes = '') {
  return `<div class="section-head"><div><h2>${esc(titulo)}</h2>${texto ? `<p>${esc(texto)}</p>` : ''}</div><div class="section-actions">${acoes}</div></div>`;
}

function deltaKpi(k, chave) {
  const c = k.comparativo?.[chave];
  if (!c) return '';
  const v = Number(c.variacao || 0);
  const seta = v > 0.05 ? 'up' : v < -0.05 ? 'down' : '';
  const sinal = v > 0 ? '+' : '';
  return `<span class="kpi-delta"><${seta || 'span'}>${sinal}${v.toFixed(1)}%</${seta || 'span'}> vs. anterior</span>`;
}
function kpiCard(rotulo, valor, rodape, spark = '') {
  return `<div class="kpi">
    <div class="kpi-label">${esc(rotulo)}</div>
    <div class="kpi-value">${valor}</div>
    <div class="kpi-foot">${rodape || ''}${spark}</div>
  </div>`;
}

function periodoRange(p) {
  const comp = compAtual();
  if (p === 'mes') return { de: comp, ate: comp };
  if (p === '6m') return { de: addMesesComp(comp, -5), ate: comp };
  if (p === 'ano') return { de: `${comp.slice(0, 4)}-01`, ate: comp };
  if (p === 'anterior') { const a = Number(comp.slice(0, 4)) - 1; return { de: `${a}-01`, ate: `${a}-12` }; }
  return { de: addMesesComp(comp, -11), ate: comp };
}

/* ============================================================
   PAINEL
   ============================================================ */
export async function viewPainel(root, params) {
  let periodo = localStorage.getItem('painel-periodo') || '12m';
  let comparar = localStorage.getItem('painel-comparar') !== '0';
  root.innerHTML = `
    ${head('Painel analítico', 'Receita, carteira e inadimplência em um só lugar.', `
      <div class="segmented" data-periodos>
        <button data-p="mes">Mês atual</button>
        <button data-p="6m">6 meses</button>
        <button data-p="12m">12 meses</button>
        <button data-p="ano">Ano atual</button>
        <button data-p="anterior">Ano anterior</button>
      </div>
      <button class="btn" data-comparar title="Comparar com o período anterior">Comparar</button>
      ${podeEscrever() ? `<button class="btn primary" data-nova-cobranca>${icon('plus')} Gerar cobranças</button>` : ''}`)}
    <div data-corpo>${loadingBox('Montando o painel…')}</div>`;

  const corpo = root.querySelector('[data-corpo]');
  const marcar = () => {
    root.querySelectorAll('[data-periodos] button').forEach(b => b.classList.toggle('active', b.dataset.p === periodo));
    root.querySelector('[data-comparar]').classList.toggle('primary', comparar);
  };
  root.querySelectorAll('[data-periodos] button').forEach(b => b.onclick = () => {
    periodo = b.dataset.p; localStorage.setItem('painel-periodo', periodo); marcar(); carregar();
  });
  root.querySelector('[data-comparar]').onclick = () => {
    comparar = !comparar; localStorage.setItem('painel-comparar', comparar ? '1' : '0'); marcar(); carregar();
  };
  const btnNova = root.querySelector('[data-nova-cobranca]');
  if (btnNova) btnNova.onclick = () => abrirGerarCobrancas(() => carregar());
  marcar();

  async function carregar() {
    corpo.innerHTML = loadingBox();
    try {
      const { de, ate } = periodoRange(periodo);
      const comp = compAtual();
      const qs = `de=${de}&ate=${ate}&comparar=${comparar ? 1 : 0}`;
      const [a, d, cr, mes] = await Promise.all([
        api(`/analytics?${qs}`),
        api('/dashboard'),
        api(`/cobrancas/resumo?competencia=${comp}`),
        api(`/analytics?de=${comp}&ate=${comp}&comparar=1`),
      ]);
      const k = a.kpis;
      const mk = mes.kpis;
      const serie = a.serie;
      const best = serie.reduce((m, x) => (x.receita_imob > (m?.receita_imob || -1) ? x : m), null);
      const varReceita = a.comparativo?.receita_imob?.variacao || 0;
      const aging = cr.aging_valores || {};
      const agingItems = [
        { nome: '0–30 dias', valor: aging['0-30'] || 0, cor: '#a8c3b0' },
        { nome: '31–60 dias', valor: aging['31-60'] || 0, cor: '#ead9a8' },
        { nome: '61–90 dias', valor: aging['61-90'] || 0, cor: '#efc9a8' },
        { nome: '90+ dias', valor: aging['90+'] || 0, cor: '#e5b8b0' },
      ];

      corpo.innerHTML = `
        <div class="month-strip">
          <div class="month-strip-head">
            <div>
              <p class="eyebrow" style="margin-bottom:2px">Dados do mês</p>
              <h2>${compBR(comp)}</h2>
            </div>
            <div class="pill-row">
              ${badge(d.mesFechado ? 'Mês fechado' : 'Mês em andamento', d.mesFechado ? 'plain' : 'sage')}
              ${d.repassesPendentes.quantidade ? badge(`${d.repassesPendentes.quantidade} repasse(s) pendente(s)`, 'butter') : badge('Repasses em dia', 'sage')}
              <a class="btn sm" href="#/cobrancas?competencia=${comp}">Ver cobranças</a>
              <a class="btn sm" href="#/repasses">Ver repasses</a>
            </div>
          </div>
          <div class="month-grid">
            <div class="month-stat"><span>Receita da imobiliária</span><strong>${brl(mk.receita_imob)}</strong><small>taxa + outras receitas</small></div>
            <div class="month-stat"><span>Aluguéis recebidos</span><strong>${brl(mk.alugueis)}</strong><small>caixa dos proprietários</small></div>
            <div class="month-stat"><span>Repasses pagos</span><strong>${brl(mk.repasses)}</strong><small>saída do mês</small></div>
            <div class="month-stat"><span>Inadimplência</span><strong style="color:${(mk.inadimplencia_pct || 0) > 10 ? 'var(--blush-ink)' : 'inherit'}">${brl(mk.inadimplencia)}</strong><small>${(mk.inadimplencia_pct || 0).toFixed(1)}% do previsto</small></div>
            <div class="month-stat"><span>Cobranças do mês</span><strong>${cr.total}</strong><small>${brl(cr.valor_pago)} recebido</small></div>
            <div class="month-stat"><span>Em aberto na carteira</span><strong>${brl(cr.valor_aberto)}</strong><small>${cr.abertas} cobrança(s) · ${brl(cr.valor_vencido)} vencido</small></div>
          </div>
        </div>

        <div class="kpis mt-2">
          ${kpiCard('Receita da imobiliária', brl(k.receita_imob), deltaKpi(a, 'receita_imob'), sparkline(serie.map(x => x.receita_imob)))}
          ${kpiCard('Aluguéis administrados', brl(k.alugueis), deltaKpi(a, 'alugueis'), sparkline(serie.map(x => x.alugueis), '#35596e'))}
          ${kpiCard('Repasses', brl(k.repasses), deltaKpi(a, 'repasses'), sparkline(serie.map(x => x.repasses), '#5a4a79'))}
          ${kpiCard('Inadimplência', brl(k.inadimplencia), `<span class="kpi-delta">${(k.inadimplencia_pct || 0).toFixed(1)}% do previsto</span>`, sparkline(serie.map(x => x.inadimplencia), '#8a4238'))}
          ${kpiCard('Taxa média', `${(k.taxa_media_pct || 0).toFixed(2)}%`, deltaKpi(a, 'taxa_media_pct'), sparkline(serie.map(x => x.taxa), '#7a6425'))}
          ${kpiCard('Carteira ativa', `${k.contratos_ativos} contratos`, `<span class="kpi-delta">${k.imoveis_alugados}/${k.imoveis_total} imóveis ocupados</span>`)}
        </div>

        <div class="grid cols-2 mt-2">
          <div class="card">
            <div class="card-head"><div><h2>Movimento financeiro</h2><p>${esc(a.periodo.rotulo)}</p></div></div>
            <div class="card-body">${barChart({
              labels: serie.map(x => x.mes),
              series: [
                { nome: 'Receita', valores: serie.map(x => x.receita_imob), cor: '#3d6350' },
                { nome: 'Despesas', valores: serie.map(x => x.desp_imob), cor: '#e5b8b0' },
                { nome: 'Resultado', valores: serie.map(x => x.resultado_imob), cor: '#a9c6d8' },
              ],
              altura: 240,
            })}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Previsto × recebido</h2><p>Aluguéis da carteira comparados ao caixa</p></div></div>
            <div class="card-body">${lineChart({
              labels: serie.map(x => x.mes),
              series: [
                { nome: 'Previsto', valores: serie.map(x => x.previsto), cor: '#c3b8d9', dashed: true },
                { nome: 'Recebido', valores: serie.map(x => x.alugueis), cor: '#3d6350' },
              ],
              altura: 240,
            })}</div>
          </div>
        </div>

        <div class="grid cols-3 mt-2">
          <div class="card">
            <div class="card-head"><div><h2>Composição das receitas</h2><p>No período selecionado</p></div></div>
            <div class="card-body">${donut(a.composicao_receitas.map((c, i) => ({
              nome: c.nome, valor: c.valor, cor: ['#3d6350', '#35596e', '#5a4a79', '#7a6425', '#8a4238', '#4f5c58'][i % 6],
            })), { centro: 'Receitas', tamanho: 150 })}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Evolução dos saldos</h2><p>Imobiliária × proprietários</p></div></div>
            <div class="card-body">${lineChart({
              labels: serie.map(x => x.mes),
              series: [
                { nome: 'Imobiliária', valores: serie.map(x => x.saldo_imob), cor: '#35596e' },
                { nome: 'Proprietários', valores: serie.map(x => x.saldo_prop), cor: '#3d6350' },
              ],
              altura: 210,
            })}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Ocupação da carteira</h2><p>${k.imoveis_total} imóveis ativos</p></div></div>
            <div class="card-body" style="display:grid;place-items:center;gap:8px">
              ${gauge(k.ocupacao_pct, { rotulo: 'Ocupação' })}
              <div class="pill-row" style="justify-content:center">
                ${badge(`${a.ocupacao.alugado} alugados`, 'sage')}${badge(`${a.ocupacao.vago} vagos`, 'plain')}${badge(`${a.ocupacao.manutencao} manutenção`, 'butter')}
              </div>
            </div>
          </div>
        </div>

        <div class="grid cols-2 mt-2">
          <div class="card">
            <div class="card-head"><div><h2>Repasses por proprietário</h2><p>Pagos e pendentes no período</p></div></div>
            <div class="card-body">${hbar(a.repasses_proprietarios.map(p => ({ nome: p.nome, valor: p.valor })), { formato: brlShort })}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Aging de cobranças</h2><p>Saldo vencido por faixa de atraso</p></div><a class="link" href="#/cobrancas">Ver cobranças</a></div>
            <div class="card-body">${hbar(agingItems, { formato: brlShort, cor: '#8a4238' })}</div>
          </div>
        </div>

        <div class="grid cols-3 mt-2">
          <div class="card">
            <div class="card-head"><div><h2>Insights</h2><p>Leitura rápida do período</p></div></div>
            <div class="card-body" style="display:grid;gap:10px">
              <div class="notice info">Melhor mês: <strong>${best ? compBR(best.mes) : '—'}</strong>${best ? ` com ${brl(best.receita_imob)} de receita.` : ''}</div>
              <div class="notice ${varReceita >= 0 ? '' : 'danger'}">Receita ${varReceita >= 0 ? 'cresceu' : 'caiu'} <strong>${Math.abs(varReceita).toFixed(1)}%</strong> em relação ao período anterior.</div>
              <div class="notice ${k.inadimplencia_pct > 10 ? 'danger' : 'info'}">Inadimplência em <strong>${(k.inadimplencia_pct || 0).toFixed(1)}%</strong> do previsto${k.inadimplencia_pct > 10 ? ' — atenção à régua de cobrança.' : '.'}</div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Alertas</h2><p>${d.alertasResumo.urgente} urgentes · ${d.alertasResumo.atencao} atenção</p></div><a class="link" href="#/alertas">Ver todos</a></div>
            <div class="card-body">
              ${(d.alertas || []).slice(0, 5).map(al => `
                <div class="alert-item"><span class="alert-dot ${esc(al.nivel)}"></span>
                  <div class="a-main"><strong>${esc(al.titulo)}</strong><p>${esc(al.descricao)}</p></div>
                </div>`).join('') || '<p class="muted small">Nenhum alerta no momento.</p>'}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Atividade recente</h2><p>Últimas ações registradas</p></div></div>
            <div class="card-body">
              ${(a.atividades || []).length ? `<div class="timeline">${a.atividades.map(x => `
                <div class="tl-item"><span class="tl-dot"></span><div>
                  <p><strong>${esc(x.usuario_nome || 'sistema')}</strong> · ${esc(x.acao)} ${esc(x.entidade)}</p>
                  <small>${esc((x.criado_em || '').replace('T', ' ').slice(0, 16))}</small>
                </div></div>`).join('')}</div>` : '<p class="muted small">Sem atividades visíveis para este perfil.</p>'}
            </div>
          </div>
        </div>

        <div class="card mt-2">
          <div class="card-head"><div><h2>Carteira de contratos</h2><p>Maiores aluguéis ativos</p></div><a class="link" href="#/contratos">Gerenciar contratos</a></div>
          <div class="card-body">
            ${tableHtml([
              { label: 'Contrato', render: c => `<strong>${esc(c.codigo || '#' + c.id)}</strong>` },
              { label: 'Imóvel', render: c => `${esc(c.endereco)}${c.numero ? ', ' + esc(c.numero) : ''}` },
              { label: 'Proprietário', key: 'proprietario_nome' },
              { label: 'Inquilino', key: 'inquilino_nome' },
              { label: 'Aluguel', num: true, render: c => brl(c.aluguel_centavos) },
              { label: 'Vencimento', num: true, render: c => `dia ${c.dia_vencimento}` },
            ], a.top_contratos || [])}
          </div>
        </div>`;
    } catch (e) {
      corpo.innerHTML = erroBox(e);
    }
  }
  await carregar();
}

/* ============================================================
   ALERTAS
   ============================================================ */
export async function viewAlertas(root) {
  let filtro = 'todos';
  root.innerHTML = head('Alertas', 'Vencimentos, reajustes, garantias e atrasos que pedem ação.', `<button class="btn" data-atualizar>${icon('bell')} Atualizar</button>`)
    + `<div class="tabs" data-tabs><button class="active" data-f="todos">Todos</button><button data-f="urgente">Urgentes</button><button data-f="atencao">Atenção</button><button data-f="info">Informativos</button></div><div data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  let dados = [];
  const render = () => {
    const itens = dados.filter(a => filtro === 'todos' || a.nivel === filtro);
    if (!itens.length) { lista.innerHTML = emptyState('Nenhum alerta', 'A carteira está em dia com os prazos configurados.'); return; }
    lista.innerHTML = `<div class="card"><div class="card-body">${itens.map(a => `
      <div class="alert-item">
        <span class="alert-dot ${esc(a.nivel)}"></span>
        <div class="a-main">
          <strong>${esc(a.titulo)}</strong>
          <p>${esc(a.descricao)}</p>
          <div class="pill-row" style="margin-top:5px">
            ${badge(a.tipo, a.tipo === 'atraso' ? 'blush' : a.tipo === 'reajuste' ? 'butter' : 'sky')}
            ${a.proprietario ? badge('Proprietário: ' + a.proprietario, 'plain') : ''}
            ${a.responsavel ? badge('Resp.: ' + a.responsavel, 'outline') : ''}
          </div>
        </div>
        <div class="a-actions">
          ${a.tipo === 'atraso' && a.telefone ? `<button class="icon-btn" data-wa="${a.contrato_id}" title="WhatsApp">${icon('whatsapp')}</button>` : ''}
          ${a.tipo === 'atraso' && a.email ? `<button class="icon-btn" data-email="${a.contrato_id}" title="E-mail">${icon('mail')}</button>` : ''}
          ${a.contrato_id ? `<a class="icon-btn" href="#/contratos" title="Contratos">${icon('contract')}</a>` : ''}
        </div>
      </div>`).join('')}</div></div>`;
    lista.querySelectorAll('[data-wa]').forEach(b => b.onclick = () => {
      const a = dados.find(x => String(x.contrato_id) === b.dataset.wa && x.tipo === 'atraso');
      abrirMensagem({ entidade: 'contratos', entidadeId: a.contrato_id, destinatarios: [{ nome: a.inquilino, telefone: a.telefone, email: a.email, imovel: a.imovel, competencia: a.competencia, vencimento: a.data, valor_centavos: a.valor_centavos }], contexto: a.titulo });
    });
    lista.querySelectorAll('[data-email]').forEach(b => b.onclick = () => {
      const a = dados.find(x => String(x.contrato_id) === b.dataset.email && x.tipo === 'atraso');
      abrirMensagem({ entidade: 'contratos', entidadeId: a.contrato_id, destinatarios: [{ nome: a.inquilino, telefone: a.telefone, email: a.email, imovel: a.imovel, competencia: a.competencia, vencimento: a.data, valor_centavos: a.valor_centavos }], contexto: a.titulo });
    });
  };
  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try { dados = await api('/alertas'); render(); } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelectorAll('[data-tabs] button').forEach(b => b.onclick = () => {
    filtro = b.dataset.f;
    root.querySelectorAll('[data-tabs] button').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
  root.querySelector('[data-atualizar]').onclick = carregar;
  await carregar();
}

/* ============================================================
   PROPRIETÁRIOS
   ============================================================ */
const camposProprietario = () => [
  { name: 'nome', label: 'Nome', required: true, span: 2 },
  { name: 'cpf_cnpj', label: 'CPF/CNPJ' },
  { name: 'telefone', label: 'Telefone', placeholder: '(11) 99999-9999' },
  { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'taxa_admin_pct', label: 'Taxa própria (%)', type: 'percent', hint: 'Deixe vazio para usar a regra geral.' },
  { name: 'endereco', label: 'Endereço', span: 2 },
  { name: 'banco', label: 'Banco' },
  { name: 'agencia', label: 'Agência' },
  { name: 'conta', label: 'Conta' },
  { name: 'tipo_conta', label: 'Tipo de conta', type: 'select', options: ['corrente', 'poupanca', 'pagamento'] },
  { name: 'pix', label: 'Pix' },
  { name: 'documento_url', label: 'Link de documentos', span: 2, placeholder: 'https://…' },
  { name: 'observacoes', label: 'Observações', type: 'textarea' },
  { name: 'ativo', label: 'Ativo', type: 'checkbox', checkLabel: 'Cadastro ativo', span: 2 },
];

export async function viewProprietarios(root) {
  let busca = '';
  let dados = [];
  root.innerHTML = head('Proprietários', 'Cadastro, conta bancária, Pix e taxa própria.', `
      ${podeEscrever() ? `<button class="btn primary" data-novo>${icon('plus')} Novo proprietário</button>` : ''}`)
    + `<div class="filters"><div class="search grow">${icon('search')}<input placeholder="Buscar por nome, CPF, e-mail ou telefone" data-busca></div></div>
      <div data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');

  const abrirForm = (p = null) => formModal({
    titulo: p ? 'Editar proprietário' : 'Novo proprietário',
    subtitulo: 'A taxa própria, quando informada, vence a regra geral.',
    fields: camposProprietario(),
    valores: p || { ativo: 1, tipo_conta: 'corrente' },
    onSubmit: async (dadosForm) => {
      if (!dadosForm.nome) throw new Error('Informe o nome.');
      if (p) await api(`/proprietarios/${p.id}`, { method: 'PUT', body: dadosForm });
      else await api('/proprietarios', { method: 'POST', body: dadosForm });
      toast(p ? 'Proprietário atualizado.' : 'Proprietário cadastrado.');
      carregar();
    },
  });

  const render = () => {
    const termo = busca.toLowerCase();
    const filtrados = dados.filter(p => !termo || [p.nome, p.cpf_cnpj, p.email, p.telefone].some(v => String(v || '').toLowerCase().includes(termo)));
    lista.innerHTML = tableHtml([
      { label: 'Nome', render: p => `<strong>${esc(p.nome)}</strong>${p.observacoes ? `<span class="sub">${esc(p.observacoes)}</span>` : ''}` },
      { label: 'CPF/CNPJ', render: p => esc(p.cpf_cnpj || '—') },
      { label: 'Contato', render: p => `${esc(p.telefone || '—')}${p.email ? `<span class="sub">${esc(p.email)}</span>` : ''}` },
      { label: 'Taxa', num: true, render: p => p.taxa_admin_pct != null ? `${p.taxa_admin_pct}%` : '<span class="muted">padrão</span>' },
      { label: 'Situação', render: p => badge(p.ativo ? 'Ativo' : 'Inativo', p.ativo ? 'sage' : 'plain') },
      { label: 'Ações', acao: p => `
        <a class="icon-btn" href="#/imoveis" title="Imóveis">${icon('home')}</a>
        <button class="icon-btn" data-docs="${p.id}" title="Documentos">${icon('folder')}</button>
        <button class="icon-btn" data-msg="${p.id}" title="Mensagem">${icon('whatsapp')}</button>
        ${podeEscrever() ? `<button class="icon-btn" data-edit="${p.id}" title="Editar">${icon('edit')}</button>` : ''}
        ${podeEscrever() ? `<button class="icon-btn" data-del="${p.id}" title="Desativar">${icon('trash')}</button>` : ''}` },
    ], filtrados);
    lista.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => abrirForm(dados.find(x => x.id === Number(b.dataset.edit))));
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const p = dados.find(x => x.id === Number(b.dataset.del));
      if (!await confirmar({ titulo: 'Desativar proprietário', mensagem: `Desativar ${p.nome}? O histórico financeiro é preservado.`, textoBotao: 'Desativar', perigo: true })) return;
      try { await api(`/proprietarios/${p.id}`, { method: 'DELETE' }); toast('Proprietário desativado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
    lista.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
      const p = dados.find(x => x.id === Number(b.dataset.docs));
      abrirDocumentos({ entidade: 'proprietarios', entidadeId: p.id, titulo: p.nome, podeEditar: podeEscrever() });
    });
    lista.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
      const p = dados.find(x => x.id === Number(b.dataset.msg));
      abrirMensagem({ entidade: 'proprietarios', entidadeId: p.id, contexto: p.nome, destinatarios: [{ nome: p.nome, telefone: p.telefone, email: p.email }] });
    });
  };
  const carregar = async () => {
    try { dados = await api('/proprietarios'); render(); } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
  const novo = root.querySelector('[data-novo]'); if (novo) novo.onclick = () => abrirForm();
  await carregar();
}

/* ============================================================
   IMÓVEIS
   ============================================================ */
export async function viewImoveis(root) {
  let busca = '';
  let dados = [];
  let props = [];
  root.innerHTML = head('Imóveis', 'Carteira, situação de ocupação e taxa por imóvel.', podeEscrever() ? `<button class="btn primary" data-novo>${icon('plus')} Novo imóvel</button>` : '')
    + `<div class="filters"><div class="search grow">${icon('search')}<input placeholder="Buscar por endereço, bairro, apelido ou proprietário" data-busca></div></div>
      <div data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');

  const campos = () => [
    { name: 'proprietario_id', label: 'Proprietário', type: 'select', required: true, options: props.filter(p => p.ativo).map(p => ({ value: p.id, label: p.nome })) },
    { name: 'apelido', label: 'Apelido', placeholder: 'Apto 302' },
    { name: 'endereco', label: 'Endereço', required: true, span: 2 },
    { name: 'numero', label: 'Número' },
    { name: 'complemento', label: 'Complemento' },
    { name: 'bairro', label: 'Bairro' },
    { name: 'cidade', label: 'Cidade' },
    { name: 'uf', label: 'UF', maxlength: 2 },
    { name: 'cep', label: 'CEP' },
    { name: 'tipo', label: 'Tipo', type: 'select', options: [['apartamento', 'Apartamento'], ['casa', 'Casa'], ['comercial', 'Comercial'], ['terreno', 'Terreno'], ['outro', 'Outro']] },
    { name: 'situacao', label: 'Situação', type: 'select', options: [['alugado', 'Alugado'], ['vago', 'Vago'], ['manutencao', 'Manutenção'], ['reservado', 'Reservado']] },
    { name: 'taxa_admin_pct', label: 'Taxa própria (%)', type: 'percent', hint: 'Vence a regra do proprietário.' },
    { name: 'documento_url', label: 'Link de documentos', span: 2 },
    { name: 'observacoes', label: 'Observações', type: 'textarea' },
    { name: 'ativo', label: 'Ativo', type: 'checkbox', checkLabel: 'Imóvel ativo', span: 2 },
  ];

  const abrirForm = (im = null) => formModal({
    titulo: im ? 'Editar imóvel' : 'Novo imóvel',
    fields: campos(),
    valores: im || { situacao: 'alugado', tipo: 'apartamento', ativo: 1 },
    wide: true,
    onSubmit: async (d) => {
      if (!d.proprietario_id) throw new Error('Escolha o proprietário.');
      if (im) await api(`/imoveis/${im.id}`, { method: 'PUT', body: d });
      else await api('/imoveis', { method: 'POST', body: d });
      toast(im ? 'Imóvel atualizado.' : 'Imóvel cadastrado.');
      carregar();
    },
  });

  const render = () => {
    const termo = busca.toLowerCase();
    const filtrados = dados.filter(i => !termo || [i.endereco, i.numero, i.bairro, i.apelido, i.proprietario_nome].some(v => String(v || '').toLowerCase().includes(termo)));
    lista.innerHTML = tableHtml([
      { label: 'Imóvel', render: i => `<strong>${esc(i.endereco)}${i.numero ? ', ' + esc(i.numero) : ''}</strong><span class="sub">${esc([i.complemento, i.bairro, i.cidade].filter(Boolean).join(' · ') || '—')}</span>` },
      { label: 'Proprietário', key: 'proprietario_nome' },
      { label: 'Tipo', render: i => esc(i.tipo || '—') },
      { label: 'Situação', render: i => badge(i.situacao, i.situacao === 'alugado' ? 'sage' : i.situacao === 'vago' ? 'plain' : 'butter') },
      { label: 'Taxa', num: true, render: i => i.taxa_admin_pct != null ? `${i.taxa_admin_pct}%` : '<span class="muted">padrão</span>' },
      { label: 'Ações', acao: i => `
        <button class="icon-btn" data-docs="${i.id}" title="Documentos">${icon('folder')}</button>
        ${podeEscrever() ? `<button class="icon-btn" data-edit="${i.id}" title="Editar">${icon('edit')}</button>` : ''}
        ${podeEscrever() ? `<button class="icon-btn" data-del="${i.id}" title="Desativar">${icon('trash')}</button>` : ''}` },
    ], filtrados);
    lista.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => abrirForm(dados.find(x => x.id === Number(b.dataset.edit))));
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const i = dados.find(x => x.id === Number(b.dataset.del));
      if (!await confirmar({ titulo: 'Desativar imóvel', mensagem: `Desativar ${i.endereco}?`, textoBotao: 'Desativar', perigo: true })) return;
      try { await api(`/imoveis/${i.id}`, { method: 'DELETE' }); toast('Imóvel desativado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
    lista.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
      const i = dados.find(x => x.id === Number(b.dataset.docs));
      abrirDocumentos({ entidade: 'imoveis', entidadeId: i.id, titulo: `${i.endereco}, ${i.numero || ''}`, podeEditar: podeEscrever() });
    });
  };
  const carregar = async () => {
    try {
      [dados, props] = await Promise.all([api('/imoveis'), api('/proprietarios')]);
      render();
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
  const novo = root.querySelector('[data-novo]'); if (novo) novo.onclick = () => abrirForm();
  await carregar();
}

/* ============================================================
   INQUILINOS
   ============================================================ */
const camposInquilino = () => [
  { name: 'nome', label: 'Nome', required: true, span: 2 },
  { name: 'cpf_cnpj', label: 'CPF/CNPJ' },
  { name: 'telefone', label: 'Telefone' },
  { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  { name: 'ativo', label: 'Ativo', type: 'checkbox', checkLabel: 'Cadastro ativo', span: 2 },
];
export async function viewInquilinos(root) {
  let busca = '';
  let dados = [];
  root.innerHTML = head('Inquilinos', 'Contatos para cobrança, mensagens e contratos.', podeEscrever() ? `<button class="btn primary" data-novo>${icon('plus')} Novo inquilino</button>` : '')
    + `<div class="filters"><div class="search grow">${icon('search')}<input placeholder="Buscar por nome, CPF, e-mail ou telefone" data-busca></div></div><div data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const abrirForm = (q = null) => formModal({
    titulo: q ? 'Editar inquilino' : 'Novo inquilino', fields: camposInquilino(),
    valores: q || { ativo: 1 },
    onSubmit: async (d) => {
      if (q) await api(`/inquilinos/${q.id}`, { method: 'PUT', body: d });
      else await api('/inquilinos', { method: 'POST', body: d });
      toast(q ? 'Inquilino atualizado.' : 'Inquilino cadastrado.'); carregar();
    },
  });
  const render = () => {
    const termo = busca.toLowerCase();
    const filtrados = dados.filter(q => !termo || [q.nome, q.cpf_cnpj, q.email, q.telefone].some(v => String(v || '').toLowerCase().includes(termo)));
    lista.innerHTML = tableHtml([
      { label: 'Nome', render: q => `<strong>${esc(q.nome)}</strong>` },
      { label: 'CPF/CNPJ', render: q => esc(q.cpf_cnpj || '—') },
      { label: 'Contato', render: q => `${esc(q.telefone || '—')}${q.email ? `<span class="sub">${esc(q.email)}</span>` : ''}` },
      { label: 'Situação', render: q => badge(q.ativo ? 'Ativo' : 'Inativo', q.ativo ? 'sage' : 'plain') },
      { label: 'Ações', acao: q => `
        <button class="icon-btn" data-docs="${q.id}" title="Documentos">${icon('folder')}</button>
        <button class="icon-btn" data-msg="${q.id}" title="Mensagem">${icon('whatsapp')}</button>
        ${podeEscrever() ? `<button class="icon-btn" data-edit="${q.id}" title="Editar">${icon('edit')}</button>` : ''}
        ${podeEscrever() ? `<button class="icon-btn" data-del="${q.id}" title="Desativar">${icon('trash')}</button>` : ''}` },
    ], filtrados);
    lista.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => abrirForm(dados.find(x => x.id === Number(b.dataset.edit))));
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const q = dados.find(x => x.id === Number(b.dataset.del));
      if (!await confirmar({ titulo: 'Desativar inquilino', mensagem: `Desativar ${q.nome}?`, textoBotao: 'Desativar', perigo: true })) return;
      try { await api(`/inquilinos/${q.id}`, { method: 'DELETE' }); toast('Inquilino desativado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
    lista.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
      const q = dados.find(x => x.id === Number(b.dataset.docs));
      abrirDocumentos({ entidade: 'inquilinos', entidadeId: q.id, titulo: q.nome, podeEditar: podeEscrever() });
    });
    lista.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
      const q = dados.find(x => x.id === Number(b.dataset.msg));
      abrirMensagem({ entidade: 'inquilinos', entidadeId: q.id, contexto: q.nome, destinatarios: [{ nome: q.nome, telefone: q.telefone, email: q.email }] });
    });
  };
  const carregar = async () => { try { dados = await api('/inquilinos'); render(); } catch (e) { lista.innerHTML = erroBox(e); } };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
  const novo = root.querySelector('[data-novo]'); if (novo) novo.onclick = () => abrirForm();
  await carregar();
}

/* ============================================================
   CONTRATOS
   ============================================================ */
export async function viewContratos(root) {
  let dados = [], imoveis = [], inquilinos = [], filtro = 'todos', busca = '';
  root.innerHTML = head('Contratos', 'Vigência, aluguel, reajuste, garantia e exceção de taxa.', `${podeEscrever() ? `<button class="btn" data-reajuste>${icon('chart')} Reajuste em lote</button>` : ''}${podeEscrever() ? `<button class="btn primary" data-novo>${icon('plus')} Novo contrato</button>` : ''}`)
    + `<div class="filters">
        <div class="search grow">${icon('search')}<input placeholder="Buscar por código, imóvel, inquilino ou proprietário" data-busca></div>
        <div class="segmented" data-filtro><button class="active" data-f="todos">Todos</button><button data-f="ativo">Ativos</button><button data-f="encerrado">Encerrados</button></div>
      </div><div data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');

  const campos = () => [
    { name: 'codigo', label: 'Código', placeholder: 'CT-001' },
    { name: 'status', label: 'Status', type: 'select', options: [['ativo', 'Ativo'], ['encerrado', 'Encerrado'], ['suspenso', 'Suspenso']] },
    { name: 'imovel_id', label: 'Imóvel', type: 'select', required: true, options: imoveis.filter(i => i.ativo).map(i => ({ value: i.id, label: `${i.endereco}${i.numero ? ', ' + i.numero : ''} — ${i.proprietario_nome}` })) },
    { name: 'inquilino_id', label: 'Inquilino', type: 'select', required: true, options: inquilinos.filter(i => i.ativo).map(i => ({ value: i.id, label: i.nome })) },
    { name: 'inicio', label: 'Início', type: 'date', required: true },
    { name: 'fim', label: 'Fim', type: 'date' },
    { name: 'aluguel_centavos', label: 'Aluguel (R$)', type: 'money', required: true },
    { name: 'dia_vencimento', label: 'Dia de vencimento', type: 'number', min: 1, step: 1 },
    { name: 'indice_reajuste', label: 'Índice', type: 'select', options: ['IGP-M', 'IPCA', 'INCC', 'IGP-DI', 'Fixo'] },
    { name: 'ultimo_reajuste', label: 'Último reajuste', type: 'date' },
    { name: 'garantia_tipo', label: 'Garantia', type: 'select', options: [['nenhuma', 'Nenhuma'], ['caucao', 'Caução'], ['fiador', 'Fiador'], ['seguro', 'Seguro fiança']] },
    { name: 'garantia_valor_centavos', label: 'Valor da garantia (R$)', type: 'money' },
    { name: 'garantia_fim', label: 'Fim da garantia', type: 'date' },
    { name: 'taxa_admin_pct', label: 'Exceção de taxa (%)', type: 'percent', hint: 'Exige justificativa. Vence imóvel, proprietário e regra geral.' },
    { name: 'justificativa_taxa', label: 'Justificativa da exceção', span: 2 },
    { name: 'documento_url', label: 'Link do contrato assinado', span: 2 },
    { name: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  ];

  const abrirForm = (c = null) => formModal({
    titulo: c ? 'Editar contrato' : 'Novo contrato', wide: true,
    fields: campos(),
    valores: c || { status: 'ativo', dia_vencimento: 5, indice_reajuste: setting('indice_reajuste_padrao', 'IGP-M'), garantia_tipo: 'nenhuma' },
    onSubmit: async (d) => {
      if (d.taxa_admin_pct != null && !d.justificativa_taxa) throw new Error('Exceção de taxa exige justificativa.');
      if (c) await api(`/contratos/${c.id}`, { method: 'PUT', body: d });
      else await api('/contratos', { method: 'POST', body: d });
      toast(c ? 'Contrato atualizado.' : 'Contrato criado.'); carregar();
    },
  });

  const abrirReajusteLote = () => {
    const camposReajuste = [
      { name: 'data', label: 'Data do reajuste', type: 'date', required: true },
      { name: 'percentual', label: 'Percentual aplicado (%)', type: 'percent', required: true },
      { name: 'indice', label: 'Índice de referência', type: 'select', options: ['IGP-M', 'IPCA', 'INCC', 'IGP-DI', 'Fixo'] },
    ];
    openModal({
      titulo: 'Reajuste em lote', subtitulo: 'Contratos com aniversário vencido — confira a prévia antes de aplicar.',
      wide: true,
      corpo: `<form data-form>${fieldsHtml(camposReajuste, { data: hojeISO(), percentual: 5, indice: setting('indice_reajuste_padrao', 'IGP-M') })}</form>
        <div class="divider"></div>
        <div data-preview>${loadingBox('Calculando prévia…')}</div>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok disabled>Aplicar reajuste</button>`,
      onMount(r, close) {
        const form = r.querySelector('[data-form]');
        const box = r.querySelector('[data-preview]');
        const ok = r.querySelector('[data-ok]');
        const atualizar = async () => {
          try {
            const dados = collectForm(form, camposReajuste.map(f => ({ ...f, required: false })));
            const qs = new URLSearchParams({ data: dados.data || hojeISO(), percentual: dados.percentual ?? 0, indice: dados.indice || '' });
            const previa = await api(`/contratos/reajuste/preview?${qs}`);
            box.innerHTML = previa.linhas.length ? tableHtml([
              { label: '', render: l => `<input type="checkbox" data-id value="${l.contrato_id}" checked aria-label="Incluir">` },
              { label: 'Contrato', render: l => `<strong>${esc(l.codigo)}</strong><span class="sub">${esc(l.imovel)}</span>` },
              { label: 'Aniversário', render: l => dataBR(l.aniversario) },
              { label: 'Aluguel atual', num: true, render: l => brl(l.aluguel_atual_centavos) },
              { label: 'Novo aluguel', num: true, render: l => `<strong>${brl(l.aluguel_novo_centavos)}</strong><span class="sub">+${brl(l.diferenca_centavos)}</span>` },
            ], previa.linhas) + `<p class="small muted mt-2">${previa.resumo.contratos} contrato(s): ${previa.resumo.total_atual} → ${previa.resumo.total_novo} (${previa.resumo.diferenca}).</p>`
              : `<div class="notice">Nenhum contrato com aniversário vencido nessa data. Ajuste a data ou o percentual.</div>`;
            ok.disabled = !previa.linhas.length;
          } catch (e) { box.innerHTML = erroBox(e); ok.disabled = true; }
        };
        form.addEventListener('change', atualizar);
        form.addEventListener('input', () => { clearTimeout(window.__reajT); window.__reajT = setTimeout(atualizar, 400); });
        ok.onclick = async () => {
          const ids = [...r.querySelectorAll('[data-id]:checked')].map(el => Number(el.value));
          if (!ids.length) return toast('Selecione ao menos um contrato.', 'err');
          try {
            const d = collectForm(form, camposReajuste);
            const res = await api('/contratos/reajustar-lote', { method: 'POST', body: { ...d, contrato_ids: ids } });
            toast(`${res.aplicados.length} contrato(s) reajustado(s). Cobranças em aberto atualizadas.`);
            close(); carregar();
          } catch (e) { toast(e.message, 'err'); }
        };
        atualizar();
      },
    });
  };

  const abrirRescisao = (c) => formModal({
    titulo: 'Rescisão de contrato', subtitulo: `${c.codigo || '#' + c.id} — ${c.endereco}`,
    fields: [
      { name: 'data', label: 'Data da rescisão', type: 'date', required: true },
      { name: 'motivo', label: 'Motivo', required: true, placeholder: 'Devolução do imóvel, acordo…' },
      { name: 'multa_centavos', label: 'Multa rescisória (R$)', type: 'money' },
      { name: 'devolver_caucao', label: 'Devolver caução descontando a multa', type: 'checkbox', checkLabel: 'Gerar conta a pagar da devolução da caução' },
      { name: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
    ],
    valores: { data: hojeISO(), devolver_caucao: c.garantia_tipo === 'caucao' ? 1 : 0 },
    textoBotao: 'Confirmar rescisão',
    onSubmit: async (d) => {
      const res = await api(`/contratos/${c.id}/rescindir`, { method: 'POST', body: d });
      toast(`Contrato encerrado. ${res.cobrancas_canceladas.length} cobrança(s) futura(s) cancelada(s)${res.caucao_devolucao_centavos ? ' e devolução de caução gerada' : ''}.`);
      carregar();
    },
  });

  const render = () => {
    const termo = busca.toLowerCase();
    const filtrados = dados.filter(c => (filtro === 'todos' || c.status === filtro)
      && (!termo || [c.codigo, c.endereco, c.inquilino_nome, c.proprietario_nome].some(v => String(v || '').toLowerCase().includes(termo))));
    lista.innerHTML = tableHtml([
      { label: 'Contrato', render: c => `<strong>${esc(c.codigo || '#' + c.id)}</strong><span class="sub">${dataBR(c.inicio)} → ${c.fim ? dataBR(c.fim) : 'sem fim'}</span>` },
      { label: 'Imóvel', render: c => `${esc(c.endereco)}${c.numero ? ', ' + esc(c.numero) : ''}<span class="sub">${esc(c.proprietario_nome)}</span>` },
      { label: 'Inquilino', key: 'inquilino_nome' },
      { label: 'Aluguel', num: true, render: c => `<strong>${brl(c.aluguel_centavos)}</strong><span class="sub">dia ${c.dia_vencimento}</span>` },
      { label: 'Taxa', num: true, render: c => c.taxa_admin_pct != null ? `${c.taxa_admin_pct}% <span class="badge butter">exceção</span>` : '<span class="muted">regra</span>' },
      { label: 'Status', render: c => badge(c.status, c.status === 'ativo' ? 'sage' : c.status === 'encerrado' ? 'plain' : 'butter') },
      { label: 'Ações', acao: c => `
        <button class="icon-btn" data-docs="${c.id}" title="Documentos">${icon('folder')}</button>
        <button class="icon-btn" data-msg="${c.id}" title="Mensagem">${icon('whatsapp')}</button>
        <a class="icon-btn" href="#/cobrancas?contrato=${c.id}" title="Cobranças">${icon('receipt')}</a>
        ${podeEscrever() ? `<button class="icon-btn" data-edit="${c.id}" title="Editar">${icon('edit')}</button>` : ''}
        ${podeEscrever() && c.status === 'ativo' ? `<button class="icon-btn" data-rescindir="${c.id}" title="Rescindir">${icon('alert')}</button>` : ''}
        ${podeEscrever() && c.status === 'ativo' ? `<button class="icon-btn" data-del="${c.id}" title="Encerrar">${icon('x')}</button>` : ''}` },
    ], filtrados);
    lista.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => abrirForm(dados.find(x => x.id === Number(b.dataset.edit))));
    lista.querySelectorAll('[data-rescindir]').forEach(b => b.onclick = () => abrirRescisao(dados.find(x => x.id === Number(b.dataset.rescindir))));
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const c = dados.find(x => x.id === Number(b.dataset.del));
      if (!await confirmar({ titulo: 'Encerrar contrato', mensagem: `Encerrar ${c.codigo || '#' + c.id}? O histórico é mantido e o contrato sai das novas cobranças.`, textoBotao: 'Encerrar', perigo: true })) return;
      try { await api(`/contratos/${c.id}`, { method: 'DELETE' }); toast('Contrato encerrado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
    lista.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
      const c = dados.find(x => x.id === Number(b.dataset.docs));
      abrirDocumentos({ entidade: 'contratos', entidadeId: c.id, titulo: `${c.codigo || '#' + c.id} — ${c.endereco}`, podeEditar: podeEscrever() });
    });
    lista.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
      const c = dados.find(x => x.id === Number(b.dataset.msg));
      abrirMensagem({
        entidade: 'contratos', entidadeId: c.id, contexto: `${c.codigo || '#' + c.id} — ${c.endereco}`,
        destinatarios: [
          { nome: c.inquilino_nome, telefone: c.inquilino_telefone, email: c.inquilino_email, imovel: c.endereco, indice: c.indice_reajuste, data: c.ultimo_reajuste },
          { nome: c.proprietario_nome, telefone: c.proprietario_telefone, email: c.proprietario_email, imovel: c.endereco },
        ],
      });
    });
  };
  const carregar = async () => {
    try {
      [dados, imoveis, inquilinos] = await Promise.all([api('/contratos'), api('/imoveis'), api('/inquilinos')]);
      render();
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
  root.querySelectorAll('[data-filtro] button').forEach(b => b.onclick = () => {
    filtro = b.dataset.f;
    root.querySelectorAll('[data-filtro] button').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
  const novo = root.querySelector('[data-novo]'); if (novo) novo.onclick = () => abrirForm();
  root.querySelector('[data-reajuste]')?.addEventListener('click', abrirReajusteLote);
  await carregar();
}

/* ============================================================
   EXCEÇÕES
   ============================================================ */
export async function viewExcecoes(root) {
  let dados = [], contratos = [];
  root.innerHTML = head('Exceções de repasse', 'Descontos e acréscimos pontuais por competência, sempre com motivo.', podeEscrever() ? `<button class="btn primary" data-novo>${icon('plus')} Nova exceção</button>` : '')
    + `<div class="notice info">A exceção vale somente para a competência informada e não altera o snapshot de repasses já pagos.</div><div class="mt-2" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const campos = () => [
    { name: 'contrato_id', label: 'Contrato', type: 'select', required: true, options: contratos.map(c => ({ value: c.id, label: `${c.codigo || '#' + c.id} — ${c.endereco} (${c.inquilino_nome})` })) },
    { name: 'competencia', label: 'Competência', type: 'month', required: true },
    { name: 'tipo', label: 'Tipo', type: 'select', options: [['desconto', 'Desconto'], ['acrescimo', 'Acréscimo']] },
    { name: 'valor_centavos', label: 'Valor (R$)', type: 'money', required: true },
    { name: 'motivo', label: 'Motivo', span: 2, required: true, placeholder: 'Ex.: reparo aprovado pelo proprietário' },
  ];
  const abrirForm = () => formModal({
    titulo: 'Nova exceção', fields: campos(), valores: { competencia: compAtual(), tipo: 'desconto' },
    onSubmit: async (d) => { await api('/excecoes', { method: 'POST', body: d }); toast('Exceção registrada.'); carregar(); },
  });
  const render = () => {
    lista.innerHTML = tableHtml([
      { label: 'Competência', render: e => compBR(e.competencia) },
      { label: 'Contrato', render: e => `${esc(e.codigo || '#' + e.contrato_id)}<span class="sub">${esc(e.endereco || '')}${e.numero ? ', ' + esc(e.numero) : ''}</span>` },
      { label: 'Proprietário', key: 'proprietario_nome' },
      { label: 'Tipo', render: e => badge(e.tipo, e.tipo === 'desconto' ? 'blush' : 'sage') },
      { label: 'Valor', num: true, render: e => brl(e.valor_centavos) },
      { label: 'Motivo', render: e => esc(e.motivo) },
      { label: 'Ações', acao: e => podeEscrever() ? `<button class="icon-btn" data-del="${e.id}" title="Excluir">${icon('trash')}</button>` : '' },
    ], dados);
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmar({ titulo: 'Excluir exceção', mensagem: 'A exceção será removida e o repasse recalculado. Continuar?', textoBotao: 'Excluir', perigo: true })) return;
      try { await api(`/excecoes/${b.dataset.del}`, { method: 'DELETE' }); toast('Exceção excluída.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
  };
  const carregar = async () => { try { [dados, contratos] = await Promise.all([api('/excecoes'), api('/contratos')]); render(); } catch (e) { lista.innerHTML = erroBox(e); } };
  const novo = root.querySelector('[data-novo]'); if (novo) novo.onclick = abrirForm;
  await carregar();
}

/* ============================================================
   GERAR COBRANÇAS (compartilhado com painel)
   ============================================================ */
export async function abrirGerarCobrancas(aoConcluir) {
  let comp = compAtual();
  const { root, close } = openModal({
    titulo: 'Gerar competência', subtitulo: 'Cria uma cobrança por contrato ativo, com prévia e idempotência.',
    wide: true,
    corpo: `<div class="filters"><label class="field"><span>Competência</span><input type="month" data-comp value="${comp}"></label><button class="btn" data-previa>Ver prévia</button></div><div data-preview>${loadingBox()}</div>`,
    rodape: `<button class="btn" data-close>Fechar</button><button class="btn primary" data-gerar disabled>Gerar cobranças</button>`,
  });
  const preview = root.querySelector('[data-preview]');
  const btn = root.querySelector('[data-gerar]');
  let atual = null;
  const carregar = async () => {
    comp = root.querySelector('[data-comp]').value || comp;
    preview.innerHTML = loadingBox('Calculando prévia…');
    btn.disabled = true;
    try {
      atual = await api(`/cobrancas/gerar/preview?competencia=${comp}`);
      preview.innerHTML = `
        <div class="grid cols-3">
          <div class="notice info"><strong>${atual.novos}</strong> novas cobranças</div>
          <div class="notice"><strong>${atual.ja_existem}</strong> já existem</div>
          <div class="notice ${atual.sem_valor ? 'danger' : ''}"><strong>${atual.sem_valor}</strong> sem valor</div>
        </div>
        ${atual.fechado ? '<div class="notice danger mt-2">Competência fechada: não é possível gerar.</div>' : ''}
        <div class="mt-2">${tableHtml([
          { label: 'Contrato', render: l => `${esc(l.codigo || '#' + l.contrato_id)}` },
          { label: 'Imóvel', render: l => `${esc(l.imovel)}<span class="sub">${esc(l.inquilino)}</span>` },
          { label: 'Vencimento', render: l => dataBR(l.vencimento) },
          { label: 'Valor', num: true, render: l => brl(l.valor_centavos) },
          { label: 'Status', render: l => badge(l.status === 'novo' ? 'Novo' : l.status === 'ja_existe' ? 'Já existe' : 'Sem valor', l.status === 'novo' ? 'sage' : l.status === 'ja_existe' ? 'plain' : 'blush') },
        ], atual.linhas)}</div>`;
      btn.disabled = !atual.novos || atual.fechado;
    } catch (e) { preview.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-comp]').onchange = carregar;
  root.querySelector('[data-previa]').onclick = carregar;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await api('/cobrancas/gerar', { method: 'POST', body: { competencia: comp } });
      toast(`${r.criadas} cobrança(s) geradas.`);
      close();
      aoConcluir?.();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
  await carregar();
}
