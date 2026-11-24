/** 最终验证：UI 统计数字 + 抽测游戏加载。进程内临时服务 serve 别名版 dist。 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
const DIST = resolve('dist'), PORT = 4192;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.swf': 'application/octet-stream' };
const server = createServer((req, res) => {
  let p; try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const fp = resolve(join(DIST, p));
  if (!fp.startsWith(DIST) || !existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const notice = await page.locator('.notice').innerText();
const sidefoot = await page.locator('.sidefoot').innerText();
const cards = await page.locator('.gamecard').count();
const chips = await page.locator('.chip').allInnerTexts();
console.log('NOTICE:', notice.replace(/\s+/g, ' ').trim());
console.log('SIDEFoot:', sidefoot.replace(/\s+/g, ' ').trim());
console.log('CARDS:', cards, 'CHIPS:', chips.join('|'));
await page.screenshot({ path: 'verification/final_ui_76.png', fullPage: false });
// 抽测 075 加载
await page.goto(`${BASE}/index.html#/play?id=fl075`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const rp = page.locator('ruffle-player').first();
await rp.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
await page.waitForTimeout(4000);
const box = await rp.boundingBox();
if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(2500); }
await rp.screenshot({ path: 'verification/final_fl075.png', timeout: 6000 }).catch(() => {});
console.log('075 player count:', await rp.count());
await browser.close(); server.close();
