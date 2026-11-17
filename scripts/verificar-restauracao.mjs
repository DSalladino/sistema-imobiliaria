#!/usr/bin/env node
/**
 * Teste real de restauração de backup.
 *
 * Uso:
 *   node scripts/verificar-restauracao.mjs                 # cria um snapshot da base atual e valida
 *   node scripts/verificar-restauracao.mjs caminho.db      # valida um arquivo de backup específico
 *
 * O script abre o arquivo como banco somente leitura, roda integrity_check e
 * foreign_key_check, confere as contagens e compara com a base viva quando ela
 * está disponível. Sai com código 1 se algo não estiver íntegro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TABELAS = [
  'usuarios', 'proprietarios', 'imoveis', 'inquilinos', 'contratos', 'excecoes',
  'lancamentos', 'cobrancas', 'cobranca_acoes', 'conciliacoes', 'repasses',
  'fechamentos', 'documentos', 'comunicacoes', 'contas', 'comissoes',
  'reajustes', 'rescisoes', 'auditoria',
];

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const vivo = path.join(DATA_DIR, 'imobiliaria.db');
let arquivo = process.argv[2];
let temporario = false;

function contar(caminho) {
  const b = new DatabaseSync(caminho, { readOnly: true });
  const out = {};
  try {
    for (const t of TABELAS) {
      try { out[t] = b.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { out[t] = null; }
    }
  } finally { b.close(); }
  return out;
}

function integridade(caminho) {
  const b = new DatabaseSync(caminho, { readOnly: true });
  try {
    return {
      check: b.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]),
      fk: b.prepare('PRAGMA foreign_key_check').all(),
    };
  } finally { b.close(); }
}

try {
  if (!arquivo) {
    if (!fs.existsSync(vivo)) {
      console.error(`Base viva não encontrada em ${vivo}. Informe um arquivo de backup explicitamente.`);
      process.exit(2);
    }
    arquivo = path.join(DATA_DIR, 'backups', `verificacao-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
    const b = new DatabaseSync(vivo);
    try { b.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`); } finally { b.close(); }
    temporario = true;
  }
  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo não encontrado: ${arquivo}`);
    process.exit(2);
  }

  const integ = integridade(arquivo);
  const okInteg = integ.check.every(x => x === 'ok') && integ.fk.length === 0;
  const contagens = contar(arquivo);
  const divergencias = [];
  if (fs.existsSync(vivo) && path.resolve(vivo) !== path.resolve(arquivo)) {
    const atuais = contar(vivo);
    for (const [t, n] of Object.entries(atuais)) {
      if (contagens[t] !== n) divergencias.push({ tabela: t, atual: n, backup: contagens[t] });
    }
  }

  console.log('— Teste de restauração —');
  console.log(`Arquivo: ${arquivo}`);
  console.log(`integrity_check: ${okInteg ? 'ok' : 'FALHOU'} (${integ.check.join(', ')})`);
  console.log(`foreign_key_check: ${integ.fk.length} problema(s)`);
  console.log(`Tabelas conferidas: ${Object.keys(contagens).length}`);
  if (divergencias.length) {
    console.log('Divergências em relação à base viva:');
    for (const d of divergencias) console.log(`  ${d.tabela}: atual ${d.atual}, backup ${d.backup}`);
  } else {
    console.log('Contagens conferem com a base viva (quando aplicável).');
  }

  if (!okInteg || divergencias.length) {
    console.error('Resultado: FALHOU. Não use este backup sem investigar.');
    process.exitCode = 1;
  } else {
    console.log('Resultado: OK. O backup abre, está íntegro e preserva as contagens.');
  }
} finally {
  if (temporario && arquivo) { try { fs.unlinkSync(arquivo); } catch {} }
}
