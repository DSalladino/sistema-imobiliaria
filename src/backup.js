import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, DATA_DIR } from './db.js';
import { getSettingNum } from './regras.js';

/**
 * Backup, integridade e teste de restauração.
 *
 * Backup sem restauração testada é só uma esperança. Este módulo cria
 * snapshots consistentes com `VACUUM INTO`, roda `PRAGMA integrity_check` e
 * abre uma cópia temporária do banco para comparar contagens — o mesmo caminho
 * que um restore real percorreria.
 */

const TABELAS = [
  'usuarios', 'proprietarios', 'imoveis', 'inquilinos', 'contratos', 'excecoes',
  'lancamentos', 'cobrancas', 'cobranca_acoes', 'conciliacoes', 'repasses',
  'fechamentos', 'documentos', 'comunicacoes', 'contas', 'comissoes',
  'reajustes', 'rescisoes', 'parceiros', 'categorias', 'auditoria', 'auditoria_estado',
];

export function diretorioBackups() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  return dir;
}

export function integridadeBanco(caminho = null) {
  if (caminho) {
    const b = new DatabaseSync(caminho, { readOnly: true });
    try {
      return {
        ok: b.prepare('PRAGMA integrity_check').all().every(r => Object.values(r)[0] === 'ok'),
        resultado: b.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]),
        foreign_keys: b.prepare('PRAGMA foreign_key_check').all(),
      };
    } finally {
      b.close();
    }
  }
  const resultado = db.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]);
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  return { ok: resultado.every(r => r === 'ok') && fk.length === 0, resultado, foreign_keys: fk };
}

export function contarTabelas(caminho = null) {
  const contagens = {};
  if (!caminho) {
    for (const t of TABELAS) {
      try { contagens[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { contagens[t] = null; }
    }
    return contagens;
  }
  const b = new DatabaseSync(caminho, { readOnly: true });
  try {
    for (const t of TABELAS) {
      try { contagens[t] = b.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { contagens[t] = null; }
    }
  } finally {
    b.close();
  }
  return contagens;
}

export function hashArquivo(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

function gravarHash(arquivo) {
  try {
    const hash = hashArquivo(arquivo);
    fs.writeFileSync(`${arquivo}.sha256`, `${hash}  ${path.basename(arquivo)}\n`, { mode: 0o600 });
    return hash;
  } catch { return null; }
}

export function criarSnapshot({ prefixo = 'manual' } = {}) {
  const arquivo = path.join(diretorioBackups(), `${prefixo}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  try { fs.chmodSync(arquivo, 0o600); } catch {}
  gravarHash(arquivo);
  expurgarSnapshots();
  return arquivo;
}

export function listarSnapshots() {
  const dir = diretorioBackups();
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        const hashFile = `${full}.sha256`;
        let hash = null;
        let hash_ok = null;
        if (fs.existsSync(hashFile)) {
          hash = String(fs.readFileSync(hashFile, 'utf8')).split(/\s+/)[0] || null;
          hash_ok = hash ? hash === hashArquivo(full) : null;
        }
        return { nome: f, bytes: st.size, criado_em: st.mtime.toISOString(), hash, hash_ok };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

/**
 * Cria um snapshot automático se o mais recente já passou da janela
 * configurada. Roda ao iniciar o servidor: protege contra o esquecimento do
 * backup manual sem depender de cron externo.
 */
export function backupAutomatico({ horas = getSettingNum('backup_automatico_horas', 24) } = {}) {
  const intervalo = Math.max(Number(horas) || 24, 1);
  const ultimo = listarSnapshots()[0];
  if (ultimo && Date.now() - new Date(ultimo.criado_em).getTime() < intervalo * 3600000) return null;
  const arquivo = criarSnapshot({ prefixo: 'automatico' });
  return { arquivo: path.basename(arquivo), bytes: fs.statSync(arquivo).size };
}

export function expurgarSnapshots() {
  const dias = Math.max(getSettingNum('backup_retencao_dias', 30), 1);
  const limite = Date.now() - dias * 86400000;
  const dir = diretorioBackups();
  let removidos = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.db')) continue;
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < limite) {
        fs.unlinkSync(full);
        try { fs.unlinkSync(`${full}.sha256`); } catch {}
        removidos++;
      }
    } catch {}
  }
  return removidos;
}

/**
 * Executa um ensaio de restauração: gera um snapshot, abre-o como banco,
 * verifica integridade e compara as contagens com a base viva.
 */
export function testarRestauracao() {
  const inicio = Date.now();
  const snapshot = criarSnapshot({ prefixo: 'ensaio' });
  try {
    const integridade = integridadeBanco(snapshot);
    const contagensVivas = contarTabelas();
    const contagensBackup = contarTabelas(snapshot);
    const divergencias = Object.entries(contagensVivas)
      .filter(([t, n]) => contagensBackup[t] !== n)
      .map(([t, n]) => ({ tabela: t, atual: n, backup: contagensBackup[t] }));
    return {
      ok: integridade.ok && divergencias.length === 0,
      snapshot: path.basename(snapshot),
      duracao_ms: Date.now() - inicio,
      integridade,
      contagens: contagensBackup,
      divergencias,
      verificado_em: new Date().toISOString(),
    };
  } finally {
    try { fs.unlinkSync(snapshot); } catch {}
  }
}

/** Backup ZIP descartável para conferência em disco (usado nos testes). */
export function snapshotTemporario() {
  const arquivo = path.join(os.tmpdir(), `imob-snapshot-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  return arquivo;
}
