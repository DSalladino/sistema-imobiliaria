import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { parseCookies, hashToken } from './auth.js';
import { handleApi } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function requisicaoSegura(req) {
  return !!(req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function origemPermitida(req) {
  // Navegadores modernos enviam Sec-Fetch-Site. Requisições cross-site são
  // sempre recusadas, mesmo que não tragam o cabeçalho Origin.
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    const u = new URL(origem);
    return u.host === req.headers.host && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

function ipCliente(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

function usuarioDaRequisicao(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.sid;
  if (!token) return { user: null, token: null, tokenHash: null };
  const tokenHash = hashToken(token);
  const row = db.prepare(`SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.deve_trocar_senha, u.totp_ativo, s.expira_em
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`).get(tokenHash);
  if (!row || !row.ativo) return { user: null, token, tokenHash };
  if (new Date(row.expira_em) < new Date()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(tokenHash);
    return { user: null, token, tokenHash };
  }
  return {
    user: {
      id: row.id, nome: row.nome, email: row.email, papel: row.papel,
      deve_trocar_senha: !!row.deve_trocar_senha, totp_ativo: !!row.totp_ativo,
    }, token, tokenHash,
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) { reject(Object.assign(new Error('Corpo muito grande.'), { status: 413 })); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function servirEstatico(req, res, pathname) {
  const rel = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^[/\\]+/, '');
  const file = path.resolve(PUBLIC, rel);
  const relPath = path.relative(PUBLIC, file);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) { res.writeHead(403); return res.end('Proibido'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (path.extname(pathname)) { res.writeHead(404); return res.end('Não encontrado'); }
      // SPA: páginas sem extensão caem no index
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Não encontrado'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = ipCliente(req);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (requisicaoSegura(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (url.pathname.startsWith('/api/')) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !origemPermitida(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ erro: 'Origem não permitida.' }));
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ erro: 'Envie JSON com Content-Type application/json.' }));
      }
    }
    const { user, token, tokenHash } = usuarioDaRequisicao(req);
    req._sid = token;
    req._sidHash = tokenHash;
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try { body = await lerCorpo(req); }
      catch (e) { res.writeHead(e.status || 400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ erro: e.message })); }
    }
    return handleApi(req, res, url, user, ip, body);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('Método não permitido');
  }
  return servirEstatico(req, res, url.pathname);
});

server.headersTimeout = 20000;
server.requestTimeout = 30000;

// Primeira execução: completa a base de demonstração com cobranças e repasses.
// Só roda quando o banco está intocado (sem cobranças e sem auditoria), para não
// sobrescrever dados reais. Use SEED_COMPLETO=0 para desativar (testes/CI).
async function completarDemoInicial() {
  if (process.env.SEED_COMPLETO === '0') return;
  // Nunca injeta dados de demonstração em produção sem autorização explícita.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== '1') return;
  try {
    const cobs = db.prepare('SELECT COUNT(*) AS n FROM cobrancas').get().n;
    const aud = db.prepare('SELECT COUNT(*) AS n FROM auditoria').get().n;
    const props = db.prepare('SELECT COUNT(*) AS n FROM proprietarios').get().n;
    if (cobs > 0 || aud > 0 || props === 0) return;
    const { carregarDemo } = await import('./manutencao.js');
    carregarDemo();
    console.log('  Base de demonstração completa: 12 meses de cobranças e repasses.');
  } catch (e) {
    console.error('  Aviso: não foi possível completar a base de demonstração:', e.message);
  }
}
await completarDemoInicial();

server.listen(PORT, HOST, () => {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString());
  db.prepare("DELETE FROM password_resets WHERE expira_em < ? OR (usado_em IS NOT NULL AND usado_em < datetime('now','-30 days'))")
    .run(new Date().toISOString());
  const porta = server.address()?.port || PORT;
  console.log(`\n  Sistema de Gestão da Imobiliária`);
  console.log(`  Rodando em http://${HOST}:${porta}`);
  console.log(`  Acesso inicial: admin@imobiliaria.local (troca de senha obrigatória)\n`);
});
