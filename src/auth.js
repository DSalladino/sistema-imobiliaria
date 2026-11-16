import crypto from 'node:crypto';

export function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verificaSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
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
