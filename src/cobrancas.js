import { db } from './db.js';
import { hojeISO, getSettingNum, getSetting, exigirMesAberto, mesFechado } from './regras.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function ultimoDia(comp) {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}

function diffDias(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d1 - d2) / 86400000);
}

export function saldo(c) {
  return Math.max((c.valor_original_centavos || 0) + (c.multa_centavos || 0) + (c.juros_centavos || 0) - (c.desconto_centavos || 0) - (c.valor_pago_centavos || 0), 0);
}

export function diasAtraso(c, ref = hojeISO()) {
  if (!c.vencimento) return 0;
  return Math.max(diffDias(ref, c.vencimento), 0);
}

export function calcularEncargos(c, ref = hojeISO()) {
  const dias = diasAtraso(c, ref);
  if (!dias || c.status === 'pago' || c.status === 'cancelado') {
    return { multa: c.multa_centavos || 0, juros: c.juros_centavos || 0, dias: 0 };
  }
  const multaPct = getSettingNum('multa_atraso_pct', 2);
  const jurosDiaPct = getSettingNum('juros_atraso_dia_pct', 0.033);
  const multa = Math.round((c.valor_original_centavos || 0) * multaPct / 100);
  const juros = Math.round((c.valor_original_centavos || 0) * jurosDiaPct / 100 * dias);
  // Para cobranças ainda abertas (inclusive pagas em parte), multa e juros são
  // recalculados até a data de referência. Usar o valor armazenado congelaria
  // os juros no dia da primeira baixa parcial.
  return { multa, juros, dias };
}

export function statusEfetivo(c, ref = hojeISO()) {
  if (c.status === 'cancelado') return 'cancelado';
  if (c.status === 'pago') return 'pago';
  // Atraso é um fato objetivo: precisa prevalecer sobre o rótulo da régua
  // (promessa, acordo, jurídico). Sem isso, uma cobrança vencida marcada como
  // "promessa" deixava de aparecer como atrasada no painel e nos alertas.
  if (c.vencimento && c.vencimento < ref && saldo(c) > 0) return 'em_atraso';
  if (c.cobranca_status) return c.cobranca_status;
  if (c.status === 'pago_parcial') return 'pago_parcial';
  return 'em_aberto';
}

export const STATUS_LABEL = {
  em_aberto: 'Em aberto',
  pago_parcial: 'Pago parcial',
  pago: 'Pago',
  cancelado: 'Cancelado',
  em_atraso: 'Em atraso',
  em_cobranca: 'Em cobrança',
  promessa: 'Promessa de pagamento',
  acordo: 'Acordo',
  juridico: 'Jurídico',
};

export const ACOES = [
  ['lembrete', 'Lembrete enviado'],
  ['ligacao', 'Ligação'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'E-mail'],
  ['promessa', 'Promessa de pagamento'],
  ['acordo', 'Acordo'],
  ['juridico', 'Encaminhado ao jurídico'],
  ['observacao', 'Observação'],
];

function baseSelect() {
  return `SELECT c.*,
    ct.codigo AS contrato_codigo, ct.aluguel_centavos, ct.dia_vencimento,
    i.endereco, i.numero, i.complemento, i.proprietario_id,
    p.nome AS proprietario_nome, p.telefone AS proprietario_telefone, p.email AS proprietario_email,
    q.id AS inquilino_id, q.nome AS inquilino_nome, q.telefone AS inquilino_telefone, q.email AS inquilino_email
    FROM cobrancas c
    JOIN contratos ct ON ct.id = c.contrato_id
    JOIN imoveis i ON i.id = ct.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = ct.inquilino_id`;
}

function enriquecer(c) {
  if (!c) return c;
  const enc = calcularEncargos(c);
  const multa = enc.multa;
  const juros = enc.juros;
  const saldoFinal = Math.max(
    (c.valor_original_centavos || 0) + multa + juros - (c.desconto_centavos || 0) - (c.valor_pago_centavos || 0),
    0
  );
  return {
    ...c,
    status_efetivo: statusEfetivo(c),
    regua_status: c.cobranca_status || null,
    saldo_centavos: saldoFinal,
    multa_calculada_centavos: multa,
    juros_calculados_centavos: juros,
    dias_atraso: enc.dias,
  };
}

function filtroSql(filtros = {}) {
  const where = [];
  const args = [];
  if (filtros.competencia) { where.push('c.competencia = ?'); args.push(filtros.competencia); }
  if (filtros.status === 'abertas') where.push("c.status IN ('em_aberto','pago_parcial')");
  else if (filtros.status === 'vencidas') {
    where.push("c.status IN ('em_aberto','pago_parcial') AND c.vencimento < ?");
    args.push(hojeISO());
  }
  else if (filtros.status === 'pagas') where.push("c.status = 'pago'");
  else if (filtros.status === 'canceladas') where.push("c.status = 'cancelado'");
  else if (['em_cobranca', 'promessa', 'acordo', 'juridico'].includes(filtros.status)) {
    where.push('c.cobranca_status = ?'); args.push(filtros.status);
  }
  else if (filtros.status) { where.push('c.status = ?'); args.push(filtros.status); }
  if (filtros.contrato_id) { where.push('c.contrato_id = ?'); args.push(Number(filtros.contrato_id)); }
  if (filtros.busca) {
    where.push('(q.nome LIKE ? OR p.nome LIKE ? OR i.endereco LIKE ? OR ct.codigo LIKE ?)');
    const b = `%${filtros.busca}%`;
    args.push(b, b, b, b);
  }
  return { where, args };
}

const LIMITE_PADRAO = 1000;
const LIMITE_MAXIMO = 5000;

function normalizarLimite(limite) {
  if (limite === null || limite === 'todos') return null;
  const n = Number(limite);
  if (!Number.isFinite(n) || n <= 0) return LIMITE_PADRAO;
  return Math.min(Math.trunc(n), LIMITE_MAXIMO);
}

export function listar(filtros = {}) {
  const { where, args } = filtroSql(filtros);
  const limite = normalizarLimite(filtros.limite);
  const offset = Math.max(Math.trunc(Number(filtros.offset)) || 0, 0);
  const paginacao = limite == null ? '' : `LIMIT ${limite} OFFSET ${offset}`;
  const sql = `${baseSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.vencimento, p.nome ${paginacao}`;
  return db.prepare(sql).all(...args).map(enriquecer);
}

/** Total de registros para os mesmos filtros, sem carregar as linhas. */
export function contar(filtros = {}) {
  const { where, args } = filtroSql(filtros);
  const sql = `SELECT COUNT(*) AS n FROM (${baseSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''})`;
  return db.prepare(sql).get(...args).n;
}

export function obter(id) {
  const c = db.prepare(`${baseSelect()} WHERE c.id = ?`).get(Number(id));
  if (!c) return null;
  const acoes = db.prepare('SELECT * FROM cobranca_acoes WHERE cobranca_id = ? ORDER BY id DESC').all(c.id);
  const pagamentos = db.prepare(`SELECT id, data, valor_centavos, descricao, status FROM lancamentos
    WHERE cobranca_id = ? ORDER BY id`).all(c.id);
  return { ...enriquecer(c), acoes, pagamentos };
}

export function resumo(competencia = null) {
  const todas = db.prepare(`${baseSelect()} WHERE c.status <> 'cancelado'`).all().map(enriquecer);
  const abertas = todas.filter(c => c.status === 'em_aberto' || c.status === 'pago_parcial');
  const vencidas = abertas.filter(c => c.vencimento < hojeISO() && c.saldo_centavos > 0);
  const pagas = todas.filter(c => c.status === 'pago');
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const c of vencidas) {
    const d = c.dias_atraso;
    if (d <= 30) aging['0-30'] += c.saldo_centavos;
    else if (d <= 60) aging['31-60'] += c.saldo_centavos;
    else if (d <= 90) aging['61-90'] += c.saldo_centavos;
    else aging['90+'] += c.saldo_centavos;
  }
  const comp = competencia || hojeISO().slice(0, 7);
  const doMes = todas.filter(c => c.competencia === comp);
  const hoje = abertas.filter(c => c.vencimento === hojeISO());
  const proximas = abertas
    .filter(c => c.proxima_data && c.proxima_data <= hojeISO())
    .sort((a, b) => a.proxima_data.localeCompare(b.proxima_data));
  return {
    competencia: comp,
    total: doMes.length,
    abertas: abertas.length,
    vencidas: vencidas.length,
    pagas: pagas.length,
    valor_aberto: abertas.reduce((s, c) => s + c.saldo_centavos, 0),
    valor_vencido: vencidas.reduce((s, c) => s + c.saldo_centavos, 0),
    valor_pago: doMes.reduce((s, c) => s + (c.valor_pago_centavos || 0), 0),
    aging_valores: aging,
    hoje: hoje.slice(0, 8),
    proximas: proximas.slice(0, 8),
  };
}

function ajustarVencimento(dataISO) {
  if (String(getSetting('prorrogar_vencimento', '1')) !== '1') return dataISO;
  const d = new Date(dataISO + 'T00:00:00');
  const dia = d.getDay();
  if (dia === 6) d.setDate(d.getDate() + 2);
  else if (dia === 0) d.setDate(d.getDate() + 1);
  // Componentes locais: toISOString() pode recuar um dia em fusos positivos.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function previewGeracao(competencia) {
  if (!/^\d{4}-\d{2}$/.test(competencia || '')) throw Object.assign(new Error('Competência inválida.'), { status: 400 });
  const inicioMes = `${competencia}-01`;
  const fimMes = ultimoDia(competencia);
  const contratos = db.prepare(`
    SELECT ct.*, i.endereco, i.numero, i.complemento, i.proprietario_id,
           p.nome AS proprietario_nome, q.nome AS inquilino_nome
    FROM contratos ct
    JOIN imoveis i ON i.id = ct.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = ct.inquilino_id
    WHERE ct.status = 'ativo' AND ct.inicio <= ? AND (ct.fim IS NULL OR ct.fim >= ?)
    ORDER BY p.nome, i.endereco
  `).all(fimMes, inicioMes);
  const proporcional = String(getSetting('cobranca_proporcional', '0')) === '1';
  const linhas = contratos.map(ct => {
    const existente = db.prepare('SELECT id, status FROM cobrancas WHERE contrato_id = ? AND competencia = ?').get(ct.id, competencia);
    const dia = Math.min(Number(ct.dia_vencimento) || 5, Number(fimMes.slice(-2)));
    const vencimento = ajustarVencimento(`${competencia}-${String(dia).padStart(2, '0')}`);
    let valor = ct.aluguel_centavos || 0;
    let aviso = '';
    if (proporcional && ct.inicio > inicioMes) {
      const dias = diffDias(fimMes, ct.inicio) + 1;
      const total = Number(fimMes.slice(-2));
      valor = Math.round(valor * Math.max(dias, 1) / total);
      aviso = `Proporcional a ${dias} dia(s)`;
    }
    const status = existente ? 'ja_existe' : valor <= 0 ? 'sem_valor' : 'novo';
    return {
      contrato_id: ct.id,
      codigo: ct.codigo,
      imovel: `${ct.endereco}${ct.numero ? ', ' + ct.numero : ''}`,
      proprietario: ct.proprietario_nome,
      inquilino: ct.inquilino_nome,
      inicio: ct.inicio,
      fim: ct.fim,
      vencimento,
      valor_centavos: valor,
      aviso,
      status,
      cobranca_existente_id: existente?.id || null,
    };
  });
  const novos = linhas.filter(l => l.status === 'novo');
  return {
    competencia,
    fechado: mesFechado(competencia),
    linhas,
    total: linhas.length,
    novos: novos.length,
    ja_existem: linhas.filter(l => l.status === 'ja_existe').length,
    sem_valor: linhas.filter(l => l.status === 'sem_valor').length,
    valor_total_centavos: novos.reduce((s, l) => s + l.valor_centavos, 0),
  };
}

export function gerar(competencia, contratoIds = null, usuario) {
  exigirMesAberto(competencia);
  const previa = previewGeracao(competencia);
  const selecionados = contratoIds && contratoIds.length
    ? new Set(contratoIds.map(Number))
    : null;
  let criadas = 0;
  let ignoradas = 0;
  db.exec('BEGIN');
  try {
    for (const l of previa.linhas) {
      if (l.status !== 'novo') { ignoradas++; continue; }
      if (selecionados && !selecionados.has(l.contrato_id)) { ignoradas++; continue; }
      try {
        db.prepare(`INSERT INTO cobrancas (contrato_id, competencia, vencimento, valor_original_centavos, status, criado_por)
          VALUES (?,?,?,?,'em_aberto',?)`).run(l.contrato_id, competencia, l.vencimento, l.valor_centavos, usuario?.nome || null);
        criadas++;
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) { ignoradas++; continue; }
        throw e;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { competencia, criadas, ignoradas, total: previa.novos };
}

export function pagar(id, { valor, data, forma, desconto, observacao } = {}, usuario) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if (c.status === 'pago') throw Object.assign(new Error('Cobrança já está paga.'), { status: 409 });
  if (c.status === 'cancelado') throw Object.assign(new Error('Cobrança cancelada.'), { status: 409 });
  exigirMesAberto(c.competencia);

  const dataPg = data || hojeISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPg)) throw Object.assign(new Error('Data de pagamento inválida.'), { status: 400 });
  const enc = calcularEncargos({ ...c, multa_centavos: 0, juros_centavos: 0 }, dataPg);
  const descontoCent = Math.max(Number(desconto) || 0, 0);
  const totalDevido = (c.valor_original_centavos || 0) + enc.multa + enc.juros - (c.desconto_centavos || 0) - descontoCent - (c.valor_pago_centavos || 0);
  const valorCent = valor === undefined || valor === null || valor === '' ? totalDevido : Math.round(Number(valor));
  if (!Number.isFinite(valorCent) || valorCent <= 0) throw Object.assign(new Error('Valor de pagamento inválido.'), { status: 400 });
  if (valorCent > totalDevido) throw Object.assign(new Error(`O valor informado (${(valorCent / 100).toFixed(2)}) é maior que o saldo devedor (${(totalDevido / 100).toFixed(2)}).`), { status: 400 });

  const ct = db.prepare('SELECT * FROM contratos WHERE id = ?').get(c.contrato_id);
  const imovel = db.prepare('SELECT * FROM imoveis WHERE id = ?').get(ct.imovel_id);
  const novoPago = (c.valor_pago_centavos || 0) + valorCent;
  const novoSaldo = Math.max((c.valor_original_centavos || 0) + enc.multa + enc.juros - (c.desconto_centavos || 0) - descontoCent - novoPago, 0);
  const status = novoSaldo <= 0 ? 'pago' : 'pago_parcial';
  const descricao = `Aluguel ${ct.codigo || '#' + ct.id} · ${c.competencia}${enc.multa || enc.juros ? ' (com multa/juros)' : ''}`;

  db.exec('BEGIN');
  try {
    const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
        proprietario_id, imovel_id, contrato_id, cobranca_id, criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(dataPg, c.competencia, 'receita', 'Aluguel', descricao, valorCent, 'proprietarios',
        imovel.proprietario_id, imovel.id, ct.id, c.id, usuario?.nome || null);
    db.prepare(`UPDATE cobrancas SET multa_centavos=?, juros_centavos=?, desconto_centavos=?, valor_pago_centavos=?,
        status=?, data_pagamento=?, forma_pagamento=?, observacao=COALESCE(?, observacao),
        cobranca_status=CASE WHEN ? = 'pago' THEN NULL ELSE cobranca_status END,
        atualizado_em=datetime('now','localtime') WHERE id=?`)
      .run(enc.multa, enc.juros, (c.desconto_centavos || 0) + descontoCent, novoPago, status, dataPg,
        forma || null, observacao || null, status, c.id);
    db.exec('COMMIT');
    return { ok: true, id: c.id, lancamento_id: Number(r.lastInsertRowid), valor_centavos: valorCent, saldo_centavos: novoSaldo, status };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function estornarBaixa(id, motivo, usuario) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if (!motivo) throw Object.assign(new Error('Informe o motivo do estorno.'), { status: 400 });
  exigirMesAberto(c.competencia);
  const pagamentos = db.prepare("SELECT * FROM lancamentos WHERE cobranca_id = ? AND status = 'ativo'").all(c.id);
  if (!pagamentos.length) throw Object.assign(new Error('Não há pagamento ativo para estornar.'), { status: 409 });
  db.exec('BEGIN');
  try {
    for (const l of pagamentos) {
      db.prepare("UPDATE lancamentos SET status='estornado', motivo_estorno=? WHERE id=?").run(motivo, l.id);
      db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
          proprietario_id, imovel_id, contrato_id, status, estorno_de_id, motivo_estorno, criado_por)
          VALUES (?,?,?,?,?,?,?,?,?,?,'ativo',?,?,?)`)
        .run(hojeISO(), l.competencia, l.tipo === 'receita' ? 'despesa' : 'receita', l.categoria,
          `Estorno: ${l.descricao || l.categoria}`, l.valor_centavos, l.caixa, l.proprietario_id, l.imovel_id,
          l.contrato_id, l.id, motivo, usuario?.nome || null);
    }
    db.prepare(`UPDATE cobrancas SET valor_pago_centavos=0, multa_centavos=0, juros_centavos=0, desconto_centavos=0,
      status='em_aberto', data_pagamento=NULL, forma_pagamento=NULL, atualizado_em=datetime('now','localtime') WHERE id=?`).run(c.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

export function cancelar(id, motivo, usuario) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if ((c.valor_pago_centavos || 0) > 0) throw Object.assign(new Error('Cobrança com pagamento não pode ser cancelada. Estorne a baixa primeiro.'), { status: 409 });
  if (c.status === 'cancelado') return { ok: true };
  exigirMesAberto(c.competencia);
  db.prepare(`UPDATE cobrancas SET status='cancelado', cancelado_em=datetime('now','localtime'),
    motivo_cancelamento=?, atualizado_em=datetime('now','localtime') WHERE id=?`).run(motivo || null, c.id);
  return { ok: true };
}

export function registrarAcao(id, { tipo, descricao, responsavel, proxima_acao, proxima_data, cobranca_status } = {}, usuario) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  const tipoOk = ACOES.some(a => a[0] === tipo) ? tipo : 'observacao';
  const statusOk = ['em_cobranca', 'promessa', 'acordo', 'juridico'].includes(cobranca_status) ? cobranca_status
    : tipo === 'promessa' ? 'promessa'
    : tipo === 'acordo' ? 'acordo'
    : tipo === 'juridico' ? 'juridico'
    : tipo === 'lembrete' || tipo === 'ligacao' || tipo === 'whatsapp' || tipo === 'email' ? 'em_cobranca'
    : c.cobranca_status;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO cobranca_acoes (cobranca_id, tipo, descricao, responsavel, proxima_acao, proxima_data, criado_por)
      VALUES (?,?,?,?,?,?,?)`).run(c.id, tipoOk, descricao || null, responsavel || usuario?.nome || null,
      proxima_acao || null, proxima_data || null, usuario?.nome || null);
    db.prepare(`UPDATE cobrancas SET cobranca_status=?, responsavel=COALESCE(?, responsavel),
      proxima_acao=COALESCE(?, proxima_acao), proxima_data=COALESCE(?, proxima_data),
      atualizado_em=datetime('now','localtime') WHERE id=?`)
      .run(statusOk, responsavel || null, proxima_acao || null, proxima_data || null, c.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, status: statusOk };
}

export function definirCobrancaStatus(id, cobranca_status, usuario) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  const st = ['em_cobranca', 'promessa', 'acordo', 'juridico', ''].includes(cobranca_status) ? cobranca_status : '';
  db.prepare(`UPDATE cobrancas SET cobranca_status=?, atualizado_em=datetime('now','localtime') WHERE id=?`).run(st || null, c.id);
  return { ok: true, status: st || null };
}
