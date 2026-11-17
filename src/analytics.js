import { db } from './db.js';
import { getSettingNum, saldos, alertas, hojeISO, competenciaAtual } from './regras.js';
import { resumo as resumoCobrancas } from './cobrancas.js';
import { resumo as resumoContas, previsaoCaixa } from './contas.js';
import { resumo as resumoComissoes } from './comissoes.js';

export function addMesesComp(comp, delta) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function mesesEntre(de, ate) {
  const out = [];
  let atual = de;
  let guard = 0;
  while (atual <= ate && guard++ < 240) {
    out.push(atual);
    atual = addMesesComp(atual, 1);
  }
  return out;
}

export function ultimoDia(comp) {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}

function sqlProp(propId, alias = 'l') {
  const id = Number(propId);
  return Number.isFinite(id) && id > 0 ? ` AND ${alias}.proprietario_id = ${id}` : '';
}

/** Série mensal consolidada. */
export function serieMensal(de, ate, propId = null) {
  const meses = mesesEntre(de, ate);
  const rows = db.prepare(`
    SELECT l.competencia,
      SUM(CASE WHEN l.tipo='receita' AND l.caixa='proprietarios' AND l.categoria='Aluguel' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS alugueis,
      SUM(CASE WHEN l.tipo='receita' AND l.caixa='proprietarios' AND l.categoria<>'Aluguel' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS outras_prop,
      SUM(CASE WHEN l.tipo='receita' AND l.caixa='imobiliaria' AND l.categoria='Taxa de administração' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS taxa,
      SUM(CASE WHEN l.tipo='receita' AND l.caixa='imobiliaria' AND l.categoria<>'Taxa de administração' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS outras_imob,
      SUM(CASE WHEN l.tipo='despesa' AND l.caixa='imobiliaria' THEN l.valor_centavos ELSE 0 END) AS desp_imob,
      SUM(CASE WHEN l.tipo='despesa' AND l.caixa='proprietarios' AND l.categoria='Repasse ao proprietário' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS repasses,
      SUM(CASE WHEN l.tipo='despesa' AND l.caixa='proprietarios' AND l.categoria<>'Repasse ao proprietário' COLLATE NOCASE THEN l.valor_centavos ELSE 0 END) AS desp_prop
    FROM lancamentos l
    WHERE l.status='ativo' AND l.competencia BETWEEN ? AND ?${sqlProp(propId)}
    GROUP BY l.competencia
  `).all(de, ate);
  const porMes = Object.fromEntries(rows.map(r => [r.competencia, r]));

  const contratos = db.prepare(`
    SELECT c.aluguel_centavos, c.inicio, c.fim, i.proprietario_id
    FROM contratos c JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.status <> 'encerrado'${propId ? ` AND i.proprietario_id = ${Number(propId)}` : ''}
  `).all();

  let saldoImob = 0;
  let saldoProp = 0;
  return meses.map(mes => {
    const r = porMes[mes] || {};
    const alugueis = r.alugueis || 0;
    const taxa = r.taxa || 0;
    const outrasImob = r.outras_imob || 0;
    const despImob = r.desp_imob || 0;
    const repasses = r.repasses || 0;
    const despProp = r.desp_prop || 0;
    const outrasProp = r.outras_prop || 0;

    const inicioMes = `${mes}-01`;
    const fimMes = ultimoDia(mes);
    const previsto = contratos
      .filter(c => c.inicio <= fimMes && (!c.fim || c.fim >= inicioMes))
      .reduce((s, c) => s + (c.aluguel_centavos || 0), 0);

    const receitaImob = taxa + outrasImob;
    const resultadoImob = receitaImob - despImob;
    saldoImob += resultadoImob;
    saldoProp += alugueis + outrasProp - despProp - repasses;

    return {
      mes,
      alugueis,
      outras_prop: outrasProp,
      taxa,
      outras_imob: outrasImob,
      desp_imob: despImob,
      desp_prop: despProp,
      repasses,
      previsto,
      receita_imob: receitaImob,
      resultado_imob: resultadoImob,
      saldo_imob: saldoImob,
      saldo_prop: saldoProp,
      inadimplencia: Math.max(previsto - alugueis, 0),
    };
  });
}

function somar(serie) {
  return serie.reduce((acc, m) => {
    for (const k of ['alugueis', 'taxa', 'outras_imob', 'outras_prop', 'desp_imob', 'desp_prop', 'repasses', 'previsto', 'receita_imob', 'resultado_imob', 'inadimplencia']) {
      acc[k] = (acc[k] || 0) + (m[k] || 0);
    }
    return acc;
  }, {});
}

function variacao(atual, anterior) {
  if (!anterior) return atual ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function ocupacao(propId = null) {
  const where = propId ? 'WHERE ativo=1 AND proprietario_id = ?' : 'WHERE ativo=1';
  const args = propId ? [propId] : [];
  const rows = db.prepare(`SELECT situacao, COUNT(*) AS n FROM imoveis ${where} GROUP BY situacao`).all(...args);
  const map = { alugado: 0, vago: 0, manutencao: 0, reservado: 0 };
  for (const r of rows) map[r.situacao] = r.n;
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return { ...map, total, ocupacao_pct: total ? (map.alugado / total) * 100 : 0 };
}

export function composicao(de, ate, tipo, propId = null) {
  const cond = tipo === 'receita'
    ? "l.tipo='receita'"
    : "l.tipo='despesa' AND l.categoria <> 'Repasse ao proprietário' COLLATE NOCASE";
  const rows = db.prepare(`
    SELECT MIN(l.categoria) AS nome, SUM(l.valor_centavos) AS valor
    FROM lancamentos l
    WHERE l.status='ativo' AND ${cond} AND l.competencia BETWEEN ? AND ?${sqlProp(propId)}
    GROUP BY lower(l.categoria) ORDER BY valor DESC
  `).all(de, ate);
  const top = rows.slice(0, 6);
  const resto = rows.slice(6).reduce((s, r) => s + r.valor, 0);
  if (resto > 0) top.push({ nome: 'Outros', valor: resto });
  return top;
}

export function repassesPorProprietario(de, ate) {
  return db.prepare(`
    SELECT p.id, p.nome,
      COALESCE(SUM(r.valor_centavos),0) AS valor,
      COALESCE(SUM(CASE WHEN r.status='pago' THEN r.valor_centavos ELSE 0 END),0) AS pago,
      COALESCE(SUM(CASE WHEN r.status<>'pago' THEN r.valor_centavos ELSE 0 END),0) AS pendente
    FROM repasses r JOIN proprietarios p ON p.id = r.proprietario_id
    WHERE r.competencia BETWEEN ? AND ?
    GROUP BY p.id ORDER BY valor DESC
  `).all(de, ate);
}

export function topContratos(propId = null) {
  return db.prepare(`
    SELECT c.id, c.codigo, c.aluguel_centavos, c.dia_vencimento, i.endereco, i.numero, i.complemento,
           p.nome AS proprietario_nome, q.nome AS inquilino_nome
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = c.inquilino_id
    WHERE c.status='ativo'${propId ? ` AND i.proprietario_id = ${Number(propId)}` : ''}
    ORDER BY c.aluguel_centavos DESC LIMIT 8
  `).all();
}

/** Carteira ativa por proprietário: base para concentração e comissão. */
export function carteiraPorProprietario(propId = null) {
  return db.prepare(`
    SELECT p.id, p.nome, COUNT(c.id) AS contratos,
      COALESCE(SUM(c.aluguel_centavos),0) AS aluguel_centavos
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    WHERE c.status='ativo'${propId ? ` AND i.proprietario_id = ${Number(propId)}` : ''}
    GROUP BY p.id ORDER BY aluguel_centavos DESC
  `).all();
}

function dataLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compromissos em aberto dos próximos dias (contas a pagar e a receber). */
export function proximosVencimentos(dias = 45, limite = 10) {
  const hoje = hojeISO();
  const limiteData = new Date(`${hoje}T00:00:00`);
  limiteData.setDate(limiteData.getDate() + Math.max(1, Number(dias) || 45));
  const ate = dataLocal(limiteData);
  return db.prepare(`
    SELECT c.id, c.tipo, c.descricao, c.categoria, c.fornecedor, c.valor_centavos, c.vencimento,
      c.recorrencia, pc.nome AS parceiro_nome
    FROM contas c LEFT JOIN parceiros pc ON pc.id = c.parceiro_id
    WHERE c.status = 'aberta' AND c.vencimento <= ?
    ORDER BY c.vencimento, c.tipo, c.id LIMIT ?
  `).all(ate, Math.max(1, Math.min(Number(limite) || 10, 50)));
}

/** Contratos ativos que terminam nos próximos dias. */
export function contratosVencendo(dias = 90, limite = 10) {
  const hoje = hojeISO();
  const d = new Date(`${hoje}T00:00:00`);
  d.setDate(d.getDate() + Math.max(1, Number(dias) || 90));
  const ate = dataLocal(d);
  return db.prepare(`
    SELECT c.id, c.codigo, c.fim, c.aluguel_centavos, i.endereco, i.numero,
      p.nome AS proprietario_nome, q.nome AS inquilino_nome
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = c.inquilino_id
    WHERE c.status = 'ativo' AND c.fim IS NOT NULL AND c.fim BETWEEN ? AND ?
    ORDER BY c.fim LIMIT ?
  `).all(hoje, ate, Math.max(1, Math.min(Number(limite) || 10, 50)));
}

export function analytics({ de, ate, comparar = false, propId = null } = {}) {
  const compAtual = competenciaAtual();
  const pid = Number(propId);
  propId = Number.isFinite(pid) && pid > 0 ? pid : null;
  const regex = /^\d{4}-\d{2}$/;
  if (!regex.test(ate || '')) ate = compAtual;
  if (!regex.test(de || '')) de = addMesesComp(ate, -11);
  if (de > ate) [de, ate] = [ate, de];
  const meses = mesesEntre(de, ate);
  const serie = serieMensal(de, ate, propId);
  const tot = somar(serie);

  const n = meses.length;
  const anteriorAte = addMesesComp(de, -1);
  const anteriorDe = addMesesComp(anteriorAte, -(n - 1));
  const serieAnt = serieMensal(anteriorDe, anteriorAte, propId);
  const totAnt = somar(serieAnt);

  const saldoAtual = saldos();
  const imoveis = ocupacao(propId);
  const contratosAtivos = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(AVG(c.aluguel_centavos),0) AS ticket
    FROM contratos c JOIN imoveis i ON i.id=c.imovel_id
    WHERE c.status='ativo'${propId ? ` AND i.proprietario_id=${Number(propId)}` : ''}
  `).get();
  const al = alertas();
  const inadPct = tot.previsto > 0 ? (tot.inadimplencia / tot.previsto) * 100 : 0;
  const inadPctAnt = totAnt.previsto > 0 ? (totAnt.inadimplencia / totAnt.previsto) * 100 : 0;
  const taxaMedia = tot.alugueis > 0 ? (tot.taxa / tot.alugueis) * 100 : 0;
  const taxaMediaAnt = totAnt.alugueis > 0 ? (totAnt.taxa / totAnt.alugueis) * 100 : 0;

  const kpis = {
    receita_imob: tot.receita_imob,
    resultado_imob: tot.resultado_imob,
    alugueis: tot.alugueis,
    repasses: tot.repasses,
    despesas_imob: tot.desp_imob,
    despesas_prop: tot.desp_prop,
    taxa: tot.taxa,
    taxa_media_pct: taxaMedia,
    previsto: tot.previsto,
    inadimplencia: tot.inadimplencia,
    inadimplencia_pct: inadPct,
    contratos_ativos: contratosAtivos.n,
    ticket_medio: Math.round(contratosAtivos.ticket),
    saldo_imob: saldoAtual.imobiliaria_centavos,
    saldo_prop: saldoAtual.proprietarios_centavos,
    ocupacao_pct: imoveis.ocupacao_pct,
    imoveis_total: imoveis.total,
    imoveis_alugados: imoveis.alugado,
  };

  const comparativo = {
    receita_imob: { atual: tot.receita_imob, anterior: totAnt.receita_imob, variacao: variacao(tot.receita_imob, totAnt.receita_imob) },
    resultado_imob: { atual: tot.resultado_imob, anterior: totAnt.resultado_imob, variacao: variacao(tot.resultado_imob, totAnt.resultado_imob) },
    alugueis: { atual: tot.alugueis, anterior: totAnt.alugueis, variacao: variacao(tot.alugueis, totAnt.alugueis) },
    repasses: { atual: tot.repasses, anterior: totAnt.repasses, variacao: variacao(tot.repasses, totAnt.repasses) },
    despesas_imob: { atual: tot.desp_imob, anterior: totAnt.desp_imob, variacao: variacao(tot.desp_imob, totAnt.desp_imob) },
    inadimplencia_pct: { atual: inadPct, anterior: inadPctAnt, variacao: variacao(inadPct, inadPctAnt) },
    taxa_media_pct: { atual: taxaMedia, anterior: taxaMediaAnt, variacao: variacao(taxaMedia, taxaMediaAnt) },
  };

  const composicaoReceitas = composicao(de, ate, 'receita', propId);
  const composicaoDespesas = composicao(de, ate, 'despesa', propId);
  const contasResumo = resumoContas();
  const previsao = previsaoCaixa({ meses: Math.min(Math.max(n, 3), 6) });
  const comissoesResumo = resumoComissoes(competenciaAtual());
  const carteiraProprietarios = carteiraPorProprietario(propId);
  const proximos = proximosVencimentos(45, 8);
  const contratosFim = contratosVencendo(90, 8);
  const totalAluguelCarteira = carteiraProprietarios.reduce((s, p) => s + p.aluguel_centavos, 0);
  const concentracao = totalAluguelCarteira > 0
    ? (carteiraProprietarios.slice(0, 3).reduce((s, p) => s + p.aluguel_centavos, 0) / totalAluguelCarteira) * 100
    : 0;
  const mediaReceita = n ? Math.round(tot.receita_imob / n) : 0;
  const mediaResultado = n ? Math.round(tot.resultado_imob / n) : 0;
  const margemPct = tot.receita_imob > 0 ? (tot.resultado_imob / tot.receita_imob) * 100 : 0;

  const atividades = db.prepare(`SELECT acao, entidade, entidade_id, usuario_nome, criado_em, detalhe
    FROM auditoria ORDER BY id DESC LIMIT 7`).all();

  return {
    periodo: {
      de, ate, meses: n,
      anterior: { de: anteriorDe, ate: anteriorAte },
      rotulo: `${meses[0]} a ${meses[meses.length - 1]}`,
    },
    kpis: {
      ...kpis,
      media_receita: mediaReceita,
      media_resultado: mediaResultado,
      margem_pct: margemPct,
      concentracao_tres_pct: concentracao,
    },
    comparativo,
    serie,
    serie_anterior: comparar ? serieAnt.map(m => ({ ...m, mes_original: m.mes })) : null,
    composicao_receitas: composicaoReceitas,
    composicao_despesas: composicaoDespesas,
    repasses_proprietarios: repassesPorProprietario(de, ate),
    carteira_proprietarios: carteiraProprietarios,
    contas: contasResumo,
    previsao_caixa: previsao,
    comissoes: comissoesResumo,
    proximos_vencimentos: proximos,
    contratos_vencendo: contratosFim,
    ocupacao: imoveis,
    top_contratos: topContratos(propId),
    alertas: {
      urgente: al.filter(a => a.nivel === 'urgente').length,
      atencao: al.filter(a => a.nivel === 'atencao').length,
      info: al.filter(a => a.nivel === 'info').length,
      lista: al.slice(0, 5),
    },
    atividades,
    cobrancas: resumoCobrancas(ate),
    gerado_em: hojeISO(),
  };
}
