import { db } from './db.js';
import {
  competenciaAtual, saldos, alertas, brl,
} from './regras.js';
import { resumo as resumoCobrancas, listar as listarCobrancas } from './cobrancas.js';
import { analytics } from './analytics.js';
import { resumo as resumoContas, previsaoCaixa } from './contas.js';
import { resumo as resumoComissoes } from './comissoes.js';
import { resumoAnaliseFutura, analiseFutura } from './previsao.js';
import { drePorImovel } from './dre.js';

/**
 * Assistente interno de gestão.
 *
 * Funciona sem serviço externo e sem enviar dados para fora: interpreta a
 * pergunta, consulta o próprio SQLite e devolve uma resposta curta com números,
 * links e sugestões. É deliberadamente determinístico — cada resposta pode ser
 * explicada e testada. Quando não entende, apresenta um resumo executivo em vez
 * de inventar informação.
 */

const MESES = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function compBR(comp) {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [ano, mes] = String(comp || '').split('-');
  return `${meses[Number(mes) - 1] || mes}/${ano}`;
}

function dataBR(iso) {
  const s = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : (iso || '—');
}

function addComp(comp, delta) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Extrai um período (competência inicial/final) das expressões mais comuns. */
export function periodoDaPergunta(pergunta, referencia = competenciaAtual()) {
  const t = normalizar(pergunta);
  const comp = /^\d{4}-\d{2}$/.test(String(referencia)) ? String(referencia) : competenciaAtual();
  const [ano, mes] = comp.split('-').map(Number);
  const rotuloMes = (c) => compBR(c);

  if (/\bano passado\b|\bultimo ano\b/.test(t)) {
    return { de: `${ano - 1}-01`, ate: `${ano - 1}-12`, rotulo: `ano ${ano - 1}` };
  }
  if (/\bano atual\b|\beste ano\b|\besse ano\b|\bno ano\b/.test(t)) {
    return { de: `${ano}-01`, ate: comp, rotulo: `ano ${ano}` };
  }
  if (/\bmes passado\b|\bultimo mes\b/.test(t)) {
    const anterior = addComp(comp, -1);
    return { de: anterior, ate: anterior, rotulo: compBR(anterior) };
  }
  const ultimos = t.match(/ultimos?\s+(\d{1,2})\s+mes/);
  if (ultimos) {
    const n = Math.min(Math.max(Number(ultimos[1]) || 1, 1), 36);
    return { de: addComp(comp, -(n - 1)), ate: comp, rotulo: `últimos ${n} meses` };
  }
  const nomeMes = t.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b(?:\s+(?:de\s+)?(\d{4}))?/);
  if (nomeMes) {
    const m = MESES[nomeMes[1]];
    let a = nomeMes[2] ? Number(nomeMes[2]) : ano;
    if (!nomeMes[2] && m > mes) a -= 1;
    const c = `${a}-${String(m).padStart(2, '0')}`;
    return { de: c, ate: c, rotulo: compBR(c) };
  }
  if (/\bmes atual\b|\beste mes\b|\besse mes\b|\bno mes\b|\bdo mes\b/.test(t)) {
    return { de: comp, ate: comp, rotulo: compBR(comp) };
  }
  return { de: comp, ate: comp, rotulo: rotuloMes(comp) };
}

function rotuloPeriodo(p) {
  return p.de === p.ate ? p.rotulo : `${compBR(p.de)} a ${compBR(p.ate)}`;
}

function link(rota, texto = 'Abrir') {
  return { rotulo: texto, rota };
}

function resposta({ intencao, texto, destaques = [], itens = [], acoes = [], sugestoes = [] }) {
  return {
    intencao,
    resposta: texto,
    destaques: destaques.slice(0, 4),
    itens: itens.slice(0, 8),
    acoes: acoes.slice(0, 4),
    sugestoes: (sugestoes.length ? sugestoes : SUGESTOES_PADRAO).slice(0, 4),
  };
}

const SUGESTOES_PADRAO = [
  'Resumo do mês',
  'Quem está inadimplente?',
  'Quais contratos vencem em 90 dias?',
  'Quanto tenho a receber e a pagar?',
];

function resumoExecutivo(pergunta = '') {
  const p = periodoDaPergunta(pergunta);
  const comp = /^\d{4}-\d{2}$/.test(p.ate) ? p.ate : competenciaAtual();
  const analise = analytics({ de: p.de, ate: p.ate, comparar: true });
  const k = analise.kpis;
  const variacao = analise.comparativo?.receita_imob?.variacao || 0;
  const cr = resumoCobrancas(comp);
  const al = alertas();
  const urgentes = al.filter(a => a.nivel === 'urgente');
  const tendencia = Math.abs(variacao) < 0.5
    ? 'estável em relação ao mês anterior'
    : `${variacao > 0 ? 'alta' : 'queda'} de ${Math.abs(variacao).toFixed(1)}% em relação ao mês anterior`;

  return resposta({
    intencao: 'resumo',
    texto: `Em ${rotuloPeriodo(p)}, a imobiliária faturou ${brl(k.receita_imob)}, com ${brl(k.alugueis)} em aluguéis e ${brl(k.inadimplencia)} de inadimplência (${(k.inadimplencia_pct || 0).toFixed(1)}% do previsto). A receita está ${tendencia}. Há ${cr.vencidas} cobrança(s) vencida(s) e ${urgentes.length} alerta(s) urgente(s).`,
    destaques: [
      { rotulo: 'Receita da imobiliária', valor: brl(k.receita_imob) },
      { rotulo: 'Aluguéis', valor: brl(k.alugueis) },
      { rotulo: 'Inadimplência', valor: brl(k.inadimplencia) },
      { rotulo: 'Ocupação', valor: `${(k.ocupacao_pct || 0).toFixed(0)}%` },
    ],
    itens: urgentes.slice(0, 4).map(a => ({
      titulo: a.titulo,
      detalhe: a.descricao,
      valor: a.valor_centavos ? brl(a.valor_centavos) : '',
      rota: a.tipo === 'contrato' || a.tipo === 'reajuste' || a.tipo === 'garantia' ? '#/alertas' : '#/cobrancas',
    })),
    acoes: [link('#/painel', 'Ver painel'), link('#/cobrancas', 'Cobranças'), link('#/alertas', 'Alertas')],
  });
}

function inadimplencia() {
  const comp = competenciaAtual();
  const cr = resumoCobrancas(comp);
  const vencidas = listarCobrancas({ status: 'vencidas', limite: 5000 })
    .sort((a, b) => (b.saldo_centavos || 0) - (a.saldo_centavos || 0));
  const total = vencidas.reduce((s, c) => s + (c.saldo_centavos || 0), 0);
  const faixa = (() => {
    const a = cr.aging_valores || {};
    const maior = Object.entries(a).sort((x, y) => y[1] - x[1])[0];
    return maior && maior[1] > 0 ? `A maior parte (${brl(maior[1])}) está na faixa de ${maior[0]} dias.` : '';
  })();
  const texto = vencidas.length
    ? `Há ${vencidas.length} cobrança(s) vencida(s), somando ${brl(total)} em saldo atualizado com multa e juros. ${faixa} Os maiores saldos estão abaixo; a confirmação de pagamento continua sendo manual.`
    : `Não há cobranças vencidas neste momento. O saldo em aberto da carteira é de ${brl(cr.valor_aberto)}.`;
  return resposta({
    intencao: 'inadimplencia',
    texto,
    destaques: [
      { rotulo: 'Vencido', valor: brl(total || cr.valor_vencido) },
      { rotulo: 'Cobranças vencidas', valor: String(vencidas.length || cr.vencidas) },
      { rotulo: 'Em aberto', valor: brl(cr.valor_aberto) },
    ],
    itens: vencidas.slice(0, 6).map(c => ({
      titulo: `${c.inquilino_nome} · ${c.endereco}${c.numero ? ', ' + c.numero : ''}`,
      detalhe: `Vencimento ${dataBR(c.vencimento)} · ${c.dias_atraso} dia(s) de atraso${c.contrato_codigo ? ` · ${c.contrato_codigo}` : ''}`,
      valor: brl(c.saldo_centavos),
      rota: `#/cobrancas?busca=${encodeURIComponent(c.inquilino_nome)}`,
    })),
    acoes: [link('#/cobrancas', 'Abrir cobranças'), link('#/relatorios', 'Relatórios')],
    sugestoes: ['Quanto recebi neste mês?', 'Como faço uma baixa parcial?', 'Resumo do mês', 'Quais contratos vencem em 90 dias?'],
  });
}

function cobrancas(pergunta) {
  const p = periodoDaPergunta(pergunta);
  const analise = analytics({ de: p.de, ate: p.ate });
  const k = analise.kpis;
  const comp = /^\d{4}-\d{2}$/.test(p.ate) ? p.ate : competenciaAtual();
  const cr = resumoCobrancas(comp);
  const texto = `Em ${rotuloPeriodo(p)}, entraram ${brl(k.alugueis)} de aluguéis e ${brl(k.receita_imob)} de receita da imobiliária. A inadimplência do período foi de ${brl(k.inadimplencia)} (${(k.inadimplencia_pct || 0).toFixed(1)}% do previsto). A competência ${compBR(comp)} tem ${cr.abertas} cobrança(s) em aberto, somando ${brl(cr.valor_aberto)}.`;
  return resposta({
    intencao: 'cobrancas',
    texto,
    destaques: [
      { rotulo: 'Aluguéis recebidos', valor: brl(k.alugueis) },
      { rotulo: 'Receita da imobiliária', valor: brl(k.receita_imob) },
      { rotulo: 'Inadimplência', valor: `${(k.inadimplencia_pct || 0).toFixed(1)}%` },
      { rotulo: 'Em aberto', valor: brl(cr.valor_aberto) },
    ],
    itens: (cr.hoje || []).slice(0, 4).map(c => ({
      titulo: `Vence hoje: ${c.endereco}${c.numero ? ', ' + c.numero : ''}`,
      detalhe: `Contrato ${c.contrato_codigo || '—'} · ${c.inquilino_nome}`,
      valor: brl(c.saldo_centavos ?? c.valor_original_centavos),
      rota: '#/cobrancas',
    })),
    acoes: [link(`#/cobrancas?competencia=${comp}`, 'Ver competência'), link('#/relatorios', 'Exportar relatório')],
    sugestoes: ['Quem está inadimplente?', 'Quanto tenho a receber e a pagar?', 'Resumo do mês', 'Qual imóvel rende mais?'],
  });
}

function repasses(pergunta) {
  const p = periodoDaPergunta(pergunta);
  const comp = /^\d{4}-\d{2}$/.test(p.ate) ? p.ate : competenciaAtual();
  const linhas = db.prepare(`
    SELECT r.*, p.nome AS proprietario_nome
    FROM repasses r JOIN proprietarios p ON p.id = r.proprietario_id
    WHERE r.competencia = ? ORDER BY r.valor_centavos DESC`).all(comp);
  const pendentes = linhas.filter(r => r.status === 'calculado');
  const pagos = linhas.filter(r => r.status === 'pago');
  const totalPend = pendentes.reduce((s, r) => s + r.valor_centavos, 0);
  const totalPago = pagos.reduce((s, r) => s + r.valor_centavos, 0);
  const texto = linhas.length
    ? `Na competência ${compBR(comp)} há ${linhas.length} repasse(s): ${pendentes.length} pendente(s) (${brl(totalPend)}) e ${pagos.length} pago(s) (${brl(totalPago)}). O cálculo usa a taxa vigente do contrato, do imóvel ou do proprietário, nesta ordem de precedência.`
    : `Ainda não há repasses calculados para ${compBR(comp)}. Gere-os em Repasses depois de baixar as cobranças.`;
  return resposta({
    intencao: 'repasses',
    texto,
    destaques: [
      { rotulo: 'Pendente', valor: brl(totalPend) },
      { rotulo: 'Pago', valor: brl(totalPago) },
      { rotulo: 'Proprietários', valor: String(linhas.length) },
    ],
    itens: linhas.slice(0, 6).map(r => ({
      titulo: r.proprietario_nome,
      detalhe: `${r.status === 'pago' ? 'Pago' : 'Aguardando pagamento'} · taxa ${Number(r.taxa_pct || 0).toFixed(2)}%`,
      valor: brl(r.valor_centavos),
      rota: '#/repasses',
    })),
    acoes: [link('#/repasses', 'Abrir repasses'), link('#/fechamentos', 'Fechamento')],
    sugestoes: ['Qual o saldo dos proprietários?', 'Resumo do mês', 'Quanto tenho a receber e a pagar?', 'Quem está inadimplente?'],
  });
}

function caixa() {
  const s = saldos();
  return resposta({
    intencao: 'caixa',
    texto: `O caixa da imobiliária está em ${brl(s.imobiliaria_centavos)} e o caixa dos proprietários em ${brl(s.proprietarios_centavos)}. Esses valores consideram apenas lançamentos ativos; repasses pagos e despesas já saíram.`,
    destaques: [
      { rotulo: 'Caixa da imobiliária', valor: brl(s.imobiliaria_centavos) },
      { rotulo: 'Caixa dos proprietários', valor: brl(s.proprietarios_centavos) },
      { rotulo: 'Receitas da imobiliária', valor: brl(s.receitas_imob_centavos) },
      { rotulo: 'Despesas da imobiliária', valor: brl(s.despesas_imob_centavos) },
    ],
    acoes: [link('#/lancamentos', 'Lançamentos'), link('#/contas', 'Contas e previsão')],
    sugestoes: ['Quanto tenho a receber e a pagar?', 'Como está a previsão de caixa?', 'Resumo do mês', 'Quanto ficou de repasse pendente?'],
  });
}

function contas() {
  const r = resumoContas();
  const previsao = previsaoCaixa({ meses: 3 });
  const proximos = previsao.meses || [];
  const texto = `Há ${r.contas_abertas} conta(s) em aberto: ${brl(r.a_pagar)} a pagar e ${brl(r.a_receber)} a receber. Desse total, ${brl(r.vencido_pagar)} em contas a pagar e ${brl(r.vencido_receber)} a receber já estão vencidos. A previsão de 3 meses aponta saldo acumulado de ${previsao.meses?.at(-1)?.saldo_formatado || 'R$ 0,00'}.`;
  return resposta({
    intencao: 'contas',
    texto,
    destaques: [
      { rotulo: 'A pagar', valor: brl(r.a_pagar) },
      { rotulo: 'A receber', valor: brl(r.a_receber) },
      { rotulo: 'Vencido a pagar', valor: brl(r.vencido_pagar) },
      { rotulo: 'Saldo projetado (3m)', valor: proximos.at(-1)?.saldo_formatado || '—' },
    ],
    itens: proximos.map(m => ({
      titulo: compBR(m.competencia),
      detalhe: `Entradas ${m.entradas_formatado} · Saídas ${m.saidas_formatado}`,
      valor: m.saldo_formatado,
      rota: '#/contas',
    })),
    acoes: [link('#/contas', 'Abrir contas'), link('#/lancamentos', 'Lançamentos')],
    sugestoes: ['Qual o saldo da imobiliária?', 'Quanto ficou de repasse pendente?', 'Resumo do mês', 'Como está a ocupação dos imóveis?'],
  });
}

function contratosAlerta(pergunta) {
  const t = normalizar(pergunta);
  const janela = Number((t.match(/(\d{1,3})\s*dias/) || [])[1] || 90);
  const lista = alertas().filter(a => a.tipo === 'contrato' || a.tipo === 'garantia');
  const filtrados = lista.filter(a => a.dias <= janela);
  const texto = filtrados.length
    ? `${filtrados.length} contrato(s)/garantia(s) exigem atenção nos próximos ${janela} dias. Os mais próximos estão abaixo; renovação e reajuste precisam de decisão humana.`
    : `Nenhum contrato ou garantia vence nos próximos ${janela} dias, considerando os alertas configurados.`;
  return resposta({
    intencao: 'contratos',
    texto,
    destaques: [
      { rotulo: 'Contratos ativos', valor: String(db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE status='ativo'").get().n) },
      { rotulo: 'Na janela', valor: String(filtrados.length) },
      { rotulo: 'Janela', valor: `${janela} dias` },
    ],
    itens: filtrados.slice(0, 6).map(a => ({
      titulo: a.titulo,
      detalhe: a.descricao,
      valor: a.dias < 0 ? `${Math.abs(a.dias)}d atrasado` : `${a.dias}d`,
      rota: '#/alertas',
    })),
    acoes: [link('#/contratos', 'Abrir contratos'), link('#/alertas', 'Ver todos os alertas')],
    sugestoes: ['Quais contratos precisam de reajuste?', 'Quem está inadimplente?', 'Resumo do mês', 'Como está a ocupação dos imóveis?'],
  });
}

function reajustes() {
  const lista = alertas().filter(a => a.tipo === 'reajuste');
  const texto = lista.length
    ? `${lista.length} contrato(s) têm reajuste previsto em breve. A base é o último reajuste (ou o início do contrato) mais 12 meses, usando o índice cadastrado. Você pode aplicar em lote com prévia antes de confirmar.`
    : 'Nenhum reajuste está dentro da janela de alerta configurada. Você pode conferir todos os contratos e antecipar a revisão do índice.';
  return resposta({
    intencao: 'reajustes',
    texto,
    destaques: [{ rotulo: 'Reajustes na janela', valor: String(lista.length) }],
    itens: lista.slice(0, 6).map(a => ({
      titulo: a.titulo,
      detalhe: a.descricao,
      valor: `${a.dias}d`,
      rota: '#/contratos',
    })),
    acoes: [link('#/contratos', 'Aplicar reajuste em lote'), link('#/alertas', 'Ver alertas')],
    sugestoes: ['Quais contratos vencem em 90 dias?', 'Resumo do mês', 'Qual imóvel rende mais?', 'Quem está inadimplente?'],
  });
}

function ocupacao() {
  const comp = competenciaAtual();
  const a = analytics({ de: comp, ate: comp });
  const k = a.kpis;
  const vagos = db.prepare("SELECT endereco, numero, complemento, apelido FROM imoveis WHERE ativo=1 AND situacao='vago' ORDER BY endereco LIMIT 6").all();
  const texto = `A carteira tem ${k.imoveis_total} imóvel(is) ativo(s), com ${k.imoveis_alugados} alugado(s) e ocupação de ${(k.ocupacao_pct || 0).toFixed(0)}%. ${vagos.length ? `${vagos.length} imóvel(is) estão vagos e podem entrar na próxima conversa comercial.` : 'Não há imóveis vagos cadastrados.'}`;
  return resposta({
    intencao: 'ocupacao',
    texto,
    destaques: [
      { rotulo: 'Imóveis', valor: String(k.imoveis_total) },
      { rotulo: 'Alugados', valor: String(k.imoveis_alugados) },
      { rotulo: 'Ocupação', valor: `${(k.ocupacao_pct || 0).toFixed(0)}%` },
      { rotulo: 'Ticket médio', valor: brl(k.ticket_medio) },
    ],
    itens: vagos.map(i => ({
      titulo: `${i.endereco}${i.numero ? ', ' + i.numero : ''}${i.complemento ? ' - ' + i.complemento : ''}`,
      detalhe: i.apelido || 'Imóvel vago',
      valor: 'Vago',
      rota: '#/imoveis',
    })),
    acoes: [link('#/imoveis', 'Abrir imóveis'), link('#/contratos', 'Contratos')],
    sugestoes: ['Qual imóvel rende mais?', 'Resumo do mês', 'Quais contratos vencem em 90 dias?', 'Quanto tenho a receber e a pagar?'],
  });
}

function rentabilidade(pergunta) {
  const p = periodoDaPergunta(pergunta);
  const dre = drePorImovel({ de: p.de, ate: p.ate });
  const linhas = [...dre.linhas].sort((a, b) => b.resultado_imobiliaria_centavos - a.resultado_imobiliaria_centavos);
  const melhor = linhas[0];
  const texto = melhor
    ? `Em ${rotuloPeriodo(p)}, o imóvel com maior resultado para a imobiliária é ${melhor.imovel}, com ${brl(melhor.resultado_imobiliaria_centavos)} (margem de ${melhor.margem_pct.toFixed(1)}%). No total, a carteira gerou ${brl(dre.totais.resultado_imobiliaria_centavos)} para a imobiliária e ${brl(dre.totais.resultado_proprietario_centavos)} para os proprietários.`
    : `Ainda não há receita suficiente em ${rotuloPeriodo(p)} para montar o DRE por imóvel.`;
  return resposta({
    intencao: 'rentabilidade',
    texto,
    destaques: [
      { rotulo: 'Resultado da imobiliária', valor: brl(dre.totais.resultado_imobiliaria_centavos) },
      { rotulo: 'Resultado dos proprietários', valor: brl(dre.totais.resultado_proprietario_centavos) },
      { rotulo: 'Aluguéis', valor: brl(dre.totais.alugueis_centavos) },
      { rotulo: 'Taxa administrada', valor: brl(dre.totais.taxa_centavos) },
    ],
    itens: linhas.slice(0, 6).map(l => ({
      titulo: l.imovel,
      detalhe: `${l.proprietario} · margem ${l.margem_pct.toFixed(1)}%`,
      valor: brl(l.resultado_imobiliaria_centavos),
      rota: '#/relatorios',
    })),
    acoes: [link('#/relatorios', 'Abrir relatórios'), link('#/painel', 'Ver painel')],
    sugestoes: ['Como está a ocupação dos imóveis?', 'Resumo do mês', 'Quem está inadimplente?', 'Quanto tenho a receber e a pagar?'],
  });
}

function previsao() {
  return resumoAnaliseFutura();
}

function riscosCarteira() {
  const a = analiseFutura({ meses: 12, horizonte: 3 });
  const criticos = a.riscos.filter(r => r.nivel !== 'info');
  return resposta({
    intencao: 'riscos',
    texto: criticos.length
      ? `Encontrei ${criticos.length} ponto(s) de atenção na carteira. ${criticos.map(r => `${r.titulo}: ${r.descricao}`).join(' ')}`
      : 'Nenhum risco crítico pelos indicadores atuais. A ocupação e a inadimplência estão dentro da faixa de referência.',
    destaques: [
      { rotulo: 'Inadimplência', valor: `${a.indicadores.inadimplencia_pct}%` },
      { rotulo: 'Ocupação', valor: `${a.indicadores.ocupacao_pct}%` },
      { rotulo: 'Meses de caixa', valor: a.indicadores.meses_de_caixa == null ? '—' : String(a.indicadores.meses_de_caixa) },
      { rotulo: 'Tendência', valor: a.tendencia.receita },
    ],
    itens: a.riscos.slice(0, 6).map(r => ({
      titulo: r.titulo,
      detalhe: `${r.descricao} Ação: ${r.acao}`,
      valor: r.nivel === 'alto' ? 'Alto' : r.nivel === 'atencao' ? 'Atenção' : 'OK',
      rota: '#/analises',
    })),
    acoes: [link('#/analises', 'Abrir análises'), link('#/alertas', 'Ver alertas')],
    sugestoes: ['Qual a previsão dos próximos meses?', 'Quem está inadimplente?', 'Resumo do mês', 'Quanto tenho a receber e a pagar?'],
  });
}

function comissoes() {
  const comp = competenciaAtual();
  const r = resumoComissoes(comp);
  const texto = `Em ${compBR(comp)}, há ${r.quantidade} comissão(ões): ${brl(r.previstas_centavos)} previstas/liberadas e ${brl(r.pagas_centavos)} pagas. ${r.corretores.length ? `Corretores com lançamentos: ${r.corretores.join(', ')}.` : 'Nenhum corretor lançado neste mês.'}`;
  return resposta({
    intencao: 'comissoes',
    texto,
    destaques: [
      { rotulo: 'Previstas/liberadas', valor: brl(r.previstas_centavos) },
      { rotulo: 'Pagas', valor: brl(r.pagas_centavos) },
      { rotulo: 'Total', valor: brl(r.total_centavos) },
    ],
    acoes: [link('#/comissoes', 'Abrir comissões'), link('#/contratos', 'Contratos')],
    sugestoes: ['Quanto ficou de repasse pendente?', 'Resumo do mês', 'Quem está inadimplente?', 'Qual imóvel rende mais?'],
  });
}

function ajuda(pergunta) {
  const t = normalizar(pergunta);
  const topicos = [
    { chaves: /pix/, titulo: 'Pix', texto: 'Cada cobrança tem um BR Code Pix gerado pelo próprio sistema, com valor e txid. O txid também ajuda na conciliação. Configure a chave em Configurações → Pix.', rota: '#/cobrancas' },
    { chaves: /whatsapp|cobrar|comunic/, titulo: 'Comunicação', texto: 'Na cobrança você pode gerar um link do WhatsApp com a mensagem pronta. Com a Cloud API configurada, o envio é registrado no histórico de comunicações.', rota: '#/cobrancas' },
    { chaves: /baixa|pagamento|recebi/, titulo: 'Baixa de cobrança', texto: 'Abra a cobrança e use “Registrar pagamento”. Pagamentos parciais continuam gerando multa e juros sobre o saldo; o recibo e a auditoria são automáticos.', rota: '#/cobrancas' },
    { chaves: /reajuste/, titulo: 'Reajuste', texto: 'Em Contratos existe o reajuste em lote com prévia. O sistema calcula o aniversário do contrato e usa o índice cadastrado; a confirmação é sempre humana.', rota: '#/contratos' },
    { chaves: /concili|extrato|ofx|csv/, titulo: 'Conciliação', texto: 'Importe OFX/CSV em Conciliação. O sistema sugere vínculos por valor, data e txid; você confirma ou ignora cada sugestão.', rota: '#/conciliacao' },
    { chaves: /relatorio|export|pdf|xlsx/, titulo: 'Relatórios', texto: 'Em Relatórios você exporta o mesmo recorte em CSV, XLSX e PDF, incluindo DRE por imóvel. Os valores seguem o período selecionado.', rota: '#/relatorios' },
    { chaves: /lgpd|privacidade|dados/, titulo: 'LGPD', texto: 'A área de Privacidade permite exportar e anonimizar dados, com registro em auditoria. A retenção é configurável em Configurações.', rota: '#/lgpd' },
    { chaves: /backup|restaur/, titulo: 'Backup', texto: 'Em Manutenção você baixa um .zip com banco e documentos e verifica a integridade. Guarde cópias fora do servidor e teste a restauração.', rota: '#/manutencao' },
  ];
  const topico = topicos.find(x => x.chaves.test(t));
  if (topico) {
    return resposta({
      intencao: 'ajuda',
      texto: topico.texto,
      acoes: [link(topico.rota, `Abrir ${topico.titulo}`)],
      sugestoes: ['Resumo do mês', 'Quem está inadimplente?', 'Quanto tenho a receber e a pagar?', 'Quais contratos vencem em 90 dias?'],
    });
  }
  const rotas = [
    { chaves: /cobranca/, rota: '#/cobrancas', nome: 'Cobranças' },
    { chaves: /contrato/, rota: '#/contratos', nome: 'Contratos' },
    { chaves: /imovel|imoveis/, rota: '#/imoveis', nome: 'Imóveis' },
    { chaves: /proprietario/, rota: '#/proprietarios', nome: 'Proprietários' },
    { chaves: /inquilino/, rota: '#/inquilinos', nome: 'Inquilinos' },
    { chaves: /repasse/, rota: '#/repasses', nome: 'Repasses' },
    { chaves: /relatorio/, rota: '#/relatorios', nome: 'Relatórios' },
    { chaves: /configura/, rota: '#/configuracoes', nome: 'Configurações' },
  ];
  const destino = rotas.find(x => x.chaves.test(t));
  if (destino) {
    return resposta({
      intencao: 'navegar',
      texto: `A tela de ${destino.nome} fica em ${destino.rota.replace('#/', '')}. Posso resumir os números ou explicar o fluxo antes de você abrir.`,
      acoes: [link(destino.rota, `Abrir ${destino.nome}`)],
    });
  }
  return resposta({
    intencao: 'ajuda',
    texto: 'Posso consultar a carteira e explicar rotinas: inadimplência, cobranças, repasses, caixa, contratos a vencer, reajustes, ocupação, rentabilidade por imóvel, comissões, contas a pagar/receber, previsões e riscos. Também indico onde fica cada tela. Tudo é calculado no seu banco, sem enviar dados para fora.',
    acoes: [link('#/painel', 'Ver painel'), link('#/relatorios', 'Relatórios')],
    sugestoes: ['Resumo do mês', 'Quem está inadimplente?', 'Como faço uma baixa parcial?', 'Quanto tenho a receber e a pagar?'],
  });
}

/* Busca simples por nome quando a pergunta cita alguém ou um imóvel. */
function buscar(pergunta) {
  const termos = normalizar(pergunta)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .filter(p => p.length >= 3 && !['quem', 'qual', 'quais', 'sobre', 'fale', 'mostre', 'dados', 'contrato', 'imovel', 'imóvel', 'cliente', 'inquilino', 'proprietario', 'proprietário', 'esta', 'este', 'para', 'como', 'onde', 'quanto'].includes(p));
  if (!termos.length) return null;
  const termo = termos.join(' ');
  const like = `%${termo}%`;
  const props = db.prepare('SELECT id, nome, email, telefone FROM proprietarios WHERE lower(nome) LIKE ? LIMIT 3').all(like);
  const inqs = db.prepare('SELECT id, nome, email, telefone FROM inquilinos WHERE lower(nome) LIKE ? LIMIT 3').all(like);
  const imoveis = db.prepare(`SELECT id, endereco, numero, complemento, situacao FROM imoveis
    WHERE lower(endereco || ' ' || COALESCE(numero,'') || ' ' || COALESCE(complemento,'')) LIKE ? LIMIT 3`).all(like);
  const contratos = db.prepare("SELECT id, codigo, status FROM contratos WHERE lower(codigo) LIKE ? LIMIT 3").all(like);
  const itens = [
    ...props.map(p => ({ titulo: p.nome, detalhe: `Proprietário · ${p.email || p.telefone || 'sem contato'}`, valor: '', rota: '#/proprietarios' })),
    ...inqs.map(p => ({ titulo: p.nome, detalhe: `Inquilino · ${p.email || p.telefone || 'sem contato'}`, valor: '', rota: '#/inquilinos' })),
    ...imoveis.map(i => ({ titulo: `${i.endereco}${i.numero ? ', ' + i.numero : ''}${i.complemento ? ' - ' + i.complemento : ''}`, detalhe: `Imóvel · ${i.situacao}`, valor: '', rota: '#/imoveis' })),
    ...contratos.map(c => ({ titulo: c.codigo, detalhe: `Contrato · ${c.status}`, valor: '', rota: '#/contratos' })),
  ];
  if (!itens.length) return null;
  return resposta({
    intencao: 'busca',
    texto: `Encontrei ${itens.length} registro(s) com “${termo}”. Posso detalhar a inadimplência, os repasses ou a rentabilidade se você disser o que precisa saber.`,
    itens,
    acoes: [link('#/painel', 'Voltar ao painel')],
  });
}

/** Ponto de entrada: recebe a pergunta e devolve uma resposta estruturada. */
export function responder(pergunta) {
  const original = String(pergunta || '').trim();
  if (!original) {
    return resposta({
      intencao: 'vazio',
      texto: 'Faça uma pergunta sobre a carteira. Exemplos: “quem está inadimplente?”, “quanto recebi em outubro?” ou “quais contratos vencem em 90 dias?”.',
    });
  }
  if (original.length > 500) {
    return resposta({ intencao: 'limite', texto: 'A pergunta é longa demais. Resuma em até 500 caracteres para eu consultar os dados.' });
  }

  const t = normalizar(original);
  if (/^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|e ai)\b/.test(t) && t.split(' ').length <= 4) {
    return resposta({
      intencao: 'saudacao',
      texto: 'Olá! Sou o assistente interno. Posso consultar inadimplência, caixa, repasses, contratos a vencer, reajustes, ocupação, rentabilidade e contas. O que você quer saber?',
    });
  }

  if (/previsao|previsão|projec|futuro|proximos meses|próximos meses|tendencia|tendência|cenario|cenário|simular/.test(t)) return previsao();
  if (/risco|riscos|saude|saúde da carteira|ameaca|ameaça/.test(t)) return riscosCarteira();
  if (/inadimpl|atrasad|vencid|quem deve|devedor|nao pagou|nao recebi|em atraso/.test(t)) return inadimplencia();
  if (/reajuste|dissidio|aniversario|igp-m|igpm|ipca/.test(t)) return reajustes();
  if (/contrato/.test(t) && /venc|termin|fim|garantia|proxim|alerta/.test(t)) return contratosAlerta(original);
  if (/contrato/.test(t) && /reajuste|dissidio|indice/.test(t)) return reajustes();
  if (/repasse/.test(t)) return repasses(original);
  if (/comissao|corretor/.test(t)) return comissoes();
  if (/previsao|fluxo de caixa/.test(t)) return contas();
  if (/conta/.test(t) && /pagar|receber|previsao|fluxo|caixa/.test(t)) return contas();
  if (/a receber|receber e a pagar|contas? a pagar|pagar e receber|quanto tenho a pagar/.test(t)) return contas();
  if (/saldo|caixa|quanto tenho|disponivel/.test(t)) return caixa();
  if (/ocupacao|vago|alugado|carteira de imoveis|quantos imoveis/.test(t)) {
    if (/rend|rentab|resultado|dre|melhor|top|margem/.test(t)) return rentabilidade(original);
    return ocupacao();
  }
  if (/imovel|imoveis|propriedade/.test(t) && /rend|rentab|resultado|dre|melhor|top|margem/.test(t)) return rentabilidade(original);
  if (/contrato/.test(t) && /quantos|ativos|lista|status/.test(t)) return contratosAlerta(original);
  if (/cobranca|recebi|recebido|receita|faturamento|alugueis|aluguel/.test(t)) return cobrancas(original);
  if (/relatorio|exportar|pdf|xlsx|csv/.test(t)) return ajuda(original);
  if (/pix|whatsapp|concili|baixa|pagamento|backup|lgpd|privacidade|reajuste/.test(t)) return ajuda(original);
  if (/onde fica|abrir|ir para|navegar|tela/.test(t)) return ajuda(original);

  const achado = buscar(original);
  if (achado) return achado;
  return resumoExecutivo(original);
}

/** Sugestões iniciais exibidas na interface. */
export function sugestoesIniciais() {
  return SUGESTOES_PADRAO;
}

/** Contexto curto para telas: evita que o usuário comece com a caixa vazia. */
export function contextoRapido() {
  const comp = competenciaAtual();
  const cr = resumoCobrancas(comp);
  const al = alertas();
  return {
    competencia: comp,
    vencidas: cr.vencidas,
    valor_vencido_centavos: cr.valor_vencido,
    alertas_urgentes: al.filter(a => a.nivel === 'urgente').length,
    sugestoes: SUGESTOES_PADRAO,
  };
}

