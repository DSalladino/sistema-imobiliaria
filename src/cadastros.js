import { db } from './db.js';
import { getSetting } from './regras.js';
import { validarDocumentoObrigatorio, somenteDigitos, documentoValido } from './validacao.js';

/**
 * Cadastros de apoio do financeiro: parceiros (corretores, fornecedores e
 * clientes) e categorias. Manter essas listas em tabelas próprias evita que o
 * mesmo corretor apareça com três grafias e permite selecionar em vez de
 * digitar em todo formulário.
 */

export const TIPOS_PARCEIRO = {
  corretor: 'Corretor(a)',
  fornecedor: 'Fornecedor(a)',
  cliente: 'Cliente',
  ambos: 'Fornecedor e cliente',
};

export const CONTEXTOS_CATEGORIA = {
  lancamento: 'Lançamentos',
  conta_pagar: 'Contas a pagar',
  conta_receber: 'Contas a receber',
};

export const CAIXAS = {
  imobiliaria: 'Imobiliária',
  proprietarios: 'Proprietários',
};

function erro(msg, status = 400) {
  return Object.assign(new Error(msg), { status });
}

function texto(v) {
  return v == null ? null : String(v).trim() || null;
}

function sementeInicial(contexto, nome) {
  return db.prepare('SELECT * FROM categorias WHERE contexto = ? AND lower(nome) = lower(?)').get(contexto, nome);
}

function prepararDocumento(valor, atual = null) {
  const bruto = texto(valor);
  if (!bruto) return null;
  const mudou = !atual || somenteDigitos(bruto) !== somenteDigitos(atual.cpf_cnpj);
  if (!mudou) return bruto;
  if (String(getSetting('validar_documento', '1')) === '1') return validarDocumentoObrigatorio(bruto);
  if (documentoValido(bruto) === false) throw erro('O CPF/CNPJ informado não é válido.');
  return bruto;
}

function garantirDocumentoUnico(documento, id = null) {
  const digitos = somenteDigitos(documento);
  if (!digitos) return;
  const outro = db.prepare(`SELECT id, nome FROM parceiros
    WHERE replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','') = ? AND id <> ?`).get(digitos, id ?? -1);
  if (outro) throw erro(`O CPF/CNPJ informado já está cadastrado para ${outro.nome}.`, 409);
}

export function listarParceiros({ tipo, busca } = {}) {
  const where = [];
  const args = [];
  if (tipo) {
    if (!TIPOS_PARCEIRO[tipo]) throw erro('Tipo de parceiro inválido.');
    where.push("(tipo = ? OR tipo = 'ambos')");
    args.push(tipo);
  }
  if (busca) {
    const b = `%${String(busca).trim()}%`;
    where.push('(nome LIKE ? OR cpf_cnpj LIKE ? OR creci LIKE ? OR email LIKE ? OR telefone LIKE ?)');
    args.push(b, b, b, b, b);
  }
  return db.prepare(`SELECT * FROM parceiros
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ativo DESC, nome COLLATE NOCASE`).all(...args);
}

export function obterParceiro(id) {
  return db.prepare('SELECT * FROM parceiros WHERE id = ?').get(Number(id));
}

export function criarParceiro(dados) {
  const tipo = String(dados.tipo || '').trim();
  if (!TIPOS_PARCEIRO[tipo]) throw erro('Escolha corretor, fornecedor, cliente ou ambos.');
  const nome = texto(dados.nome);
  if (!nome) throw erro('Informe o nome do parceiro.');
  const duplicado = db.prepare('SELECT id FROM parceiros WHERE lower(nome) = lower(?) AND ativo = 1').get(nome);
  if (duplicado) throw erro(`Já existe um parceiro ativo com o nome ${nome}.`, 409);
  const documento = prepararDocumento(dados.cpf_cnpj);
  garantirDocumentoUnico(documento);
  const r = db.prepare(`INSERT INTO parceiros (tipo, nome, cpf_cnpj, creci, email, telefone, pix, endereco, observacoes, ativo)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    tipo, nome, documento, texto(dados.creci), texto(dados.email), texto(dados.telefone),
    texto(dados.pix), texto(dados.endereco), texto(dados.observacoes), dados.ativo === 0 || dados.ativo === '0' ? 0 : 1,
  );
  return obterParceiro(Number(r.lastInsertRowid));
}

export function atualizarParceiro(id, dados) {
  const atual = obterParceiro(id);
  if (!atual) throw erro('Parceiro não encontrado.', 404);
  const tipo = dados.tipo === undefined ? atual.tipo : String(dados.tipo || '').trim();
  if (!TIPOS_PARCEIRO[tipo]) throw erro('Escolha corretor, fornecedor, cliente ou ambos.');
  const nome = dados.nome === undefined ? atual.nome : texto(dados.nome);
  if (!nome) throw erro('Informe o nome do parceiro.');
  const duplicado = db.prepare('SELECT id FROM parceiros WHERE lower(nome) = lower(?) AND ativo = 1 AND id <> ?').get(nome, atual.id);
  if (duplicado) throw erro(`Já existe um parceiro ativo com o nome ${nome}.`, 409);
  const documento = dados.cpf_cnpj === undefined ? atual.cpf_cnpj : prepararDocumento(dados.cpf_cnpj, atual);
  garantirDocumentoUnico(documento, atual.id);
  const campo = (c) => (dados[c] === undefined ? atual[c] : texto(dados[c]));
  const ativo = dados.ativo === undefined ? atual.ativo : (dados.ativo === 0 || dados.ativo === '0' ? 0 : 1);
  db.prepare(`UPDATE parceiros SET tipo=?, nome=?, cpf_cnpj=?, creci=?, email=?, telefone=?, pix=?, endereco=?,
      observacoes=?, ativo=? WHERE id=?`).run(
    tipo, nome, documento, campo('creci'), campo('email'), campo('telefone'), campo('pix'),
    campo('endereco'), campo('observacoes'), ativo, atual.id,
  );
  return obterParceiro(atual.id);
}

export function desativarParceiro(id) {
  const atual = obterParceiro(id);
  if (!atual) throw erro('Parceiro não encontrado.', 404);
  db.prepare('UPDATE parceiros SET ativo = 0 WHERE id = ?').run(atual.id);
  return { ok: true };
}

/** Resolve um parceiro pelo id ou pelo nome, restringindo ao tipo esperado. */
export function resolverParceiro({ id, nome, tipo } = {}) {
  if (id != null && id !== '') {
    const p = obterParceiro(id);
    if (!p) throw erro('Parceiro vinculado não encontrado.');
    if (tipo && p.tipo !== tipo && p.tipo !== 'ambos') {
      throw erro(`O parceiro ${p.nome} não está cadastrado como ${TIPOS_PARCEIRO[tipo].toLowerCase()}.`);
    }
    return p;
  }
  const alvo = texto(nome);
  if (!alvo) return null;
  const candidatos = db.prepare(`SELECT * FROM parceiros WHERE ativo = 1 AND lower(nome) = lower(?) ORDER BY id`).all(alvo);
  const compativel = tipo ? candidatos.find(p => p.tipo === tipo || p.tipo === 'ambos') : candidatos[0];
  return compativel || null;
}

export function listarCategorias({ contexto, tipo, incluirInativas = false } = {}) {
  const where = [];
  const args = [];
  if (contexto) {
    if (!CONTEXTOS_CATEGORIA[contexto]) throw erro('Contexto de categoria inválido.');
    where.push('contexto = ?');
    args.push(contexto);
  }
  if (tipo) { where.push('(tipo = ? OR tipo IS NULL)'); args.push(tipo); }
  if (!incluirInativas) where.push('ativo = 1');
  return db.prepare(`SELECT * FROM categorias
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY contexto, ordem, nome COLLATE NOCASE`).all(...args);
}

export function obterCategoria(id) {
  return db.prepare('SELECT * FROM categorias WHERE id = ?').get(Number(id));
}

export function criarCategoria(dados) {
  const contexto = String(dados.contexto || '').trim();
  if (!CONTEXTOS_CATEGORIA[contexto]) throw erro('Escolha o contexto da categoria.');
  const nome = texto(dados.nome);
  if (!nome) throw erro('Informe o nome da categoria.');
  const tipo = texto(dados.tipo);
  if (tipo && !['receita', 'despesa'].includes(tipo)) throw erro('Tipo da categoria inválido.');
  const caixa = texto(dados.caixa);
  if (caixa && !CAIXAS[caixa]) throw erro('Caixa sugerido inválido.');
  const existente = sementeInicial(contexto, nome);
  if (existente) {
    if (existente.ativo) throw erro(`A categoria ${nome} já existe neste contexto.`, 409);
    db.prepare('UPDATE categorias SET ativo = 1, tipo = ?, caixa = ? WHERE id = ?').run(tipo, caixa, existente.id);
    return obterCategoria(existente.id);
  }
  const ordem = Number.isFinite(Number(dados.ordem)) ? Math.trunc(Number(dados.ordem)) : 50;
  const r = db.prepare('INSERT INTO categorias (contexto, nome, tipo, caixa, ordem, ativo) VALUES (?,?,?,?,?,1)')
    .run(contexto, nome, tipo, caixa, ordem);
  return obterCategoria(Number(r.lastInsertRowid));
}

export function atualizarCategoria(id, dados) {
  const atual = obterCategoria(id);
  if (!atual) throw erro('Categoria não encontrada.', 404);
  const contexto = dados.contexto === undefined ? atual.contexto : String(dados.contexto || '').trim();
  if (!CONTEXTOS_CATEGORIA[contexto]) throw erro('Escolha o contexto da categoria.');
  const nome = dados.nome === undefined ? atual.nome : texto(dados.nome);
  if (!nome) throw erro('Informe o nome da categoria.');
  const tipo = dados.tipo === undefined ? atual.tipo : (texto(dados.tipo) || null);
  if (tipo && !['receita', 'despesa'].includes(tipo)) throw erro('Tipo da categoria inválido.');
  const caixa = dados.caixa === undefined ? atual.caixa : (texto(dados.caixa) || null);
  if (caixa && !CAIXAS[caixa]) throw erro('Caixa sugerido inválido.');
  const ordem = dados.ordem === undefined ? atual.ordem : Math.trunc(Number(dados.ordem) || 0);
  const ativo = dados.ativo === undefined ? atual.ativo : (dados.ativo === 0 || dados.ativo === '0' ? 0 : 1);
  const duplicada = db.prepare('SELECT id FROM categorias WHERE contexto = ? AND lower(nome) = lower(?) AND id <> ?')
    .get(contexto, nome, atual.id);
  if (duplicada) throw erro(`A categoria ${nome} já existe neste contexto.`, 409);
  db.prepare('UPDATE categorias SET contexto=?, nome=?, tipo=?, caixa=?, ordem=?, ativo=? WHERE id=?')
    .run(contexto, nome, tipo, caixa, ordem, ativo, atual.id);
  return obterCategoria(atual.id);
}

export function desativarCategoria(id) {
  const atual = obterCategoria(id);
  if (!atual) return { ok: true };
  db.prepare('UPDATE categorias SET ativo = 0 WHERE id = ?').run(atual.id);
  return { ok: true };
}

/**
 * Garante que uma categoria usada em um lançamento/conta exista no dicionário.
 * Não altera o valor digitalizado: apenas registra para que ele apareça nas
 * próximas listas de seleção. Erros aqui nunca devem bloquear o lançamento.
 */
export function garantirCategoria(contexto, nome, tipo = null, caixa = null) {
  const limpo = texto(nome);
  if (!limpo || !CONTEXTOS_CATEGORIA[contexto]) return null;
  try {
    const existente = sementeInicial(contexto, limpo);
    if (existente) {
      if (!existente.ativo) db.prepare('UPDATE categorias SET ativo = 1 WHERE id = ?').run(existente.id);
      return existente.id;
    }
    const r = db.prepare('INSERT INTO categorias (contexto, nome, tipo, caixa, ordem, ativo) VALUES (?,?,?,?,?,1)')
      .run(contexto, limpo, tipo, caixa, 80);
    return Number(r.lastInsertRowid);
  } catch {
    return null;
  }
}
