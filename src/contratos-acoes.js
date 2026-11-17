import { db } from './db.js';
import { hojeISO, competenciaDe, addMeses, brl } from './regras.js';

/**
 * Ações em lote sobre contratos: reajuste anual e rescisão.
 * Ambas guardam histórico próprio, além da auditoria do sistema.
 */

function contratosBase() {
  return db.prepare(`
    SELECT c.*, i.endereco, i.numero, i.complemento, i.proprietario_id, i.situacao AS imovel_situacao,
           p.nome AS proprietario_nome, q.nome AS inquilino_nome, q.telefone AS inquilino_telefone,
           q.email AS inquilino_email
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = c.inquilino_id
  `);
}

function aniversarioParaData(contrato) {
  // Primeiro aniversário após o último reajuste (ou após o início). Se o
  // contrato acumulou anos sem reajuste, o operador informa o percentual
  // acumulado e aplica de uma vez; o histórico guarda a data da aplicação.
  const base = String(contrato.ultimo_reajuste || contrato.inicio).slice(0, 10);
  return addMeses(base, 12);
}

export function calcularNovoAluguel(atualCentavos, percentual) {
  const pct = Number(percentual);
  if (!Number.isFinite(pct) || pct <= -100) {
    throw Object.assign(new Error('Percentual de reajuste inválido.'), { status: 400 });
  }
  return Math.max(Math.round((Number(atualCentavos) || 0) * (1 + pct / 100)), 0);
}

/**
 * Prévia do reajuste. Sem `contrato_ids`, lista os contratos com aniversário
 * vencido até a data informada.
 */
export function previewReajuste({ data = hojeISO(), percentual = 0, indice = '', contrato_ids = null } = {}) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : hojeISO();
  const ids = Array.isArray(contrato_ids) && contrato_ids.length
    ? new Set(contrato_ids.map(Number))
    : null;
  const pct = Number(percentual);
  if (!Number.isFinite(pct) || pct <= -100) {
    throw Object.assign(new Error('Percentual de reajuste inválido.'), { status: 400 });
  }
  const linhas = [];
  const contratos = contratosBase().all();
  for (const c of contratos) {
    if (ids && !ids.has(c.id)) continue;
    if (c.status !== 'ativo') continue;
    const aniversario = aniversarioParaData(c);
    if (!ids && aniversario > dia) continue;
    const novo = calcularNovoAluguel(c.aluguel_centavos, pct);
    linhas.push({
      contrato_id: c.id,
      codigo: c.codigo || `#${c.id}`,
      imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`,
      proprietario: c.proprietario_nome,
      inquilino: c.inquilino_nome,
      inicio: c.inicio,
      ultimo_reajuste: c.ultimo_reajuste,
      indice: c.indice_reajuste || '',
      aniversario,
      aluguel_atual_centavos: c.aluguel_centavos,
      aluguel_novo_centavos: novo,
      diferenca_centavos: novo - c.aluguel_centavos,
      percentual: pct,
      previsto: aniversario <= dia,
    });
  }
  const totalAtual = linhas.reduce((s, l) => s + l.aluguel_atual_centavos, 0);
  const totalNovo = linhas.reduce((s, l) => s + l.aluguel_novo_centavos, 0);
  return {
    data: dia,
    competencia: competenciaDe(dia),
    indice: indice || '',
    percentual: pct,
    linhas,
    resumo: {
      contratos: linhas.length,
      total_atual_centavos: totalAtual,
      total_novo_centavos: totalNovo,
      diferenca_centavos: totalNovo - totalAtual,
      total_atual: brl(totalAtual),
      total_novo: brl(totalNovo),
      diferenca: brl(totalNovo - totalAtual),
    },
  };
}

export function aplicarReajuste({ contrato_ids = [], percentual, indice = '', data = hojeISO(), observacoes = '' } = {}, user) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : hojeISO();
  const pct = Number(percentual);
  if (!Number.isFinite(pct) || pct <= -100) {
    throw Object.assign(new Error('Percentual de reajuste inválido.'), { status: 400 });
  }
  const ids = Array.isArray(contrato_ids) ? contrato_ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) throw Object.assign(new Error('Selecione ao menos um contrato.'), { status: 400 });

  const competencia = competenciaDe(dia);
  const aplicados = [];
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      const c = db.prepare('SELECT * FROM contratos WHERE id = ?').get(id);
      if (!c) throw Object.assign(new Error(`Contrato #${id} não encontrado.`), { status: 404 });
      if (c.status !== 'ativo') {
        throw Object.assign(new Error(`Contrato ${c.codigo || '#' + id} não está ativo.`), { status: 409 });
      }
      const anterior = c.aluguel_centavos || 0;
      const novo = calcularNovoAluguel(anterior, pct);
      db.prepare('UPDATE contratos SET aluguel_centavos = ?, ultimo_reajuste = ? WHERE id = ?').run(novo, dia, id);
      db.prepare(`INSERT INTO reajustes (contrato_id, competencia, indice, percentual, aluguel_anterior_centavos,
          aluguel_novo_centavos, aplicado_em, aplicado_por, observacoes)
          VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, competencia, indice || c.indice_reajuste || null, pct, anterior, novo, dia, user?.nome || null, observacoes || null);
      // Cobranças ainda em aberto com vencimento a partir da data passam a
      // refletir o novo aluguel; as pagas ficam no histórico com o valor antigo.
      const cobrancas = db.prepare(`UPDATE cobrancas SET valor_original_centavos = ?, atualizado_em = datetime('now','localtime')
        WHERE contrato_id = ? AND status = 'em_aberto' AND vencimento >= ?`)
        .run(novo, id, dia);
      aplicados.push({
        contrato_id: id,
        codigo: c.codigo,
        aluguel_anterior_centavos: anterior,
        aluguel_novo_centavos: novo,
        cobrancas_atualizadas: Number(cobrancas.changes || 0),
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {
    ok: true,
    data: dia,
    competencia,
    percentual: pct,
    indice: indice || null,
    aplicados,
    total_anterior_centavos: aplicados.reduce((s, a) => s + a.aluguel_anterior_centavos, 0),
    total_novo_centavos: aplicados.reduce((s, a) => s + a.aluguel_novo_centavos, 0),
  };
}

export function historicoReajustes(contratoId) {
  return db.prepare(`SELECT * FROM reajustes WHERE contrato_id = ? ORDER BY aplicado_em DESC, id DESC`)
    .all(Number(contratoId));
}

/**
 * Rescisão: encerra o contrato, cancela cobranças futuras em aberto, registra a
 * multa e, quando houver caução, gera a devolução como conta a pagar.
 */
export function rescindir(contratoId, {
  data = hojeISO(), motivo = '', multa_centavos = 0, devolver_caucao = true, observacoes = '',
} = {}, user) {
  const c = db.prepare('SELECT * FROM contratos WHERE id = ?').get(Number(contratoId));
  if (!c) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
  if (c.status === 'encerrado') throw Object.assign(new Error('Contrato já está encerrado.'), { status: 409 });
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : hojeISO();
  if (dia < c.inicio) {
    throw Object.assign(new Error('A data da rescisão não pode ser anterior ao início do contrato.'), { status: 400 });
  }
  const motivoTexto = String(motivo || '').trim();
  if (motivoTexto.length < 3) throw Object.assign(new Error('Informe o motivo da rescisão.'), { status: 400 });
  const multa = Math.max(Math.round(Number(multa_centavos) || 0), 0);

  const imovel = db.prepare('SELECT * FROM imoveis WHERE id = ?').get(c.imovel_id);
  const canceladas = db.prepare(`SELECT id, competencia, vencimento FROM cobrancas
    WHERE contrato_id = ? AND status = 'em_aberto' AND vencimento > ?`).all(c.id, dia);
  const abertasNoPeriodo = db.prepare(`SELECT COUNT(*) AS n FROM cobrancas
    WHERE contrato_id = ? AND status = 'em_aberto' AND vencimento <= ?`).get(c.id, dia).n;

  const caucao = devolver_caucao && c.garantia_tipo === 'caucao' ? Math.max((c.garantia_valor_centavos || 0) - multa, 0) : 0;

  db.exec('BEGIN');
  try {
    for (const cob of canceladas) {
      db.prepare(`UPDATE cobrancas SET status='cancelado', cancelado_em=?, motivo_cancelamento=? WHERE id=?`)
        .run(dia, `Contrato rescindido em ${dia}`, cob.id);
    }
    db.prepare(`UPDATE contratos SET status='encerrado', fim=? WHERE id=?`).run(dia, c.id);
    const outroAtivo = db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE imovel_id = ? AND id <> ? AND status = 'ativo'")
      .get(c.imovel_id, c.id).n;
    if (!outroAtivo) {
      db.prepare("UPDATE imoveis SET situacao = 'vago' WHERE id = ?").run(c.imovel_id);
    }

    const contas = [];
    if (caucao > 0) {
      const venc = dia;
      const r = db.prepare(`INSERT INTO contas (tipo, descricao, categoria, fornecedor, valor_centavos, vencimento, competencia,
          recorrencia, caixa, proprietario_id, imovel_id, contrato_id, observacoes, criado_por)
          VALUES ('pagar', ?, 'Devolução de caução', NULL, ?, ?, ?, 'unica', 'proprietarios', ?, ?, ?, ?, ?)`)
        .run(`Devolução de caução — ${c.codigo || '#' + c.id}`, caucao, venc, venc.slice(0, 7),
          imovel?.proprietario_id || null, c.imovel_id, c.id,
          `Rescisão em ${dia}${multa ? ` com multa de ${brl(multa)} descontada` : ''}`, user?.nome || null);
      contas.push({ tipo: 'pagar', id: Number(r.lastInsertRowid), valor_centavos: caucao, categoria: 'Devolução de caução' });
    }
    if (multa > 0) {
      const r = db.prepare(`INSERT INTO contas (tipo, descricao, categoria, fornecedor, valor_centavos, vencimento, competencia,
          recorrencia, caixa, proprietario_id, imovel_id, contrato_id, observacoes, criado_por)
          VALUES ('receber', ?, 'Multa rescisória', NULL, ?, ?, ?, 'unica', 'proprietarios', ?, ?, ?, ?, ?)`)
        .run(`Multa rescisória — ${c.codigo || '#' + c.id}`, multa, dia, dia.slice(0, 7),
          imovel?.proprietario_id || null, c.imovel_id, c.id, motivoTexto, user?.nome || null);
      contas.push({ tipo: 'receber', id: Number(r.lastInsertRowid), valor_centavos: multa, categoria: 'Multa rescisória' });
    }

    const res = db.prepare(`INSERT INTO rescisoes (contrato_id, data, motivo, multa_centavos, caucao_devolucao_centavos,
        cobrancas_canceladas, observacoes, criado_por) VALUES (?,?,?,?,?,?,?,?)`)
      .run(c.id, dia, motivoTexto, multa, caucao, canceladas.length, observacoes || null, user?.nome || null);
    db.exec('COMMIT');
    return {
      ok: true,
      rescisao_id: Number(res.lastInsertRowid),
      contrato_id: c.id,
      data: dia,
      motivo: motivoTexto,
      multa_centavos: multa,
      caucao_devolucao_centavos: caucao,
      cobrancas_canceladas: canceladas.map(x => x.id),
      cobrancas_abertas_ate_data: abertasNoPeriodo,
      contas,
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function obterRescisao(contratoId) {
  return db.prepare('SELECT * FROM rescisoes WHERE contrato_id = ?').get(Number(contratoId)) || null;
}
