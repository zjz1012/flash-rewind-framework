/**
 * 验证「正式包」本身能否直接跑：解包后的目录起静态服务 → 真机路径 /toy/<slug>/。
 * 与 verify_toy_sdk.mjs 的分工：那个测 SDK 门禁逻辑，这个测包内容完整性（无预览别名也能加载 SWF）。
 *
 * 用法：node scripts/verify_package.mjs dist-packages/_check [端口]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'dist-packages/_check');
const PORT = Number(process.argv[3] ?? 0);
const SLUG = '/toy/flash-rewind';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.swf': 'application/x-shockwave-flash', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('ERROR: 目录里没有 index.html:', ROOT);
  process.exit(2);
}

const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p.startsWith(SLUG + '/')) p = p.slice(SLUG.length);
  if (p === '/') p = '/index.html';
  const fp = resolve(join(ROOT, p));
  if (!fp.startsWith(ROOT) || !existsSync(fp) || !statSync(fp).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${SLUG}/index.html`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// 本机验证环境访问不到 s1.hdslb.com（离线上传包内容为主），SDK 挂起会拖住入口脚本，
// 这里直接 abort —— 等价于「SDK 加载失败」场景：应用必须仍能启动（无 SDK 时按放行处理）。
await ctx.route('**/toy-sdk.js', (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
const notFound = [];
const aliasHits = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // 被主动 abort 的 SDK 请求会报 ERR_FAILED，属预期，不计入
  if (/ERR_FAILED/.test(t)) return;
  errors.push('console: ' + t);
});
page.on('response', (r) => {
  const u = r.url();
  if (r.status() === 404) notFound.push(u.split('/').pop());
  if (/\.swf\.wasm($|\?)/.test(u)) aliasHits.push(u.split('/').pop());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.gamecard', { timeout: 20000 });
await page.waitForTimeout(1200);

const cards = await page.locator('.gamecard').count();
check('首页卡片数 = 108', cards === 108, `实际 ${cards}`);

// 卡片封面是 loading=lazy，首屏只会解码可见那批，这里强制全量解码
await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.cover-img')];
  imgs.forEach((i) => { i.loading = 'eager'; });
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
});
const covers = await page.evaluate(() =>
  [...document.querySelectorAll('.cover-img')].filter((i) => i.complete && i.naturalWidth > 0).length
);
check('封面全部解码 = 108', covers === 108, `实际 ${covers}`);

// 打开一款游戏，走真实 .swf 请求（包内没有 .swf.wasm 别名）
const swfResponses = [];
page.on('response', (r) => {
  if (/\.swf(\.data)?($|\?)/.test(r.url())) swfResponses.push({ url: r.url().split('/').pop(), status: r.status() });
});

await page.goto(`${BASE}#/play?id=fl001`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const playerCount = await page.locator('ruffle-player').count();
check('播放器已挂载', playerCount === 1, `ruffle-player=${playerCount}`);

const swfOk = swfResponses.some((r) => r.status === 200);
check('SWF 请求 200', swfOk, swfResponses.map((r) => `${r.url}:${r.status}`).join(', ') || '未捕获');

// Ruffle 内部分辨率：真实加载成功后 canvas 会有非零尺寸像素数据
const painted = await page.evaluate(() => {
  const el = document.querySelector('ruffle-player');
  const canvas = el?.shadowRoot?.querySelector('canvas');
  if (!canvas) return { ok: false, reason: 'no canvas' };
  return { ok: canvas.width > 0 && canvas.height > 0, w: canvas.width, h: canvas.height };
});
check('Ruffle canvas 有尺寸', painted.ok, JSON.stringify(painted));

check('包内未请求 .swf.wasm 别名', aliasHits.length === 0, aliasHits.slice(0, 3).join(', '));
check('无 404 资源', notFound.length === 0, notFound.slice(0, 5).join(', '));
check('无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'verification/package-play.png' });
await browser.close();
server.close();

const pass = results.filter((r) => r.ok).length;
console.log(`SUMMARY: ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
