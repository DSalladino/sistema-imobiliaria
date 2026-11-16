/**
 * Gera as capturas de tela usadas na documentação e no portfólio.
 *
 * Pré-requisitos (opcionais, não entram nas dependências do produto):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Com a demonstração no ar:
 *   npm run demo:servir          # em outro terminal
 *   node scripts/capturar-telas.mjs
 *
 * Variáveis: APP_URL (padrão http://127.0.0.1:3009), DEMO_SENHA e SAIDA.
 */
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.APP_URL || 'http://127.0.0.1:3009';
const senha = process.env.DEMO_SENHA || 'Demo#2026';
const saida = path.resolve(process.env.SAIDA || 'docs/assets/telas');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright não encontrado. Rode:\n  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

try {
  const r = await fetch(`${base}/api/health`);
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error(`A demonstração não respondeu em ${base}. Rode "npm run demo:servir" antes.`);
  process.exit(1);
}

fs.mkdirSync(saida, { recursive: true });
const browser = await chromium.launch();

async function entrar(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#form-login input[name="email"]', 'admin@imobiliaria.local');
  await page.fill('#form-login input[name="senha"]', senha);
  await page.click('#form-login button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(1200);
}

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR',
});
const page = await desktop.newPage();
await page.goto(base, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(saida, '01-login.png') });
await entrar(page);

const telas = [
  ['painel', '02-painel'],
  ['contratos', '03-contratos'],
  ['cobrancas', '04-cobrancas'],
  ['repasses', '05-repasses'],
  ['conciliacao', '06-conciliacao'],
  ['relatorios', '07-relatorios'],
  ['alertas', '08-alertas'],
];

for (const [rota, nome] of telas) {
  await page.evaluate((r) => { location.hash = `#/${r}`; }, rota);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(saida, `${nome}.png`) });
  console.log('capturado', `${nome}.png`);
}

// No celular o layout vira cartões; vale mostrar as duas telas principais.
const celular = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, locale: 'pt-BR',
});
const m = await celular.newPage();
await entrar(m);
await m.screenshot({ path: path.join(saida, '09-painel-celular.png') });
await m.evaluate(() => { location.hash = '#/cobrancas'; });
await m.waitForTimeout(1300);
await m.screenshot({ path: path.join(saida, '10-cobrancas-celular.png') });

await browser.close();
console.log(`\nCapturas salvas em ${saida}`);
