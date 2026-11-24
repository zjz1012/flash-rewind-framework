/** 验证卡片封面：DOM 数量、图片是否真正解码、首屏截图。 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const DIST = resolve('dist');
const OUT = resolve('verification/covers-raw');
mkdirSync(OUT, { recursive: true });
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.swf': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.xml': 'text/xml', '.txt': 'text/plain',
};
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const fp = resolve(join(DIST, p));
  if (!fp.startsWith(DIST) || !existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.gamecard');
const before = await page.evaluate(() => document.querySelectorAll('.cover-img').length);
await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.cover-img')];
  imgs.forEach((i) => { i.loading = 'eager'; });
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
});
const stats = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.cover-img')];
  return {
    total: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    src: imgs[0]?.getAttribute('src'),
  };
});
const genSrc = readFileSync(resolve('src/data/released.generated.ts'), 'utf-8');
const TOTAL = (genSrc.match(/id: "fl\d+"/g) || []).length;
const EXPECTED = TOTAL;
await page.screenshot({ path: join(OUT, 'home-with-covers.png'), fullPage: false });
console.log('DOM imgs:', before, '| loaded:', stats.loaded, '/', stats.total, '| expected:', EXPECTED, '| src:', stats.src);
console.log('pageerror:', errors.length ? errors.slice(0, 2) : 'none');
console.log(stats.loaded === EXPECTED && stats.total === EXPECTED && errors.length === 0 ? 'PASS' : 'FAIL');
await browser.close();
server.close();
