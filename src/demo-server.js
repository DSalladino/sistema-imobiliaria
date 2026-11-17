import fs from 'node:fs';
import path from 'node:path';

// Sobe uma instância de demonstração em uma porta separada, com banco próprio.
// Funciona localmente e em PaaS: respeita PORT/HOST do ambiente e nunca toca na
// base de produção.
const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), 'data-demo');
process.env.DEMO_DATA_DIR = dir;
process.env.DATA_DIR = dir;
process.env.PORT = process.env.PORT || process.env.DEMO_PORT || '3009';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.DEMO_MODE = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const senhaDemo = String(process.env.DEMO_SENHA || 'Demo#2026');
process.env.ADMIN_SENHA = process.env.ADMIN_SENHA || senhaDemo;

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const dbFile = path.join(dir, 'imobiliaria.db');
if (!fs.existsSync(dbFile)) {
  console.log('Criando base de demonstração em', dir);
  await import('./demo-preparar.js');
}

await import('./server.js');

// A demonstração pública é descartável por definição. Um reset periódico
// devolve a base ao estado inicial e restaura a senha conhecida, para que um
// visitante não deixe o sistema inutilizável para o próximo. Desligue com
// DEMO_RESET_HORAS=0.
const horas = Number(process.env.DEMO_RESET_HORAS ?? 6);
if (Number.isFinite(horas) && horas > 0) {
  const intervaloMs = Math.max(horas, 0.25) * 60 * 60 * 1000;
  let resetando = false;
  const resetar = async () => {
    if (resetando) return;
    resetando = true;
    try {
      const { carregarDemo } = await import('./manutencao.js');
      const { db } = await import('./db.js');
      const { hashSenha } = await import('./auth.js');
      carregarDemo();
      db.prepare(`UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0,
          totp_ativo = 0, totp_secret = NULL, totp_recovery = NULL
        WHERE email = 'admin@imobiliaria.local'`).run(hashSenha(senhaDemo));
      db.prepare('DELETE FROM sessoes').run();
      console.log(`  Demonstração reiniciada automaticamente (a cada ${horas}h).`);
    } catch (e) {
      console.error('  Aviso: falha ao reiniciar a demonstração:', e.message);
    } finally {
      resetando = false;
    }
  };
  const timer = setInterval(resetar, intervaloMs);
  timer.unref();
  console.log(`  Reset automático da demonstração: a cada ${horas}h (DEMO_RESET_HORAS=0 desliga).`);
}
