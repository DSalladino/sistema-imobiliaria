import path from 'node:path';

// Cria (ou recria) uma base de demonstração separada da produção, com dados
// fictícios e credenciais conhecidas para apresentação.
const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), 'data-demo');
process.env.DATA_DIR = dir;

const senhaDemo = String(process.env.DEMO_SENHA || 'Demo#2026');
process.env.ADMIN_SENHA = process.env.ADMIN_SENHA || senhaDemo;

const { carregarDemo } = await import('./manutencao.js');
const { db } = await import('./db.js');
const { hashSenha } = await import('./auth.js');
const { validarSenha } = await import('./seguranca.js');

carregarDemo();

// A base de demonstração é isolada e descartável: o acesso é conhecido de
// propósito para que qualquer pessoa consiga avaliar o produto.
validarSenha(senhaDemo, 'admin@imobiliaria.local');
db.prepare(`UPDATE usuarios
  SET senha_hash = ?, deve_trocar_senha = 0,
      totp_ativo = 0, totp_secret = NULL, totp_recovery = NULL
  WHERE email = 'admin@imobiliaria.local'`).run(hashSenha(senhaDemo));
db.prepare('DELETE FROM sessoes').run();

console.log('');
console.log('  Base de demonstração pronta em', dir);
console.log('  E-mail: admin@imobiliaria.local');
console.log('  Senha: ', senhaDemo);
console.log('');
console.log('  Dados fictícios, sem vínculo com clientes reais.');
console.log('  Suba a instância isolada com: npm run demo:servir');
