import crypto from 'node:crypto';
import { db } from './db.js';

/**
 * Trilha de auditoria à prova de adulteração.
 *
 * Cada registro guarda o hash do registro anterior e o próprio hash, formando
 * uma cadeia. Alterar ou apagar uma linha antiga quebra a verificação, o que
 * permite detectar edição direta no SQLite — algo que uma auditoria tradicional
 * (somente leitura de tabela) não consegue provar.
 */

export function agoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function hashAuditoria(anterior, r) {
  const partes = [
    anterior || '',
    r.usuario_id ?? '',
    r.usuario_nome ?? '',
    r.acao ?? '',
    r.entidade ?? '',
    r.entidade_id ?? '',
    r.detalhe ?? '',
    r.ip ?? '',
    r.criado_em ?? '',
  ];
  return crypto.createHash('sha256').update(partes.join('|')).digest('hex');
}

export function ultimoHashAuditoria() {
  const row = db.prepare('SELECT hash FROM auditoria WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  return row?.hash || '';
}

/**
 * Insere um registro já encadeado. Usado por `auditar()`; também é chamado
 * diretamente pela migração de bancos antigos.
 */
export function inserirAuditoria({ usuario_id = null, usuario_nome = 'sistema', acao, entidade, entidade_id = null, detalhe = null, ip = null, criado_em = null }) {
  const quando = criado_em || agoraLocal();
  const anterior = ultimoHashAuditoria();
  const base = {
    usuario_id,
    usuario_nome,
    acao,
    entidade,
    entidade_id: entidade_id == null ? null : String(entidade_id),
    detalhe: detalhe == null ? null : (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)),
    ip,
    criado_em: quando,
  };
  const hash = hashAuditoria(anterior, base);
  const r = db.prepare(`INSERT INTO auditoria
      (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip, criado_em, hash_anterior, hash)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(base.usuario_id, base.usuario_nome, base.acao, base.entidade, base.entidade_id,
      base.detalhe, base.ip, base.criado_em, anterior, hash);
  return { id: Number(r.lastInsertRowid), hash };
}

/** Recalcula a cadeia inteira e devolve o primeiro ponto de divergência. */
export function verificarIntegridadeAuditoria({ limite = null } = {}) {
  const limiteSql = Number.isFinite(Number(limite)) && Number(limite) > 0 ? `LIMIT ${Math.trunc(Number(limite))}` : '';
  const linhas = db.prepare(`SELECT id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip, criado_em, hash_anterior, hash
    FROM auditoria ORDER BY id ${limiteSql}`).all();
  let anterior = '';
  for (const linha of linhas) {
    const esperado = hashAuditoria(anterior, linha);
    if (linha.hash_anterior !== (anterior || null) && linha.hash_anterior !== anterior) {
      return {
        ok: false,
        total: linhas.length,
        problema: { id: linha.id, motivo: 'Encadeamento anterior não confere.', esperado: anterior, encontrado: linha.hash_anterior },
      };
    }
    if (linha.hash !== esperado) {
      return {
        ok: false,
        total: linhas.length,
        problema: { id: linha.id, motivo: 'Hash do registro não confere (conteúdo alterado).', esperado, encontrado: linha.hash },
      };
    }
    anterior = linha.hash;
  }
  return { ok: true, total: linhas.length, ultimo_hash: anterior, verificado_em: new Date().toISOString() };
}

/** Reencadeia a trilha após expurgo legítimo por retenção. */
export function reencadearAuditoria() {
  const linhas = db.prepare(`SELECT id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip, criado_em
    FROM auditoria ORDER BY id`).all();
  const atualizar = db.prepare('UPDATE auditoria SET hash_anterior = ?, hash = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    let anterior = '';
    for (const linha of linhas) {
      const hash = hashAuditoria(anterior, linha);
      atualizar.run(anterior || null, hash, linha.id);
      anterior = hash;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, registros: linhas.length };
}

/** Converte o detalhe JSON em uma lista legível de alterações. */
export function diffAuditoria(detalhe) {
  if (detalhe == null) return [];
  let obj = detalhe;
  if (typeof detalhe === 'string') {
    try { obj = JSON.parse(detalhe); } catch { return []; }
  }
  if (!obj || typeof obj !== 'object') return [];
  const antes = obj.antes || obj.before;
  const depois = obj.depois || obj.after;
  if (!antes || !depois) return [];
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  const mudancas = [];
  for (const chave of chaves) {
    const a = antes[chave];
    const d = depois[chave];
    if (JSON.stringify(a) === JSON.stringify(d)) continue;
    mudancas.push({ campo: chave, antes: a ?? null, depois: d ?? null });
  }
  return mudancas;
}

export function detalharAuditoria(id) {
  const row = db.prepare('SELECT * FROM auditoria WHERE id = ?').get(Number(id));
  if (!row) return null;
  return { ...row, alteracoes: diffAuditoria(row.detalhe) };
}

/**
 * Filtros da auditoria com paginação e envelope opcional. A interface usa o
 * envelope para saber se há mais registros do que os exibidos.
 */
export function consultarAuditoria({ usuario, acao, entidade, entidade_id, de, ate, busca, limite = 200, offset = 0, envelope = false } = {}) {
  const where = [];
  const args = [];
  if (usuario) { where.push('usuario_nome LIKE ?'); args.push(`%${usuario}%`); }
  if (acao) { where.push('acao = ?'); args.push(acao); }
  if (entidade) { where.push('entidade = ?'); args.push(entidade); }
  if (entidade_id) { where.push('entidade_id = ?'); args.push(String(entidade_id)); }
  if (de) { where.push('criado_em >= ?'); args.push(`${de} 00:00:00`); }
  if (ate) { where.push('criado_em <= ?'); args.push(`${ate} 23:59:59`); }
  if (busca) {
    where.push('(usuario_nome LIKE ? OR acao LIKE ? OR entidade LIKE ? OR detalhe LIKE ? OR ip LIKE ?)');
    const b = `%${busca}%`;
    args.push(b, b, b, b, b);
  }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const n = Math.min(Math.max(Math.trunc(Number(limite)) || 200, 1), 2000);
  const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
  const itens = db.prepare(`SELECT id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip, criado_em, hash_anterior, hash
    FROM auditoria ${filtro} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, n, off);
  if (!envelope) return itens;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${filtro}`).get(...args).n;
  return { itens, total, limite: n, offset: off };
}
