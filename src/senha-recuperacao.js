import crypto from 'node:crypto';
import { db } from './db.js';
import { hashSenha } from './auth.js';
import { validarSenha } from './seguranca.js';
import { getSettingNum, setSetting } from './regras.js';

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function criarSolicitacao(email, ip) {
  const u = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ? AND ativo = 1').get(String(email || '').toLowerCase());
  if (!u) return { ok: true };
  db.prepare('DELETE FROM password_resets WHERE usuario_id = ? AND usado_em IS NULL').run(u.id);
  const token = crypto.randomBytes(32).toString('hex');
  const minutos = Math.max(10, Math.min(getSettingNum('reset_validade_min', 30), 120));
  const expira = new Date(Date.now() + minutos * 60000).toISOString();
  db.prepare('INSERT INTO password_resets (usuario_id, token_hash, expira_em, ip) VALUES (?,?,?,?)')
    .run(u.id, hashToken(token), expira, ip || null);
  return { ok: true, usuario: u, token, expira, minutos };
}

export function validarToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT pr.*, u.nome, u.email, u.ativo
    FROM password_resets pr JOIN usuarios u ON u.id = pr.usuario_id
    WHERE pr.token_hash = ?`).get(hashToken(token));
  if (!row || row.usado_em || !row.ativo) return null;
  if (new Date(row.expira_em) < new Date()) return null;
  return row;
}

export function usarToken(token, novaSenha) {
  const row = validarToken(token);
  if (!row) throw Object.assign(new Error('Link inválido ou expirado. Solicite outro.'), { status: 400 });
  validarSenha(novaSenha, row.email);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?').run(hashSenha(novaSenha), row.usuario_id);
    db.prepare("UPDATE password_resets SET usado_em = datetime('now','localtime') WHERE id = ?").run(row.id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(row.usuario_id);
    db.exec('COMMIT');
    setSetting('primeiro_acesso', '0');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, usuario_id: row.usuario_id, email: row.email };
}

export function listarSolicitacoes() {
  return db.prepare(`SELECT pr.id, pr.criado_em, pr.expira_em, pr.usado_em, pr.ip,
      u.id AS usuario_id, u.nome, u.email
    FROM password_resets pr JOIN usuarios u ON u.id = pr.usuario_id
    ORDER BY pr.id DESC LIMIT 50`).all();
}
