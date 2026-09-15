// Smoke-перевірка в headless-браузері: імпортує сторінку і ловить будь-які
// помилки консолі/винятки. Якщо Playwright не встановлено — скрипт НЕ падає,
// а друкує "SKIPPED" (щоб CI без браузера не ламався). Встановлення:
//   npm i -D playwright && npx playwright install chromium
import { launchIfAvailable } from './smoke.helper.mjs';

const URL = process.env.SMOKE_URL || 'https://olehcheff.github.io/woodstove2/';

const result = await launchIfAvailable();
if (!result) {
  console.log('SMOKE SKIPPED — Playwright не встановлено (npm i -D playwright && npx playwright install chromium)');
  process.exit(0);
}

const { browser } = result;
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + (err && err.message)));
  await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
  // Дати модулям виконатись і 3D збудуватись.
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    canvas: !!document.querySelector('#canvas-container canvas'),
    width: document.querySelector('#canvas-container canvas')?.width || 0,
    hasKpi: (document.getElementById('m-kw')?.textContent || '').trim().length > 0 && document.getElementById('m-kw').textContent !== '—',
  }));
  if (!state.canvas || state.width === 0) { errors.push('no WebGL canvas / zero size'); }
  if (!state.hasKpi) { errors.push('KPI not rendered (m-kw empty)'); }
  if (errors.length) {
    failed = true;
    console.error('SMOKE FAILED:');
    for (const e of errors) console.error('  - ' + e);
  } else {
    console.log('SMOKE PASSED — canvas', state.width + 'px, KPI rendered, no console errors');
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
