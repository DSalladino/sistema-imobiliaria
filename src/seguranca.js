import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function base32Decode(str) {
  const limpo = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const out = [];
  for (const c of limpo) {
    const idx = ALFABETO.indexOf(c);
    if (idx < 0) continue;
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function gerarSegredoTotp() {
  return base32Encode(crypto.randomBytes(20));
}

export function codigoTotp(segredo, tempo = Date.now()) {
  const contador = Math.floor(tempo / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac('sha1', base32Decode(segredo)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codigo = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(codigo).padStart(6, '0');
}

export function verificarTotp(segredo, codigo, janela = 1) {
  const alvo = String(codigo || '').replace(/\D/g, '');
  if (alvo.length !== 6) return false;
  const agora = Date.now();
  for (let i = -janela; i <= janela; i++) {
    const esperado = codigoTotp(segredo, agora + i * 30000);
    if (esperado.length === alvo.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(alvo))) return true;
  }
  return false;
}

export function otpauthUrl(segredo, email, emissor) {
  const e = encodeURIComponent(emissor || 'Imobiliária');
  const conta = encodeURIComponent(email || 'usuario');
  return `otpauth://totp/${e}:${conta}?secret=${segredo}&issuer=${e}&algorithm=SHA1&digits=6&period=30`;
}

let chaveCache = null;
function chave() {
  if (chaveCache) return chaveCache;
  if (process.env.APP_SECRET) {
    chaveCache = crypto.createHash('sha256').update(String(process.env.APP_SECRET)).digest();
    return chaveCache;
  }
  const arquivo = path.join(DATA_DIR, '.app-key');
  if (!fs.existsSync(arquivo)) {
    fs.writeFileSync(arquivo, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chaveCache = Buffer.from(fs.readFileSync(arquivo, 'utf8').trim(), 'hex');
  return chaveCache;
}

export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), dados.toString('hex')].join('.');
}

export function decifrar(valor) {
  if (!valor || !String(valor).includes('.')) return null;
  const [ivHex, tagHex, dadosHex] = String(valor).split('.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dadosHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function normalizarCodigo(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function gerarRecovery() {
  const codigos = Array.from({ length: 8 }, () => {
    const bruto = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${bruto.slice(0, 5)}-${bruto.slice(5)}`;
  });
  const salt = crypto.randomBytes(16).toString('hex');
  // HMAC com a chave da aplicação: uma cópia isolada do banco não permite
  // testar códigos de recuperação offline sem conhecer APP_SECRET/.app-key.
  const hashes = codigos.map(c => hmacRecovery(salt + normalizarCodigo(c)));
  return { codigos, armazenado: JSON.stringify({ v: 2, salt, hashes }) };
}

function hmacRecovery(valor) {
  return crypto.createHmac('sha256', chave()).update(valor).digest('hex');
}

export function usarRecovery(armazenado, codigo) {
  if (!armazenado) return { ok: false };
  let dados;
  try { dados = JSON.parse(armazenado); } catch { return { ok: false }; }
  const alvo = dados.v === 2
    ? hmacRecovery(dados.salt + normalizarCodigo(codigo))
    : crypto.createHash('sha256').update(dados.salt + normalizarCodigo(codigo)).digest('hex');
  const idx = dados.hashes.indexOf(alvo);
  if (idx < 0) return { ok: false };
  dados.hashes.splice(idx, 1);
  return { ok: true, novo: JSON.stringify(dados) };
}

export function validarSenha(senha, email) {
  const s = String(senha || '');
  if (s.length < 8) throw Object.assign(new Error('A senha deve ter ao menos 8 caracteres.'), { status: 400 });
  const fracas = new Set(['12345678', '123456789', 'senha123', 'password', 'admin123', 'qwerty123', 'imobiliaria', 'admin@123']);
  if (fracas.has(s.toLowerCase())) throw Object.assign(new Error('Essa senha é muito comum. Escolha outra.'), { status: 400 });
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && s.toLowerCase().includes(local)) {
    throw Object.assign(new Error('A senha não pode conter o seu e-mail.'), { status: 400 });
  }
}
