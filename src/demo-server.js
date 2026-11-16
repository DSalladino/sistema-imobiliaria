import fs from 'node:fs';
import path from 'node:path';

// Sobe uma instância de demonstração em uma porta separada, com banco próprio.
const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), 'data-demo');
process.env.DEMO_DATA_DIR = dir;
process.env.DATA_DIR = dir;
process.env.PORT = process.env.DEMO_PORT || '3009';
process.env.HOST = process.env.HOST || '127.0.0.1';

fs.mkdirSync(dir, { recursive: true });
const dbFile = path.join(dir, 'imobiliaria.db');
if (!fs.existsSync(dbFile)) {
  console.log('Criando base de demonstração em', dir);
  await import('./demo-preparar.js');
}

await import('./server.js');
