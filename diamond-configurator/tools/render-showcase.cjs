/**
 * Renders public/showcase/<id>.jpg for every design in src/showcase/collections.ts
 * with the real engine (?capture=<id>).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm i -D playwright && npx playwright install chromium   # once
 *   node tools/render-showcase.cjs [http://localhost:4173/]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://localhost:4173/';
const src = fs.readFileSync(path.join(__dirname, '../src/showcase/collections.ts'), 'utf8');
const ids = [...src.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const out = path.join(__dirname, '../public/showcase');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  for (const id of ids) {
    await page.goto(`${base}?capture=${id}&quality=high`, { waitUntil: 'load' });
    await page.waitForSelector('body[data-ready="1"]', { timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `${id}.jpg`), type: 'jpeg', quality: 88, timeout: 180000 });
    console.log('rendered', id);
  }
  await browser.close();
})();
