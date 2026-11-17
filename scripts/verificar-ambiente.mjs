#!/usr/bin/env node
/**
 * Verificação de ambiente antes de subir o sistema.
 *
 * A causa mais comum de "o sistema não abre" é uma versão de Node anterior à
 * 22.13, que não traz o módulo `node:sqlite` estável, ou uma pasta de dados sem
 * permissão de escrita. Este script falha cedo, com uma mensagem acionável, em
 * vez de deixar o usuário diante de um erro obscuro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const MIN = [22, 13, 0];
const atual = process.versions.node.split('.').map(Number);
const versaoOk = atual[0] > MIN[0]
  || (atual[0] === MIN[0] && atual[1] > MIN[1])
  || (atual[0] === MIN[0] && atual[1] === MIN[1] && atual[2] >= MIN[2]);

const linhas = [];
linhas.push('');
linhas.push('  Verificando ambiente do sistema...');

if (!versaoOk) {
  console.error(`
  ✖ Node.js ${process.versions.node} não é compatível.

  O sistema usa o SQLite nativo do Node (node:sqlite), disponível a partir
  da versão 22.13. Instale o Node 24 LTS e tente novamente:

    nvm install 24
    nvm use 24
    node -v
    npm start

  No Windows, baixe em https://nodejs.org (escolha a versão LTS 24).
`);
  process.exit(1);
}

try {
  const require = createRequire(import.meta.url);
  const sqlite = require('node:sqlite');
  if (typeof sqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync indisponível');
} catch (e) {
  console.error(`
  ✖ O SQLite nativo do Node não está disponível (${e.message}).

  Confirme que está usando o Node 24 LTS (node -v) e que não há um Node
  antigo no PATH. Em alguns ambientes é necessário permitir o módulo:

    node --experimental-sqlite src/server.js

  Recomendado: use o Node 24 LTS, onde node:sqlite é estável.
`);
  process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const teste = path.join(dataDir, `.escrita-${process.pid}`);
  fs.writeFileSync(teste, 'ok');
  fs.rmSync(teste, { force: true });
} catch (e) {
  console.error(`
  ✖ Não foi possível escrever na pasta de dados:

    ${dataDir}

  Detalhe: ${e.message}

  Ajuste a permissão ou use outra pasta:

    DATA_DIR=C:\\caminho\\com\\permissao npm start
`);
  process.exit(1);
}

const porta = process.env.PORT || (process.argv.includes('--demo') ? '3009' : '3000');
const host = process.env.HOST || '0.0.0.0';
linhas.push(`  ✔ Node ${process.versions.node} · SQLite nativo · dados em ${dataDir}`);
linhas.push(`  → http://localhost:${porta}${host === '0.0.0.0' ? ' (aceita acesso na rede local)' : ''}`);
linhas.push('');
console.log(linhas.join('\n'));
