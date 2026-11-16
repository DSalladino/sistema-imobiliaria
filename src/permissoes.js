import { db } from './db.js';

export const PERMISSOES = {
  admin: ['*'],
  operador: ['ler', 'escrever', 'financeiro', 'repasses'],
  consulta: ['ler'],
};

export function pode(user, acao) {
  if (!user) return false;
  if (user.papel === 'admin') return true;
  const lista = PERMISSOES[user.papel] || [];
  return lista.includes(acao);
}

export function exigir(user, acao) {
  if (!pode(user, acao)) {
    const err = new Error('Sem permissão para esta ação.');
    err.status = 403;
    throw err;
  }
}

export function auditar(user, acao, entidade, entidadeId, detalhe, ip) {
  db.prepare(`INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip)
              VALUES (?,?,?,?,?,?,?)`)
    .run(user?.id ?? null, user?.nome ?? 'sistema', acao, entidade, entidadeId == null ? null : String(entidadeId),
      detalhe == null ? null : (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)), ip ?? null);
}
