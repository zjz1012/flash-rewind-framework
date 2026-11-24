/** 零图版（VITE_NO_IMAGES=1）验收：界面必须是纯文字列表，全程不请求任何图片。 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const DIST = resolve('dist-noimg');
const OUT = resolve('verification/noimg');
const PORT = 4197;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.swf': 'application/octet-stream' };

mkdirSync(OUT, { recursive: true });
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

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'],
});

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);

const genSrc = readFileSync(resolve('src/data/released.generated.ts'), 'utf-8');
const TOTAL = (genSrc.match(/id: "fl\d+"/g) || []).length;

// ---------- 桌面 ----------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
const imgReqs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
page.on('request', (r) => {
  const url = r.url();
  if (r.resourceType() === 'image' || /\.(jpe?g|png|webp|gif|svg|ico)(\?|$)/i.test(url)) imgReqs.push(url);
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const rows = await page.locator('.gamerow').count();
check('首页为列表行', rows === TOTAL, `(${rows}/${TOTAL})`);
const imgs = await page.locator('#app img').count();
check('首页无 img 元素', imgs === 0, `(${imgs})`);
const covers = await page.locator('.cover, .cover-img, .glyph').count();
check('首页无封面容器', covers === 0, `(${covers})`);
const gridBlock = await page.locator('.gamegrid').evaluate((el) => getComputedStyle(el).display);
check('列表容器为 block 排版', gridBlock === 'block', `(${gridBlock})`);
const lockedCount = await page.locator('.gamerow .rowlock').count();
// 本地非 Toy 环境按设计全部放行，所以这里应当没有锁定提示；锁定态只在 Toy 内未关注时出现
check('本地环境全部放行（无锁定行）', lockedCount === 0, `(${lockedCount})`);
await page.screenshot({ path: join(OUT, '01-desktop-list.png'), fullPage: false });
await page.screenshot({ path: join(OUT, '02-desktop-list-full.png'), fullPage: true });

// 详情弹窗
await page.locator('.gamerow').first().click();
await page.waitForTimeout(500);
const dlgOpen = await page.locator('#overlay.open').count();
check('详情弹窗可打开', dlgOpen === 1);
const dlgImgs = await page.locator('#dialogBody img').count();
check('详情弹窗无图片', dlgImgs === 0, `(${dlgImgs})`);
await page.screenshot({ path: join(OUT, '03-desktop-detail.png') });

// 搜索仍然可用
await page.locator('#closeDialog').click();
await page.waitForTimeout(200);
await page.locator('#search').fill('2048');
await page.waitForTimeout(350);
const sRows = await page.locator('.gamerow').count();
check('搜索过滤生效', sRows > 0 && sRows < TOTAL, `(${sRows})`);
await page.locator('#search').fill('');
await page.waitForTimeout(300);

check('无运行时报错', errs.length === 0, errs.join(' | '));
check('全程未请求图片', imgReqs.length === 0, imgReqs.slice(0, 3).join(' '));

// ---------- 移动端 ----------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
await mp.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await mp.waitForTimeout(1200);
const mRows = await mp.locator('.gamerow').count();
check('手机端同样为列表', mRows === TOTAL, `(${mRows})`);
const mImgs = await mp.locator('#app img').count();
check('手机端无 img 元素', mImgs === 0, `(${mImgs})`);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('手机端无横向溢出', overflow <= 1, `(${overflow}px)`);
await mp.screenshot({ path: join(OUT, '04-mobile-list.png') });

await browser.close();
server.close();

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log('截图目录：' + OUT); process.exitCode = 1; }
