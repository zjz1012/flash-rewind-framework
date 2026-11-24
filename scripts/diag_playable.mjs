/**
 * 逐款实测：进程内起临时静态服务器 serve dist，Playwright 真实点击进入游戏，
 * 每款截两帧。像素判定交给 analyze_playable.py。
 * 用法: node scripts/diag_playable.mjs [startIdx] [endIdx]
 *   endIdx 不含。例: node scripts/diag_playable.mjs 0 40
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const DIST = resolve('dist');
const OUT = resolve('verification/playtest');
mkdirSync(OUT, { recursive: true });
const PORT = 4188;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.swf': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.xml': 'text/xml', '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const fp = resolve(join(DIST, p));
  if (!fp.startsWith(DIST) || !existsSync(fp)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

const gen = readFileSync('src/data/released.generated.ts', 'utf-8');
const ids = [...gen.matchAll(/id: "(fl\d+)"/g)].map((m) => m[1]);
const start = Number(process.argv[2] ?? 0);
const end = Number(process.argv[3] ?? ids.length);
const batch = ids.slice(start, end);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*', '--autoplay-policy=no-user-gesture-required'],
});

const results = [];
for (let i = 0; i < batch.length; i++) {
  const id = batch[i];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad404 = [];
  const errors = [];
  page.on('response', (r) => { if (r.status() >= 400) bad404.push(`${r.status()} ${r.url().split('/').pop()}`); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 80)));
  let ok = false;
  try {
    await page.goto(`${BASE}/index.html#/play?id=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    if (await page.locator('#playBtn').count()) await page.locator('#playBtn').click().catch(() => {});
    const rp = page.locator('ruffle-player').first();
    await rp.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2200);
    const box = await rp.boundingBox();
    const cx = box ? box.x + box.width / 2 : 640;
    const cy = box ? box.y + box.height / 2 : 400;
    // 真实点击三次：唤醒 click-to-play、二次开场、部分游戏菜单确认
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(250);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(1400);
    const target = (await rp.count()) ? rp : page.locator('#screen').first();
    await target.screenshot({ path: join(OUT, `${id}_1.png`), timeout: 6000 });
    await page.waitForTimeout(1300);
    await target.screenshot({ path: join(OUT, `${id}_2.png`), timeout: 6000 });
    ok = true;
  } catch (e) {
    errors.push(String(e).slice(0, 100));
  }
  results.push({ id, shot: ok, bad404, errors });
  console.log(`${String(start + i + 1).padStart(2)}/${ids.length} ${id} ${ok ? 'shot' : 'FAIL'} 404=${bad404.length} err=${errors.length}`);
  await ctx.close();
}
await browser.close();
server.close();

const rpath = join(OUT, `result_${start}_${end}.json`);
writeFileSync(rpath, JSON.stringify(results, null, 1));
console.log('DONE', rpath);
