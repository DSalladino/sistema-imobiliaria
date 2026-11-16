/**
 * Grava um tour curto (≈ 90 s) da demonstração, com legendas de contexto.
 *
 * Pré-requisitos (opcionais):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Com a demonstração no ar:
 *   npm run demo:servir          # em outro terminal
 *   node scripts/gravar-demo.mjs
 *
 * Saída: docs/assets/demonstracao.webm (abra no navegador ou converta para MP4).
 * Variáveis: APP_URL, DEMO_SENHA e SAIDA.
 */
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.APP_URL || 'http://127.0.0.1:3009';
const senha = process.env.DEMO_SENHA || 'Demo#2026';
const saida = path.resolve(process.env.SAIDA || 'docs/assets');
const temp = path.join(saida, '.video-temp');

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

fs.mkdirSync(temp, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: temp, size: { width: 1280, height: 720 } },
  locale: 'pt-BR',
});
const page = await context.newPage();

// Legenda fixa no rodapé, para o vídeo se explicar sem áudio.
async function legenda(texto, ms = 2200) {
  await page.evaluate((t) => {
    let el = document.getElementById('legenda-demo');
    if (!el) {
      el = document.createElement('div');
      el.id = 'legenda-demo';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'background:rgba(18,32,27,.92);color:#fff;padding:10px 18px;border-radius:10px;' +
        'font:600 15px/1.4 system-ui,sans-serif;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.3);' +
        'max-width:80vw;text-align:center;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, texto);
  await page.waitForTimeout(ms);
}

await page.goto(base, { waitUntil: 'networkidle' });
await legenda('Acesso com credenciais de demonstração', 7000);
await page.fill('#form-login input[name="email"]', 'admin@imobiliaria.local');
await page.fill('#form-login input[name="senha"]', senha);
await page.click('#form-login button[type="submit"]');
await page.waitForSelector('#app:not([hidden])');
await page.waitForTimeout(600);

await legenda('Painel: caixa, inadimplência, ocupação e evolução', 7000);
await page.evaluate(() => { location.hash = '#/painel'; });
await page.waitForTimeout(2200);

await legenda('Carteira: imóveis, contratos, garantias e reajustes', 7000);
await page.evaluate(() => { location.hash = '#/contratos'; });
await page.waitForTimeout(2400);

await legenda('Cobranças: geração em lote, baixa, juros e aging', 7000);
await page.evaluate(() => { location.hash = '#/cobrancas'; });
await page.waitForTimeout(2600);

await legenda('Conciliação: importa extrato e sugere o vínculo', 7000);
await page.evaluate(() => { location.hash = '#/conciliacao'; });
await page.waitForTimeout(2200);

await legenda('Repasses: snapshot da taxa e extrato por contrato', 7000);
await page.evaluate(() => { location.hash = '#/repasses'; });
await page.waitForTimeout(2600);

await legenda('Relatórios em CSV, Excel e PDF', 7000);
await page.evaluate(() => { location.hash = '#/relatorios'; });
await page.waitForTimeout(2000);

await legenda('Tudo funciona no celular', 7000);
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { location.hash = '#/cobrancas'; });
await page.waitForTimeout(2600);

await legenda('Demonstração isolada, dados fictícios, sem dados reais', 7000);

await context.close();
await browser.close();

const arquivos = fs.readdirSync(temp).filter((f) => f.endsWith('.webm'));
if (!arquivos.length) {
  console.error('O navegador não gerou o vídeo.');
  process.exit(1);
}
const destino = path.join(saida, 'demonstracao.webm');
fs.renameSync(path.join(temp, arquivos[0]), destino);
fs.rmSync(temp, { recursive: true, force: true });
console.log('Vídeo salvo em', destino);
