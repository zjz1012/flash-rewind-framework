/**
 * 验证「关于」弹窗里的开源引用地址与许可摘要可见且可点。
 * 自起自停本地静态服务，不依赖外部进程；用完即关。
 *   node scripts/verify_about.mjs [--shot path.png]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve('dist');
const PORT = 0;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-nav="about"]', { timeout: 10000 });
  await page.click('[data-nav="about"]');
  await page.waitForSelector('#overlay.open', { timeout: 5000 });

  const text = await page.textContent('#dialogBody');
  const url = 'github.com/zjz1012/flash-rewind-framework';
  const checks = {
    '弹窗含开源标题': text.includes('开源与许可'),
    '弹窗含 MIT 许可': text.includes('MIT') && text.includes('Apache-2.0'),
    '弹窗含项目地址': text.includes(url),
    '地址链接可点': await page.locator(`#dialogBody a[href*="${url}"]`).count() > 0,
  };

  const shotIdx = process.argv.indexOf('--shot');
  if (shotIdx > -1 && process.argv[shotIdx + 1]) {
    await page.screenshot({ path: process.argv[shotIdx + 1], fullPage: false });
  }

  for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  if (errors.length) console.log('PAGE ERRORS:', errors.join(' | '));
  const ok = Object.values(checks).every(Boolean) && errors.length === 0;
  console.log(ok ? '\nABOUT CREDIT: ALL PASS' : '\nABOUT CREDIT: FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
