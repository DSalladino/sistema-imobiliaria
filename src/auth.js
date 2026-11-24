import crypto from 'node:crypto';

// Parâmetros de custo do scrypt para hashes novos (formato scrypt2).
// Hashes antigos (sem prefixo) continuam válidos com os parâmetros padrão.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// N=32768 com r=8 exige maxmem acima do padrão do Node (32 MB).
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }).toString('hex');
  return `scrypt2$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verificaSenha(senha, armazenado) {
  if (!armazenado) return false;
  if (String(armazenado).startsWith('scrypt2$')) {
    const [tag, n, r, p, salt, hash] = String(armazenado).split('$');
    if (tag !== 'scrypt2' || !salt || !hash || !/^[0-9]+$/.test(n || '') || !/^[0-9]+$/.test(r || '') || !/^[0-9]+$/.test(p || '')) return false;
    try {
      const calc = crypto.scryptSync(String(senha), salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM });
      const alvo = Buffer.from(hash, 'hex');
      return calc.length === alvo.length && crypto.timingSafeEqual(calc, alvo);
    } catch { return false; }
  }
  if (!String(armazenado).includes(':')) return false;
  const [salt, hash] = armazenado.split(':');
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const alvo = Buffer.from(hash, 'hex');
  return calc.length === alvo.length && crypto.timingSafeEqual(calc, alvo);
}

export function novoToken() {
  return crypto.randomBytes(32).toString('hex');
}

// O token de sessão só é guardado no banco em forma de hash. Assim, uma cópia
// do banco não permite reutilizar sessões ativas.
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i > -1) {
      const valor = parte.slice(i + 1).trim();
      try { out[parte.slice(0, i).trim()] = decodeURIComponent(valor); }
      catch { out[parte.slice(0, i).trim()] = valor; }
    }
  }
  return out;
}
