import { db } from './db.js';
import { serieMensal, addMesesComp, ocupacao, mesesEntre } from './analytics.js';
import { competenciaAtual, hojeISO, saldos, getSettingNum, brl } from './regras.js';
import { resumo as resumoCobrancas } from './cobrancas.js';

/**
 * Análises futuras e projeções.
 *
 * Tudo é calculado a partir dos dados já coletados no SQLite: série histórica
 * de receitas/despesas, contratos ativos, inadimplência, ocupação e caixa. Não
 * há chamada a serviço externo nem "chute" de modelo generativo — a projeção é
 * uma regressão linear simples com faixa de erro e o cenário é explícito nas
 * premissas devolvidas junto com os números.
 */

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function rotuloMes(comp) {
  const [ano, mes] = String(comp).split('-').map(Number);
  return `${MESES_CURTOS[(mes || 1) - 1]}/${ano}`;
}

function media(valores) {
  if (!valores.length) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/** Regressão linear y = a + b*x sobre os pontos informados. */
export function regressao(valores) {
  const n = valores.length;
  if (n < 2) return { a: valores[0] || 0, b: 0, r2: 0, residuo: 0 };
  const xs = valores.map((_, i) => i);
  const mx = media(xs);
  const my = media(valores);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (valores[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const previsto = a + b * xs[i];
    ssTot += (valores[i] - my) ** 2;
    ssRes += (valores[i] - previsto) ** 2;
  }
  const r2 = ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { a, b, r2, residuo: Math.sqrt(ssRes / Math.max(n - 2, 1)) };
}

function arredondar(n) {
  return Math.max(0, Math.round(n));
}

function pct(parte, todo) {
  return todo ? (parte / todo) * 100 : 0;
}

/** Taxa média praticada, usada quando a base ainda não tem repasses pagos. */
function taxaAdministracaoProxy() {
  const rows = db.prepare('SELECT taxa_pct FROM repasses WHERE taxa_pct > 0 ORDER BY id DESC LIMIT 24').all();
  return rows.length ? media(rows.map(r => r.taxa_pct)) : getSettingNum('taxa_admin_padrao', 8);
}

/** Receita da imobiliária; se não houve taxa lançada, estima pela taxa média. */
function receitaDoMes(m, taxa) {
  return m.receita_imob > 0 ? m.receita_imob : Math.round(m.alugueis * taxa / 100);
}

function risco(nivel, titulo, descricao, acao) {
  return { nivel, titulo, descricao, acao };
}

/**
 * Projeta os próximos meses com o cenário informado.
 *
 * - `inadimplencia_pct`: percentual da carteira que não será recebido.
 * - `vacancia_pct`: percentual adicional de contratos sem receber.
 * - `reajuste_pct`: reajuste médio aplicado aos aluguéis ativos.
 * - `aumento_despesa_pct`: pressão de custos sobre a despesa da imobiliária.
 */
export function projetarCenario({ meses = 6, inadimplencia_pct = null, vacancia_pct = 0, reajuste_pct = 0, aumento_despesa_pct = 0 } = {}) {
  const horizonte = Math.min(Math.max(Math.trunc(Number(meses)) || 6, 1), 24);
  const compAtual = competenciaAtual();
  const inicio = addMesesComp(compAtual, -11);
  const serie = serieMensal(inicio, compAtual);
  const taxaProxy = taxaAdministracaoProxy();
  const receitas = serie.map(m => receitaDoMes(m, taxaProxy));
  const despesas = serie.map(m => m.desp_imob);
  const alugueis = serie.map(m => m.alugueis);
  const previstos = serie.map(m => m.previsto);
  const regReceita = regressao(receitas);
  const regDespesa = regressao(despesas);
  const regAluguel = regressao(alugueis);
  const regPrevisto = regressao(previstos);

  const totalPrevisto = previstos.reduce((s, v) => s + v, 0);
  const totalAluguel = alugueis.reduce((s, v) => s + v, 0);
  const inadimplenciaObservada = totalPrevisto ? Math.max(0, pct(totalPrevisto - totalAluguel, totalPrevisto)) : 0;
  const inadImpl = inadimplencia_pct == null || inadimplencia_pct === '' || !Number.isFinite(Number(inadimplencia_pct))
    ? inadimplenciaObservada
    : Math.min(Math.max(Number(inadimplencia_pct), 0), 100);
  const vacancia = Math.min(Math.max(Number(vacancia_pct) || 0, 0), 100);
  const reajuste = Math.min(Math.max(Number(reajuste_pct) || 0, -100), 100);
  const pressao = Math.min(Math.max(Number(aumento_despesa_pct) || 0, -100), 300);

  const fatorRecebimento = (1 - inadImpl / 100) * (1 - vacancia / 100) * (1 + reajuste / 100);
  const fatorDespesa = 1 + pressao / 100;
  const saldoInicial = saldos().imobiliaria_centavos;
  let acumulado = saldoInicial;
  const projecoes = [];
  const n = serie.length;

  for (let i = 1; i <= horizonte; i++) {
    const x = n - 1 + i;
    const receitaBase = Math.max(regReceita.a + regReceita.b * x, 0);
    const despesaBase = Math.max(regDespesa.a + regDespesa.b * x, 0);
    // A receita da imobiliária (taxa) acompanha o aluguel recebido. Quando o
    // cenário reduz o recebimento, a taxa também cai, o que é o comportamento
    // real de uma administração percentual.
    const receita = arredondar(receitaBase * fatorRecebimento);
    const despesa = arredondar(despesaBase * fatorDespesa);
    const aluguelProjetado = arredondar(Math.max(regAluguel.a + regAluguel.b * x, 0) * fatorRecebimento);
    const previsto = arredondar(Math.max(regPrevisto.a + regPrevisto.b * x, 0) * (1 + reajuste / 100));
    const saldo = receita - despesa;
    acumulado += saldo;
    projecoes.push({
      competencia: addMesesComp(compAtual, i),
      rotulo: rotuloMes(addMesesComp(compAtual, i)),
      receita_centavos: receita,
      despesa_centavos: despesa,
      resultado_centavos: saldo,
      saldo_acumulado_centavos: acumulado,
      aluguel_centavos: aluguelProjetado,
      previsto_centavos: previsto,
      receita_formatada: brl(receita),
      despesa_formatada: brl(despesa),
      resultado_formatado: brl(saldo),
      saldo_acumulado_formatado: brl(acumulado),
    });
  }

  return {
    premissas: {
      meses: horizonte,
      inadimplencia_pct: Number(inadImpl.toFixed(1)),
      vacancia_pct: vacancia,
      reajuste_pct: reajuste,
      aumento_despesa_pct: pressao,
      inadimplencia_observada_pct: Number(inadimplenciaObservada.toFixed(1)),
    },
    saldo_inicial_centavos: saldoInicial,
    saldo_inicial_formatado: brl(saldoInicial),
    projecoes,
    totais: {
      receita_centavos: projecoes.reduce((s, p) => s + p.receita_centavos, 0),
      despesa_centavos: projecoes.reduce((s, p) => s + p.despesa_centavos, 0),
      resultado_centavos: projecoes.reduce((s, p) => s + p.resultado_centavos, 0),
      saldo_final_centavos: acumulado,
    },
    confianca: {
      r2_receita: Number(regReceita.r2.toFixed(3)),
      r2_despesa: Number(regDespesa.r2.toFixed(3)),
      meses_base: n,
      nivel: regReceita.r2 >= 0.6 && n >= 6 ? 'alta' : regReceita.r2 >= 0.25 ? 'media' : 'baixa',
    },
  };
}

/** Indicadores, riscos e recomendações derivados dos dados históricos. */
export function analiseFutura({ meses = 12, horizonte = 3 } = {}) {
  const compAtual = competenciaAtual();
  const periodo = Math.min(Math.max(Math.trunc(Number(meses)) || 12, 3), 36);
  const inicio = addMesesComp(compAtual, -(periodo - 1));
  const serie = serieMensal(inicio, compAtual);
  const ocup = ocupacao();
  const caixa = saldos();
  const cob = resumoCobrancas(compAtual);

  const taxaProxy = taxaAdministracaoProxy();
  const receitas = serie.map(m => receitaDoMes(m, taxaProxy));
  const despesas = serie.map(m => m.desp_imob);
  const resultados = serie.map(m => receitaDoMes(m, taxaProxy) - m.desp_imob);
  const alugueis = serie.map(m => m.alugueis);
  const previstos = serie.map(m => m.previsto);
  const regReceita = regressao(receitas);
  const regResultado = regressao(resultados);

  const receitaMedia = media(receitas);
  const despesaMedia = media(despesas);
  const resultadoMedio = media(resultados);
  const margem = receitaMedia ? (resultadoMedio / receitaMedia) * 100 : 0;
  const totalPrevisto = previstos.reduce((s, v) => s + v, 0);
  const totalAluguel = alugueis.reduce((s, v) => s + v, 0);
  const inadimplenciaPct = totalPrevisto ? Math.max(0, pct(totalPrevisto - totalAluguel, totalPrevisto)) : 0;
  const mesesCaixa = despesaMedia > 0 ? caixa.imobiliaria_centavos / despesaMedia : null;

  // Variação dos últimos 3 meses comparada aos 3 anteriores.
  const ultimos = resultados.slice(-3);
  const anteriores = resultados.slice(-6, -3);
  const variacaoRecente = anteriores.length
    ? pct(media(ultimos) - media(anteriores), Math.abs(media(anteriores)) || 1)
    : 0;

  const concentracao = db.prepare(`
    SELECT p.id, p.nome, COALESCE(SUM(c.aluguel_centavos),0) AS aluguel
    FROM proprietarios p
    JOIN imoveis i ON i.proprietario_id = p.id AND i.ativo = 1
    JOIN contratos c ON c.imovel_id = i.id AND c.status = 'ativo'
    GROUP BY p.id ORDER BY aluguel DESC
  `).all();
  const aluguelTotal = concentracao.reduce((s, p) => s + p.aluguel, 0);
  const top = concentracao[0];
  const concentracaoPct = top && aluguelTotal ? pct(top.aluguel, aluguelTotal) : 0;

  const vencendo90 = db.prepare(`SELECT COUNT(*) AS n FROM contratos WHERE status = 'ativo' AND fim IS NOT NULL
    AND fim BETWEEN ? AND ?`).get(hojeISO(), addMesesComp(compAtual, 3) + '-31').n;
  const contratosAtivos = db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE status = 'ativo'").get().n;

  const riscos = [];
  if (inadimplenciaPct >= 10) {
    riscos.push(risco('alto', 'Inadimplência elevada', `${inadimplenciaPct.toFixed(1)}% do previsto não foi recebido no período.`, 'Priorizar a régua de cobrança e revisar a política de crédito.'));
  } else if (inadimplenciaPct >= 5) {
    riscos.push(risco('atencao', 'Inadimplência acima do saudável', `${inadimplenciaPct.toFixed(1)}% do previsto não foi recebido.`, 'Acompanhar os maiores saldos vencidos semanalmente.'));
  }
  if (ocup.total && ocup.ocupacao_pct < 80) {
    riscos.push(risco('alto', 'Vacância alta', `Apenas ${ocup.ocupacao_pct.toFixed(0)}% da carteira está alugada.`, 'Revisar anúncios, preço e tempo de vacância dos imóveis vagos.'));
  } else if (ocup.total && ocup.ocupacao_pct < 90) {
    riscos.push(risco('atencao', 'Ocupação abaixo do ideal', `${ocup.ocupacao_pct.toFixed(0)}% dos imóveis estão alugados.`, 'Planejar a colocação dos imóveis vagos.'));
  }
  if (mesesCaixa != null && mesesCaixa < 1) {
    riscos.push(risco('alto', 'Caixa curto', `O caixa cobre ${mesesCaixa.toFixed(1)} mês(es) de despesa média.`, 'Reduzir despesas não essenciais e antecipar recebíveis.'));
  } else if (mesesCaixa != null && mesesCaixa < 3) {
    riscos.push(risco('atencao', 'Reserva de caixa baixa', `O caixa cobre ${mesesCaixa.toFixed(1)} mês(es) de despesa média.`, 'Construir reserva de 3 a 6 meses.'));
  }
  if (concentracaoPct > 50) {
    riscos.push(risco('atencao', 'Concentração de carteira', `${top.nome} representa ${concentracaoPct.toFixed(0)}% do aluguel administrado.`, 'Diversificar a carteira para reduzir dependência.'));
  }
  if (contratosAtivos && pct(vencendo90, contratosAtivos) >= 20) {
    riscos.push(risco('atencao', 'Renovações concentradas', `${vencendo90} de ${contratosAtivos} contratos vencem em até 90 dias.`, 'Antecipar a conversa de renovação com proprietários e inquilinos.'));
  }
  if (variacaoRecente < -10) {
    riscos.push(risco('atencao', 'Resultado em queda', `O resultado dos últimos 3 meses caiu ${Math.abs(variacaoRecente).toFixed(0)}% frente ao trimestre anterior.`, 'Revisar despesas e a rentabilidade por imóvel.'));
  }
  if (!riscos.length) {
    riscos.push(risco('info', 'Sem riscos críticos', 'Os indicadores atuais estão dentro das faixas de referência do sistema.', 'Manter o acompanhamento mensal.'));
  }

  const cenario = projetarCenario({ meses: Math.min(Math.max(horizonte, 1), 12) });
  const projecao = cenario.projecoes.map((p, i) => {
    const x = serie.length - 1 + i + 1;
    const base = Math.max(regReceita.a + regReceita.b * x, 0);
    const erro = regReceita.residuo * Math.sqrt(1 + 1 / Math.max(serie.length, 1));
    return {
      ...p,
      faixa_min_centavos: arredondar(base - erro),
      faixa_max_centavos: arredondar(base + erro),
      faixa_min_formatada: brl(arredondar(base - erro)),
      faixa_max_formatada: brl(arredondar(base + erro)),
    };
  });

  const recomendacoes = [];
  if (cob.vencidas > 0) recomendacoes.push(`Cobrar ${cob.vencidas} cobrança(s) vencida(s), hoje em ${brl(cob.valor_vencido)}.`);
  if (ocup.vago > 0) recomendacoes.push(`Colocar ${ocup.vago} imóvel(is) vago(s) em anúncio e revisar o preço de mercado.`);
  if (margem < 20 && receitaMedia > 0) recomendacoes.push(`Margem média de ${margem.toFixed(1)}%: revisar despesas da imobiliária.`);
  if (mesesCaixa != null && mesesCaixa < 3) recomendacoes.push('Reforçar a reserva de caixa antes de ampliar a operação.');
  if (vencendo90 > 0) recomendacoes.push(`Planejar a renovação de ${vencendo90} contrato(s) que vencem em 90 dias.`);
  if (!recomendacoes.length) recomendacoes.push('Manter a rotina de conciliação, baixa e repasse para preservar a previsibilidade.');

  return {
    gerado_em: new Date().toISOString(),
    competencia_base: compAtual,
    periodo: { de: inicio, ate: compAtual, meses: serie.length },
    indicadores: {
      receita_media_centavos: Math.round(receitaMedia),
      despesa_media_centavos: Math.round(despesaMedia),
      resultado_medio_centavos: Math.round(resultadoMedio),
      margem_pct: Number(margem.toFixed(1)),
      inadimplencia_pct: Number(inadimplenciaPct.toFixed(1)),
      ocupacao_pct: Number(ocup.ocupacao_pct.toFixed(1)),
      caixa_centavos: caixa.imobiliaria_centavos,
      meses_de_caixa: mesesCaixa == null ? null : Number(mesesCaixa.toFixed(1)),
      contratos_ativos: contratosAtivos,
      vencendo_90_dias: vencendo90,
      concentracao_maior_proprietario_pct: Number(concentracaoPct.toFixed(1)),
      maior_proprietario: top?.nome || null,
      variacao_trimestral_pct: Number(variacaoRecente.toFixed(1)),
    },
    tendencia: {
      receita: regReceita.b > 0 ? 'alta' : regReceita.b < 0 ? 'queda' : 'estável',
      resultado: regResultado.b > 0 ? 'alta' : regResultado.b < 0 ? 'queda' : 'estável',
      inclinacao_receita_centavos_mes: Math.round(regReceita.b),
      inclinacao_resultado_centavos_mes: Math.round(regResultado.b),
      r2: Number(regReceita.r2.toFixed(3)),
      confianca: cenario.confianca.nivel,
    },
    serie: serie.map(m => ({
      competencia: m.mes,
      rotulo: rotuloMes(m.mes),
      receita_centavos: receitaDoMes(m, taxaProxy),
      despesa_centavos: m.desp_imob,
      resultado_centavos: receitaDoMes(m, taxaProxy) - m.desp_imob,
      alugueis_centavos: m.alugueis,
      previsto_centavos: m.previsto,
      inadimplencia_centavos: m.inadimplencia,
    })),
    projecao,
    cenario: {
      premissas: cenario.premissas,
      saldo_inicial_formatado: cenario.saldo_inicial_formatado,
      totais: cenario.totais,
      projecoes: cenario.projecoes,
      confianca: cenario.confianca,
    },
    riscos,
    recomendacoes,
    base: {
      meses_analisados: serie.length,
      cobrancas_abertas: cob.abertas,
      cobrancas_vencidas: cob.vencidas,
      imoveis: ocup.total,
      imoveis_vagos: ocup.vago,
      ultima_atualizacao: hojeISO(),
      fonte: 'Dados internos do sistema (sem envio para serviços externos).',
    },
  };
}

/** Texto curto para o assistente responder perguntas de previsão. */
export function resumoAnaliseFutura() {
  const a = analiseFutura({ meses: 12, horizonte: 3 });
  const prox = a.projecao[0];
  const ultimo = a.projecao.at(-1);
  const texto = `Com base nos últimos ${a.periodo.meses} meses, a receita média da imobiliária é ${brl(a.indicadores.receita_media_centavos)} e a tendência é de ${a.tendencia.receita}. A projeção para ${prox?.rotulo || 'o próximo mês'} é ${prox?.receita_formatada || brl(0)} (faixa ${prox?.faixa_min_formatada} a ${prox?.faixa_max_formatada}) e, em ${a.cenario.premissas.meses} meses, o saldo acumulado projetado é ${ultimo?.saldo_acumulado_formatado || brl(0)}. Inadimplência em ${a.indicadores.inadimplencia_pct}% e ocupação em ${a.indicadores.ocupacao_pct}%.`;
  return {
    intencao: 'previsao',
    texto,
    destaques: [
      { rotulo: 'Receita média', valor: brl(a.indicadores.receita_media_centavos) },
      { rotulo: 'Tendência', valor: a.tendencia.receita },
      { rotulo: 'Inadimplência', valor: `${a.indicadores.inadimplencia_pct}%` },
      { rotulo: 'Confiança', valor: a.tendencia.confianca },
    ],
    itens: a.projecao.map(p => ({
      titulo: p.rotulo,
      detalhe: `Receita ${p.receita_formatada} · despesa ${p.despesa_formatada} · faixa ${p.faixa_min_formatada} a ${p.faixa_max_formatada}`,
      valor: p.saldo_acumulado_formatado,
      rota: '#/analises',
    })),
    acoes: [{ rotulo: 'Abrir análises', rota: '#/analises' }],
    sugestoes: ['Quais são os riscos da carteira?', 'Simular inadimplência de 10%', 'Resumo do mês', 'Quem está inadimplente?'],
  };
}

/** Lista de competências disponíveis para o seletor da tela. */
export function competenciasDisponiveis(meses = 12) {
  const fim = competenciaAtual();
  const inicio = addMesesComp(fim, -(meses - 1));
  return mesesEntre(inicio, fim);
}

export function configuracaoPrevisao() {
  return {
    meses_padrao: Math.min(Math.max(getSettingNum('previsao_analise_meses', 12), 3), 36),
    horizonte_padrao: Math.min(Math.max(getSettingNum('previsao_horizonte_meses', 3), 1), 12),
  };
}
