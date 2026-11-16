/* Telas financeiras, documentos, relatórios e administração. */
import {
  $, esc, brl, brlShort, api, state, setting, icon, badge, badgeCobranca, tableHtml,
  emptyState, loadingBox, erroBox, toast, openModal, closeModal, confirmar, confirmarTexto,
  formModal, dataBR, compBR, compAtual, addMesesComp, hojeISO, lerArquivo, download,
  abrirDocumentos, abrirMensagem, baixarArquivo, fieldsHtml, collectForm, setting as cfg,
} from './core.js';
import { hbar, barChart, donut, moneyShort } from './charts.js';
import { abrirGerarCobrancas } from './views.js';

const podeEscrever = () => ['admin', 'operador'].includes(state.user?.papel);
const podeFinanceiro = () => ['admin', 'operador'].includes(state.user?.papel);
const isAdmin = () => state.user?.papel === 'admin';

function head(titulo, texto, acoes = '') {
  return `<div class="section-head"><div><h2>${esc(titulo)}</h2>${texto ? `<p>${esc(texto)}</p>` : ''}</div><div class="section-actions">${acoes}</div></div>`;
}
const stat = (rotulo, valor, tom = '') => `<div class="kpi"><div class="kpi-label">${esc(rotulo)}</div><div class="kpi-value" ${tom ? `style="color:var(--${tom})"` : ''}>${valor}</div></div>`;

/* ============================================================
   COBRANÇAS
   ============================================================ */
export async function viewCobrancas(root, params) {
  let comp = params?.get('competencia') || compAtual();
  let status = 'abertas';
  let busca = params?.get('busca') || '';
  const contrato = params?.get('contrato') || '';
  let resumo = null;

  root.innerHTML = head('Cobranças', 'Geração mensal, baixa, encargos e régua de cobrança.', `
      ${podeFinanceiro() ? `<button class="btn" data-gerar>${icon('plus')} Gerar competência</button>` : ''}
      ${podeFinanceiro() ? `<button class="btn" data-exportar>${icon('download')} CSV</button>` : ''}`) +
    `<div data-resumo>${loadingBox()}</div>
     <div class="filters mt-2">
       <label class="field"><span>Competência</span><input type="month" data-comp value="${comp}"></label>
       <label class="field"><span>Status</span><select data-status>
         <option value="abertas">Em aberto</option><option value="vencidas">Vencidas</option>
         <option value="pagas">Pagas</option><option value="">Todas</option>
         <option value="em_cobranca">Em cobrança</option><option value="promessa">Promessa</option>
         <option value="acordo">Acordo</option><option value="juridico">Jurídico</option>
       </select></label>
       <div class="search grow">${icon('search')}<input placeholder="Buscar inquilino, proprietário ou imóvel" data-busca value="${esc(busca)}"></div>
       ${contrato ? `<span class="badge sky">Contrato #${esc(contrato)} <button class="link" data-limpar style="color:inherit">limpar</button></span>` : ''}
     </div>
     <div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const painel = root.querySelector('[data-resumo]');

  const renderResumo = () => {
    if (!resumo) return;
    const aging = resumo.aging_valores || {};
    painel.innerHTML = `<div class="kpis">
      ${stat('Em aberto', brl(resumo.valor_aberto))}
      ${stat('Vencido', brl(resumo.valor_vencido), 'blush-ink')}
      ${stat('Pago na competência', brl(resumo.valor_pago), 'sage-ink')}
      ${stat('Cobranças abertas', String(resumo.abertas))}
      ${stat('Vencidas', String(resumo.vencidas), 'blush-ink')}
      ${stat('Competência', compBR(comp))}
    </div>
    <div class="card mt-2"><div class="card-head"><div><h3>Aging de inadimplência</h3><p>Saldo vencido por faixa</p></div></div>
      <div class="card-body">${hbar([
        { nome: '0–30 dias', valor: aging['0-30'] || 0, cor: '#a8c3b0' },
        { nome: '31–60 dias', valor: aging['31-60'] || 0, cor: '#ead9a8' },
        { nome: '61–90 dias', valor: aging['61-90'] || 0, cor: '#efc9a8' },
        { nome: '90+ dias', valor: aging['90+'] || 0, cor: '#e5b8b0' },
      ], { formato: brlShort, cor: '#8a4238' })}</div></div>`;
  };

  const abrirPagar = (c) => {
    const saldo = c.saldo_centavos;
    const fields = [
      { name: 'valor_centavos', label: 'Valor recebido (R$)', type: 'money', required: true },
      { name: 'data', label: 'Data do pagamento', type: 'date', required: true },
      { name: 'forma', label: 'Forma', type: 'select', options: [['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cartao', 'Cartão']] },
      { name: 'desconto_centavos', label: 'Desconto adicional (R$)', type: 'money' },
      { name: 'observacao', label: 'Observação', type: 'textarea', span: 2 },
    ];
    openModal({
      titulo: 'Dar baixa', subtitulo: `${c.inquilino_nome} · ${compBR(c.competencia)} · saldo ${brl(saldo)}`,
      corpo: `<div class="notice info" style="margin-bottom:14px">Multa de ${brl(c.multa_calculada_centavos)} e juros de ${brl(c.juros_calculados_centavos)} (${c.dias_atraso} dia(s) de atraso) entram no cálculo.</div>
        <form data-form>${fieldsHtml(fields, { valor_centavos: saldo, data: hojeISO(), forma: 'pix' })}<div class="form-error mt-2" data-erro hidden></div></form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Confirmar baixa</button>`,
      onMount(r, close) {
        r.querySelector('[data-ok]').onclick = async () => {
          const err = r.querySelector('[data-erro]');
          err.hidden = true;
          try {
            const d = collectForm(r.querySelector('[data-form]'), fields);
            await api(`/cobrancas/${c.id}/pagar`, { method: 'POST', body: d });
            toast('Baixa registrada e receita lançada no caixa dos proprietários.');
            close(); carregar();
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        };
      },
    });
  };

  const abrirAcao = (c) => {
    const fields = [
      { name: 'tipo', label: 'Tipo de contato', type: 'select', options: [['lembrete', 'Lembrete enviado'], ['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['promessa', 'Promessa de pagamento'], ['acordo', 'Acordo'], ['juridico', 'Encaminhado ao jurídico'], ['observacao', 'Observação']] },
      { name: 'cobranca_status', label: 'Status da régua', type: 'select', options: [['em_cobranca', 'Em cobrança'], ['promessa', 'Promessa'], ['acordo', 'Acordo'], ['juridico', 'Jurídico']], placeholder: 'Manter atual' },
      { name: 'responsavel', label: 'Responsável' },
      { name: 'proxima_data', label: 'Próxima ação em', type: 'date' },
      { name: 'descricao', label: 'Histórico / observação', type: 'textarea', span: 2 },
      { name: 'proxima_acao', label: 'Próxima ação', span: 2, placeholder: 'Ex.: ligar novamente' },
    ];
    openModal({
      titulo: 'Régua de cobrança', subtitulo: `${c.inquilino_nome} · ${brl(c.saldo_centavos)} em aberto`,
      wide: true,
      corpo: `<form data-form>${fieldsHtml(fields, { responsavel: state.user.nome })}<div class="form-error mt-2" data-erro hidden></div></form>
        ${(c.acoes || []).length ? `<div class="divider"></div><h3 style="margin-bottom:8px">Histórico</h3><div class="timeline">${c.acoes.map(a => `<div class="tl-item"><span class="tl-dot"></span><div><p><strong>${esc(a.tipo)}</strong> ${esc(a.descricao || '')}</p><small>${esc(a.responsavel || '')} · ${esc((a.criado_em || '').replace('T', ' ').slice(0, 16))}${a.proxima_data ? ` · próxima ${dataBR(a.proxima_data)}` : ''}</small></div></div>`).join('')}</div>` : ''}`,
      rodape: `<button class="btn" data-close>Fechar</button><button class="btn primary" data-ok>Registrar ação</button>`,
      onMount(r, close) {
        r.querySelector('[data-ok]').onclick = async () => {
          const err = r.querySelector('[data-erro]'); err.hidden = true;
          try {
            const d = collectForm(r.querySelector('[data-form]'), fields);
            await api(`/cobrancas/${c.id}/acao`, { method: 'POST', body: d });
            toast('Ação registrada.'); close(); carregar();
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        };
      },
    });
  };

  const abrirDetalhe = async (id) => {
    try {
      const c = await api(`/cobrancas/${id}`);
      openModal({
        titulo: 'Cobrança', subtitulo: `${c.contrato_codigo || '#' + c.contrato_id} · ${compBR(c.competencia)}`,
        wide: true,
        corpo: `
          <div class="grid cols-2">
            <div class="card"><div class="card-body">
              <dl class="dl">
                <dt>Inquilino</dt><dd>${esc(c.inquilino_nome)}</dd>
                <dt>Imóvel</dt><dd>${esc(c.endereco)}${c.numero ? ', ' + esc(c.numero) : ''}</dd>
                <dt>Proprietário</dt><dd>${esc(c.proprietario_nome)}</dd>
                <dt>Vencimento</dt><dd>${dataBR(c.vencimento)}${c.dias_atraso ? ` (+${c.dias_atraso} dias)` : ''}</dd>
                <dt>Status</dt><dd>${badgeCobranca(c.status_efetivo)}</dd>
              </dl>
            </div></div>
            <div class="card"><div class="card-body">
              <dl class="dl">
                <dt>Valor original</dt><dd>${brl(c.valor_original_centavos)}</dd>
                <dt>Multa</dt><dd>${brl(c.multa_calculada_centavos)}</dd>
                <dt>Juros</dt><dd>${brl(c.juros_calculados_centavos)}</dd>
                <dt>Desconto</dt><dd>${brl(c.desconto_centavos)}</dd>
                <dt>Pago</dt><dd>${brl(c.valor_pago_centavos)}</dd>
                <dt><strong>Saldo</strong></dt><dd><strong>${brl(c.saldo_centavos)}</strong></dd>
              </dl>
            </div></div>
          </div>
          ${(c.pagamentos || []).length ? `<div class="card mt-2"><div class="card-head"><h3>Pagamentos</h3></div><div class="card-body">${c.pagamentos.map(p => `<div class="doc"><div class="doc-ico">${icon('wallet')}</div><div class="doc-meta"><strong>${brl(p.valor_centavos)}</strong><small>${dataBR(p.data)} · ${esc(p.descricao || '')} · ${esc(p.status)}</small></div></div>`).join('')}</div></div>` : ''}`,
        rodape: `${podeFinanceiro() && c.status !== 'pago' && c.status !== 'cancelado' ? `<button class="btn soft" data-baixa>Dar baixa</button><button class="btn" data-acao>Régua</button>` : ''}
          ${podeFinanceiro() && c.status !== 'pago' && c.status !== 'cancelado' ? `<button class="btn danger" data-cancelar>Cancelar</button>` : ''}
          ${c.status === 'pago' ? `<button class="btn" data-estornar>Estornar baixa</button>` : ''}
          <button class="btn" data-close>Fechar</button>`,
        onMount(r, close) {
          r.querySelector('[data-baixa]')?.addEventListener('click', () => { close(); abrirPagar(c); });
          r.querySelector('[data-acao]')?.addEventListener('click', () => { close(); abrirAcao(c); });
          r.querySelector('[data-cancelar]')?.addEventListener('click', async () => {
            const motivo = prompt('Motivo do cancelamento:');
            if (!motivo) return;
            try { await api(`/cobrancas/${c.id}/cancelar`, { method: 'POST', body: { motivo } }); toast('Cobrança cancelada.'); close(); carregar(); } catch (e) { toast(e.message, 'err'); }
          });
          r.querySelector('[data-estornar]')?.addEventListener('click', async () => {
            const motivo = prompt('Motivo do estorno:');
            if (!motivo) return;
            try { await api(`/cobrancas/${c.id}/estornar`, { method: 'POST', body: { motivo } }); toast('Baixa estornada.'); close(); carregar(); } catch (e) { toast(e.message, 'err'); }
          });
        },
      });
    } catch (e) { toast(e.message, 'err'); }
  };

  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try {
      const qs = new URLSearchParams({ competencia: comp, status });
      if (busca) qs.set('busca', busca);
      if (contrato) qs.set('contrato_id', contrato);
      const [cobrancas, res] = await Promise.all([
        api(`/cobrancas?${qs}`),
        api(`/cobrancas/resumo?competencia=${comp}`),
      ]);
      resumo = res;
      renderResumo();
      lista.innerHTML = tableHtml([
        { label: 'Inquilino / imóvel', render: c => `<strong>${esc(c.inquilino_nome)}</strong><span class="sub">${esc(c.endereco)}${c.numero ? ', ' + esc(c.numero) : ''} · ${esc(c.contrato_codigo || '#' + c.contrato_id)}</span>` },
        { label: 'Competência', render: c => compBR(c.competencia) },
        { label: 'Vencimento', render: c => `${dataBR(c.vencimento)}${c.dias_atraso ? `<span class="sub" style="color:var(--blush-ink)">${c.dias_atraso} dias</span>` : ''}` },
        { label: 'Valor', num: true, render: c => brl(c.valor_original_centavos) },
        { label: 'Saldo', num: true, render: c => `<strong>${brl(c.saldo_centavos)}</strong>${c.valor_pago_centavos ? `<span class="sub">pago ${brl(c.valor_pago_centavos)}</span>` : ''}` },
        { label: 'Status', render: c => badgeCobranca(c.status_efetivo) },
        { label: 'Ações', acao: c => `
          <button class="icon-btn" data-detalhe="${c.id}" title="Detalhe">${icon('eye')}</button>
          ${podeFinanceiro() && c.status !== 'pago' && c.status !== 'cancelado' ? `<button class="icon-btn" data-pagar="${c.id}" title="Dar baixa">${icon('check')}</button>` : ''}
          ${podeFinanceiro() ? `<button class="icon-btn" data-acao="${c.id}" title="Régua">${icon('bell')}</button>` : ''}` },
      ], cobrancas);
      lista.querySelectorAll('[data-detalhe]').forEach(b => b.onclick = () => abrirDetalhe(Number(b.dataset.detalhe)));
      lista.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => abrirPagar(cobrancas.find(x => x.id === Number(b.dataset.pagar))));
      lista.querySelectorAll('[data-acao]').forEach(b => b.onclick = () => {
        const c = cobrancas.find(x => x.id === Number(b.dataset.acao));
        api(`/cobrancas/${c.id}`).then(full => abrirAcao(full)).catch(e => toast(e.message, 'err'));
      });
    } catch (e) { lista.innerHTML = erroBox(e); }
  };

  root.querySelector('[data-comp]').onchange = (e) => { comp = e.target.value; carregar(); };
  root.querySelector('[data-status]').onchange = (e) => { status = e.target.value; carregar(); };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; clearTimeout(window.__cobT); window.__cobT = setTimeout(carregar, 350); });
  root.querySelector('[data-limpar]')?.addEventListener('click', () => { location.hash = '#/cobrancas'; });
  root.querySelector('[data-gerar]')?.addEventListener('click', () => abrirGerarCobrancas(carregar));
  root.querySelector("[data-exportar]")?.addEventListener("click", () => download(`/export/lancamentos?competencia=${comp}`));
  await carregar();
}

/* ============================================================
   CONCILIAÇÃO
   ============================================================ */
export async function viewConciliacao(root) {
  let status = 'pendente';
  let resumo = null;
  root.innerHTML = head('Conciliação bancária', 'Importe OFX ou CSV/Excel; o sistema sugere o vínculo e você confirma.', `
      ${podeFinanceiro() ? `<label class="btn primary">${icon('upload')} Importar extrato<input type="file" data-arquivo accept=".ofx,.csv,.xlsx,.xls" hidden></label>` : ''}`) +
    `<div class="notice info">Nada é conciliado automaticamente. Duplicidades são detectadas por FITID ou data + valor + descrição.</div>
     <div class="mt-2" data-resumo></div>
     <div class="tabs mt-2" data-tabs><button class="active" data-s="pendente">Pendentes</button><button data-s="conciliado">Conciliados</button><button data-s="ignorado">Ignorados</button></div>
     <div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const painel = root.querySelector('[data-resumo]');

  const renderResumo = () => {
    if (!resumo) return;
    painel.innerHTML = `<div class="kpis">
      ${stat('Pendentes', String(resumo.pendentes || 0))}
      ${stat('Conciliados', String(resumo.conciliados || 0))}
      ${stat('Entradas pendentes', brl(resumo.entradas || 0), 'sage-ink')}
      ${stat('Saídas pendentes', brl(resumo.saidas || 0), 'blush-ink')}
    </div>`;
  };

  const criarLancamento = (t) => {
    const fields = [
      { name: 'tipo', label: 'Tipo', type: 'select', options: [['receita', 'Receita'], ['despesa', 'Despesa']] },
      { name: 'caixa', label: 'Caixa', type: 'select', options: [['proprietarios', 'Proprietários'], ['imobiliaria', 'Imobiliária']] },
      { name: 'competencia', label: 'Competência', type: 'month', required: true },
      { name: 'categoria', label: 'Categoria', required: true, placeholder: 'Aluguel, Taxa, Manutenção…' },
      { name: 'descricao', label: 'Descrição', span: 2 },
    ];
    openModal({
      titulo: 'Criar lançamento', subtitulo: `${dataBR(t.data)} · ${brl(Math.abs(t.valor_centavos))}`,
      corpo: `<form data-form>${fieldsHtml(fields, { tipo: t.valor_centavos > 0 ? 'receita' : 'despesa', caixa: t.valor_centavos > 0 ? 'proprietarios' : 'imobiliaria', competencia: t.data.slice(0, 7), descricao: t.descricao })}<div class="form-error mt-2" data-erro hidden></div></form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Criar e conciliar</button>`,
      onMount(r, close) {
        r.querySelector('[data-ok]').onclick = async () => {
          const err = r.querySelector('[data-erro]'); err.hidden = true;
          try {
            const d = collectForm(r.querySelector('[data-form]'), fields);
            await api(`/conciliacao/${t.id}/confirmar`, { method: 'POST', body: { acao: 'lancamento', lancamento: d } });
            toast('Lançamento criado e transação conciliada.'); close(); carregar();
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        };
      },
    });
  };

  const importar = async (file) => {
    const base64 = await lerArquivo(file);
    const enviar = async (mapeamento) => api('/conciliacao/preview', { method: 'POST', body: { nome: file.name, arquivo_base64: base64, mapeamento } });
    try {
      let r = await enviar(null);
      if (r.precisa_mapeamento) {
        const cols = r.colunas || [];
        const opts = cols.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('');
        const sug = r.sugestao || {};
        openModal({
          titulo: 'Mapear colunas do CSV', subtitulo: 'Indique qual coluna contém data, valor e descrição.',
          corpo: `<div class="grid-3">
            <label class="field"><span>Data</span><select data-mapa="data"><option value="">Selecione…</option>${opts.replace(`value="${sug.data}"`, `value="${sug.data}" selected`)}</select></label>
            <label class="field"><span>Valor</span><select data-mapa="valor"><option value="">Selecione…</option>${opts.replace(`value="${sug.valor}"`, `value="${sug.valor}" selected`)}</select></label>
            <label class="field"><span>Descrição</span><select data-mapa="descricao"><option value="">Selecione…</option>${opts.replace(`value="${sug.descricao}"`, `value="${sug.descricao}" selected`)}</select></label>
          </div>
          <div class="form-note mt-2">Amostra: ${esc(JSON.stringify(r.amostra || []).slice(0, 300))}</div>
          <div class="form-error mt-2" data-erro hidden></div>`,
          rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Importar</button>`,
          onMount(mr, close) {
            mr.querySelector('[data-ok]').onclick = async () => {
              const err = mr.querySelector('[data-erro]'); err.hidden = true;
              const mapeamento = {};
              mr.querySelectorAll('[data-mapa]').forEach(s => { if (s.value !== '') mapeamento[s.dataset.mapa] = Number(s.value); });
              try {
                const r2 = await enviar(mapeamento);
                toast(`${r2.importadas} transação(ões) importadas, ${r2.duplicadas} duplicadas.`, r2.importadas ? 'ok' : 'err');
                close(); carregar();
              } catch (e) { err.hidden = false; err.textContent = e.message; }
            };
          },
        });
        return;
      }
      toast(`${r.importadas} transação(ões) importadas, ${r.duplicadas} duplicadas.`, r.importadas ? 'ok' : 'err');
      carregar();
    } catch (e) { toast(e.message, 'err'); }
  };

  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try {
      const [rows, res] = await Promise.all([api(`/conciliacao?status=${status}`), api('/conciliacao/resumo')]);
      resumo = res; renderResumo();
      lista.innerHTML = tableHtml([
        { label: 'Data', render: t => dataBR(t.data) },
        { label: 'Descrição', render: t => esc(t.descricao || '—') },
        { label: 'Valor', num: true, render: t => `<span style="color:${t.valor_centavos >= 0 ? 'var(--sage-ink)' : 'var(--blush-ink)'}">${brl(t.valor_centavos)}</span>` },
        { label: 'Sugestão', render: t => t.sugestao_label ? `${esc(t.sugestao_label)}${t.confianca ? `<span class="sub">confiança ${t.confianca}%</span>` : ''}` : '<span class="muted">sem sugestão</span>' },
        { label: 'Status', render: t => badge(t.status, t.status === 'conciliado' ? 'sage' : t.status === 'ignorado' ? 'plain' : 'butter') },
        { label: 'Ações', acao: t => t.status !== 'pendente' ? '<span class="muted small">tratada</span>' : `
          ${t.sugestao_tipo ? `<button class="btn sm soft" data-conciliar="${t.id}">Conciliar</button>` : ''}
          <button class="btn sm" data-lancar="${t.id}">Lançar</button>
          <button class="icon-btn" data-ignorar="${t.id}" title="Ignorar">${icon('x')}</button>` },
      ], rows);
      const porId = new Map(rows.map(r => [r.id, r]));
      lista.querySelectorAll('[data-conciliar]').forEach(b => b.onclick = async () => {
        const t = porId.get(Number(b.dataset.conciliar));
        const acao = t.sugestao_tipo === 'cobranca' ? 'cobranca' : t.sugestao_tipo === 'repasse' ? 'repasse' : 'vincular-lancamento';
        try {
          await api(`/conciliacao/${t.id}/confirmar`, { method: 'POST', body: { acao, cobranca_id: t.sugestao_id, repasse_id: t.sugestao_id, lancamento: { lancamento_id: t.sugestao_id } } });
          toast('Transação conciliada.'); carregar();
        } catch (e) { toast(e.message, 'err'); }
      });
      lista.querySelectorAll('[data-lancar]').forEach(b => b.onclick = () => criarLancamento(porId.get(Number(b.dataset.lancar))));
      lista.querySelectorAll('[data-ignorar]').forEach(b => b.onclick = async () => {
        if (!await confirmar({ titulo: 'Ignorar transação', mensagem: 'A transação sai da fila de pendências sem gerar lançamento. Continuar?', textoBotao: 'Ignorar' })) return;
        try { await api(`/conciliacao/${b.dataset.ignorar}/confirmar`, { method: 'POST', body: { acao: 'ignorar' } }); toast('Transação ignorada.'); carregar(); } catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-arquivo]')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    await importar(f); e.target.value = '';
  });
  root.querySelectorAll('[data-tabs] button').forEach(b => b.onclick = () => {
    status = b.dataset.s;
    root.querySelectorAll('[data-tabs] button').forEach(x => x.classList.toggle('active', x === b));
    carregar();
  });
  await carregar();
}

/* ============================================================
   LANÇAMENTOS
   ============================================================ */
export async function viewLancamentos(root) {
  let comp = compAtual(), caixa = '', tipo = '', dados = [], saldos = null;
  let props = [], imoveis = [], contratos = [];
  root.innerHTML = head('Lançamentos', 'Dois caixas separados, correção por estorno e fechamento mensal.', `
      ${podeFinanceiro() ? `<button class="btn primary" data-novo>${icon('plus')} Novo lançamento</button>` : ''}
      ${podeFinanceiro() ? `<button class="btn" data-exportar>${icon('download')} CSV</button>` : ''}`) +
    `<div data-saldos>${loadingBox()}</div>
     <div class="filters mt-2">
       <label class="field"><span>Competência</span><input type="month" data-comp value="${comp}"></label>
       <label class="field"><span>Caixa</span><select data-caixa><option value="">Todos</option><option value="proprietarios">Proprietários</option><option value="imobiliaria">Imobiliária</option></select></label>
       <label class="field"><span>Tipo</span><select data-tipo><option value="">Todos</option><option value="receita">Receita</option><option value="despesa">Despesa</option></select></label>
     </div>
     <div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');

  const campos = () => [
    { name: 'data', label: 'Data', type: 'date', required: true },
    { name: 'competencia', label: 'Competência', type: 'month', required: true },
    { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: [['receita', 'Receita'], ['despesa', 'Despesa']] },
    { name: 'caixa', label: 'Caixa', type: 'select', required: true, options: [['imobiliaria', 'Imobiliária'], ['proprietarios', 'Proprietários']] },
    { name: 'categoria', label: 'Categoria', required: true, placeholder: 'Aluguel, Taxa, Manutenção…' },
    { name: 'valor_centavos', label: 'Valor (R$)', type: 'money', required: true },
    { name: 'descricao', label: 'Descrição', type: 'textarea', span: 2 },
    { name: 'proprietario_id', label: 'Proprietário', type: 'select', options: props.map(p => ({ value: p.id, label: p.nome })) },
    { name: 'imovel_id', label: 'Imóvel', type: 'select', options: imoveis.map(i => ({ value: i.id, label: `${i.endereco}${i.numero ? ', ' + i.numero : ''}` })) },
    { name: 'contrato_id', label: 'Contrato', type: 'select', span: 2, options: contratos.map(c => ({ value: c.id, label: `${c.codigo || '#' + c.id} — ${c.endereco} (${c.inquilino_nome})` })) },
  ];
  const abrirForm = () => formModal({
    titulo: 'Novo lançamento', wide: true,
    fields: campos(), valores: { data: hojeISO(), competencia: comp, tipo: 'despesa', caixa: 'imobiliaria' },
    onSubmit: async (d) => { await api('/lancamentos', { method: 'POST', body: d }); toast('Lançamento criado.'); carregar(); },
  });

  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try {
      const qs = new URLSearchParams({ competencia: comp });
      if (caixa) qs.set('caixa', caixa);
      if (tipo) qs.set('tipo', tipo);
      [dados, saldos] = await Promise.all([api(`/lancamentos?${qs}`), api('/saldos')]);
      root.querySelector('[data-saldos]').innerHTML = `<div class="kpis">
        ${stat('Saldo imobiliária', brl(saldos.imobiliaria_centavos))}
        ${stat('Saldo proprietários', brl(saldos.proprietarios_centavos))}
        ${stat('Receitas da imobiliária', brl(saldos.receitas_imob_centavos), 'sage-ink')}
        ${stat('Despesas da imobiliária', brl(saldos.despesas_imob_centavos), 'blush-ink')}
      </div>`;
      lista.innerHTML = tableHtml([
        { label: 'Data', render: l => `${dataBR(l.data)}<span class="sub">${compBR(l.competencia)}</span>` },
        { label: 'Tipo', render: l => badge(l.tipo, l.tipo === 'receita' ? 'sage' : 'blush') },
        { label: 'Categoria', render: l => `<strong>${esc(l.categoria)}</strong><span class="sub">${esc(l.descricao || '')}</span>` },
        { label: 'Caixa', render: l => badge(l.caixa === 'imobiliaria' ? 'Imobiliária' : 'Proprietários', l.caixa === 'imobiliaria' ? 'sky' : 'lavender') },
        { label: 'Proprietário', render: l => esc(l.proprietario_nome || '—') },
        { label: 'Valor', num: true, render: l => `<span style="color:${l.tipo === 'receita' ? 'var(--sage-ink)' : 'var(--blush-ink)'}">${brl(l.valor_centavos)}</span>` },
        { label: 'Status', render: l => badge(l.status, l.status === 'estornado' ? 'plain' : 'sage') },
        { label: 'Ações', acao: l => l.status === 'estornado' || l.repasse_id || !podeFinanceiro() ? '' : `<button class="icon-btn" data-estornar="${l.id}" title="Estornar">${icon('x')}</button>` },
      ], dados);
      lista.querySelectorAll('[data-estornar]').forEach(b => b.onclick = async () => {
        const motivo = prompt('Motivo do estorno (obrigatório):');
        if (!motivo) return;
        try { await api(`/lancamentos/${b.dataset.estornar}/estornar`, { method: 'POST', body: { motivo } }); toast('Lançamento estornado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { lista.innerHTML = erroBox(e); }
  };

  root.querySelector('[data-comp]').onchange = (e) => { comp = e.target.value; carregar(); };
  root.querySelector('[data-caixa]').onchange = (e) => { caixa = e.target.value; carregar(); };
  root.querySelector('[data-tipo]').onchange = (e) => { tipo = e.target.value; carregar(); };
  root.querySelector("[data-exportar]")?.addEventListener("click", () => download(`/export/lancamentos?competencia=${comp}`));
  root.querySelector('[data-novo]')?.addEventListener('click', async () => {
    try { [props, imoveis, contratos] = await Promise.all([api('/proprietarios'), api('/imoveis'), api('/contratos')]); abrirForm(); } catch (e) { toast(e.message, 'err'); }
  });
  await carregar();
}

/* ============================================================
   REPASSES
   ============================================================ */
export async function viewRepasses(root) {
  let comp = compAtual(), dados = [];
  root.innerHTML = head('Repasses', 'Aluguéis recebidos − taxa − despesas − descontos + acréscimos.', podeFinanceiro() ? `<button class="btn primary" data-calcular>${icon('wallet')} Calcular competência</button>` : '') +
    `<div class="notice info">Cada repasse guarda um snapshot do cálculo. Competências pagas não são recalculadas.</div>
     <div class="filters mt-2"><label class="field"><span>Competência</span><input type="month" data-comp value="${comp}"></label>
     <button class="btn" data-atualizar>Atualizar</button></div>
     <div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');

  const imprimir = (r) => {
    const det = r.detalhe || {};
    const area = document.createElement('div');
    area.className = 'print-only';
    area.innerHTML = `<div class="receipt">
      <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start">
        <div><h2>${esc(cfg('imob_nome', 'Imobiliária'))}</h2><p class="muted">Extrato de repasse · ${compBR(r.competencia)}</p></div>
        <div style="text-align:right"><strong>${esc(r.proprietario_nome)}</strong><br><span class="muted small">${esc(r.banco || '')} ${esc(r.agencia || '')} ${esc(r.conta || '')}</span></div>
      </div>
      <div class="divider"></div>
      <table style="width:100%"><tbody>
        <tr><td>Aluguéis recebidos</td><td class="num">${brl(r.aluguel_centavos)}</td></tr>
        <tr><td>Taxa de administração (${(r.taxa_pct || 0).toFixed(2)}%)</td><td class="num">− ${brl(r.taxa_centavos)}</td></tr>
        <tr><td>Despesas</td><td class="num">− ${brl(r.despesas_centavos)}</td></tr>
        <tr><td>Descontos</td><td class="num">− ${brl(r.descontos_centavos)}</td></tr>
        <tr><td>Acréscimos</td><td class="num">+ ${brl(r.acrescimos_centavos)}</td></tr>
        <tr><td><strong>Valor a repassar</strong></td><td class="num"><strong>${brl(r.valor_centavos)}</strong></td></tr>
      </tbody></table>
      ${(det.contratos || []).length ? `<h3 style="margin:18px 0 6px">Origem da taxa</h3>
        <table style="width:100%"><thead><tr><th>Contrato</th><th>Imóvel</th><th class="num">Aluguel</th><th>Taxa</th><th>Origem</th></tr></thead><tbody>
        ${det.contratos.map(c => `<tr><td>${esc(c.codigo || '')}</td><td>${esc(c.imovel)}</td><td class="num">${brl(c.aluguel_centavos)}</td><td>${c.taxa_pct}%</td><td>${esc(c.taxa_origem)}</td></tr>`).join('')}
        </tbody></table>` : ''}
      ${(det.excecoes || []).length ? `<h3 style="margin:18px 0 6px">Exceções</h3>${det.excecoes.map(e => `<p class="small">${esc(e.tipo)} · ${brl(e.valor_centavos)} · ${esc(e.motivo)}</p>`).join('')}` : ''}
      <p class="muted small" style="margin-top:24px">Emitido em ${dataBR(hojeISO())}. Snapshot do cálculo preservado para auditoria.</p>
    </div>`;
    document.body.appendChild(area);
    window.print();
    setTimeout(() => area.remove(), 400);
  };

  const abrirDetalhe = async (id) => {
    try {
      const r = await api(`/repasses/${id}`);
      const det = r.detalhe || {};
      openModal({
        titulo: 'Extrato do repasse', subtitulo: `${r.proprietario_nome} · ${compBR(r.competencia)}`,
        wide: true,
        corpo: `
          <div class="grid cols-2">
            <div class="card"><div class="card-body"><dl class="dl">
              <dt>Aluguéis recebidos</dt><dd>${brl(r.aluguel_centavos)}</dd>
              <dt>Taxa (${(r.taxa_pct || 0).toFixed(2)}%)</dt><dd>− ${brl(r.taxa_centavos)}</dd>
              <dt>Despesas</dt><dd>− ${brl(r.despesas_centavos)}</dd>
              <dt>Descontos</dt><dd>− ${brl(r.descontos_centavos)}</dd>
              <dt>Acréscimos</dt><dd>+ ${brl(r.acrescimos_centavos)}</dd>
              <dt><strong>Valor do repasse</strong></dt><dd><strong>${brl(r.valor_centavos)}</strong></dd>
            </dl></div></div>
            <div class="card"><div class="card-body"><dl class="dl">
              <dt>Status</dt><dd>${badge(r.status, r.status === 'pago' ? 'sage' : 'butter')}</dd>
              <dt>Pago em</dt><dd>${r.pago_em ? dataBR(r.pago_em) : '—'}</dd>
              <dt>Banco</dt><dd>${esc([r.banco, r.agencia, r.conta].filter(Boolean).join(' · ') || '—')}</dd>
              <dt>Pix</dt><dd>${esc(r.pix || '—')}</dd>
            </dl></div></div>
          </div>
          ${(det.contratos || []).length ? `<div class="card mt-2"><div class="card-head"><h3>Origem da taxa</h3></div><div class="card-body">
            ${tableHtml([
              { label: 'Contrato', render: c => esc(c.codigo || '') },
              { label: 'Imóvel', render: c => `${esc(c.imovel)}<span class="sub">${esc(c.inquilino)}</span>` },
              { label: 'Aluguel', num: true, render: c => brl(c.aluguel_centavos) },
              { label: 'Taxa', num: true, render: c => `${c.taxa_pct}%` },
              { label: 'Origem', render: c => `${esc(c.taxa_origem)}${c.taxa_detalhe ? `<span class="sub">${esc(c.taxa_detalhe)}</span>` : ''}` },
            ], det.contratos)}
          </div></div>` : ''}
          ${(det.despesas || []).length ? `<div class="card mt-2"><div class="card-head"><h3>Despesas do proprietário</h3></div><div class="card-body">${det.despesas.map(d => `<div class="doc"><div class="doc-ico">${icon('wallet')}</div><div class="doc-meta"><strong>${esc(d.categoria)} — ${brl(d.valor_centavos)}</strong><small>${dataBR(d.data)} · ${esc(d.descricao || '')}</small></div></div>`).join('')}</div></div>` : ''}
          ${(det.excecoes || []).length ? `<div class="card mt-2"><div class="card-head"><h3>Exceções</h3></div><div class="card-body">${det.excecoes.map(e => `<p class="small">${badge(e.tipo, e.tipo === 'desconto' ? 'blush' : 'sage')} ${brl(e.valor_centavos)} · ${esc(e.motivo)}</p>`).join('')}</div></div>` : ''}`,
        rodape: `<button class="btn" data-print>${icon('print')} Imprimir / PDF</button>
          ${podeFinanceiro() && r.status !== 'pago' ? `<button class="btn primary" data-pagar="${r.id}">Pagar repasse</button>` : ''}
          <button class="btn" data-close>Fechar</button>`,
        onMount(mr, close) {
          mr.querySelector('[data-print]').onclick = () => imprimir(r);
          mr.querySelector('[data-pagar]')?.addEventListener('click', async () => {
            if (!await confirmar({ titulo: 'Pagar repasse', mensagem: `Confirmar o pagamento de ${brl(r.valor_centavos)} a ${r.proprietario_nome}? Serão criados os lançamentos de repasse e taxa.`, textoBotao: 'Pagar' })) return;
            try { await api(`/repasses/${r.id}/pagar`, { method: 'POST', body: {} }); toast('Repasse pago.'); close(); carregar(); } catch (e) { toast(e.message, 'err'); }
          });
        },
      });
    } catch (e) { toast(e.message, 'err'); }
  };

  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try {
      dados = await api(`/repasses?competencia=${comp}`);
      lista.innerHTML = tableHtml([
        { label: 'Proprietário', render: r => `<strong>${esc(r.proprietario_nome)}</strong><span class="sub">${compBR(r.competencia)}</span>` },
        { label: 'Aluguéis', num: true, render: r => brl(r.aluguel_centavos) },
        { label: 'Taxa', num: true, render: r => `${(r.taxa_pct || 0).toFixed(2)}%<span class="sub">${brl(r.taxa_centavos)}</span>` },
        { label: 'Despesas', num: true, render: r => brl(r.despesas_centavos) },
        { label: 'Descontos', num: true, render: r => brl(r.descontos_centavos) },
        { label: 'Valor', num: true, render: r => `<strong>${brl(r.valor_centavos)}</strong>` },
        { label: 'Status', render: r => badge(r.status, r.status === 'pago' ? 'sage' : 'butter') },
        { label: 'Ações', acao: r => `<button class="icon-btn" data-detalhe="${r.id}" title="Extrato">${icon('eye')}</button>
          ${podeFinanceiro() && r.status !== 'pago' ? `<button class="icon-btn" data-pagar="${r.id}" title="Pagar">${icon('check')}</button>` : ''}` },
      ], dados);
      lista.querySelectorAll('[data-detalhe]').forEach(b => b.onclick = () => abrirDetalhe(Number(b.dataset.detalhe)));
      lista.querySelectorAll('[data-pagar]').forEach(b => b.onclick = async () => {
        const r = dados.find(x => x.id === Number(b.dataset.pagar));
        if (!await confirmar({ titulo: 'Pagar repasse', mensagem: `Confirmar o pagamento de ${brl(r.valor_centavos)} a ${r.proprietario_nome}?`, textoBotao: 'Pagar' })) return;
        try { await api(`/repasses/${r.id}/pagar`, { method: 'POST', body: {} }); toast('Repasse pago.'); carregar(); } catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-comp]').onchange = (e) => { comp = e.target.value; carregar(); };
  root.querySelector('[data-atualizar]').onclick = carregar;
  root.querySelector('[data-calcular]')?.addEventListener('click', async () => {
    if (!await confirmar({ titulo: 'Calcular repasses', mensagem: `Calcular os repasses de ${compBR(comp)}? Repasses já pagos são preservados.`, textoBotao: 'Calcular' })) return;
    try { const r = await api('/repasses/calcular', { method: 'POST', body: { competencia: comp } }); toast(`${r.repasses.length} repasse(s) calculados.`); carregar(); } catch (e) { toast(e.message, 'err'); }
  });
  await carregar();
}

/* ============================================================
   FECHAMENTOS
   ============================================================ */
export async function viewFechamentos(root) {
  let dados = [], comp = compAtual();
  root.innerHTML = head('Fechamento mensal', 'Uma competência fechada bloqueia lançamentos, cobranças e repasses.', podeFinanceiro() ? `<button class="btn primary" data-fechar>${icon('check')} Fechar competência</button>` : '') +
    `<div class="notice">Só o administrador reabre um mês, com motivo registrado. Repasses pendentes impedem o fechamento.</div>
     <div class="card tight mt-2" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const carregar = async () => {
    try {
      dados = await api('/fechamentos');
      lista.innerHTML = tableHtml([
        { label: 'Competência', render: f => `<strong>${compBR(f.competencia)}</strong>` },
        { label: 'Fechado por', render: f => esc(f.fechado_por || '—') },
        { label: 'Fechado em', render: f => esc((f.fechado_em || '').replace('T', ' ').slice(0, 16)) },
        { label: 'Situação', render: f => badge(f.reaberto_em ? 'Reaberto' : 'Fechado', f.reaberto_em ? 'butter' : 'sage') },
        { label: 'Motivo da reabertura', render: f => esc(f.motivo_reabertura || '—') },
        { label: 'Ações', acao: f => isAdmin() && !f.reaberto_em ? `<button class="btn sm" data-reabrir="${f.competencia}">Reabrir</button>` : '' },
      ], dados);
      lista.querySelectorAll('[data-reabrir]').forEach(b => b.onclick = () => {
        openModal({
          titulo: 'Reabrir competência', narrow: true,
          corpo: `<p class="small muted" style="margin-bottom:12px">A reabertura permite novos lançamentos em ${compBR(b.dataset.reabrir)}.</p>
            <label class="field"><span>Motivo *</span><textarea name="motivo" rows="3"></textarea></label><div class="form-error mt-2" data-erro hidden></div>`,
          rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Reabrir</button>`,
          onMount(r, close) {
            r.querySelector('[data-ok]').onclick = async () => {
              const motivo = r.querySelector('[name=motivo]').value.trim();
              const err = r.querySelector('[data-erro]');
              if (!motivo) { err.hidden = false; err.textContent = 'Informe o motivo.'; return; }
              try { await api(`/fechamentos/${b.dataset.reabrir}/reabrir`, { method: 'POST', body: { motivo } }); toast('Competência reaberta.'); close(); carregar(); } catch (e) { err.hidden = false; err.textContent = e.message; }
            };
          },
        });
      });
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-fechar]')?.addEventListener('click', () => {
    openModal({
      titulo: 'Fechar competência', narrow: true,
      corpo: `<label class="field"><span>Competência</span><input type="month" name="comp" value="${comp}"></label><div class="form-error mt-2" data-erro hidden></div>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Fechar</button>`,
      onMount(r, close) {
        r.querySelector('[data-ok]').onclick = async () => {
          const err = r.querySelector('[data-erro]'); err.hidden = true;
          try {
            await api('/fechamentos', { method: 'POST', body: { competencia: r.querySelector('[name=comp]').value } });
            toast('Competência fechada.'); close(); carregar();
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        };
      },
    });
  });
  await carregar();
}

/* ============================================================
   DOCUMENTOS
   ============================================================ */
export async function viewDocumentos(root) {
  let entidade = '', busca = '', dados = [];
  root.innerHTML = head('Documentos', 'Arquivos vinculados a cadastros e contratos, com versões e validade.', podeEscrever() ? `<button class="btn primary" data-novo>${icon('upload')} Enviar documento</button>` : '') +
    `<div class="filters">
      <label class="field"><span>Vínculo</span><select data-entidade><option value="">Todos</option><option value="proprietarios">Proprietários</option><option value="imoveis">Imóveis</option><option value="inquilinos">Inquilinos</option><option value="contratos">Contratos</option></select></label>
      <div class="search grow">${icon('search')}<input placeholder="Buscar por nome ou categoria" data-busca></div>
    </div><div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const render = () => {
    const termo = busca.toLowerCase();
    const rows = dados.filter(d => !termo || [d.nome, d.categoria, d.descricao].some(v => String(v || '').toLowerCase().includes(termo)));
    lista.innerHTML = tableHtml([
      { label: 'Documento', render: d => `<div class="doc"><div class="doc-ico">${icon('doc')}</div><div class="doc-meta"><strong>${esc(d.nome)}</strong><small>v${d.versao} · ${(Number(d.tamanho || 0) / 1024).toFixed(0)} KB · ${dataBR(d.criado_em)}</small></div></div>` },
      { label: 'Vínculo', render: d => `${esc(d.entidade)} #${d.entidade_id}` },
      { label: 'Categoria', render: d => badge((d.categoria || 'outros').replace('_', ' '), 'lavender') },
      { label: 'Validade', render: d => d.validade ? dataBR(d.validade) : '—' },
      { label: 'Ações', acao: d => `
        ${['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(d.mime) ? `<a class="icon-btn" href="/api/documentos/${d.id}/download?inline=1" target="_blank" rel="noopener" title="Visualizar">${icon('eye')}</a>` : ''}
        <a class="icon-btn" href="/api/documentos/${d.id}/download" title="Baixar">${icon('download')}</a>
        ${podeEscrever() ? `<button class="icon-btn" data-del="${d.id}" title="Remover">${icon('trash')}</button>` : ''}` },
    ], rows);
    lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmar({ titulo: 'Remover documento', mensagem: 'O documento sai da lista ativa; o histórico de versões permanece. Continuar?', textoBotao: 'Remover', perigo: true })) return;
      try { await api(`/documentos/${b.dataset.del}`, { method: 'DELETE' }); toast('Documento removido.'); carregar(); } catch (e) { toast(e.message, 'err'); }
    });
  };
  const carregar = async () => {
    lista.innerHTML = loadingBox();
    try { dados = await api('/documentos' + (entidade ? `?entidade=${entidade}` : '')); render(); } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-entidade]').onchange = (e) => { entidade = e.target.value; carregar(); };
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
  root.querySelector('[data-novo]')?.addEventListener('click', () => {
    const fields = [
      { name: 'entidade', label: 'Vincular a', type: 'select', required: true, options: [['proprietarios', 'Proprietário'], ['imoveis', 'Imóvel'], ['inquilinos', 'Inquilino'], ['contratos', 'Contrato']] },
      { name: 'entidade_id', label: 'ID do registro', type: 'number', required: true, min: 1, hint: 'Use o ID que aparece na listagem do cadastro.' },
      { name: 'categoria', label: 'Categoria', type: 'select', options: [['contrato', 'Contrato'], ['documento_pessoal', 'Documento pessoal'], ['comprovante', 'Comprovante'], ['garantia', 'Garantia'], ['vistoria', 'Vistoria'], ['nota_fiscal', 'Nota fiscal'], ['outros', 'Outros']] },
      { name: 'validade', label: 'Validade', type: 'date' },
      { name: 'descricao', label: 'Descrição', span: 2 },
    ];
    openModal({
      titulo: 'Enviar documento', wide: true,
      corpo: `<form data-form>${fieldsHtml(fields)}<label class="field mt-1"><span>Arquivo *</span><input type="file" name="arquivo" required accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Até 10 MB.</small></label><div class="form-error mt-2" data-erro hidden></div></form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Enviar</button>`,
      onMount(r, close) {
        r.querySelector('[data-ok]').onclick = async () => {
          const err = r.querySelector('[data-erro]'); err.hidden = true;
          const form = r.querySelector('[data-form]');
          const file = form.elements.arquivo.files[0];
          if (!file) { err.hidden = false; err.textContent = 'Escolha um arquivo.'; return; }
          try {
            const d = collectForm(form, fields);
            await api('/documentos', { method: 'POST', body: { ...d, nome: file.name, mime: file.type, arquivo_base64: await lerArquivo(file) } });
            toast('Documento enviado.'); close(); carregar();
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        };
      },
    });
  });
  await carregar();
}

/* ============================================================
   IMPORTAÇÃO
   ============================================================ */
export async function viewImportacao(root) {
  let entidade = 'proprietarios';
  let arquivo = null;
  let preview = null;
  root.innerHTML = head('Importar planilhas', 'Modelos prontos, prévia linha a linha e atualização de registros existentes.') +
    `<div class="tabs" data-entidades></div>
     <div class="card"><div class="card-body">
       <div class="grid cols-2">
         <div>
           <h3>1. Baixe o modelo</h3>
           <p class="muted small" style="margin:4px 0 12px">O cabeçalho precisa seguir o modelo. Datas em dd/mm/aaaa e valores em reais.</p>
           <div class="pill-row" data-modelos></div>
         </div>
         <div>
           <h3>2. Envie a planilha</h3>
           <p class="muted small" style="margin:4px 0 12px">Até 12 MB, 5.000 linhas e 60 colunas (.xlsx, .xls ou .csv).</p>
           <label class="btn primary">${icon('upload')} Escolher arquivo<input type="file" data-arquivo accept=".xlsx,.xls,.csv" hidden></label>
           <span class="small muted" data-nome style="margin-left:8px"></span>
           <div class="mt-2" style="display:flex;gap:14px;flex-wrap:wrap">
             <label class="check"><input type="checkbox" data-atualizar> Atualizar registros existentes</label>
             <label class="check"><input type="checkbox" data-criar-inq checked> Criar inquilinos ao importar contratos</label>
           </div>
           <button class="btn soft mt-2" data-previa disabled>Analisar planilha</button>
         </div>
       </div>
       <div class="form-error mt-2" data-erro hidden></div>
     </div></div>
     <div class="mt-2" data-resultado></div>`;
  const tabs = root.querySelector('[data-entidades]');
  const modelos = root.querySelector('[data-modelos]');
  const resultado = root.querySelector('[data-resultado]');
  const btnPrevia = root.querySelector('[data-previa]');
  const errBox = root.querySelector('[data-erro]');
  let meta = [];

  const carregarModelos = async () => {
    meta = await api('/import/modelos');
    tabs.innerHTML = meta.map(m => `<button data-e="${m.id}">${esc(m.nome)}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.onclick = () => {
      entidade = b.dataset.e; marcar(); modelosHtml();
    });
    marcar();
    modelosHtml();
  };
  const marcar = () => tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.e === entidade));
  const modelosHtml = () => {
    modelos.innerHTML = `<a class="btn sm" href="/api/import/modelo/${entidade}.xlsx">${icon('download')} Excel</a>
      <a class="btn sm" href="/api/import/modelo/${entidade}.csv">${icon('download')} CSV</a>
      <span class="small muted">${esc(meta.find(m => m.id === entidade)?.descricao || '')}</span>`;
  };

  root.querySelector('[data-arquivo]').addEventListener('change', (e) => {
    arquivo = e.target.files[0] || null;
    root.querySelector('[data-nome]').textContent = arquivo ? arquivo.name : '';
    btnPrevia.disabled = !arquivo;
    preview = null; resultado.innerHTML = '';
  });

  btnPrevia.onclick = async () => {
    errBox.hidden = true;
    resultado.innerHTML = loadingBox('Analisando a planilha…');
    try {
      const base64 = await lerArquivo(arquivo);
      preview = await api('/import/preview', { method: 'POST', body: {
        entidade, arquivo_base64: base64,
        opcoes: {
          atualizar: root.querySelector('[data-atualizar]').checked,
          criar_inquilinos: root.querySelector('[data-criar-inq]').checked,
        },
      } });
      resultado.innerHTML = `<div class="card"><div class="card-head"><div><h3>Prévia — ${esc(preview.modelo)}</h3><p>${preview.total} linha(s) · ${preview.validos} válida(s) · ${preview.erros} com erro</p></div>
        <button class="btn primary" data-commit ${preview.validos ? '' : 'disabled'}>Importar ${preview.validos} registro(s)</button></div>
        <div class="card-body">${tableHtml([
          { label: 'Linha', render: l => l.linha },
          { label: 'Status', render: l => badge(l.status, l.status === 'erro' ? 'blush' : l.status === 'atualizar' ? 'butter' : 'sage') },
          { label: 'Resumo', render: l => esc(l.resumo) },
          { label: 'Erros', render: l => l.erros.length ? `<span style="color:var(--blush-ink)">${esc(l.erros.join('; '))}</span>` : '—' },
        ], preview.linhas)}</div></div>`;
      resultado.querySelector('[data-commit]').onclick = async () => {
        const btn = resultado.querySelector('[data-commit]');
        btn.disabled = true;
        try {
          const base64 = await lerArquivo(arquivo);
          const r = await api('/import/commit', { method: 'POST', body: {
            entidade, arquivo_base64: base64,
            opcoes: {
              atualizar: root.querySelector('[data-atualizar]').checked,
              criar_inquilinos: root.querySelector('[data-criar-inq]').checked,
            },
          } });
          toast(`Importação concluída: ${r.inseridos} inseridos, ${r.atualizados} atualizados, ${r.erros.length} erros.`);
          resultado.innerHTML = `<div class="notice ${r.erros.length ? '' : 'info'}"><strong>Importação concluída.</strong> ${r.inseridos} inseridos · ${r.atualizados} atualizados · ${r.erros.length} erros.${r.erros.length ? `<div class="mt-1 small">${r.erros.slice(0, 5).map(e => `Linha ${e.linha}: ${esc(e.erro)}`).join('<br>')}</div>` : ''}</div>`;
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      };
    } catch (e) {
      resultado.innerHTML = '';
      errBox.hidden = false;
      errBox.textContent = e.message;
    }
  };
  await carregarModelos();
}

/* ============================================================
   RELATÓRIOS + BACKUP
   ============================================================ */
export async function viewRelatorios(root) {
  let dados = [], props = [], filtros = { de: addMesesComp(compAtual(), -11) + '-01', ate: hojeISO(), proprietario_id: '' };
  root.innerHTML = head('Relatórios', 'Sete relatórios em CSV, Excel e PDF com cabeçalho e paginação.') +
    `<div class="filters">
      <label class="field"><span>De</span><input type="date" data-de value="${filtros.de}"></label>
      <label class="field"><span>Até</span><input type="date" data-ate value="${filtros.ate}"></label>
      <label class="field"><span>Proprietário</span><select data-prop><option value="">Todos</option></select></label>
    </div>
    <div class="grid cols-3" data-lista>${loadingBox()}</div>
    <div class="card mt-2" data-backup></div>`;
  const lista = root.querySelector('[data-lista]');

  const render = () => {
    const qs = new URLSearchParams({ de: filtros.de, ate: filtros.ate });
    if (filtros.proprietario_id) qs.set('proprietario_id', filtros.proprietario_id);
    lista.innerHTML = dados.map(r => `
      <div class="card">
        <div class="card-body">
          <div class="pill-row" style="margin-bottom:8px">${badge(r.cor, r.cor)}</div>
          <h3>${esc(r.nome)}</h3>
          <p class="muted small" style="min-height:38px;margin:6px 0 14px">${esc(r.descricao)}</p>
          <div class="pill-row">
            <a class="btn sm" href="/api/reports/${r.id}.csv?${qs}">${icon('download')} CSV</a>
            <a class="btn sm" href="/api/reports/${r.id}.xlsx?${qs}">${icon('download')} Excel</a>
            <a class="btn sm soft" href="/api/reports/${r.id}.pdf?${qs}">${icon('doc')} PDF</a>
          </div>
        </div>
      </div>`).join('');
  };

  const carregarBackup = () => {
    const box = root.querySelector('[data-backup]');
    if (!isAdmin()) { box.remove(); return; }
    box.innerHTML = `<div class="card-head"><div><h2>Backup</h2><p>Banco + documentos em um .zip. Guarde fora do servidor.</p></div><div class="section-actions">
      <a class="btn" href="/api/backup">${icon('download')} Baixar backup</a>
      <button class="btn" data-verificar>${icon('shield')} Verificar integridade</button>
    </div></div>
    <div class="card-body"><p class="small muted">Último backup registrado: ${esc(cfg('ultimo_backup', 'nunca'))}. A restauração deve ser testada mensalmente.</p></div>`;
    box.querySelector('[data-verificar]').onclick = async () => {
      try {
        const r = await api('/backup/verificar');
        openModal({
          titulo: 'Verificação de integridade', narrow: true,
          corpo: `<p class="small muted" style="margin-bottom:12px">Banco aberto e tabelas conferidas em ${esc(r.gerado_em)}.</p>
            <dl class="dl">${Object.entries(r.contagens).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ?? '—'}</dd>`).join('')}
            <dt>Arquivos de documentos</dt><dd>${r.documentos_arquivos} (${(r.documentos_bytes / 1024 / 1024).toFixed(1)} MB)</dd></dl>`,
          rodape: '<button class="btn" data-close>Fechar</button>',
        });
      } catch (e) { toast(e.message, 'err'); }
    };
  };

  try {
    [dados, props] = await Promise.all([api('/relatorios'), api('/proprietarios')]);
    root.querySelector('[data-prop]').innerHTML = '<option value="">Todos</option>' + props.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    render(); carregarBackup();
  } catch (e) { lista.innerHTML = erroBox(e); }

  root.querySelector('[data-de]').onchange = (e) => { filtros.de = e.target.value; render(); };
  root.querySelector('[data-ate]').onchange = (e) => { filtros.ate = e.target.value; render(); };
  root.querySelector('[data-prop]').onchange = (e) => { filtros.proprietario_id = e.target.value; render(); };
}

/* ============================================================
   USUÁRIOS
   ============================================================ */
export async function viewUsuarios(root) {
  let dados = [], solicitacoes = [];
  root.innerHTML = head('Usuários', 'Perfis admin, operador e consulta. A autorização é aplicada no servidor.', `<button class="btn primary" data-novo>${icon('plus')} Novo usuário</button>`) +
    `<div class="card tight" data-lista>${loadingBox()}</div>
     <div class="card mt-2" data-solicitacoes></div>`;
  const lista = root.querySelector('[data-lista]');
  const abrirForm = (u = null) => {
    const fields = [
      { name: 'nome', label: 'Nome', required: true, span: 2 },
      { name: 'email', label: 'E-mail', type: 'email', required: true },
      { name: 'papel', label: 'Perfil', type: 'select', options: [['operador', 'Operador'], ['admin', 'Administrador'], ['consulta', 'Consulta']] },
      { name: 'senha', label: u ? 'Nova senha (opcional)' : 'Senha', type: 'password', required: !u, hint: 'Mínimo 8 caracteres; sem senhas comuns.' },
      { name: 'ativo', label: 'Situação', type: 'checkbox', checkLabel: 'Usuário ativo', span: 2 },
    ];
    formModal({
      titulo: u ? 'Editar usuário' : 'Novo usuário', fields,
      valores: u || { papel: 'operador', ativo: 1 },
      onSubmit: async (d) => {
        if (u) await api(`/usuarios/${u.id}`, { method: 'PUT', body: d });
        else await api('/usuarios', { method: 'POST', body: d });
        toast(u ? 'Usuário atualizado.' : 'Usuário criado; a senha deve ser trocada no primeiro acesso.'); carregar();
      },
    });
  };
  const carregar = async () => {
    try {
      [dados, solicitacoes] = await Promise.all([api('/usuarios'), api('/reset/solicitacoes')]);
      lista.innerHTML = tableHtml([
        { label: 'Nome', render: u => `<strong>${esc(u.nome)}</strong><span class="sub">${esc(u.email)}</span>` },
        { label: 'Perfil', render: u => badge(u.papel, u.papel === 'admin' ? 'lavender' : u.papel === 'operador' ? 'sky' : 'plain') },
        { label: '2FA', render: u => badge(u.totp_ativo ? 'Ativo' : 'Inativo', u.totp_ativo ? 'sage' : 'plain') },
        { label: 'Situação', render: u => badge(u.ativo ? 'Ativo' : 'Inativo', u.ativo ? 'sage' : 'plain') },
        { label: 'Criado em', render: u => dataBR(u.criado_em) },
        { label: 'Ações', acao: u => `
          <button class="icon-btn" data-edit="${u.id}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn" data-senha="${u.id}" title="Resetar senha">${icon('key')}</button>
          ${u.totp_ativo ? `<button class="icon-btn" data-2fa="${u.id}" title="Resetar 2FA">${icon('shield')}</button>` : ''}` },
      ], dados);
      lista.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => abrirForm(dados.find(x => x.id === Number(b.dataset.edit))));
      lista.querySelectorAll('[data-senha]').forEach(b => b.onclick = async () => {
        const u = dados.find(x => x.id === Number(b.dataset.senha));
        if (!await confirmar({ titulo: 'Resetar senha', mensagem: `Gerar senha temporária para ${u.nome}? As sessões serão encerradas e a troca será exigida no próximo login.`, textoBotao: 'Gerar senha' })) return;
        try {
          const r = await api(`/usuarios/${u.id}/resetar-senha`, { method: 'POST', body: {} });
          openModal({
            titulo: 'Senha temporária', narrow: true,
            corpo: `<p class="small muted">Entregue com segurança para <strong>${esc(r.email)}</strong>. No próximo login o sistema exigirá a troca.</p>
              <div class="notice info mono" style="font-size:1.05rem;margin-top:12px;user-select:all">${esc(r.senha)}</div>`,
            rodape: '<button class="btn" data-close>Fechar</button>',
          });
        } catch (e) { toast(e.message, 'err'); }
      });
      lista.querySelectorAll('[data-2fa]').forEach(b => b.onclick = async () => {
        if (!await confirmar({ titulo: 'Resetar 2FA', mensagem: 'O usuário poderá entrar apenas com senha até ativar um novo autenticador. Continuar?', textoBotao: 'Resetar' })) return;
        try { await api(`/usuarios/${b.dataset['2fa']}/resetar-2fa`, { method: 'POST', body: {} }); toast('2FA resetado.'); carregar(); } catch (e) { toast(e.message, 'err'); }
      });
      root.querySelector('[data-solicitacoes]').innerHTML = `<div class="card-head"><div><h2>Solicitações de acesso e recuperação</h2><p>Cadastros pendentes de aprovação e pedidos de senha.</p></div></div>
        <div class="card-body">${solicitacoes.length ? tableHtml([
          { label: 'Usuário', render: s => `${esc(s.nome)}<span class="sub">${esc(s.email)}</span>` },
          { label: 'Criado em', render: s => esc((s.criado_em || '').replace('T', ' ').slice(0, 16)) },
          { label: 'Expira em', render: s => esc((s.expira_em || '').replace('T', ' ').slice(0, 16)) },
          { label: 'Situação', render: s => badge(s.usado_em ? 'Usado' : 'Pendente', s.usado_em ? 'plain' : 'butter') },
        ], solicitacoes) : '<p class="muted small">Nenhuma solicitação registrada.</p>'}</div>`;
    } catch (e) { lista.innerHTML = erroBox(e); }
  };
  root.querySelector('[data-novo]').onclick = () => abrirForm();
  await carregar();
}

/* ============================================================
   AUDITORIA
   ============================================================ */
export async function viewAuditoria(root) {
  let dados = [], busca = '';
  root.innerHTML = head('Auditoria', 'Login, CRUD, estornos, repasses, fechamentos, importações, backups e LGPD.') +
    `<div class="filters"><div class="search grow">${icon('search')}<input placeholder="Buscar por usuário, ação, entidade ou detalhe" data-busca></div></div>
     <div class="card tight" data-lista>${loadingBox()}</div>`;
  const lista = root.querySelector('[data-lista]');
  const render = () => {
    const termo = busca.toLowerCase();
    const rows = dados.filter(a => !termo || [a.usuario_nome, a.acao, a.entidade, a.entidade_id, a.detalhe, a.ip].some(v => String(v || '').toLowerCase().includes(termo)));
    lista.innerHTML = tableHtml([
      { label: 'Quando', render: a => esc((a.criado_em || '').replace('T', ' ').slice(0, 16)) },
      { label: 'Usuário', render: a => esc(a.usuario_nome || 'sistema') },
      { label: 'Ação', render: a => badge(a.acao, 'lavender') },
      { label: 'Entidade', render: a => `${esc(a.entidade)}${a.entidade_id ? ` #${esc(a.entidade_id)}` : ''}` },
      { label: 'Detalhe', render: a => `<span class="small muted">${esc(String(a.detalhe || '—').slice(0, 160))}</span>` },
      { label: 'IP', render: a => esc(a.ip || '—') },
    ], rows);
  };
  try { dados = await api('/auditoria?limite=500'); render(); } catch (e) { lista.innerHTML = erroBox(e); }
  root.querySelector('[data-busca]').addEventListener('input', (e) => { busca = e.target.value; render(); });
}

/* ============================================================
   CONFIGURAÇÕES + 2FA + SENHA
   ============================================================ */
const GRUPOS = {
  empresa: 'Empresa', regras: 'Regras de negócio', alertas: 'Alertas', mensagens: 'Mensagens',
  comunicacao: 'Comunicação', cobranca: 'Cobrança', lgpd: 'LGPD', seguranca: 'Segurança',
};
export async function viewConfiguracoes(root, params) {
  let dados = [], grupo = params?.get('grupo') || 'empresa';
  let tfa = { ativo: false };
  root.innerHTML = head('Configurações', 'Regras editáveis valem para novos cálculos; competências já calculadas não mudam.') +
    `<div class="settings-grid">
      <div class="settings-nav" data-nav></div>
      <div>
        <div class="card" data-form-card>${loadingBox()}</div>
        <div class="card mt-2" data-seguranca>${loadingBox()}</div>
      </div>
    </div>`;
  const nav = root.querySelector('[data-nav]');
  const card = root.querySelector('[data-form-card]');
  const seg = root.querySelector('[data-seguranca]');

  const camposTipo = (s) => {
    const val = s.valor ?? '';
    const dis = s.editavel ? '' : 'disabled';
    if (s.tipo === 'lista') {
      const opts = String(s.opcoes || '').split(',').map(o => o.trim()).filter(Boolean);
      return `<select name="${esc(s.chave)}" ${dis}>${opts.map(o => `<option value="${esc(o)}" ${String(val) === o ? 'selected' : ''}>${esc(o === '1' ? 'Sim' : o === '0' ? 'Não' : o)}</option>`).join('')}</select>`;
    }
    if (s.tipo === 'texto_longo') return `<textarea name="${esc(s.chave)}" rows="4" ${dis}>${esc(val)}</textarea>`;
    if (s.tipo === 'percentual') return `<input type="number" step="0.001" name="${esc(s.chave)}" value="${esc(val)}" ${dis}>`;
    if (s.tipo === 'numero' || s.tipo === 'dinheiro') return `<input type="number" step="${s.tipo === 'dinheiro' ? '0.01' : '1'}" name="${esc(s.chave)}" value="${esc(val)}" ${dis}>`;
    if (s.tipo === 'data') return `<input type="date" name="${esc(s.chave)}" value="${esc(val)}" ${dis}>`;
    return `<input name="${esc(s.chave)}" value="${esc(val)}" ${dis} ${s.chave === 'url_publica' ? 'placeholder="https://sistema.seudominio.com"' : ''}>`;
  };

  const renderGrupo = () => {
    const itens = dados.filter(s => s.grupo === grupo);
    card.innerHTML = `<div class="card-head"><div><h2>${esc(GRUPOS[grupo] || grupo)}</h2><p>${itens.length} configuração(ões)</p></div></div>
      <div class="card-body"><form data-settings class="settings-group">
        ${itens.map(s => `<label class="field"><span>${esc(s.rotulo)}</span>${camposTipo(s)}<small>${esc(s.chave)}${s.editavel ? '' : ' · somente leitura'}</small></label>`).join('')}
        <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn primary" type="submit">Salvar ${esc((GRUPOS[grupo] || grupo).toLowerCase())}</button></div>
        <div class="form-error" data-erro hidden></div>
      </form></div>`;
    card.querySelector('[data-settings]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = card.querySelector('[data-erro]'); err.hidden = true;
      const form = e.target;
      const itensObj = {};
      for (const s of itens) {
        if (!s.editavel) continue;
        const el = form.elements[s.chave];
        if (el) itensObj[s.chave] = el.value;
      }
      try {
        await api('/settings', { method: 'PUT', body: { itens: itensObj } });
        toast('Configurações salvas.');
        dados = await api('/settings');
        segurar();
      } catch (ex) { err.hidden = false; err.textContent = ex.message; }
    });
  };

  const renderNav = () => {
    nav.innerHTML = Object.entries(GRUPOS).map(([id, nome]) => `<button data-g="${id}" class="${grupo === id ? 'active' : ''}">${esc(nome)}</button>`).join('');
    nav.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      grupo = b.dataset.g;
      history.replaceState(null, '', `#/configuracoes?grupo=${grupo}`);
      renderNav(); renderGrupo();
    });
  };

  const segurar = async () => {
    try { tfa = await api('/2fa/status'); } catch { tfa = { ativo: false }; }
    seg.innerHTML = `
      <div class="card-head"><div><h2>Conta e segurança</h2><p>${esc(state.user.email)} · ${esc(state.user.papel)}</p></div></div>
      <div class="card-body" style="display:grid;gap:16px">
        <div class="grid cols-2">
          <div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="card-body">
            <h3>Senha</h3><p class="muted small" style="margin:4px 0 12px">Trocar a senha encerra as outras sessões.</p>
            <button class="btn" data-senha>${icon('key')} Trocar senha</button>
          </div></div>
          <div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="card-body">
            <h3>Verificação em duas etapas</h3><p class="muted small" style="margin:4px 0 12px">${tfa.ativo ? '2FA ativo com aplicativo autenticador.' : 'Proteja o acesso com TOTP e códigos de recuperação.'}</p>
            ${tfa.ativo ? `<button class="btn danger" data-desativar-2fa>Desativar 2FA</button>` : `<button class="btn soft" data-ativar-2fa>${icon('shield')} Ativar 2FA</button>`}
          </div></div>
        </div>
        <p class="small muted">Perfil <strong>${esc(state.user.papel)}</strong>${state.user.papel === 'consulta' ? ' — somente leitura, sem exportações.' : ''}</p>
      </div>`;

    seg.querySelector('[data-senha]').onclick = () => {
      const fields = [
        { name: 'senha_atual', label: 'Senha atual', type: 'password', required: true },
        { name: 'senha_nova', label: 'Nova senha', type: 'password', required: true },
        { name: 'senha2', label: 'Repetir nova senha', type: 'password', required: true },
      ];
      openModal({
        titulo: 'Trocar senha', narrow: true,
        corpo: `<form data-form>${fieldsHtml(fields)}<div class="form-error mt-2" data-erro hidden></div></form>`,
        rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button>`,
        onMount(r, close) {
          r.querySelector('[data-ok]').onclick = async () => {
            const err = r.querySelector('[data-erro]'); err.hidden = true;
            try {
              const d = collectForm(r.querySelector('[data-form]'), fields);
              if (d.senha_nova !== d.senha2) throw new Error('As senhas novas não coincidem.');
              await api('/me/senha', { method: 'POST', body: { senha_atual: d.senha_atual, senha_nova: d.senha_nova } });
              toast('Senha alterada.'); close();
            } catch (e) { err.hidden = false; err.textContent = e.message; }
          };
        },
      });
    };
    seg.querySelector('[data-ativar-2fa]')?.addEventListener('click', () => {
      openModal({
        titulo: 'Ativar 2FA', narrow: true,
        corpo: `<label class="field"><span>Confirme sua senha</span><input type="password" name="senha"></label><div class="form-error mt-2" data-erro hidden></div>`,
        rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Continuar</button>`,
        onMount(r, close) {
          r.querySelector('[data-ok]').onclick = async () => {
            const err = r.querySelector('[data-erro]'); err.hidden = true;
            try {
              const r2 = await api('/2fa/iniciar', { method: 'POST', body: { senha: r.querySelector('[name=senha]').value } });
              close();
              openModal({
                titulo: 'Escaneie o QR Code', narrow: true,
                corpo: `<p class="small muted">Use Google Authenticator, 1Password ou similar. Depois informe o código de 6 dígitos.</p>
                  <div style="text-align:center;margin:14px 0"><img src="${r2.qr}" alt="QR Code do 2FA" style="width:200px;height:200px;border-radius:12px;border:1px solid var(--line)"></div>
                  <div class="form-note mono small" style="word-break:break-all">${esc(r2.segredo)}</div>
                  <label class="field mt-2"><span>Código de 6 dígitos</span><input name="codigo" inputmode="numeric" maxlength="6"></label>
                  <div class="form-error mt-2" data-erro hidden></div>`,
                rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Ativar</button>`,
                onMount(rr, cc) {
                  rr.querySelector('[data-ok]').onclick = async () => {
                    const e2 = rr.querySelector('[data-erro]'); e2.hidden = true;
                    try {
                      const at = await api('/2fa/ativar', { method: 'POST', body: { codigo: rr.querySelector('[name=codigo]').value } });
                      cc();
                      openModal({
                        titulo: '2FA ativado', narrow: true,
                        corpo: `<p class="small muted">Guarde os códigos de recuperação. Cada um funciona uma vez.</p>
                          <div class="notice mono" style="margin-top:12px;line-height:1.8">${at.codigos.map(c => esc(c)).join('<br>')}</div>`,
                        rodape: '<button class="btn" data-close>Fechar</button>',
                      });
                      segurar();
                    } catch (e) { e2.hidden = false; e2.textContent = e.message; }
                  };
                },
              });
            } catch (e) { err.hidden = false; err.textContent = e.message; }
          };
        },
      });
    });
    seg.querySelector('[data-desativar-2fa]')?.addEventListener('click', () => {
      const fields = [
        { name: 'senha', label: 'Senha atual', type: 'password', required: true },
        { name: 'codigo', label: 'Código TOTP ou de recuperação', required: true },
      ];
      openModal({
        titulo: 'Desativar 2FA', narrow: true,
        corpo: `<form data-form>${fieldsHtml(fields)}<div class="form-error mt-2" data-erro hidden></div></form>`,
        rodape: `<button class="btn" data-close>Cancelar</button><button class="btn danger" data-ok>Desativar</button>`,
        onMount(r, close) {
          r.querySelector('[data-ok]').onclick = async () => {
            const err = r.querySelector('[data-erro]'); err.hidden = true;
            try {
              const d = collectForm(r.querySelector('[data-form]'), fields);
              await api('/2fa/desativar', { method: 'POST', body: d });
              toast('2FA desativado.'); close(); segurar();
            } catch (e) { err.hidden = false; err.textContent = e.message; }
          };
        },
      });
    });
  };

  try {
    dados = await api('/settings');
    renderNav(); renderGrupo(); segurar();
  } catch (e) { card.innerHTML = erroBox(e); }
}

/* ============================================================
   LGPD
   ============================================================ */
export async function viewLGPD(root) {
  let props = [], inqs = [], tipo = 'proprietario';
  root.innerHTML = head('Privacidade (LGPD)', 'Exportação do titular, anonimização e parâmetros de retenção.') +
    `<div class="grid cols-2">
      <div class="card"><div class="card-head"><div><h2>Exportar dados do titular</h2><p>JSON com cadastro, contratos, financeiro, documentos e comunicações.</p></div></div>
        <div class="card-body stack">
          <label class="field"><span>Tipo</span><select data-tipo><option value="proprietario">Proprietário</option><option value="inquilino">Inquilino</option></select></label>
          <label class="field"><span>Titular</span><select data-id></select></label>
          <button class="btn primary" data-exportar>${icon('download')} Baixar JSON</button>
        </div></div>
      <div class="card"><div class="card-head"><div><h2>Anonimizar dados pessoais</h2><p>Preserva contratos e histórico financeiro, como exige a obrigação legal.</p></div></div>
        <div class="card-body">
          <div class="notice danger">A ação é irreversível. Nome, CPF, contato, endereço e dados bancários são removidos; o financeiro permanece.</div>
          <button class="btn danger mt-2" data-anonimizar>${icon('shield')} Anonimizar titular</button>
        </div></div>
    </div>
    <div class="card mt-2"><div class="card-head"><div><h2>Parâmetros de LGPD</h2><p>Encarregado, e-mail e prazos de retenção.</p></div><a class="link" href="#/configuracoes?grupo=lgpd">Editar em Configurações</a></div>
      <div class="card-body"><dl class="dl">
        <dt>Encarregado (DPO)</dt><dd>${esc(cfg('lgpd_encarregado', '—') || '—')}</dd>
        <dt>E-mail do encarregado</dt><dd>${esc(cfg('lgpd_email', '—') || '—')}</dd>
        <dt>Retenção financeira</dt><dd>${esc(cfg('lgpd_retencao_financeira_anos', '5'))} anos</dd>
        <dt>Retenção de logs</dt><dd>${esc(cfg('lgpd_retencao_logs_dias', '365'))} dias</dd>
        <dt>CPF mascarado para consulta</dt><dd>${cfg('mascarar_cpf_consulta', '1') === '1' ? 'Sim' : 'Não'}</dd>
      </dl></div></div>`;
  const sel = root.querySelector('[data-id]');
  const renderSel = () => {
    const lista = tipo === 'proprietario' ? props : inqs;
    sel.innerHTML = lista.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  };
  try {
    [props, inqs] = await Promise.all([api('/proprietarios'), api('/inquilinos')]);
    renderSel();
  } catch (e) { toast(e.message, 'err'); }
  root.querySelector('[data-tipo]').onchange = (e) => { tipo = e.target.value; renderSel(); };
  root.querySelector('[data-exportar]').onclick = () => {
    const id = sel.value; if (!id) return toast('Escolha o titular.', 'err');
    download(`/lgpd/titular?tipo=${tipo}&id=${id}`);
    toast('Exportação gerada.');
  };
  root.querySelector('[data-anonimizar]').onclick = async () => {
    const id = sel.value;
    const lista = tipo === 'proprietario' ? props : inqs;
    const alvo = lista.find(x => String(x.id) === String(id));
    if (!alvo) return;
    if (!await confirmarTexto({
      titulo: 'Anonimizar titular',
      mensagem: `Anonimizar ${alvo.nome}? O histórico financeiro e os contratos permanecem; os dados pessoais não podem ser recuperados.`,
      palavra: 'ANONIMIZAR', textoBotao: 'Anonimizar',
    })) return;
    try { await api('/lgpd/anonimizar', { method: 'POST', body: { tipo, id: Number(id), confirmacao: 'ANONIMIZAR' } }); toast('Titular anonimizado.'); location.reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

/* ============================================================
   MANUTENÇÃO
   ============================================================ */
export async function viewManutencao(root) {
  let status = null;
  root.innerHTML = head('Manutenção', 'Base de demonstração e limpeza operacional, sempre com backup prévio.') +
    `<div class="grid cols-3" data-status>${loadingBox()}</div>
     <div class="grid cols-2 mt-2">
       <div class="card"><div class="card-head"><div><h2>Carregar demonstração</h2><p>Substitui os dados pelo exemplo completo de 12 meses.</p></div></div>
         <div class="card-body"><div class="notice">Usuários e configurações são preservados; cadastros, contratos, financeiro e documentos são substituídos.</div>
         <button class="btn primary mt-2" data-demo>Carregar demonstração</button></div></div>
       <div class="card"><div class="card-head"><div><h2>Zerar dados operacionais</h2><p>Limpa cadastros e histórico para começar do zero.</p></div></div>
         <div class="card-body"><div class="notice danger">Usuários e configurações permanecem. Um backup do banco é criado em <code>data/backups/</code> antes da operação.</div>
         <button class="btn danger mt-2" data-zerar>Zerar dados</button></div></div>
     </div>
     <div class="card mt-2"><div class="card-head"><div><h2>Instância de demonstração separada</h2><p>Rode <code>npm run demo:servir</code> para apresentar em outra porta sem tocar na produção.</p></div></div>
       <div class="card-body"><p class="small muted">Banco em <code>data-demo/</code>, porta 3009. Pode rodar ao mesmo tempo que o sistema principal.</p></div></div>`;
  const carregar = async () => {
    try {
      status = await api('/manutencao/status');
      const c = status.contagens || {};
      root.querySelector('[data-status]').innerHTML = ['proprietarios', 'imoveis', 'contratos', 'lancamentos', 'cobrancas', 'documentos']
        .map(t => stat(t, String(c[t] ?? 0))).join('');
    } catch (e) { root.querySelector('[data-status]').innerHTML = erroBox(e); }
  };
  root.querySelector('[data-demo]').onclick = async () => {
    if (!await confirmarTexto({ titulo: 'Carregar demonstração', mensagem: 'Isto substitui os dados operacionais pelo exemplo de 12 meses. Um backup prévio será criado.', palavra: 'DEMO', textoBotao: 'Carregar demonstração' })) return;
    try { await api('/manutencao/demo', { method: 'POST', body: { confirmacao: 'DEMO' } }); toast('Demonstração carregada.'); carregar(); } catch (e) { toast(e.message, 'err'); }
  };
  root.querySelector('[data-zerar]').onclick = async () => {
    if (!await confirmarTexto({ titulo: 'Zerar dados operacionais', mensagem: 'Cadastros, contratos, financeiro e documentos serão removidos. Usuários e configurações permanecem. Um backup prévio será criado.', palavra: 'ZERAR', textoBotao: 'Zerar dados' })) return;
    try { await api('/manutencao/limpar', { method: 'POST', body: { confirmacao: 'ZERAR' } }); toast('Dados operacionais removidos.'); carregar(); } catch (e) { toast(e.message, 'err'); }
  };
  await carregar();
}
