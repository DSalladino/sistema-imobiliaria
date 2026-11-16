import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import { db, DATA_DIR } from './db.js';
import { analytics } from './analytics.js';
import { RELATORIOS, construirRelatorio, gerarCSV, gerarXLSX, gerarPDF } from './reports.js';
import { MODELOS, analisarImportacao, importar, gerarModelo } from './importacao.js';
import { enviarEmail, emailConfigurado } from './email.js';
import QRCode from 'qrcode';
import {
  gerarSegredoTotp, codigoTotp, verificarTotp, otpauthUrl, cifrar, decifrar, gerarRecovery, usarRecovery, validarSenha,
} from './seguranca.js';
import {
  listar as listarCobrancas, obter as obterCobranca, resumo as resumoCobrancas, previewGeracao,
  gerar as gerarCobrancas, pagar as pagarCobranca, estornarBaixa, cancelar as cancelarCobranca,
  registrarAcao, definirCobrancaStatus,
} from './cobrancas.js';
import { previewConciliacao, listarPendentes, resumoConciliacao, confirmarConciliacao } from './conciliacao.js';
import { criarSolicitacao, validarToken, usarToken, listarSolicitacoes } from './senha-recuperacao.js';
import { statusManutencao, limparBase, carregarDemo } from './manutencao.js';
import {
  UPLOADS, listarDocumentos, salvarDocumento, obterDocumento, caminhoFisico, removerDocumento, nomeArquivoSeguro, versoesDocumento,
} from './documentos.js';
import { hashSenha, verificaSenha, novoToken } from './auth.js';
import { auditar, exigir, pode } from './permissoes.js';
import {
  hojeISO, competenciaAtual, getSetting, setSetting, calcularRepasse, gerarRepasses,
  pagarRepasse, alertas, resumoDashboard, saldos, mesFechado, exigirMesAberto, brl,
} from './regras.js';

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

const erro = (res, status, msg) => json(res, status, { erro: msg });

function mascararCpf(valor) {
  if (!valor) return valor;
  return String(valor).replace(/\d(?=\d{2})/g, '*');
}

function aplicarMascara(entidade, dados, user) {
  if (!['proprietarios', 'inquilinos'].includes(entidade)) return dados;
  if (user?.papel === 'admin') return dados;
  if (String(getSetting('mascarar_cpf_consulta', '1')) === '0') return dados;
  return dados.map(d => ({ ...d, cpf_cnpj: mascararCpf(d.cpf_cnpj) }));
}

function num(v, padrao = null) {
  if (v === '' || v == null) return padrao;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}
function int(v, padrao = null) {
  const n = num(v, null);
  return n == null ? padrao : Math.round(n);
}
function texto(v) {
  return v == null ? null : String(v).trim();
}
function bool(v, padrao = 1) {
  if (v == null || v === '') return padrao;
  return (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
}

function exigirCampos(obj, campos) {
  for (const c of campos) {
    if (obj[c] == null || obj[c] === '') {
      throw Object.assign(new Error(`Campo obrigatório: ${c}`), { status: 400 });
    }
  }
}

function registrar(user, acao, entidade, id, detalhe, ip) {
  auditar(user, acao, entidade, id, detalhe, ip);
}

function registrarComunicacao({ canal, entidade, entidade_id, destinatario_nome, destinatario, assunto, mensagem, status, erro, usuario }) {
  db.prepare(`INSERT INTO comunicacoes (canal, entidade, entidade_id, destinatario_nome, destinatario, assunto, mensagem, status, erro, usuario)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(canal, entidade || null, entidade_id || null, destinatario_nome || null,
    destinatario || null, assunto || null, String(mensagem || '').slice(0, 6000), status, erro || null, usuario || null);
}

/* ---------------- AUTH ---------------- */

const SENHA_DUMMY = hashSenha('dummy-' + Math.random());
const tentativas = new Map();
const desafios2fa = new Map();
const JANELA_LOGIN_MS = 5 * 60 * 1000;
const MAX_LOGIN = 10;

function limitar(chave, max, janelaMs) {
  const agora = Date.now();
  const atual = tentativas.get(chave);
  if (!atual || agora - atual.inicio > janelaMs) {
    tentativas.set(chave, { n: 0, inicio: agora });
    return 0;
  }
  if (atual.n >= max) return Math.ceil((atual.inicio + janelaMs - agora) / 1000);
  return 0;
}

function contarTentativa(chave) {
  const atual = tentativas.get(chave);
  if (!atual) tentativas.set(chave, { n: 1, inicio: Date.now() });
  else atual.n++;
  if (tentativas.size > 2000) {
    const limite = Date.now() - 60 * 60 * 1000;
    for (const [k, v] of tentativas) if (v.inicio < limite) tentativas.delete(k);
  }
}

function cookieSeguro(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return !!(req.socket?.encrypted || proto === 'https');
}

function criarSessao(req, res, u, ip) {
  const token = novoToken();
  const expira = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, u.id, expira);
  auditar({ id: u.id, nome: u.nome }, 'login', 'usuarios', u.id, null, ip);
  const secure = cookieSeguro(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}${secure}`);
  return {
    usuario: {
      id: u.id, nome: u.nome, email: u.email, papel: u.papel,
      deve_trocar_senha: !!u.deve_trocar_senha, totp_ativo: !!u.totp_ativo,
    },
  };
}

function login(req, res, body, ip) {
  const email = texto(body.email)?.toLowerCase();
  const senha = String(body.senha || '');
  if (!email || !senha) return erro(res, 400, 'Informe e-mail e senha.');

  const chave = 'login:' + ip;
  const espera = limitar(chave, MAX_LOGIN, JANELA_LOGIN_MS);
  if (espera > 0) {
    auditar(null, 'login_bloqueado', 'usuarios', null, { email }, ip);
    res.setHeader('Retry-After', String(espera));
    return erro(res, 429, 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.');
  }

  const u = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(email);
  // Verifica sempre um hash, mesmo quando o e-mail não existe, para evitar timing attack.
  const senhaOk = u ? verificaSenha(senha, u.senha_hash) : (verificaSenha(senha, SENHA_DUMMY), false);
  if (!u || !u.ativo || !senhaOk) {
    contarTentativa(chave);
    auditar(null, 'login_falha', 'usuarios', null, { email }, ip);
    return erro(res, 401, 'E-mail ou senha inválidos.');
  }
  tentativas.delete(chave);
  if (u.totp_ativo) {
    const desafio = novoToken();
    desafios2fa.set(desafio, { userId: u.id, expira: Date.now() + 5 * 60 * 1000, tentativas: 0 });
    return json(res, 200, { requer_2fa: true, desafio });
  }
  return json(res, 200, criarSessao(req, res, u, ip));
}

function login2fa(req, res, body, ip) {
  const desafio = texto(body.desafio);
  const chave = '2fa:' + ip;
  const espera = limitar(chave, 10, JANELA_LOGIN_MS);
  if (espera > 0) {
    res.setHeader('Retry-After', String(espera));
    return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  }
  const d = desafio ? desafios2fa.get(desafio) : null;
  if (!d || d.expira < Date.now()) {
    if (desafio) desafios2fa.delete(desafio);
    return erro(res, 401, 'Código expirado. Entre novamente.');
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(d.userId);
  if (!u || !u.ativo) return erro(res, 401, 'Usuário indisponível.');
  const segredo = decifrar(u.totp_secret);
  let ok = !!(segredo && verificarTotp(segredo, body.codigo));
  let novoRecovery = null;
  if (!ok && u.totp_recovery) {
    const rec = usarRecovery(u.totp_recovery, body.codigo);
    if (rec.ok) { ok = true; novoRecovery = rec.novo; }
  }
  if (!ok) {
    contarTentativa(chave);
    d.tentativas++;
    if (d.tentativas >= 5) desafios2fa.delete(desafio);
    auditar(null, 'login_2fa_falha', 'usuarios', u.id, { desafio }, ip);
    return erro(res, 401, 'Código inválido.');
  }
  desafios2fa.delete(desafio);
  if (novoRecovery) db.prepare('UPDATE usuarios SET totp_recovery = ? WHERE id = ?').run(novoRecovery, u.id);
  return json(res, 200, criarSessao(req, res, u, ip));
}

function logout(req, res, user, ip) {
  const token = req._sid;
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  if (user) auditar(user, 'logout', 'usuarios', user.id, null, ip);
  const secure = cookieSeguro(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  return json(res, 200, { ok: true });
}

/* ---------------- CRUD GENÉRICO ---------------- */

const ENTIDADES = {
  proprietarios: {
    tabela: 'proprietarios',
    campos: ['nome', 'cpf_cnpj', 'email', 'telefone', 'endereco', 'banco', 'agencia', 'conta', 'tipo_conta', 'pix', 'documento_url', 'taxa_admin_pct', 'observacoes', 'ativo'],
    obrigatorios: ['nome'],
    numericos: ['taxa_admin_pct'],
    booleanos: ['ativo'],
    ordem: 'nome',
  },
  imoveis: {
    tabela: 'imoveis',
    campos: ['proprietario_id', 'apelido', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'tipo', 'situacao', 'taxa_admin_pct', 'observacoes', 'ativo'],
    obrigatorios: ['proprietario_id', 'endereco'],
    numericos: ['proprietario_id', 'taxa_admin_pct'],
    booleanos: ['ativo'],
    ordem: 'endereco',
  },
  inquilinos: {
    tabela: 'inquilinos',
    campos: ['nome', 'cpf_cnpj', 'email', 'telefone', 'observacoes', 'ativo'],
    obrigatorios: ['nome'],
    booleanos: ['ativo'],
    ordem: 'nome',
  },
  contratos: {
    tabela: 'contratos',
    campos: ['codigo', 'imovel_id', 'inquilino_id', 'inicio', 'fim', 'aluguel_centavos', 'dia_vencimento', 'indice_reajuste', 'ultimo_reajuste', 'garantia_tipo', 'garantia_valor_centavos', 'garantia_fim', 'taxa_admin_pct', 'justificativa_taxa', 'documento_url', 'status', 'observacoes'],
    obrigatorios: ['imovel_id', 'inquilino_id', 'inicio'],
    numericos: ['imovel_id', 'inquilino_id', 'aluguel_centavos', 'dia_vencimento', 'garantia_valor_centavos', 'taxa_admin_pct'],
    ordem: 'id DESC',
  },
  excecoes: {
    tabela: 'excecoes',
    campos: ['contrato_id', 'competencia', 'tipo', 'valor_centavos', 'motivo'],
    obrigatorios: ['contrato_id', 'competencia', 'motivo'],
    numericos: ['contrato_id', 'valor_centavos'],
    ordem: 'id DESC',
  },
};

function normalizar(ent, body) {
  const out = {};
  for (const c of ent.campos) {
    if (!(c in body)) continue;
    let v = body[c];
    if (ent.numericos?.includes(c)) v = num(v, null);
    else if (ent.booleanos?.includes(c)) v = bool(v);
    else v = texto(v);
    out[c] = v;
  }
  return out;
}

function listar(entidade) {
  const ent = ENTIDADES[entidade];
  if (entidade === 'imoveis') {
    return db.prepare(`SELECT i.*, p.nome AS proprietario_nome FROM imoveis i
      LEFT JOIN proprietarios p ON p.id = i.proprietario_id ORDER BY i.ativo DESC, i.endereco`).all();
  }
  if (entidade === 'contratos') {
    return db.prepare(`SELECT c.*, i.endereco, i.numero, i.complemento, i.apelido, i.proprietario_id,
        p.nome AS proprietario_nome, p.telefone AS proprietario_telefone, p.email AS proprietario_email,
        q.nome AS inquilino_nome, q.telefone AS inquilino_telefone, q.email AS inquilino_email
      FROM contratos c
      JOIN imoveis i ON i.id = c.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      JOIN inquilinos q ON q.id = c.inquilino_id
      ORDER BY c.status='ativo' DESC, c.id DESC`).all();
  }
  if (entidade === 'excecoes') {
    return db.prepare(`SELECT e.*, c.codigo, i.endereco, i.numero, p.nome AS proprietario_nome
      FROM excecoes e
      JOIN contratos c ON c.id = e.contrato_id
      JOIN imoveis i ON i.id = c.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      ORDER BY e.competencia DESC, e.id DESC`).all();
  }
  return db.prepare(`SELECT * FROM ${ent.tabela} ORDER BY ativo DESC, ${ent.ordem}`).all();
}

function criar(entidade, body, user, ip) {
  const ent = ENTIDADES[entidade];
  const dados = normalizar(ent, body);
  exigirCampos(dados, ent.obrigatorios);
  const cols = Object.keys(dados);
  const sql = `INSERT INTO ${ent.tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const r = db.prepare(sql).run(...cols.map(c => dados[c]));
  const id = Number(r.lastInsertRowid);
  registrar(user, 'criar', entidade, id, dados, ip);
  return db.prepare(`SELECT * FROM ${ent.tabela} WHERE id = ?`).get(id);
}

function atualizar(entidade, id, body, user, ip) {
  const ent = ENTIDADES[entidade];
  const dados = normalizar(ent, body);
  const cols = Object.keys(dados);
  if (!cols.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 400 });
  const antes = db.prepare(`SELECT * FROM ${ent.tabela} WHERE id = ?`).get(id);
  if (!antes) throw Object.assign(new Error('Registro não encontrado.'), { status: 404 });
  db.prepare(`UPDATE ${ent.tabela} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map(c => dados[c]), id);
  registrar(user, 'alterar', entidade, id, { antes, depois: dados }, ip);
  return db.prepare(`SELECT * FROM ${ent.tabela} WHERE id = ?`).get(id);
}

function desativar(entidade, id, user, ip) {
  const ent = ENTIDADES[entidade];
  const antes = db.prepare(`SELECT * FROM ${ent.tabela} WHERE id = ?`).get(id);
  if (!antes) throw Object.assign(new Error('Registro não encontrado.'), { status: 404 });
  if (entidade === 'contratos') {
    db.prepare("UPDATE contratos SET status = 'encerrado' WHERE id = ?").run(id);
  } else if (entidade === 'excecoes') {
    db.prepare('DELETE FROM excecoes WHERE id = ?').run(id);
  } else {
    db.prepare(`UPDATE ${ent.tabela} SET ativo = 0 WHERE id = ?`).run(id);
  }
  registrar(user, 'desativar', entidade, id, antes, ip);
  return { ok: true };
}

/* ---------------- LANÇAMENTOS ---------------- */

function listarLancamentos(url) {
  const comp = url.searchParams.get('competencia');
  const caixa = url.searchParams.get('caixa');
  const tipo = url.searchParams.get('tipo');
  const where = [];
  const args = [];
  if (comp) { where.push('l.competencia = ?'); args.push(comp); }
  if (caixa) { where.push('l.caixa = ?'); args.push(caixa); }
  if (tipo) { where.push('l.tipo = ?'); args.push(tipo); }
  const sql = `SELECT l.*, p.nome AS proprietario_nome, i.endereco AS imovel_endereco, c.codigo AS contrato_codigo
    FROM lancamentos l
    LEFT JOIN proprietarios p ON p.id = l.proprietario_id
    LEFT JOIN imoveis i ON i.id = l.imovel_id
    LEFT JOIN contratos c ON c.id = l.contrato_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.data DESC, l.id DESC LIMIT 500`;
  return db.prepare(sql).all(...args);
}

function criarLancamento(body, user, ip) {
  const dados = {
    data: texto(body.data) || hojeISO(),
    competencia: texto(body.competencia) || (texto(body.data) || hojeISO()).slice(0, 7),
    tipo: texto(body.tipo),
    categoria: texto(body.categoria),
    descricao: texto(body.descricao),
    valor_centavos: int(body.valor_centavos, 0),
    caixa: texto(body.caixa) || 'imobiliaria',
    proprietario_id: int(body.proprietario_id, null),
    imovel_id: int(body.imovel_id, null),
    contrato_id: int(body.contrato_id, null),
  };
  exigirCampos(dados, ['tipo', 'categoria', 'valor_centavos']);
  if (!['receita', 'despesa'].includes(dados.tipo)) throw Object.assign(new Error('Tipo inválido.'), { status: 400 });
  if (!['imobiliaria', 'proprietarios'].includes(dados.caixa)) throw Object.assign(new Error('Caixa inválido.'), { status: 400 });
  if (dados.valor_centavos <= 0) throw Object.assign(new Error('Valor deve ser maior que zero.'), { status: 400 });
  exigirMesAberto(dados.competencia);
  const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
      proprietario_id, imovel_id, contrato_id, criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(dados.data, dados.competencia, dados.tipo, dados.categoria, dados.descricao, dados.valor_centavos,
      dados.caixa, dados.proprietario_id, dados.imovel_id, dados.contrato_id, user.nome);
  const id = Number(r.lastInsertRowid);
  registrar(user, 'criar', 'lancamentos', id, dados, ip);
  return db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
}

function estornarLancamento(id, motivo, user, ip) {
  const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
  if (!l) throw Object.assign(new Error('Lançamento não encontrado.'), { status: 404 });
  if (l.status === 'estornado') throw Object.assign(new Error('Lançamento já estornado.'), { status: 409 });
  if (l.repasse_id) throw Object.assign(new Error('Lançamento gerado por repasse não pode ser estornado. Estorne o repasse.'), { status: 409 });
  exigirMesAberto(l.competencia);
  if (!motivo) throw Object.assign(new Error('Informe o motivo do estorno.'), { status: 400 });
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE lancamentos SET status = 'estornado', motivo_estorno = ? WHERE id = ?").run(motivo, id);
    const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
        proprietario_id, imovel_id, contrato_id, status, estorno_de_id, motivo_estorno, criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,'ativo',?,?,?)`)
      .run(hojeISO(), l.competencia, l.tipo === 'receita' ? 'despesa' : 'receita', l.categoria,
        `Estorno: ${l.descricao || l.categoria}`, l.valor_centavos, l.caixa, l.proprietario_id, l.imovel_id,
        l.contrato_id, id, motivo, user.nome);
    db.exec('COMMIT');
    registrar(user, 'estornar', 'lancamentos', id, { motivo, estorno_id: Number(r.lastInsertRowid) }, ip);
    return { ok: true, estorno_id: Number(r.lastInsertRowid) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* ---------------- REPASSES ---------------- */

function listarRepasses(url) {
  const comp = url.searchParams.get('competencia') || competenciaAtual();
  return db.prepare(`SELECT r.*, p.nome AS proprietario_nome
    FROM repasses r JOIN proprietarios p ON p.id = r.proprietario_id
    WHERE r.competencia = ? ORDER BY p.nome`).all(comp);
}

function detalheRepasse(id) {
  const r = db.prepare(`SELECT r.*, p.nome AS proprietario_nome, p.banco, p.agencia, p.conta, p.pix
    FROM repasses r JOIN proprietarios p ON p.id = r.proprietario_id WHERE r.id = ?`).get(id);
  if (!r) throw Object.assign(new Error('Repasse não encontrado.'), { status: 404 });
  r.detalhe = r.detalhe_json ? JSON.parse(r.detalhe_json) : null;
  return r;
}

/* ---------------- FECHAMENTO ---------------- */

function listarFechamentos() {
  return db.prepare('SELECT * FROM fechamentos ORDER BY competencia DESC').all();
}

function fecharMes(competencia, user, ip) {
  if (!/^\d{4}-\d{2}$/.test(competencia || '')) throw Object.assign(new Error('Competência inválida.'), { status: 400 });
  if (mesFechado(competencia)) throw Object.assign(new Error('Mês já fechado.'), { status: 409 });
  const pendentes = db.prepare("SELECT COUNT(*) AS n FROM repasses WHERE competencia = ? AND status = 'calculado'").get(competencia).n;
  if (pendentes > 0) throw Object.assign(new Error(`Existem ${pendentes} repasse(s) calculado(s) e não pagos. Pague ou remova antes de fechar.`), { status: 409 });
  db.prepare(`INSERT INTO fechamentos (competencia, fechado_por) VALUES (?,?)
    ON CONFLICT(competencia) DO UPDATE SET fechado_por=excluded.fechado_por, fechado_em=datetime('now','localtime'), reaberto_por=NULL, reaberto_em=NULL, motivo_reabertura=NULL`)
    .run(competencia, user.nome);
  registrar(user, 'fechar', 'fechamentos', competencia, null, ip);
  return { ok: true };
}

function reabrirMes(competencia, motivo, user, ip) {
  exigir(user, 'admin');
  if (!motivo) throw Object.assign(new Error('Informe o motivo da reabertura.'), { status: 400 });
  const f = db.prepare('SELECT * FROM fechamentos WHERE competencia = ?').get(competencia);
  if (!f || f.reaberto_em) throw Object.assign(new Error('Mês não está fechado.'), { status: 409 });
  db.prepare(`UPDATE fechamentos SET reaberto_por = ?, reaberto_em = datetime('now','localtime'), motivo_reabertura = ? WHERE competencia = ?`)
    .run(user.nome, motivo, competencia);
  registrar(user, 'reabrir', 'fechamentos', competencia, { motivo }, ip);
  return { ok: true };
}

/* ---------------- USUÁRIOS ---------------- */

function listarUsuarios() {
  return db.prepare('SELECT id, nome, email, papel, ativo, totp_ativo, criado_em FROM usuarios ORDER BY nome').all();
}

function criarUsuario(body, user, ip) {
  exigir(user, 'admin');
  const nome = texto(body.nome);
  const email = texto(body.email)?.toLowerCase();
  const senha = String(body.senha || '');
  const papel = texto(body.papel) || 'operador';
  exigirCampos({ nome, email, senha }, ['nome', 'email', 'senha']);
  validarSenha(senha, email);
  if (!['admin', 'operador', 'consulta'].includes(papel)) throw Object.assign(new Error('Papel inválido.'), { status: 400 });
  if (db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(email)) {
    throw Object.assign(new Error('E-mail já cadastrado.'), { status: 409 });
  }
  const r = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha) VALUES (?,?,?,?,1)')
    .run(nome, email, hashSenha(senha), papel);
  registrar(user, 'criar', 'usuarios', Number(r.lastInsertRowid), { nome, email, papel }, ip);
  return { ok: true, id: Number(r.lastInsertRowid) };
}

function atualizarUsuario(id, body, user, ip) {
  exigir(user, 'admin');
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
  const nome = body.nome != null ? texto(body.nome) : u.nome;
  const email = body.email != null ? texto(body.email)?.toLowerCase() : u.email;
  const papel = body.papel != null ? texto(body.papel) : u.papel;
  const ativo = body.ativo != null ? bool(body.ativo) : u.ativo;
  if (!['admin', 'operador', 'consulta'].includes(papel)) throw Object.assign(new Error('Papel inválido.'), { status: 400 });
  if (id === user.id && ativo === 0) throw Object.assign(new Error('Você não pode desativar seu próprio usuário.'), { status: 400 });
  db.prepare('UPDATE usuarios SET nome=?, email=?, papel=?, ativo=? WHERE id=?').run(nome, email, papel, ativo, id);
  if (body.senha) {
    validarSenha(body.senha, email);
    db.prepare('UPDATE usuarios SET senha_hash=? WHERE id=?').run(hashSenha(body.senha), id);
    if (id !== user.id) db.prepare('UPDATE usuarios SET deve_trocar_senha=1 WHERE id=?').run(id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  }
  registrar(user, 'alterar', 'usuarios', id, { nome, email, papel, ativo, senha_alterada: !!body.senha }, ip);
  return { ok: true };
}

/* ---------------- EXPORTAÇÃO CSV ---------------- */

function csv(res, nome, colunas, linhas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const conteudo = '\uFEFF' + [colunas.map(c => c.titulo).join(';'), ...linhas.map(l => colunas.map(c => esc(c.valor(l))).join(';'))].join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nome}"`,
  });
  res.end(conteudo);
}

function exportar(tipo, url, res) {
  const comp = url.searchParams.get('competencia') || competenciaAtual();
  if (tipo === 'lancamentos') {
    const linhas = db.prepare(`SELECT l.*, p.nome AS proprietario_nome FROM lancamentos l
      LEFT JOIN proprietarios p ON p.id=l.proprietario_id WHERE l.competencia=? ORDER BY l.data`).all(comp);
    return csv(res, `lancamentos-${comp}.csv`, [
      { titulo: 'Data', valor: l => l.data },
      { titulo: 'Competência', valor: l => l.competencia },
      { titulo: 'Tipo', valor: l => l.tipo },
      { titulo: 'Categoria', valor: l => l.categoria },
      { titulo: 'Descrição', valor: l => l.descricao },
      { titulo: 'Valor (R$)', valor: l => (l.valor_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Caixa', valor: l => l.caixa },
      { titulo: 'Proprietário', valor: l => l.proprietario_nome },
      { titulo: 'Status', valor: l => l.status },
    ], linhas);
  }
  if (tipo === 'repasses') {
    const linhas = db.prepare(`SELECT r.*, p.nome AS proprietario_nome FROM repasses r
      JOIN proprietarios p ON p.id=r.proprietario_id WHERE r.competencia=? ORDER BY p.nome`).all(comp);
    return csv(res, `repasses-${comp}.csv`, [
      { titulo: 'Proprietário', valor: r => r.proprietario_nome },
      { titulo: 'Competência', valor: r => r.competencia },
      { titulo: 'Aluguéis recebidos', valor: r => (r.aluguel_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Taxa (%)', valor: r => String(r.taxa_pct).replace('.', ',') },
      { titulo: 'Taxa (R$)', valor: r => (r.taxa_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Despesas (R$)', valor: r => (r.despesas_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Descontos (R$)', valor: r => (r.descontos_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Acréscimos (R$)', valor: r => (r.acrescimos_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Valor repassado (R$)', valor: r => (r.valor_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Status', valor: r => r.status },
    ], linhas);
  }
  if (tipo === 'contratos') {
    const linhas = db.prepare(`SELECT c.*, i.endereco, i.numero, p.nome AS proprietario_nome, q.nome AS inquilino_nome
      FROM contratos c JOIN imoveis i ON i.id=c.imovel_id JOIN proprietarios p ON p.id=i.proprietario_id
      JOIN inquilinos q ON q.id=c.inquilino_id ORDER BY c.id`).all();
    return csv(res, 'contratos.csv', [
      { titulo: 'Código', valor: c => c.codigo },
      { titulo: 'Imóvel', valor: c => `${c.endereco}, ${c.numero || ''}` },
      { titulo: 'Proprietário', valor: c => c.proprietario_nome },
      { titulo: 'Inquilino', valor: c => c.inquilino_nome },
      { titulo: 'Início', valor: c => c.inicio },
      { titulo: 'Fim', valor: c => c.fim },
      { titulo: 'Aluguel (R$)', valor: c => (c.aluguel_centavos / 100).toFixed(2).replace('.', ',') },
      { titulo: 'Vencimento', valor: c => c.dia_vencimento },
      { titulo: 'Índice', valor: c => c.indice_reajuste },
      { titulo: 'Status', valor: c => c.status },
    ], linhas);
  }
  throw Object.assign(new Error('Exportação desconhecida.'), { status: 404 });
}

/* ---------------- ROTEADOR ---------------- */

export async function handleApi(req, res, url, user, ip, body) {
  const p = url.pathname.replace(/^\/api/, '');
  const m = req.method;
  const seg = p.split('/').filter(Boolean);

  try {
    const esperaApi = limitar('api:' + ip, 600, 60 * 1000);
    if (esperaApi > 0) {
      res.setHeader('Retry-After', String(esperaApi));
      return erro(res, 429, 'Muitas requisições. Aguarde um instante.');
    }
    contarTentativa('api:' + ip);

    if (p === '/login' && m === 'POST') return login(req, res, body, ip);
    if (p === '/login/2fa' && m === 'POST') return login2fa(req, res, body, ip);

    if (p === '/esqueci-senha' && m === 'POST') {
      const chave = 'reset:' + ip;
      const espera = limitar(chave, 5, 15 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitas solicitações. Aguarde alguns minutos.'); }
      contarTentativa(chave);
      const email = texto(body.email)?.toLowerCase();
      if (!email) return erro(res, 400, 'Informe o e-mail.');
      const r = criarSolicitacao(email, ip);
      if (r.usuario) {
        const padrao = String(r.usuario.email || '').endsWith('.local') ? '' : r.usuario.email;
        const destino = getSetting('email_recuperacao', '') || padrao;
        if (destino && emailConfigurado()) {
          const proto = (req.socket?.encrypted || String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') ? 'https' : 'http';
          const host = req.headers?.host || 'localhost';
          const base = getSetting('url_publica', '').replace(/\/+$/, '') || `${proto}://${host}`;
          const link = `${base}/#/redefinir?token=${r.token}`;
          try {
            await enviarEmail({
              para: destino,
              assunto: `Redefinição de senha — ${getSetting('imob_nome', 'Imobiliária')}`,
              mensagem: `Olá! Foi solicitada a redefinição de senha da conta ${r.usuario.email}.\n\nAcesse o link abaixo em até ${r.minutos} minutos:\n${link}\n\nSe não foi você, ignore esta mensagem.`,
            });
          } catch (e) {
            console.error('[recuperacao] falha ao enviar e-mail:', e.message);
          }
        } else {
          console.warn('[recuperacao] SMTP não configurado; solicitação registrada para', email);
        }
        auditar(null, 'solicitar_reset', 'usuarios', r.usuario.id, { email, destino }, ip);
      }
      return json(res, 200, { ok: true, mensagem: 'Se o e-mail estiver cadastrado, enviaremos as instruções.' });
    }

    if (p === '/reset/validar' && m === 'GET') {
      const row = validarToken(url.searchParams.get('token'));
      return json(res, 200, row ? { valido: true, email: row.email, nome: row.nome } : { valido: false });
    }

    if (p === '/resetar-senha' && m === 'POST') {
      const chave = 'reset-usar:' + ip;
      const espera = limitar(chave, 10, 15 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.'); }
      contarTentativa(chave);
      const r = usarToken(texto(body.token), String(body.senha || ''));
      auditar(null, 'resetar_senha', 'usuarios', r.usuario_id, null, ip);
      return json(res, 200, { ok: true, email: r.email });
    }

    if (p === '/primeiro-acesso' && m === 'GET') {
      const admin = db.prepare("SELECT email FROM usuarios WHERE papel = 'admin' AND ativo = 1 ORDER BY id LIMIT 1").get();
      return json(res, 200, {
        mostrar: String(getSetting('primeiro_acesso', '1')) === '1',
        email: admin?.email || 'admin@imobiliaria.local',
      });
    }

    if (p === '/cadastro/status' && m === 'GET') {
      return json(res, 200, { permitido: String(getSetting('permitir_cadastro', '1')) === '1' });
    }

    if (p === '/cadastro' && m === 'POST') {
      const chave = 'cadastro:' + ip;
      const espera = limitar(chave, 5, 60 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitas solicitações. Aguarde.'); }
      contarTentativa(chave);
      if (String(getSetting('permitir_cadastro', '1')) !== '1') return erro(res, 403, 'O cadastro está desativado. Fale com o administrador.');
      const nome = texto(body.nome);
      const email = texto(body.email)?.toLowerCase();
      const senha = String(body.senha || '');
      exigirCampos({ nome, email, senha }, ['nome', 'email', 'senha']);
      validarSenha(senha, email);
      if (db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(email)) {
        return erro(res, 409, 'Este e-mail já possui acesso ou solicitação.');
      }
      db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, ativo) VALUES (?,?,?,?,0)')
        .run(nome, email, hashSenha(senha), 'operador');
      auditar(null, 'solicitar_cadastro', 'usuarios', null, { nome, email }, ip);
      const destino = getSetting('email_recuperacao', '');
      if (destino && emailConfigurado()) {
        try {
          await enviarEmail({ para: destino, assunto: 'Nova solicitação de acesso', mensagem: `${nome} (${email}) solicitou acesso ao sistema. Aprove em Usuários.` });
        } catch (e) { console.error('[cadastro] falha ao notificar:', e.message); }
      }
      return json(res, 201, { ok: true, mensagem: 'Solicitação enviada. Aguarde a aprovação do administrador.' });
    }
    if (p === '/logout' && m === 'POST') return logout(req, res, user, ip);
    if (p === '/me' && m === 'GET') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      return json(res, 200, { usuario: user });
    }
    if (p === '/me/senha' && m === 'POST') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      const atual = String(body.senha_atual || '');
      const nova = String(body.senha_nova || '');
      const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
      if (!u || !verificaSenha(atual, u.senha_hash)) return erro(res, 400, 'Senha atual incorreta.');
      validarSenha(nova, u.email);
      db.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?').run(hashSenha(nova), user.id);
      setSetting('primeiro_acesso', '0');
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token != ?').run(user.id, req._sid || '');
      registrar(user, 'alterar_senha', 'usuarios', user.id, null, ip);
      return json(res, 200, { ok: true });
    }

    if (p === '/2fa/status' && m === 'GET') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      const u = db.prepare('SELECT totp_ativo FROM usuarios WHERE id = ?').get(user.id);
      return json(res, 200, { ativo: !!u?.totp_ativo });
    }
    if (p === '/2fa/iniciar' && m === 'POST') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
      if (!verificaSenha(String(body.senha || ''), u.senha_hash)) return erro(res, 400, 'Senha atual incorreta.');
      if (u.totp_ativo) return erro(res, 409, '2FA já está ativo.');
      const segredo = gerarSegredoTotp();
      db.prepare('UPDATE usuarios SET totp_secret = ?, totp_ativo = 0 WHERE id = ?').run(cifrar(segredo), u.id);
      const url = otpauthUrl(segredo, u.email, getSetting('imob_nome', 'Imobiliária'));
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#2C3634', light: '#FFFFFF' } });
      registrar(user, 'iniciar_2fa', 'usuarios', u.id, null, ip);
      return json(res, 200, { segredo, otpauth: url, qr });
    }
    if (p === '/2fa/ativar' && m === 'POST') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
      if (u.totp_ativo) return erro(res, 409, '2FA já está ativo.');
      const segredo = decifrar(u.totp_secret);
      if (!segredo || !verificarTotp(segredo, body.codigo)) return erro(res, 400, 'Código inválido. Confira o horário do celular e tente novamente.');
      const rec = gerarRecovery();
      db.prepare('UPDATE usuarios SET totp_ativo = 1, totp_recovery = ? WHERE id = ?').run(rec.armazenado, u.id);
      registrar(user, 'ativar_2fa', 'usuarios', u.id, null, ip);
      return json(res, 200, { ok: true, codigos: rec.codigos });
    }
    if (p === '/2fa/desativar' && m === 'POST') {
      if (!user) return erro(res, 401, 'Não autenticado.');
      const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
      if (!verificaSenha(String(body.senha || ''), u.senha_hash)) return erro(res, 400, 'Senha atual incorreta.');
      const segredo = decifrar(u.totp_secret);
      let ok = !!(segredo && verificarTotp(segredo, body.codigo));
      if (!ok && u.totp_recovery) ok = usarRecovery(u.totp_recovery, body.codigo).ok;
      if (!ok) return erro(res, 400, 'Código inválido.');
      db.prepare('UPDATE usuarios SET totp_ativo = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?').run(u.id);
      registrar(user, 'desativar_2fa', 'usuarios', u.id, null, ip);
      return json(res, 200, { ok: true });
    }
    if (seg[0] === 'usuarios' && seg[1] && seg[2] === 'resetar-2fa' && m === 'POST') {
      exigir(user, 'admin');
      db.prepare('UPDATE usuarios SET totp_ativo = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?').run(Number(seg[1]));
      registrar(user, 'resetar_2fa', 'usuarios', Number(seg[1]), null, ip);
      return json(res, 200, { ok: true });
    }

    if (seg[0] === 'usuarios' && seg[1] && seg[2] === 'resetar-senha' && m === 'POST') {
      exigir(user, 'admin');
      const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(seg[1]));
      if (!u) return erro(res, 404, 'Usuário não encontrado.');
      const senha = `Imob-${crypto.randomBytes(4).toString('hex')}#26`;
      validarSenha(senha, u.email);
      db.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1 WHERE id = ?').run(hashSenha(senha), u.id);
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
      setSetting('primeiro_acesso', '0');
      registrar(user, 'resetar_senha_usuario', 'usuarios', u.id, null, ip);
      return json(res, 200, { ok: true, email: u.email, senha });
    }

    if (p === '/reset/solicitacoes' && m === 'GET') {
      exigir(user, 'admin');
      return json(res, 200, listarSolicitacoes());
    }

    if (p === '/manutencao/status' && m === 'GET') {
      exigir(user, 'admin');
      return json(res, 200, statusManutencao());
    }

    if (p === '/manutencao/limpar' && m === 'POST') {
      exigir(user, 'admin');
      if (String(body.confirmacao || '') !== 'ZERAR') return erro(res, 400, 'Digite ZERAR para confirmar.');
      const r = limparBase({
        incluirAuditoria: body.incluir_auditoria !== false,
        incluirArquivos: body.incluir_arquivos !== false,
      });
      registrar(user, 'limpar_base', 'sistema', null, { backup: path.basename(r.backup), arquivos: r.arquivos_removidos }, ip);
      return json(res, 200, { ok: true, backup: path.basename(r.backup), ...statusManutencao() });
    }

    if (p === '/manutencao/demo' && m === 'POST') {
      exigir(user, 'admin');
      if (String(body.confirmacao || '') !== 'DEMO') return erro(res, 400, 'Digite DEMO para confirmar.');
      const r = carregarDemo();
      registrar(user, 'carregar_demo', 'sistema', null, null, ip);
      return json(res, 200, r);
    }
    if (!user) return erro(res, 401, 'Não autenticado.');

    if (p === '/dashboard' && m === 'GET') return json(res, 200, resumoDashboard());
    if (p === '/analytics' && m === 'GET') {
      const dados = analytics({
        de: url.searchParams.get('de'),
        ate: url.searchParams.get('ate'),
        comparar: url.searchParams.get('comparar') === '1',
        propId: url.searchParams.get('proprietario_id'),
      });
      if (!pode(user, 'admin')) delete dados.atividades;
      return json(res, 200, dados);
    }
    if (p === '/alertas' && m === 'GET') return json(res, 200, alertas());
    if (p === '/saldos' && m === 'GET') return json(res, 200, saldos());

    if (p === '/settings' && m === 'GET') {
      return json(res, 200, db.prepare('SELECT * FROM settings ORDER BY grupo, ordem').all());
    }
    if (p === '/settings' && m === 'PUT') {
      exigir(user, 'admin');
      const itens = body.itens || body;
      const antes = {};
      for (const [chave, valor] of Object.entries(itens)) {
        const s = db.prepare('SELECT * FROM settings WHERE chave = ?').get(chave);
        if (!s || !s.editavel) continue;
        antes[chave] = s.valor;
        setSetting(chave, valor);
      }
      registrar(user, 'alterar', 'settings', null, { antes, depois: itens }, ip);
      return json(res, 200, { ok: true });
    }

    if (p === '/usuarios' && m === 'GET') { exigir(user, 'admin'); return json(res, 200, listarUsuarios()); }
    if (p === '/usuarios' && m === 'POST') return json(res, 201, criarUsuario(body, user, ip));
    if (seg[0] === 'usuarios' && seg[1] && m === 'PUT') return json(res, 200, atualizarUsuario(Number(seg[1]), body, user, ip));

    if (p === '/auditoria' && m === 'GET') {
      exigir(user, 'admin');
      const limite = Math.min(Number(url.searchParams.get('limite') || 200), 1000);
      return json(res, 200, db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').all(limite));
    }

    if (p === '/lancamentos' && m === 'GET') return json(res, 200, listarLancamentos(url));
    if (p === '/lancamentos' && m === 'POST') { exigir(user, 'financeiro'); return json(res, 201, criarLancamento(body, user, ip)); }
    if (seg[0] === 'lancamentos' && seg[1] && seg[2] === 'estornar' && m === 'POST') {
      exigir(user, 'financeiro');
      return json(res, 200, estornarLancamento(Number(seg[1]), texto(body.motivo), user, ip));
    }

    if (p === '/cobrancas/resumo' && m === 'GET') {
      return json(res, 200, resumoCobrancas(url.searchParams.get('competencia') || undefined));
    }
    if (p === '/cobrancas/gerar/preview' && m === 'GET') {
      return json(res, 200, previewGeracao(url.searchParams.get('competencia')));
    }
    if (p === '/cobrancas/gerar' && m === 'POST') {
      exigir(user, 'financeiro');
      const competencia = texto(body.competencia);
      const r = gerarCobrancas(competencia, body.contrato_ids || null, user);
      registrar(user, 'gerar', 'cobrancas', competencia, r, ip);
      return json(res, 200, r);
    }
    if (p === '/cobrancas' && m === 'GET') {
      return json(res, 200, listarCobrancas({
        competencia: url.searchParams.get('competencia') || undefined,
        status: url.searchParams.get('status') || undefined,
        contrato_id: url.searchParams.get('contrato_id') || undefined,
        busca: url.searchParams.get('busca') || undefined,
      }));
    }
    if (seg[0] === 'cobrancas' && seg[1] && !seg[2] && m === 'GET') {
      const c = obterCobranca(Number(seg[1]));
      if (!c) return erro(res, 404, 'Cobrança não encontrada.');
      return json(res, 200, c);
    }
    if (seg[0] === 'cobrancas' && seg[1] && m === 'POST') {
      exigir(user, 'financeiro');
      const acao = seg[2];
      if (acao === 'pagar') {
        const r = pagarCobranca(Number(seg[1]), {
          valor: body.valor_centavos, data: texto(body.data), forma: texto(body.forma),
          desconto: body.desconto_centavos, observacao: texto(body.observacao),
        }, user);
        registrar(user, 'pagar', 'cobrancas', Number(seg[1]), { valor_centavos: r.valor_centavos }, ip);
        return json(res, 200, r);
      }
      if (acao === 'estornar') {
        const r = estornarBaixa(Number(seg[1]), texto(body.motivo), user);
        registrar(user, 'estornar', 'cobrancas', Number(seg[1]), { motivo: texto(body.motivo) }, ip);
        return json(res, 200, r);
      }
      if (acao === 'cancelar') {
        const r = cancelarCobranca(Number(seg[1]), texto(body.motivo), user);
        registrar(user, 'cancelar', 'cobrancas', Number(seg[1]), { motivo: texto(body.motivo) }, ip);
        return json(res, 200, r);
      }
      if (acao === 'acao') {
        const r = registrarAcao(Number(seg[1]), {
          tipo: texto(body.tipo), descricao: texto(body.descricao), responsavel: texto(body.responsavel),
          proxima_acao: texto(body.proxima_acao), proxima_data: texto(body.proxima_data),
          cobranca_status: texto(body.cobranca_status),
        }, user);
        registrar(user, 'acao_cobranca', 'cobrancas', Number(seg[1]), { tipo: texto(body.tipo), status: r.status }, ip);
        return json(res, 200, r);
      }
      if (acao === 'status') {
        const r = definirCobrancaStatus(Number(seg[1]), texto(body.cobranca_status), user);
        registrar(user, 'status_cobranca', 'cobrancas', Number(seg[1]), r, ip);
        return json(res, 200, r);
      }
    }

    if (p === '/conciliacao/resumo' && m === 'GET') {
      return json(res, 200, resumoConciliacao());
    }
    if (p === '/conciliacao' && m === 'GET') {
      return json(res, 200, listarPendentes(url.searchParams.get('status') || 'pendente'));
    }
    if (p === '/conciliacao/preview' && m === 'POST') {
      exigir(user, 'financeiro');
      const r = previewConciliacao({
        arquivo_base64: body.arquivo_base64,
        nome: texto(body.nome),
        mapeamento: body.mapeamento || null,
      });
      registrar(user, 'importar', 'conciliacao', null, { importadas: r.importadas, duplicadas: r.duplicadas }, ip);
      return json(res, 200, r);
    }
    if (seg[0] === 'conciliacao' && seg[1] && seg[2] === 'confirmar' && m === 'POST') {
      exigir(user, 'financeiro');
      const r = confirmarConciliacao(Number(seg[1]), {
        acao: texto(body.acao),
        cobranca_id: body.cobranca_id,
        repasse_id: body.repasse_id,
        lancamento: body.lancamento || {},
      }, user);
      registrar(user, 'conciliar', 'conciliacao', Number(seg[1]), { acao: texto(body.acao) }, ip);
      return json(res, 200, r);
    }

    if (p === '/repasses' && m === 'GET') return json(res, 200, listarRepasses(url));
    if (p === '/repasses/calcular' && m === 'POST') {
      exigir(user, 'repasses');
      const comp = texto(body.competencia) || competenciaAtual();
      const r = gerarRepasses(comp, user.nome);
      registrar(user, 'calcular', 'repasses', comp, { quantidade: r.length }, ip);
      return json(res, 200, { competencia: comp, repasses: r });
    }
    if (seg[0] === 'repasses' && seg[1] && m === 'GET') return json(res, 200, detalheRepasse(Number(seg[1])));
    if (seg[0] === 'repasses' && seg[1] && seg[2] === 'pagar' && m === 'POST') {
      exigir(user, 'repasses');
      const r = pagarRepasse(Number(seg[1]), user.nome);
      registrar(user, 'pagar', 'repasses', Number(seg[1]), r, ip);
      return json(res, 200, r);
    }

    if (p === '/fechamentos' && m === 'GET') return json(res, 200, listarFechamentos());
    if (p === '/fechamentos' && m === 'POST') {
      exigir(user, 'financeiro');
      return json(res, 200, fecharMes(texto(body.competencia), user, ip));
    }
    if (seg[0] === 'fechamentos' && seg[1] && seg[2] === 'reabrir' && m === 'POST') {
      return json(res, 200, reabrirMes(seg[1], texto(body.motivo), user, ip));
    }

    if (seg[0] === 'export' && seg[1] && m === 'GET') {
      if (!pode(user, 'financeiro')) return erro(res, 403, 'Seu perfil não pode exportar dados.');
      return exportar(seg[1].replace(/\.csv$/, ''), url, res);
    }

    if (p === '/relatorios' && m === 'GET') {
      return json(res, 200, RELATORIOS);
    }

    if (seg[0] === 'reports' && seg[1] && m === 'GET') {
      if (!pode(user, 'financeiro')) return erro(res, 403, 'Seu perfil não pode exportar relatórios.');
      const [tipo, formato = 'pdf'] = seg[1].split('.');
      const de = url.searchParams.get('de') || url.searchParams.get('competencia') || undefined;
      const ate = url.searchParams.get('ate') || de;
      const competencia = url.searchParams.get('competencia') || ate;
      const proprietario_id = url.searchParams.get('proprietario_id') || null;
      const rel = construirRelatorio(tipo, { de, ate, competencia, proprietario_id });
      const slug = `${tipo}-${de || ''}${ate && ate !== de ? '-a-' + ate : ''}`.replace(/-+$/, '');
      if (formato === 'csv') {
        const conteudo = gerarCSV(rel);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}.csv"`,
        });
        return res.end(conteudo);
      }
      if (formato === 'xlsx') {
        const buf = gerarXLSX(rel);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${slug}.xlsx"`,
          'Content-Length': buf.length,
        });
        return res.end(buf);
      }
      if (formato === 'pdf') {
        const buf = await gerarPDF(rel);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${slug}.pdf"`,
          'Content-Length': buf.length,
        });
        return res.end(buf);
      }
      return erro(res, 400, 'Formato inválido. Use csv, xlsx ou pdf.');
    }

    if (p === '/import/modelos' && m === 'GET') {
      return json(res, 200, Object.entries(MODELOS).map(([id, m]) => ({
        id, nome: m.nome, descricao: m.descricao,
        colunas: m.colunas.map(c => ({ titulo: c.titulo, chave: c.chave, req: !!c.req, exemplo: c.exemplo ?? '' })),
      })));
    }

    if (seg[0] === 'import' && seg[1] === 'modelo' && seg[2] && m === 'GET') {
      const [entidade, formato = 'xlsx'] = seg[2].split('.');
      const conteudo = gerarModelo(entidade, formato);
      if (formato === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="modelo-${entidade}.csv"`,
        });
        return res.end(conteudo);
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="modelo-${entidade}.xlsx"`,
        'Content-Length': conteudo.length,
      });
      return res.end(conteudo);
    }

    if (p === '/import/preview' && m === 'POST') {
      exigir(user, 'escrever');
      const espera = limitar('import:' + ip, 30, 10 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitas importações em pouco tempo. Aguarde alguns minutos.'); }
      contarTentativa('import:' + ip);
      return json(res, 200, analisarImportacao({
        entidade: texto(body.entidade),
        arquivo_base64: body.arquivo_base64,
        opcoes: body.opcoes || {},
      }));
    }

    if (p === '/import/commit' && m === 'POST') {
      exigir(user, 'escrever');
      const espera = limitar('import:' + ip, 30, 10 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitas importações em pouco tempo. Aguarde alguns minutos.'); }
      contarTentativa('import:' + ip);
      const r = importar({
        entidade: texto(body.entidade),
        arquivo_base64: body.arquivo_base64,
        opcoes: body.opcoes || {},
        usuario: user,
      });
      registrar(user, 'importar', body.entidade, null, { inseridos: r.inseridos, atualizados: r.atualizados, erros: r.erros.length }, ip);
      return json(res, 200, r);
    }

    if (p === '/comunicacao/status' && m === 'GET') {
      return json(res, 200, {
        email_configurado: emailConfigurado(),
        remetente: getSetting('email_remetente', '') || process.env.SMTP_FROM || process.env.SMTP_USER || '',
        remetente_nome: getSetting('email_remetente_nome', '') || getSetting('imob_nome', 'Imobiliária'),
        whatsapp_empresa: getSetting('whatsapp_empresa', ''),
        assinatura: getSetting('email_assinatura', ''),
        templates: {
          cobranca: getSetting('mensagem_cobranca', ''),
          lembrete: getSetting('mensagem_lembrete', ''),
          reajuste: getSetting('mensagem_reajuste', ''),
        },
      });
    }

    if (p === '/comunicacao/email' && m === 'POST') {
      exigir(user, 'escrever');
      const chave = 'comunicacao:' + ip;
      const espera = limitar(chave, 30, 10 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitos envios em pouco tempo. Aguarde alguns minutos.'); }
      contarTentativa(chave);
      const para = texto(body.para);
      const assunto = texto(body.assunto) || `Mensagem de ${getSetting('imob_nome', 'Imobiliária')}`;
      const mensagem = String(body.mensagem || '').slice(0, 5000);
      try {
        const r = await enviarEmail({ para, assunto, mensagem });
        registrarComunicacao({ canal: 'email', entidade: texto(body.entidade), entidade_id: int(body.entidade_id, null),
          destinatario_nome: texto(body.destinatario_nome), destinatario: para, assunto, mensagem, status: 'enviado', usuario: user.nome });
        registrar(user, 'enviar_email', 'comunicacao', null, { para, assunto }, ip);
        return json(res, 200, { ok: true, messageId: r.messageId, remetente: r.remetente });
      } catch (e) {
        registrarComunicacao({ canal: 'email', entidade: texto(body.entidade), entidade_id: int(body.entidade_id, null),
          destinatario_nome: texto(body.destinatario_nome), destinatario: para, assunto, mensagem, status: 'erro', erro: e.message, usuario: user.nome });
        if (e.status) return erro(res, e.status, e.message);
        console.error('[email] falha no envio:', e);
        return erro(res, 502, 'Não foi possível enviar o e-mail. Verifique a configuração SMTP.');
      }
    }

    if (p === '/comunicacao/whatsapp' && m === 'POST') {
      exigir(user, 'escrever');
      const chave = 'comunicacao:' + ip;
      const espera = limitar(chave, 30, 10 * 60 * 1000);
      if (espera > 0) { res.setHeader('Retry-After', String(espera)); return erro(res, 429, 'Muitos envios em pouco tempo. Aguarde alguns minutos.'); }
      contarTentativa(chave);
      const digitos = String(body.telefone || '').replace(/\D/g, '');
      let numero = digitos;
      if (digitos.length === 10 || digitos.length === 11) numero = '55' + digitos;
      if (numero.length < 12 || numero.length > 15) {
        return erro(res, 400, 'Telefone inválido. Cadastre o número com DDD, por exemplo (11) 95555-4444.');
      }
      const mensagem = String(body.mensagem || '').slice(0, 2000);
      if (!mensagem.trim()) return erro(res, 400, 'Informe a mensagem.');
      const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
      registrarComunicacao({ canal: 'whatsapp', entidade: texto(body.entidade), entidade_id: int(body.entidade_id, null),
        destinatario_nome: texto(body.destinatario_nome), destinatario: numero, mensagem, status: 'aberto', usuario: user.nome });
      registrar(user, 'abrir_whatsapp', 'comunicacao', null, { numero }, ip);
      return json(res, 200, { ok: true, url });
    }

    if (seg[0] === 'documentos' && m === 'GET' && !seg[1]) {
      return json(res, 200, listarDocumentos({
        entidade: url.searchParams.get('entidade') || undefined,
        entidade_id: url.searchParams.get('entidade_id') || undefined,
      }));
    }

    if (p === '/documentos' && m === 'POST') {
      exigir(user, 'escrever');
      const doc = salvarDocumento({
        entidade: texto(body.entidade),
        entidade_id: body.entidade_id,
        nome: texto(body.nome),
        mime: texto(body.mime),
        base64: body.arquivo_base64,
        categoria: texto(body.categoria),
        descricao: texto(body.descricao),
        usuario: user,
        substituir_id: body.substituir_id,
        validade: texto(body.validade),
      });
      registrar(user, 'enviar', 'documentos', doc.id, { nome: doc.nome, entidade: doc.entidade, entidade_id: doc.entidade_id }, ip);
      return json(res, 201, doc);
    }

    if (seg[0] === 'documentos' && seg[1] && seg[2] === 'versoes' && m === 'GET') {
      return json(res, 200, versoesDocumento(Number(seg[1])));
    }

    if (seg[0] === 'documentos' && seg[1] && seg[2] === 'download' && m === 'GET') {
      const doc = obterDocumento(Number(seg[1]));
      if (!doc) return erro(res, 404, 'Documento não encontrado.');
      const full = caminhoFisico(doc);
      if (!fs.existsSync(full)) return erro(res, 404, 'Arquivo não encontrado no servidor.');
      const stat = fs.statSync(full);
      const nome = nomeArquivoSeguro(doc.nome);
      const inline = url.searchParams.get('inline') === '1' && ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(doc.mime);
      registrar(user, 'baixar', 'documentos', doc.id, { nome: doc.nome, inline }, ip);
      res.writeHead(200, {
        'Content-Type': doc.mime || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(doc.nome)}`,
        'Content-Length': stat.size,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return fs.createReadStream(full).pipe(res);
    }

    if (seg[0] === 'documentos' && seg[1] && m === 'DELETE') {
      exigir(user, 'escrever');
      const r = removerDocumento(Number(seg[1]), user);
      registrar(user, 'remover', 'documentos', Number(seg[1]), r, ip);
      return json(res, 200, r);
    }

    if (p === '/lgpd/titular' && m === 'GET') {
      exigir(user, 'admin');
      const tipo = url.searchParams.get('tipo');
      const id = Number(url.searchParams.get('id'));
      const tabela = tipo === 'proprietario' ? 'proprietarios' : tipo === 'inquilino' ? 'inquilinos' : null;
      if (!tabela) return erro(res, 400, 'Tipo inválido. Use proprietario ou inquilino.');
      const titular = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id);
      if (!titular) return erro(res, 404, 'Titular não encontrado.');
      const contratos = tipo === 'proprietario'
        ? db.prepare('SELECT c.*, i.endereco, i.numero FROM contratos c JOIN imoveis i ON i.id = c.imovel_id WHERE i.proprietario_id = ?').all(id)
        : db.prepare('SELECT c.*, i.endereco, i.numero FROM contratos c JOIN imoveis i ON i.id = c.imovel_id WHERE c.inquilino_id = ?').all(id);
      const ids = contratos.map(c => c.id);
      const ph = ids.map(() => '?').join(',') || 'NULL';
      const lancamentos = tipo === 'proprietario'
        ? db.prepare('SELECT * FROM lancamentos WHERE proprietario_id = ? ORDER BY data').all(id)
        : db.prepare(`SELECT * FROM lancamentos WHERE contrato_id IN (${ph}) ORDER BY data`).all(...ids);
      const cobrancas = ids.length ? db.prepare(`SELECT * FROM cobrancas WHERE contrato_id IN (${ph}) ORDER BY competencia`).all(...ids) : [];
      const docs = db.prepare(`SELECT id, entidade, entidade_id, nome, categoria, descricao, criado_em FROM documentos
        WHERE ativo = 1 AND ((entidade = ? AND entidade_id = ?) ${ids.length ? `OR (entidade = 'contratos' AND entidade_id IN (${ph}))` : ''})`)
        .all(tipo === 'proprietario' ? 'proprietarios' : 'inquilinos', id, ...ids);
      const comunicacoes = db.prepare(`SELECT canal, destinatario_nome, destinatario, assunto, status, criado_em FROM comunicacoes
        WHERE (entidade = ? AND entidade_id = ?) OR destinatario = ? OR destinatario_nome = ?`)
        .all(tipo === 'proprietario' ? 'proprietarios' : 'inquilinos', id, titular.email || '', titular.nome);
      const payload = {
        gerado_em: new Date().toISOString(),
        tipo, titular, contratos, lancamentos, cobrancas, documentos: docs, comunicacoes,
        observacao: 'Dados exportados para atendimento de solicitação LGPD. Registros financeiros podem ser mantidos por obrigação legal.',
      };
      registrar(user, 'exportar_lgpd', tipo, id, { contratos: contratos.length, lancamentos: lancamentos.length }, ip);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lgpd-${tipo}-${id}-${hojeISO()}.json"`,
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify(payload, null, 2));
    }

    if (p === '/lgpd/anonimizar' && m === 'POST') {
      exigir(user, 'admin');
      if (String(body.confirmacao || '') !== 'ANONIMIZAR') return erro(res, 400, 'Confirmação inválida. Digite ANONIMIZAR.');
      const tipo = texto(body.tipo);
      const id = Number(body.id);
      if (tipo === 'proprietario') {
        const t = db.prepare('SELECT nome, email, telefone FROM proprietarios WHERE id = ?').get(id);
        if (!t) return erro(res, 404, 'Proprietário não encontrado.');
        db.prepare(`UPDATE proprietarios SET nome = ?, cpf_cnpj = NULL, email = NULL, telefone = NULL, endereco = NULL,
          banco = NULL, agencia = NULL, conta = NULL, pix = NULL, observacoes = NULL, documento_url = NULL WHERE id = ?`)
          .run(`Titular anonimizado #${id}`, id);
        db.prepare("UPDATE comunicacoes SET destinatario = NULL, destinatario_nome = 'Titular anonimizado' WHERE destinatario = ? OR destinatario_nome = ?").run(t.email || '', t.nome);
      } else if (tipo === 'inquilino') {
        const t = db.prepare('SELECT nome, email, telefone FROM inquilinos WHERE id = ?').get(id);
        if (!t) return erro(res, 404, 'Inquilino não encontrado.');
        db.prepare('UPDATE inquilinos SET nome = ?, cpf_cnpj = NULL, email = NULL, telefone = NULL, observacoes = NULL WHERE id = ?')
          .run(`Titular anonimizado #${id}`, id);
        db.prepare("UPDATE comunicacoes SET destinatario = NULL, destinatario_nome = 'Titular anonimizado' WHERE destinatario = ? OR destinatario_nome = ?").run(t.email || '', t.nome);
      } else {
        return erro(res, 400, 'Tipo inválido.');
      }
      registrar(user, 'anonimizar_lgpd', tipo, id, { aviso: 'Dados pessoais anonimizados; registros financeiros mantidos.' }, ip);
      return json(res, 200, { ok: true });
    }

    if (p === '/backup/verificar' && m === 'GET') {
      exigir(user, 'admin');
      const tmp = path.join(os.tmpdir(), `imob-verificar-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      let contagens = {};
      try {
        const b = new DatabaseSync(tmp);
        for (const t of ['usuarios', 'proprietarios', 'imoveis', 'inquilinos', 'contratos', 'lancamentos', 'cobrancas', 'repasses', 'documentos', 'comunicacoes']) {
          try { contagens[t] = b.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { contagens[t] = null; }
        }
        b.close();
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
      let arquivos = 0;
      let bytes = 0;
      if (fs.existsSync(UPLOADS)) {
        for (const f of fs.readdirSync(UPLOADS)) {
          try { const st = fs.statSync(path.join(UPLOADS, f)); if (st.isFile()) { arquivos++; bytes += st.size; } } catch {}
        }
      }
      registrar(user, 'verificar_backup', 'sistema', null, { contagens, arquivos }, ip);
      return json(res, 200, { ok: true, gerado_em: new Date().toISOString(), contagens, documentos_arquivos: arquivos, documentos_bytes: bytes });
    }

    if (p === '/backup' && m === 'GET') {
      exigir(user, 'admin');
      const tmp = path.join(os.tmpdir(), `imobiliaria-backup-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      setSetting('ultimo_backup', hojeISO());
      registrar(user, 'backup', 'sistema', null, { documentos: fs.existsSync(UPLOADS) }, ip);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="imobiliaria-backup-${hojeISO()}.zip"`,
        'Cache-Control': 'no-store',
      });
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (e) => {
        console.error('[backup] erro:', e);
        try { fs.unlinkSync(tmp); } catch {}
        try { res.destroy(); } catch {}
      });
      archive.on('end', () => { try { fs.unlinkSync(tmp); } catch {} });
      archive.pipe(res);
      archive.file(tmp, { name: 'imobiliaria.db' });
      if (fs.existsSync(UPLOADS)) archive.directory(UPLOADS, 'documentos');
      archive.append(
        'Backup do Sistema de Gestão da Imobiliária\n\n' +
        'Conteúdo:\n- imobiliaria.db: banco de dados\n- documentos/: arquivos enviados\n\n' +
        'Para restaurar: pare o servidor, substitua data/imobiliaria.db pelo arquivo imobiliaria.db ' +
        'e copie a pasta documentos para data/uploads. Depois suba o servidor novamente.\n',
        { name: 'LEIA-ME.txt' }
      );
      archive.finalize();
      return;
    }

    if (ENTIDADES[seg[0]]) {
      const entidade = seg[0];
      if (m === 'GET' && !seg[1]) return json(res, 200, aplicarMascara(entidade, listar(entidade), user));
      if (m === 'POST' && !seg[1]) { exigir(user, 'escrever'); return json(res, 201, criar(entidade, body, user, ip)); }
      if (m === 'PUT' && seg[1]) { exigir(user, 'escrever'); return json(res, 200, atualizar(entidade, Number(seg[1]), body, user, ip)); }
      if (m === 'DELETE' && seg[1]) { exigir(user, 'escrever'); return json(res, 200, desativar(entidade, Number(seg[1]), user, ip)); }
    }

    return erro(res, 404, 'Rota não encontrada.');
  } catch (e) {
    if (e.status) return erro(res, e.status, e.message);
    console.error('[api] erro interno:', e);
    return erro(res, 500, 'Erro interno. Tente novamente.');
  }
}
