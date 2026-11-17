import { db } from './db.js';
import { hojeISO, competenciaAtual, getSettingNum } from './regras.js';

/**
 * Comissões de corretagem: previstas por contrato/corretor e pagas como despesa
 * da imobiliária, sempre com histórico e vínculo ao contrato.
 */

export const STATUS_COMISSAO = {
  prevista: 'Prevista',
  liberada: 'Liberada',
  paga: 'Paga',
  cancelada: 'Cancelada',
};

const baseSelect = `SELECT cm.*, ct.codigo AS contrato_codigo, ct.aluguel_centavos,
    i.endereco, i.numero, i.complemento, p.nome AS proprietario_nome, q.nome AS inquilino_nome
  FROM comissoes cm
  JOIN contratos ct ON ct.id = cm.contrato_id
  JOIN imoveis i ON i.id = ct.imovel_id
  JOIN proprietarios p ON p.id = i.proprietario_id
  JOIN inquilinos q ON q.id = ct.inquilino_id`;

function enriquecer(c) {
  if (!c) return c;
  return { ...c, status_label: STATUS_COMISSAO[c.status] || c.status };
}

export function listar({ status, competencia, contrato_id, corretor } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('cm.status = ?'); args.push(status); }
  if (competencia) { where.push('cm.competencia = ?'); args.push(competencia); }
  if (contrato_id) { where.push('cm.contrato_id = ?'); args.push(Number(contrato_id)); }
  if (corretor) { where.push('cm.corretor LIKE ?'); args.push(`%${corretor}%`); }
  const sql = `${baseSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY cm.competencia DESC, cm.id DESC LIMIT 1000`;
  return db.prepare(sql).all(...args).map(enriquecer);
}

export function obter(id) {
  return enriquecer(db.prepare(`${baseSelect} WHERE cm.id = ?`).get(Number(id)));
}

export function resumo(competencia = competenciaAtual()) {
  const linhas = db.prepare('SELECT * FROM comissoes WHERE competencia = ?').all(competencia);
  const soma = (status) => linhas.filter(c => status.includes(c.status)).reduce((s, c) => s + c.valor_centavos, 0);
  return {
    competencia,
    previstas_centavos: soma(['prevista', 'liberada']),
    pagas_centavos: soma(['paga']),
    total_centavos: soma(['prevista', 'liberada', 'paga']),
    quantidade: linhas.filter(c => c.status !== 'cancelada').length,
    corretores: [...new Set(linhas.map(c => c.corretor))].sort(),
  };
}

export function criar({ contrato_id, corretor, pct, competencia, base_centavos, observacoes } = {}, user) {
  const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(Number(contrato_id));
  if (!contrato) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
  const nomeCorretor = String(corretor || contrato.corretor || '').trim();
  if (!nomeCorretor) throw Object.assign(new Error('Informe o corretor.'), { status: 400 });
  const percentual = pct == null || pct === ''
    ? (contrato.comissao_pct != null ? Number(contrato.comissao_pct) : getSettingNum('comissao_padrao_pct', 0))
    : Number(String(pct).replace(',', '.'));
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
    throw Object.assign(new Error('Percentual de comissão deve estar entre 0 e 100.'), { status: 400 });
  }
  const comp = /^\d{4}-\d{2}$/.test(String(competencia || '')) ? String(competencia) : competenciaAtual();
  const base = Math.round(Number(base_centavos) || contrato.aluguel_centavos || 0);
  if (base <= 0) throw Object.assign(new Error('Base de cálculo inválida.'), { status: 400 });
  const valor = Math.round(base * percentual / 100);

  const existente = db.prepare('SELECT id FROM comissoes WHERE contrato_id = ? AND competencia = ? AND corretor = ?')
    .get(contrato.id, comp, nomeCorretor);
  if (existente) {
    throw Object.assign(new Error(`Já existe comissão de ${nomeCorretor} para este contrato em ${comp}.`), { status: 409 });
  }
  const r = db.prepare(`INSERT INTO comissoes (contrato_id, corretor, base_centavos, pct, valor_centavos, competencia,
      status, prevista_em, observacoes, criado_por) VALUES (?,?,?,?,?,?,'prevista',?,?,?)`)
    .run(contrato.id, nomeCorretor, base, percentual, valor, comp, hojeISO(), observacoes || null, user?.nome || null);
  return obter(Number(r.lastInsertRowid));
}

export function atualizarStatus(id, status, user) {
  const c = db.prepare('SELECT * FROM comissoes WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Comissão não encontrada.'), { status: 404 });
  if (!['prevista', 'liberada'].includes(status)) {
    throw Object.assign(new Error('Status inválido. Use prevista ou liberada.'), { status: 400 });
  }
  if (c.status === 'paga') throw Object.assign(new Error('Comissão já paga.'), { status: 409 });
  if (c.status === 'cancelada') throw Object.assign(new Error('Comissão cancelada.'), { status: 409 });
  db.prepare('UPDATE comissoes SET status = ? WHERE id = ?').run(status, c.id);
  void user;
  return obter(c.id);
}

export function pagar(id, { data, observacoes } = {}, user) {
  const c = db.prepare('SELECT * FROM comissoes WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Comissão não encontrada.'), { status: 404 });
  if (c.status === 'paga') throw Object.assign(new Error('Comissão já paga.'), { status: 409 });
  if (c.status === 'cancelada') throw Object.assign(new Error('Comissão cancelada.'), { status: 409 });
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? String(data) : hojeISO();
  const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(c.contrato_id);
  db.exec('BEGIN');
  try {
    const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
        contrato_id, criado_por) VALUES (?,?,'despesa','Comissão de corretagem',?,?, 'imobiliaria', ?, ?)`)
      .run(dia, c.competencia, `Comissão ${c.corretor} — ${contrato?.codigo || '#' + c.contrato_id}`,
        c.valor_centavos, c.contrato_id, user?.nome || null);
    db.prepare(`UPDATE comissoes SET status='paga', paga_em=?, lancamento_id=?,
        observacoes=COALESCE(?, observacoes) WHERE id=?`)
      .run(dia, Number(r.lastInsertRowid), observacoes || null, c.id);
    db.exec('COMMIT');
    return { ok: true, id: c.id, lancamento_id: Number(r.lastInsertRowid), valor_centavos: c.valor_centavos, comissao: obter(c.id) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function cancelar(id, motivo, user) {
  const c = db.prepare('SELECT * FROM comissoes WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Comissão não encontrada.'), { status: 404 });
  if (c.status === 'paga') {
    throw Object.assign(new Error('Comissão paga não pode ser cancelada; estorne o lançamento financeiro.'), { status: 409 });
  }
  if (c.status === 'cancelada') return obter(c.id);
  db.prepare("UPDATE comissoes SET status='cancelada', observacoes = COALESCE(?, observacoes) WHERE id=?")
    .run(motivo ? `Cancelada: ${motivo}` : null, c.id);
  void user;
  return obter(c.id);
}

/** Gera, em lote, as comissões previstas da competência para contratos ativos. */
export function gerarLote({ competencia = competenciaAtual(), pct = null, corretor = null } = {}, user) {
  const comp = /^\d{4}-\d{2}$/.test(String(competencia)) ? String(competencia) : competenciaAtual();
  const contratos = db.prepare(`SELECT c.*, i.proprietario_id FROM contratos c JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.status = 'ativo' ORDER BY c.id`).all();
  const criadas = [];
  const ignoradas = [];
  for (const c of contratos) {
    const nome = String(corretor || c.corretor || '').trim();
    if (!nome) { ignoradas.push({ contrato_id: c.id, motivo: 'sem corretor' }); continue; }
    const percentual = pct == null || pct === ''
      ? (c.comissao_pct != null ? Number(c.comissao_pct) : getSettingNum('comissao_padrao_pct', 0))
      : Number(String(pct).replace(',', '.'));
    if (!Number.isFinite(percentual) || percentual <= 0) { ignoradas.push({ contrato_id: c.id, motivo: 'percentual zerado' }); continue; }
    try {
      criadas.push(criar({ contrato_id: c.id, corretor: nome, pct: percentual, competencia: comp }, user));
    } catch (e) {
      ignoradas.push({ contrato_id: c.id, motivo: e.message });
    }
  }
  return { competencia: comp, criadas: criadas.length, ignoradas, comissoes: criadas };
}
