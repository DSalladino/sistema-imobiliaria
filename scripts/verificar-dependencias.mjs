#!/usr/bin/env node
/**
 * Guarda de cadeia de suprimentos para dependências fora do registro npm.
 *
 * O `xlsx` (SheetJS) é instalado a partir de uma URL do CDN do fornecedor, então
 * não aparece no `npm audit` nem é atualizado pelo Dependabot. Este script
 * falha se a origem, a versão instalada ou o hash de integridade do lockfile
 * divergirem do esperado. Rode com `npm run deps:check` (também na CI).
 */
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ORIGEM_ESPERADA = /^https:\/\/cdn\.sheetjs\.com\/xlsx-([\d.]+)\/xlsx-[\d.]+\.tgz$/;

const falhas = [];
const ler = (rel) => JSON.parse(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));

const lock = ler('package-lock.json');
const pkg = ler('package.json');
const entrada = lock.packages?.['node_modules/xlsx'];

if (!entrada) {
  falhas.push('package-lock.json não contém node_modules/xlsx.');
} else {
  const m = String(entrada.resolved || '').match(ORIGEM_ESPERADA);
  if (!m) falhas.push(`origem inesperada para xlsx: ${entrada.resolved}`);
  else if (entrada.version !== m[1]) falhas.push(`versão do lock (${entrada.version}) não confere com a URL (${m[1]}).`);
  if (!/^sha512-/.test(String(entrada.integrity || ''))) falhas.push('xlsx sem integrity sha512 no lockfile.');
  const especificado = pkg.dependencies?.xlsx;
  if (!String(especificado || '').includes(`xlsx-${entrada.version}`)) {
    falhas.push(`package.json aponta para ${especificado}, mas o lock resolve ${entrada.version}.`);
  }
  const instalado = path.join(RAIZ, 'node_modules', 'xlsx', 'package.json');
  if (!fs.existsSync(instalado)) {
    falhas.push('node_modules/xlsx ausente. Rode npm ci.');
  } else {
    const versaoInstalada = JSON.parse(fs.readFileSync(instalado, 'utf8')).version;
    if (versaoInstalada !== entrada.version) falhas.push(`instalado ${versaoInstalada}, lock espera ${entrada.version}.`);
  }
}

if (falhas.length) {
  console.error('✗ Dependência xlsx fora do padrão:\n  - ' + falhas.join('\n  - '));
  console.error('\nAtualize conscientemente: revise o changelog do SheetJS, troque a URL em package.json,');
  console.error('rode `npm install` para regravar o lockfile e valide `npm test`.');
  process.exit(1);
}

console.log(`✓ xlsx ${entrada.version} fixado em cdn.sheetjs.com com integrity sha512.`);
