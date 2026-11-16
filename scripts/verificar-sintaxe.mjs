import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PASTAS = ['src', 'public', 'tests', 'scripts'];
const arquivos = [];

for (const pasta of PASTAS) {
  const base = path.join(RAIZ, pasta);
  if (!fs.existsSync(base)) continue;
  for (const entrada of fs.readdirSync(base, { withFileTypes: true })) {
    if (entrada.isFile() && /\.(m?js)$/.test(entrada.name)) {
      arquivos.push(path.join(base, entrada.name));
    }
  }
}

let falhas = 0;
for (const arquivo of arquivos.sort()) {
  const r = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' });
  const rel = path.relative(RAIZ, arquivo);
  if (r.status !== 0) {
    falhas++;
    console.error(`✗ ${rel}\n${r.stderr.trim()}`);
  } else {
    console.log(`✓ ${rel}`);
  }
}

if (falhas) {
  console.error(`\n${falhas} arquivo(s) com erro de sintaxe.`);
  process.exit(1);
}
console.log(`\n${arquivos.length} arquivo(s) verificados.`);
