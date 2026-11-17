import { inserirAuditoria } from './auditoria.js';

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
  return inserirAuditoria({
    usuario_id: user?.id ?? null,
    usuario_nome: user?.nome ?? 'sistema',
    acao,
    entidade,
    entidade_id: entidadeId,
    detalhe,
    ip,
  });
}
