import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR } from './db.js';

export const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const ENTIDADES = {
  proprietarios: 'proprietarios',
  imoveis: 'imoveis',
  inquilinos: 'inquilinos',
  contratos: 'contratos',
};

const TIPOS = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

export const MAX_DOCUMENTO = 10 * 1024 * 1024;

export function nomeArquivoSeguro(nome) {
  const limpo = String(nome || 'documento')
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return limpo || 'documento';
}

export function listarDocumentos({ entidade, entidade_id } = {}) {
  const where = ['d.ativo = 1', 'd.atual = 1'];
  const args = [];
  if (entidade) {
    if (!ENTIDADES[entidade]) throw Object.assign(new Error('Tipo de vínculo inválido.'), { status: 400 });
    where.push('d.entidade = ?');
    args.push(entidade);
  }
  if (entidade_id) {
    const id = Number(entidade_id);
    if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error('Registro inválido.'), { status: 400 });
    where.push('d.entidade_id = ?');
    args.push(id);
  }
  return db.prepare(`SELECT d.id, d.entidade, d.entidade_id, d.nome, d.mime, d.tamanho, d.categoria, d.descricao,
      d.criado_por, d.criado_em, d.grupo, d.versao, d.atual, d.validade,
      (SELECT COUNT(*) FROM documentos v WHERE v.grupo = d.grupo AND v.ativo = 1) AS total_versoes
    FROM documentos d WHERE ${where.join(' AND ')} ORDER BY d.id DESC`).all(...args);
}

export function versoesDocumento(id) {
  const doc = obterDocumento(id);
  if (!doc) return [];
  if (!doc.grupo) return [doc];
  return db.prepare(`SELECT id, nome, mime, tamanho, categoria, descricao, criado_por, criado_em, versao, atual, validade
    FROM documentos WHERE grupo = ? AND ativo = 1 ORDER BY versao DESC`).all(doc.grupo);
}

export function salvarDocumento({ entidade, entidade_id, nome, mime, base64, categoria, descricao, usuario, substituir_id, validade }) {
  const tabela = ENTIDADES[entidade];
  if (!tabela) throw Object.assign(new Error('Tipo de vínculo inválido.'), { status: 400 });
  const id = Number(entidade_id);
  if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error('Registro inválido.'), { status: 400 });
  const existe = db.prepare(`SELECT id FROM ${tabela} WHERE id = ?`).get(id);
  if (!existe) throw Object.assign(new Error('O registro vinculado não existe.'), { status: 404 });

  const nomeOriginal = path.basename(String(nome || '').replace(/\\/g, '/')).slice(0, 180);
  if (!nomeOriginal) throw Object.assign(new Error('Informe o nome do arquivo.'), { status: 400 });
  const ext = path.extname(nomeOriginal).toLowerCase();
  if (!TIPOS[ext]) {
    throw Object.assign(new Error('Tipo de arquivo não permitido. Use PDF, imagem, Word, Excel, CSV ou TXT.'), { status: 400 });
  }
  if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(String(validade))) {
    throw Object.assign(new Error('Data de validade inválida.'), { status: 400 });
  }

  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!limpo) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
  if (limpo.length > Math.ceil(MAX_DOCUMENTO * 1.4)) throw Object.assign(new Error('Arquivo acima de 10 MB.'), { status: 400 });
  const buffer = Buffer.from(limpo, 'base64');
  if (!buffer.length) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
  if (buffer.length > MAX_DOCUMENTO) throw Object.assign(new Error('Arquivo acima de 10 MB.'), { status: 400 });

  let grupo = null;
  let versao = 1;
  if (substituir_id) {
    const antigo = db.prepare('SELECT * FROM documentos WHERE id = ? AND ativo = 1').get(Number(substituir_id));
    if (!antigo) throw Object.assign(new Error('Documento a substituir não encontrado.'), { status: 404 });
    grupo = antigo.grupo || crypto.randomUUID();
    if (!antigo.grupo) db.prepare('UPDATE documentos SET grupo = ? WHERE id = ?').run(grupo, antigo.id);
    db.prepare('UPDATE documentos SET atual = 0 WHERE grupo = ?').run(grupo);
    versao = (db.prepare('SELECT COALESCE(MAX(versao),0) AS v FROM documentos WHERE grupo = ?').get(grupo).v || 0) + 1;
  } else {
    grupo = crypto.randomUUID();
  }

  const arquivo = `${crypto.randomUUID()}${ext}`;
  const destino = path.join(UPLOADS, arquivo);
  fs.writeFileSync(destino, buffer, { mode: 0o600 });

  try {
    const r = db.prepare(`INSERT INTO documentos (entidade, entidade_id, nome, mime, tamanho, caminho, categoria, descricao, criado_por, grupo, versao, atual, validade)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`)
      .run(entidade, id, nomeOriginal, TIPOS[ext] || mime || 'application/octet-stream', buffer.length, arquivo,
        String(categoria || '').slice(0, 60) || null, String(descricao || '').slice(0, 500) || null, usuario?.nome || null,
        grupo, versao, validade || null);
    return db.prepare(`SELECT id, entidade, entidade_id, nome, mime, tamanho, categoria, descricao, criado_por, criado_em,
      grupo, versao, atual, validade FROM documentos WHERE id = ?`).get(Number(r.lastInsertRowid));
  } catch (e) {
    try { fs.unlinkSync(destino); } catch {}
    throw e;
  }
}

export function obterDocumento(id) {
  return db.prepare('SELECT * FROM documentos WHERE id = ? AND ativo = 1').get(Number(id));
}

export function caminhoFisico(doc) {
  const full = path.resolve(UPLOADS, String(doc.caminho || ''));
  const rel = path.relative(UPLOADS, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Caminho inválido.'), { status: 400 });
  }
  return full;
}

export function removerDocumento(id, usuario) {
  const doc = obterDocumento(id);
  if (!doc) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 });
  db.prepare('UPDATE documentos SET ativo = 0 WHERE id = ?').run(doc.id);
  try { fs.unlinkSync(caminhoFisico(doc)); } catch {}
  if (doc.grupo && doc.atual) {
    const proximo = db.prepare('SELECT * FROM documentos WHERE grupo = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1').get(doc.grupo);
    if (proximo) db.prepare('UPDATE documentos SET atual = 1 WHERE id = ?').run(proximo.id);
  }
  return { ok: true, nome: doc.nome, criado_por: usuario?.nome || null };
}
