/** UI 清理后功能回归：以普通用户视角走一遍主要交互。 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
const DIST = resolve('dist'), PORT = 4195;
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };

const genSrc = readFileSync(resolve('src/data/released.generated.ts'), 'utf-8');
const TOTAL = (genSrc.match(/id: "fl\d+"/g) || []).length;
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const cards0 = await page.locator('.gamecard').count();
check('首页渲染卡片', cards0 === TOTAL, `(${cards0})`);
const counter = await page.locator('.counter').innerText();
check('计数无孤儿0', !/\/\s*0/.test(counter) && counter.includes(String(TOTAL)), `(${counter})`);

// 搜索
await page.locator('#search').fill('2048');
await page.waitForTimeout(300);
const cardsS = await page.locator('.gamecard').count();
check('搜索过滤', cardsS > 0 && cardsS < TOTAL, `(${cardsS})`);
await page.locator('#search').fill('');
await page.waitForTimeout(200);

// 分类 chip
await page.locator('.chip', { hasText: '轻动作' }).click();
await page.waitForTimeout(300);
const cardsC = await page.locator('.gamecard').count();
check('分类筛选', cardsC > 0 && cardsC < 76, `(${cardsC})`);
await page.locator('.chip', { hasText: '全部' }).first().click();
await page.waitForTimeout(200);

// 收藏
await page.locator('.gamecard').first().click();
await page.waitForTimeout(400);
await page.locator('#favBtn').click();
await page.waitForTimeout(300);
check('详情收藏按钮', (await page.locator('#favBtn').innerText()).includes('已收藏'));
await page.locator('#closeDialog').click();
await page.waitForTimeout(200);
await page.locator('[data-nav=fav]').first().click();
await page.waitForTimeout(300);
check('收藏列表读取', (await page.locator('.gamecard').count()) >= 1);

// 设置开关
await page.locator('[data-nav=settings]').first().click();
await page.waitForTimeout(300);
await page.locator('#setMute').click();
await page.waitForTimeout(200);
check('设置静音开关', await page.locator('#setMute').evaluate((e) => e.classList.contains('on')));
await page.locator('#closeDialog').click();
await page.waitForTimeout(200);

// 详情开始游戏
await page.locator('[data-nav=all]').first().click();
await page.waitForTimeout(300);
await page.locator('.gamecard').first().click();
await page.waitForTimeout(400);
check('详情有开始游戏', (await page.locator('#playBtn').count()) === 1);
await page.locator('#playBtn').click();
await page.waitForTimeout(2500);
check('播放器加载', (await page.locator('ruffle-player').count()) >= 1);

// 导入页
await page.goto(`${BASE}/index.html#/local`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
check('导入页渲染', (await page.locator('#swfFile').count()) === 1);

console.log(results.join('\n'));
console.log('pageerror:', errs.length ? errs.join(' | ') : 'none');
console.log('SUMMARY:', results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' PASS');
await browser.close(); server.close();
