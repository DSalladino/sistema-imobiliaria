/**
 * Recuperação local do administrador.
 * Uso:
 *   node src/reset-admin.js --email admin@imobiliaria.local
 *   node src/reset-admin.js --email admin@imobiliaria.local --senha "NovaSenha#2026"
 *
 * Gera uma senha temporária, força a troca no próximo login e remove o 2FA
 * para permitir o acesso quando o celular foi perdido.
 */
import crypto from 'node:crypto';
import { db } from './db.js';
import { hashSenha } from './auth.js';
import { inserirAuditoria } from './auditoria.js';
import { validarSenha } from './seguranca.js';
import { setSetting } from './regras.js';

const args = process.argv.slice(2);
const pegar = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};

const emailArg = pegar('--email');
const senhaArg = pegar('--senha');

let usuario;
if (emailArg) {
  usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(String(emailArg).toLowerCase());
} else {
  usuario = db.prepare("SELECT * FROM usuarios WHERE papel = 'admin' AND ativo = 1 ORDER BY id LIMIT 1").get();
}

if (!usuario) {
  console.error('Administrador não encontrado. Informe --email.');
  process.exit(1);
}

const senha = senhaArg || `Imob-${crypto.randomBytes(4).toString('hex')}#26`;
validarSenha(senha, usuario.email);

db.exec('BEGIN');
try {
  db.prepare(`UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1,
    totp_ativo = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?`)
    .run(hashSenha(senha), usuario.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuario.id);
  inserirAuditoria({
    usuario_nome: 'sistema', acao: 'reset_admin_cli', entidade: 'usuarios',
    entidade_id: usuario.id, detalhe: { email: usuario.email },
  });
  db.exec('COMMIT');
  setSetting('primeiro_acesso', '0');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Falha ao redefinir:', e.message);
  process.exit(1);
}

console.log('\nSenha redefinida com sucesso.\n');
console.log('  E-mail:', usuario.email);
console.log('  Senha temporária:', senha);
console.log('\nNo próximo login o sistema exigirá a troca da senha.');
console.log('O 2FA deste usuário foi desativado. Ative novamente depois.\n');
