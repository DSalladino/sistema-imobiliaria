import { db } from './db.js';
import { hojeISO, competenciaAtual, brl } from './regras.js';
import { garantirCategoria, resolverParceiro } from './cadastros.js';

/**
 * Contas a pagar e a receber, com recorrência e previsão de caixa.
 * A baixa gera o lançamento financeiro correspondente; a recorrência cria a
 * próxima parcela automaticamente, mantendo o histórico auditável.
 */

export const RECORRENCIAS = [
  ['unica', 'Única'],
  ['semanal', 'Semanal'],
  ['mensal', 'Mensal'],
  ['bimestral', 'Bimestral'],
  ['trimestral', 'Trimestral'],
  ['semestral', 'Semestral'],
  ['anual', 'Anual'],
];

const MESES_POR_RECORRENCIA = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

export const STATUS_CONTA = {
  aberta: 'Em aberto',
  paga: 'Baixada',
  cancelada: 'Cancelada',
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ultimoDiaDoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

/** Próximo vencimento preservando o dia original (com corte no fim do mês). */
export function proximoVencimento(dataISO, recorrencia) {
  const [ano, mes, dia] = String(dataISO).split('-').map(Number);
  if (!ano || !mes || !dia) throw Object.assign(new Error('Vencimento inválido.'), { status: 400 });
  if (recorrencia === 'semanal') {
    const d = new Date(ano, mes - 1, dia + 7);
    return iso(d);
  }
  const meses = MESES_POR_RECORRENCIA[recorrencia];
  if (!meses) {
    throw Object.assign(new Error('Recorrência inválida.'), { status: 400 });
  }
  const alvo = new Date(ano, mes - 1 + meses, 1);
  const novoDia = Math.min(dia, ultimoDiaDoMes(alvo.getFullYear(), alvo.getMonth() + 1));
  return iso(new Date(alvo.getFullYear(), alvo.getMonth(), novoDia));
}

function normalizar(dados, atual = null) {
  const v = (campo, padrao = null) => (dados[campo] === undefined ? (atual ? atual[campo] : padrao) : dados[campo]);
  const tipo = String(v('tipo', 'pagar'));
  if (!['pagar', 'receber'].includes(tipo)) throw Object.assign(new Error('Tipo deve ser pagar ou receber.'), { status: 400 });
  const descricao = String(v('descricao', '') || '').trim();
  if (!descricao) throw Object.assign(new Error('Informe a descrição.'), { status: 400 });
  const vencimento = String(v('vencimento', '') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) throw Object.assign(new Error('Vencimento inválido.'), { status: 400 });
  const valor = Math.round(Number(v('valor_centavos', 0)) || 0);
  if (valor <= 0) throw Object.assign(new Error('Valor deve ser maior que zero.'), { status: 400 });
  const recorrencia = String(v('recorrencia', 'unica'));
  if (!RECORRENCIAS.some(([id]) => id === recorrencia)) {
    throw Object.assign(new Error('Recorrência inválida.'), { status: 400 });
  }
  const recorrenciaFim = v('recorrencia_fim', null);
  if (recorrenciaFim && !/^\d{4}-\d{2}-\d{2}$/.test(String(recorrenciaFim))) {
    throw Object.assign(new Error('Fim da recorrência inválido.'), { status: 400 });
  }
  if (recorrenciaFim && recorrenciaFim < vencimento) {
    throw Object.assign(new Error('O fim da recorrência não pode ser anterior ao vencimento.'), { status: 400 });
  }
  const caixa = String(v('caixa', 'imobiliaria'));
  if (!['imobiliaria', 'proprietarios'].includes(caixa)) {
    throw Object.assign(new Error('Caixa inválido.'), { status: 400 });
  }
  const parceiro = resolverParceiro({
    id: v('parceiro_id', null), nome: v('fornecedor', null), tipo: tipo === 'pagar' ? 'fornecedor' : 'cliente',
  });
  return {
    tipo,
    descricao,
    categoria: String(v('categoria', 'Outros') || 'Outros').trim(),
    fornecedor: parceiro?.nome || v('fornecedor', null) || null,
    parceiro_id: parceiro?.id || null,
    valor_centavos: valor,
    vencimento,
    competencia: vencimento.slice(0, 7),
    recorrencia,
    recorrencia_fim: recorrenciaFim || null,
    caixa,
    proprietario_id: v('proprietario_id', null) || null,
    imovel_id: v('imovel_id', null) || null,
    contrato_id: v('contrato_id', null) || null,
    observacoes: v('observacoes', null) || null,
  };
}

const baseSelect = `SELECT c.*, p.nome AS proprietario_nome, i.endereco AS imovel_endereco, i.numero AS imovel_numero,
  ct.codigo AS contrato_codigo, pc.nome AS parceiro_nome, pc.tipo AS parceiro_tipo, pc.pix AS parceiro_pix
  FROM contas c
  LEFT JOIN proprietarios p ON p.id = c.proprietario_id
  LEFT JOIN imoveis i ON i.id = c.imovel_id
  LEFT JOIN contratos ct ON ct.id = c.contrato_id
  LEFT JOIN parceiros pc ON pc.id = c.parceiro_id`;

function enriquecer(c) {
  if (!c) return c;
  const hoje = hojeISO();
  const atraso = c.status === 'aberta' && c.vencimento < hoje
    ? Math.round((new Date(hoje + 'T00:00:00') - new Date(c.vencimento + 'T00:00:00')) / 86400000)
    : 0;
  return {
    ...c,
    status_label: STATUS_CONTA[c.status] || c.status,
    dias_atraso: atraso,
    atrasada: atraso > 0,
    recorrencia_label: (RECORRENCIAS.find(([id]) => id === c.recorrencia) || [, c.recorrencia])[1],
  };
}

export function listar(filtros = {}) {
  const where = [];
  const args = [];
  if (filtros.tipo) { where.push('c.tipo = ?'); args.push(filtros.tipo); }
  if (filtros.status === 'abertas') where.push("c.status = 'aberta'");
  else if (filtros.status === 'vencidas') { where.push("c.status = 'aberta' AND c.vencimento < ?"); args.push(hojeISO()); }
  else if (filtros.status) { where.push('c.status = ?'); args.push(filtros.status); }
  if (filtros.competencia) { where.push('c.competencia = ?'); args.push(filtros.competencia); }
  if (filtros.de) { where.push('c.vencimento >= ?'); args.push(filtros.de); }
  if (filtros.ate) { where.push('c.vencimento <= ?'); args.push(filtros.ate); }
  if (filtros.proprietario_id) { where.push('c.proprietario_id = ?'); args.push(Number(filtros.proprietario_id)); }
  if (filtros.busca) {
    const b = `%${filtros.busca}%`;
    where.push('(c.descricao LIKE ? OR c.fornecedor LIKE ? OR c.categoria LIKE ? OR p.nome LIKE ?)');
    args.push(b, b, b, b);
  }
  const sql = `${baseSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.status = 'aberta' DESC, c.vencimento, c.id LIMIT 1000`;
  return db.prepare(sql).all(...args).map(enriquecer);
}

export function obter(id) {
  return enriquecer(db.prepare(`${baseSelect} WHERE c.id = ?`).get(Number(id)));
}

export function resumo() {
  const hoje = hojeISO();
  const comp = competenciaAtual();
  const linhas = db.prepare(`${baseSelect} WHERE c.status = 'aberta'`).all().map(enriquecer);
  const somar = (tipo, filtro = () => true) => linhas
    .filter(c => c.tipo === tipo && filtro(c))
    .reduce((s, c) => s + c.valor_centavos, 0);
  return {
    competencia: comp,
    a_pagar: somar('pagar'),
    a_receber: somar('receber'),
    vencido_pagar: somar('pagar', c => c.vencimento < hoje),
    vencido_receber: somar('receber', c => c.vencimento < hoje),
    pagar_no_mes: somar('pagar', c => c.competencia === comp),
    receber_no_mes: somar('receber', c => c.competencia === comp),
    contas_abertas: linhas.length,
    contas_atrasadas: linhas.filter(c => c.vencimento < hoje).length,
    saldo_previsto_centavos: somar('receber') - somar('pagar'),
  };
}

export function criar(dados, user) {
  const d = normalizar(dados);
  const existente = db.prepare(`SELECT id FROM contas WHERE tipo = ? AND descricao = ? AND vencimento = ?
    AND valor_centavos = ? AND status = 'aberta'`).get(d.tipo, d.descricao, d.vencimento, d.valor_centavos);
  if (existente) {
    throw Object.assign(new Error('Já existe uma conta em aberto com a mesma descrição, vencimento e valor.'), { status: 409 });
  }
  const r = db.prepare(`INSERT INTO contas (tipo, descricao, categoria, fornecedor, parceiro_id, valor_centavos, vencimento, competencia,
      recorrencia, recorrencia_fim, caixa, proprietario_id, imovel_id, contrato_id, observacoes, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.tipo, d.descricao, d.categoria, d.fornecedor, d.parceiro_id, d.valor_centavos, d.vencimento, d.competencia,
      d.recorrencia, d.recorrencia_fim, d.caixa, d.proprietario_id, d.imovel_id, d.contrato_id,
      d.observacoes, user?.nome || null);
  garantirCategoria(`conta_${d.tipo}`, d.categoria, d.tipo === 'pagar' ? 'despesa' : 'receita', d.caixa);
  return obter(Number(r.lastInsertRowid));
}

export function atualizar(id, dados, user) {
  const atual = db.prepare('SELECT * FROM contas WHERE id = ?').get(Number(id));
  if (!atual) throw Object.assign(new Error('Conta não encontrada.'), { status: 404 });
  if (atual.status !== 'aberta') {
    throw Object.assign(new Error('Somente contas em aberto podem ser editadas.'), { status: 409 });
  }
  const d = normalizar(dados, atual);
  db.prepare(`UPDATE contas SET tipo=?, descricao=?, categoria=?, fornecedor=?, parceiro_id=?, valor_centavos=?, vencimento=?,
      competencia=?, recorrencia=?, recorrencia_fim=?, caixa=?, proprietario_id=?, imovel_id=?, contrato_id=?,
      observacoes=?, atualizado_em=datetime('now','localtime') WHERE id=?`)
    .run(d.tipo, d.descricao, d.categoria, d.fornecedor, d.parceiro_id, d.valor_centavos, d.vencimento, d.competencia,
      d.recorrencia, d.recorrencia_fim, d.caixa, d.proprietario_id, d.imovel_id, d.contrato_id,
      d.observacoes, atual.id);
  garantirCategoria(`conta_${d.tipo}`, d.categoria, d.tipo === 'pagar' ? 'despesa' : 'receita', d.caixa);
  return obter(atual.id);
}

export function cancelar(id, motivo, user) {
  const atual = db.prepare('SELECT * FROM contas WHERE id = ?').get(Number(id));
  if (!atual) throw Object.assign(new Error('Conta não encontrada.'), { status: 404 });
  if (atual.status === 'paga') throw Object.assign(new Error('Conta já baixada não pode ser cancelada.'), { status: 409 });
  if (atual.status === 'cancelada') return obter(atual.id);
  db.prepare(`UPDATE contas SET status='cancelada', cancelado_em=?, motivo_cancelamento=? WHERE id=?`)
    .run(hojeISO(), motivo || null, atual.id);
  return obter(atual.id);
}

/** Cria a próxima parcela da conta recorrente, se ainda estiver dentro do prazo. */
function criarProximaParcela(conta, user) {
  if (conta.recorrencia === 'unica') return null;
  const proximo = proximoVencimento(conta.vencimento, conta.recorrencia);
  if (conta.recorrencia_fim && proximo > conta.recorrencia_fim) return null;
  const jaExiste = db.prepare(`SELECT id FROM contas WHERE recorrencia_origem_id = ? AND vencimento = ? AND status <> 'cancelada'`)
    .get(conta.recorrencia_origem_id || conta.id, proximo);
  if (jaExiste) return Number(jaExiste.id);
  const r = db.prepare(`INSERT INTO contas (tipo, descricao, categoria, fornecedor, parceiro_id, valor_centavos, vencimento, competencia,
      recorrencia, recorrencia_fim, recorrencia_origem_id, caixa, proprietario_id, imovel_id, contrato_id, observacoes, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conta.tipo, conta.descricao, conta.categoria, conta.fornecedor, conta.parceiro_id, conta.valor_centavos, proximo,
      proximo.slice(0, 7), conta.recorrencia, conta.recorrencia_fim, conta.recorrencia_origem_id || conta.id,
      conta.caixa, conta.proprietario_id, conta.imovel_id, conta.contrato_id, conta.observacoes, user?.nome || null);
  return Number(r.lastInsertRowid);
}

export function pagar(id, { data, valor_centavos, observacoes } = {}, user) {
  const conta = db.prepare('SELECT * FROM contas WHERE id = ?').get(Number(id));
  if (!conta) throw Object.assign(new Error('Conta não encontrada.'), { status: 404 });
  if (conta.status === 'paga') throw Object.assign(new Error('Conta já está baixada.'), { status: 409 });
  if (conta.status === 'cancelada') throw Object.assign(new Error('Conta cancelada.'), { status: 409 });
  const dataPg = data || hojeISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataPg))) throw Object.assign(new Error('Data inválida.'), { status: 400 });
  const valor = valor_centavos == null || valor_centavos === '' ? conta.valor_centavos : Math.round(Number(valor_centavos));
  if (!Number.isFinite(valor) || valor <= 0) throw Object.assign(new Error('Valor inválido.'), { status: 400 });
  if (valor > conta.valor_centavos) {
    throw Object.assign(new Error('O valor da baixa não pode ser maior que o valor da conta.'), { status: 400 });
  }

  const tipoLanc = conta.tipo === 'pagar' ? 'despesa' : 'receita';
  const descricao = `${conta.descricao}${conta.fornecedor ? ' — ' + conta.fornecedor : ''}`;
  db.exec('BEGIN');
  try {
    const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
        proprietario_id, imovel_id, contrato_id, criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(dataPg, conta.competencia, tipoLanc, conta.categoria, descricao, valor, conta.caixa,
        conta.proprietario_id, conta.imovel_id, conta.contrato_id, user?.nome || null);
    db.prepare(`UPDATE contas SET status='paga', pago_em=?, pago_centavos=?, lancamento_id=?,
        observacoes=COALESCE(?, observacoes), atualizado_em=datetime('now','localtime') WHERE id=?`)
      .run(dataPg, valor, Number(r.lastInsertRowid), observacoes || null, conta.id);
    const proxima = criarProximaParcela(conta, user);
    db.exec('COMMIT');
    return {
      ok: true,
      id: conta.id,
      lancamento_id: Number(r.lastInsertRowid),
      proxima_conta_id: proxima,
      valor_centavos: valor,
      restante_centavos: conta.valor_centavos - valor,
      conta: obter(conta.id),
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Previsão de caixa: contas em aberto do período + projeção das recorrências.
 * Não projeta aluguéis ainda não gerados como cobrança — a fonte é a conta.
 */
export function previsaoCaixa({ meses = 6, de = null } = {}) {
  const inicio = de && /^\d{4}-\d{2}-\d{2}$/.test(de) ? de : hojeISO();
  const qtd = Math.min(Math.max(Number(meses) || 6, 1), 24);
  const [ano, mes] = inicio.split('-').map(Number);
  const janela = [];
  for (let i = 0; i < qtd; i++) {
    const d = new Date(ano, mes - 1 + i, 1);
    const comp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    janela.push({ competencia: comp, de: `${comp}-01`, ate: `${comp}-${String(ultimoDiaDoMes(d.getFullYear(), d.getMonth() + 1)).padStart(2, '0')}`, entradas: 0, saidas: 0 });
  }
  const porComp = new Map(janela.map(j => [j.competencia, j]));
  let projetadas = 0;
  let vencidas = 0;

  const contas = db.prepare("SELECT * FROM contas WHERE status = 'aberta' ORDER BY vencimento").all();
  for (const conta of contas) {
    if (conta.vencimento < inicio) vencidas += conta.tipo === 'pagar' ? -conta.valor_centavos : conta.valor_centavos;
    const occorencias = [];
    if (conta.recorrencia === 'unica') {
      occorencias.push(conta.vencimento);
    } else {
      let v = conta.vencimento;
      let guarda = 0;
      while (guarda++ < 240) {
        if (conta.recorrencia_fim && v > conta.recorrencia_fim) break;
        if (v >= inicio) occorencias.push(v);
        if (v > janela[janela.length - 1].ate) break;
        const prox = proximoVencimento(v, conta.recorrencia);
        if (prox <= v) break;
        v = prox;
      }
      projetadas += occorencias.length;
    }
    for (const venc of occorencias) {
      const linha = porComp.get(String(venc).slice(0, 7));
      if (!linha) continue;
      if (conta.tipo === 'receber') linha.entradas += conta.valor_centavos;
      else linha.saidas += conta.valor_centavos;
      linha.ocorrencias = (linha.ocorrencias || 0) + 1;
    }
  }

  let acumulado = 0;
  for (const linha of janela) {
    const entradas = linha.entradas;
    const saidas = linha.saidas;
    acumulado += entradas - saidas;
    linha.saldo = entradas - saidas;
    linha.saldo_acumulado = acumulado;
    linha.entradas_formatado = brl(entradas);
    linha.saidas_formatado = brl(saidas);
    linha.saldo_formatado = brl(linha.saldo);
  }

  return {
    gerado_em: hojeISO(),
    meses: janela,
    projetadas,
    vencidas_centavos: vencidas,
    media_saidas_centavos: Math.round(janela.reduce((s, j) => s + j.saidas, 0) / janela.length),
    media_entradas_centavos: Math.round(janela.reduce((s, j) => s + j.entradas, 0) / janela.length),
  };
}
