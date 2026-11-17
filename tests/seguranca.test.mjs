import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-seg-'));
process.env.DATA_DIR = dir;
process.env.APP_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.ADMIN_SENHA = 'admin123';

const { db } = await import('../src/db.js');
const {
  base32Encode, base32Decode, gerarSegredoTotp, codigoTotp, verificarTotp,
  otpauthUrl, cifrar, decifrar, gerarRecovery, usarRecovery, validarSenha,
} = await import('../src/seguranca.js');
const { hashToken, verificaSenha, hashSenha } = await import('../src/auth.js');

test.after(() => {
  try { db.close(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

// Segredo de referência do RFC 6238 (anexo B): "12345678901234567890" em ASCII.
const SEGREDO_RFC = base32Encode(Buffer.from('12345678901234567890'));

test('base32 codifica e decodifica sem perda, ignorando máscara e caixa', () => {
  const bruto = Buffer.from('12345678901234567890');
  assert.equal(SEGREDO_RFC, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(SEGREDO_RFC), bruto);
  assert.deepEqual(base32Decode(SEGREDO_RFC.toLowerCase().replace(/(.{4})/g, '$1 ').trim()), bruto);
  assert.equal(base32Decode('').length, 0);
  for (let i = 0; i < 20; i++) {
    const aleatorio = Buffer.from(gerarSegredoTotp());
    assert.equal(aleatorio.length, 32, 'segredo TOTP deve ter 32 caracteres');
    assert.equal(base32Decode(aleatorio).length, 20);
  }
});

test('TOTP confere com os vetores do RFC 6238 (SHA-1, 6 dígitos)', () => {
  const vetores = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [segundos, esperado] of vetores) {
    assert.equal(codigoTotp(SEGREDO_RFC, segundos * 1000), esperado, `T=${segundos}`);
  }
});

test('verificação TOTP tolera um passo de deriva e rejeita o resto', () => {
  const agora = 1234567890 * 1000;
  const codigoAnterior = codigoTotp(SEGREDO_RFC, agora - 30000);
  const codigoProximo = codigoTotp(SEGREDO_RFC, agora + 30000);
  const codigoAtual = codigoTotp(SEGREDO_RFC, agora);

  const original = Date.now;
  Date.now = () => agora;
  try {
    assert.ok(verificarTotp(SEGREDO_RFC, codigoAtual), 'passo atual');
    assert.ok(verificarTotp(SEGREDO_RFC, codigoAnterior), 'passo anterior (janela 1)');
    assert.ok(verificarTotp(SEGREDO_RFC, codigoProximo), 'passo seguinte (janela 1)');
    assert.ok(verificarTotp(SEGREDO_RFC, codigoAtual, 0), 'janela 0 aceita o atual');
    assert.ok(!verificarTotp(SEGREDO_RFC, codigoAnterior, 0), 'janela 0 rejeita o anterior');

    const doisPassos = codigoTotp(SEGREDO_RFC, agora - 90000);
    assert.ok(!verificarTotp(SEGREDO_RFC, doisPassos), 'fora da janela é rejeitado');
    assert.ok(!verificarTotp(SEGREDO_RFC, '12345'), 'código curto é rejeitado');
    assert.ok(!verificarTotp(SEGREDO_RFC, 'abcdef'), 'código não numérico é rejeitado');
    assert.ok(!verificarTotp(SEGREDO_RFC, ''), 'código vazio é rejeitado');
  } finally {
    Date.now = original;
  }
});

test('URL otpauth codifica emissor e conta', () => {
  const url = otpauthUrl('ABCDEF234567', 'maria@exemplo.com', 'Imobiliária Família');
  assert.ok(url.startsWith('otpauth://totp/'));
  assert.ok(url.includes('secret=ABCDEF234567'));
  assert.ok(url.includes('issuer=Imobili%C3%A1ria%20Fam%C3%ADlia'));
  assert.ok(url.includes('digits=6') && url.includes('period=30'));
  assert.ok(!url.includes(' '), 'URL não deve conter espaços');
});

test('cifrar/decifrar ida e volta, IV aleatório e detecção de adulteração', () => {
  const texto = 'segredo do SMTP: senha-com-acentuação-ção-🔐';
  const a = cifrar(texto);
  const b = cifrar(texto);
  assert.notEqual(a, b, 'IV aleatório produz saídas diferentes');
  assert.equal(decifrar(a), texto);
  assert.equal(decifrar(b), texto);

  const [iv, tag, dados] = a.split('.');
  const inverter = (hex) => {
    const buf = Buffer.from(hex, 'hex');
    buf[0] ^= 0xff;
    return buf.toString('hex');
  };
  assert.equal(decifrar([inverter(iv), tag, dados].join('.')), null, 'IV adulterado');
  assert.equal(decifrar([iv, inverter(tag), dados].join('.')), null, 'tag adulterada');
  assert.equal(decifrar([iv, tag, inverter(dados)].join('.')), null, 'dados adulterados');
  assert.equal(decifrar('sem-separador'), null);
  assert.equal(decifrar(''), null);
  assert.equal(decifrar(null), null);
});

test('códigos de recuperação são únicos, formatados e de uso único', () => {
  const { codigos, armazenado } = gerarRecovery();
  assert.equal(codigos.length, 8);
  assert.equal(new Set(codigos).size, 8, 'códigos não se repetem');
  for (const c of codigos) assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);

  const guardado = JSON.parse(armazenado);
  assert.equal(guardado.v, 2);
  assert.equal(guardado.hashes.length, 8);
  assert.ok(!armazenado.includes(codigos[0]), 'código nunca é guardado em claro');

  let atual = armazenado;
  const primeiro = usarRecovery(atual, codigos[0]);
  assert.equal(primeiro.ok, true);
  atual = primeiro.novo;
  assert.equal(JSON.parse(atual).hashes.length, 7);

  assert.equal(usarRecovery(atual, codigos[0]).ok, false, 'código já usado é recusado');
  assert.equal(usarRecovery(atual, 'AAAAA-BBBBB').ok, false, 'código inválido é recusado');
  assert.equal(usarRecovery(atual, '').ok, false);
  assert.equal(usarRecovery(null, codigos[1]).ok, false);
  assert.equal(usarRecovery('{lixo', codigos[1]).ok, false);

  // Aceita o código digitado sem separador e em minúsculas.
  const segundo = usarRecovery(atual, codigos[1].replace('-', '').toLowerCase());
  assert.equal(segundo.ok, true);
});

test('uso de código legado (v1, sha256 simples) continua funcionando', () => {
  const codigo = 'AAAAA-BBBBB';
  const salt = 'salt-legado';
  const hash = crypto.createHash('sha256').update(salt + 'AAAAABBBBB').digest('hex');
  const armazenado = JSON.stringify({ v: 1, salt, hashes: [hash, 'outro-hash'] });
  const r = usarRecovery(armazenado, codigo);
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(r.novo).hashes.length, 1);
});

test('política de senha rejeita curta, comum, com o e-mail e aceita forte', () => {
  assert.throws(() => validarSenha('curta', 'ana@exemplo.com'), /ao menos 8 caracteres/);
  assert.throws(() => validarSenha('', 'ana@exemplo.com'), /ao menos 8 caracteres/);
  for (const fraca of ['12345678', 'senha123', 'Password', 'Admin@123']) {
    assert.throws(() => validarSenha(fraca, 'ana@exemplo.com'), /muito comum/, fraca);
  }
  assert.throws(() => validarSenha('Ana.Silva#2026', 'ana.silva@exemplo.com'), /não pode conter o seu e-mail/);
  assert.doesNotThrow(() => validarSenha('Tr3s#Cavalos', 'ana@exemplo.com'));
  // O erro carrega status 400 para virar resposta amigável na API.
  try {
    validarSenha('curta', 'ana@exemplo.com');
  } catch (erro) {
    assert.equal(erro.status, 400);
  }
});

test('hash de token de sessão é determinístico e não reversível', () => {
  const token = 'a'.repeat(64);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken('b'.repeat(64)));
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.ok(!hashToken(token).includes(token));
  assert.equal(hashToken('').length, 64, 'entrada vazia não quebra o hash');
});

test('hash de senha usa salt próprio e recusa valores inválidos', () => {
  const a = hashSenha('Senha#Forte1');
  const b = hashSenha('Senha#Forte1');
  assert.notEqual(a, b, 'sal aleatório por senha');
  assert.ok(verificaSenha('Senha#Forte1', a));
  assert.ok(!verificaSenha('Senha#Forte2', a));
  assert.ok(!verificaSenha('Senha#Forte1', 'sem-dois-pontos'));
  assert.ok(!verificaSenha('Senha#Forte1', null));
});
