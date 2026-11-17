import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, seedDemo } from './db.js';
import { gerarRepasses, pagarRepasse, competenciaAtual, getSettingNum } from './regras.js';
import { reencadearAuditoria } from './auditoria.js';
import { addMesesComp } from './analytics.js';
import { gerar as gerarCobrancas, pagar as pagarCobranca, listar as listarCobrancas } from './cobrancas.js';
import { UPLOADS } from './documentos.js';

const TABELAS = [
  'cobranca_acoes', 'conciliacoes', 'cobrancas', 'lancamentos', 'repasses',
  'excecoes', 'contratos', 'imoveis', 'inquilinos', 'proprietarios',
  'fechamentos', 'documentos', 'comunicacoes', 'password_resets',
];

export function statusManutencao() {
  const contagens = {};
  for (const t of [...TABELAS, 'usuarios', 'auditoria']) {
    try { contagens[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { contagens[t] = null; }
  }
  let arquivos = 0;
  if (fs.existsSync(UPLOADS)) {
    arquivos = fs.readdirSync(UPLOADS).filter(f => {
      try { return fs.statSync(path.join(UPLOADS, f)).isFile(); } catch { return false; }
    }).length;
  }
  return { contagens, documentos_arquivos: arquivos };
}

function backupAntes() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  const arquivo = path.join(dir, `pre-operacao-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  try { fs.chmodSync(arquivo, 0o600); } catch {}
  const antigos = fs.readdirSync(dir).filter(f => f.startsWith('pre-operacao-')).sort();
  while (antigos.length > 10) {
    try { fs.unlinkSync(path.join(dir, antigos.shift())); } catch {}
  }
  return arquivo;
}

function apagarArquivos() {
  if (!fs.existsSync(UPLOADS)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(UPLOADS)) {
    const full = path.join(UPLOADS, f);
    try {
      if (fs.statSync(full).isFile()) { fs.unlinkSync(full); n++; }
    } catch {}
  }
  return n;
}

export function limparBase({ incluirAuditoria = true, incluirArquivos = true } = {}) {
  const backup = backupAntes();
  db.exec('BEGIN');
  try {
    for (const t of TABELAS) {
      try { db.exec(`DELETE FROM ${t}`); } catch {}
    }
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${TABELAS.map(t => `'${t}'`).join(',')})`);
    if (incluirAuditoria) db.exec('DELETE FROM auditoria');
    db.prepare(`INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, detalhe)
      VALUES (NULL, 'sistema', 'limpar_base', 'sistema', ?)`)
      .run(JSON.stringify({ backup, incluirArquivos, incluirAuditoria }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const arquivos = incluirArquivos ? apagarArquivos() : 0;
  return { ok: true, backup, arquivos_removidos: arquivos };
}

export function expurgarRetencao({ confirmar = false } = {}) {
  const hoje = new Date();
  const corte = (dias) => {
    const d = new Date(hoje.getTime() - Math.max(Number(dias) || 0, 1) * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 23:59:59`;
  };
  const limiteLogs = corte(getSettingNum('lgpd_retencao_logs_dias', 365));
  const limiteComunicacoes = corte(getSettingNum('lgpd_retencao_comunicacoes_dias', 730));
  const auditoria = db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE criado_em < ?').get(limiteLogs).n;
  const comunicacoes = db.prepare('SELECT COUNT(*) AS n FROM comunicacoes WHERE criado_em < ?').get(limiteComunicacoes).n;
  const resets = db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE usado_em IS NOT NULL OR expira_em < datetime('now','localtime')").get().n;
  if (!confirmar) {
    return { simulado: true, auditoria, comunicacoes, password_resets: resets, limites: { auditoria: limiteLogs, comunicacoes: limiteComunicacoes } };
  }
  // Backup antes de apagar qualquer coisa, mesmo que seja apenas retenção.
  const backup = backupAntes();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM auditoria WHERE criado_em < ?').run(limiteLogs);
    db.prepare('DELETE FROM comunicacoes WHERE criado_em < ?').run(limiteComunicacoes);
    db.prepare("DELETE FROM password_resets WHERE usado_em IS NOT NULL OR expira_em < datetime('now','localtime')").run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const reencadeada = auditoria > 0 ? reencadearAuditoria() : null;
  return { simulado: false, auditoria, comunicacoes, password_resets: resets, backup: path.basename(backup), reencadeada };
}

export function carregarDemo() {
  limparBase({ incluirAuditoria: true, incluirArquivos: true });
  seedDemo();
  const compAtual = competenciaAtual();
  db.prepare("DELETE FROM lancamentos WHERE categoria = 'Aluguel' AND criado_por = 'seed'").run();
  for (let atras = 11; atras >= 0; atras--) {
    const comp = addMesesComp(compAtual, -atras);
    gerarCobrancas(comp, null, { nome: 'seed' });
    const cobs = listarCobrancas({ competencia: comp });
    for (const c of cobs) {
      if (atras === 0 && !['CT-002', 'CT-003'].includes(c.contrato_codigo)) continue;
      try {
        pagarCobranca(c.id, { valor: c.valor_original_centavos, data: c.vencimento, forma: 'pix' }, { nome: 'seed' });
      } catch {}
    }
  }
  for (let atras = 11; atras >= 1; atras--) {
    const comp = addMesesComp(compAtual, -atras);
    const repasses = gerarRepasses(comp, 'seed');
    for (const r of repasses) {
      if (r.status === 'calculado') {
        try { pagarRepasse(r.id, 'seed'); } catch {}
      }
    }
  }
  const repassesAtuais = gerarRepasses(compAtual, 'seed');
  for (const r of repassesAtuais) {
    if (r.status === 'calculado' && r.valor_centavos > 0) {
      try { pagarRepasse(r.id, 'seed'); } catch {}
    }
  }
  db.prepare(`INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, detalhe)
    VALUES (NULL, 'sistema', 'carregar_demo', 'sistema', ?)`).run(JSON.stringify({ competencia: compAtual }));
  return { ok: true, ...statusManutencao() };
}
