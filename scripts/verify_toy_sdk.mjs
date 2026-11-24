/**
 * B站 Toy SDK 门禁专项验证（Playwright + 注入 window.toy 桩）。
 *
 * 覆盖三条路径：
 * 1. 正式环境未关注：103 款锁定、弹关注框、直达链接不加载 SWF
 * 2. 正式环境已关注：全部解锁
 * 3. 本地环境（无 window.toy）：全部放行（由 verify_ui_regression 覆盖）
 * 另验证：二维码按钮、分享调用、云存档批量写入、横屏状态确认。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const DIST = resolve(process.env.DIST_DIR || 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.swf': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.xml': 'text/xml', '.txt': 'text/plain',
};
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  // 模拟 B站 Toy 路径：/toy/demo/* 映射到 dist 根目录，相对资源才能正常加载
  if (p.startsWith('/toy/demo/')) p = p.slice('/toy/demo'.length);
  if (p === '/' || p === '') p = '/index.html';
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

const DEMO_MID = process.env.VITE_AUTHOR_MID || '63650';
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function initScript(follow, viewerNick = '') {
  return `(() => {
    window.__follow = ${follow ? 'true' : 'false'};
    window.__viewerNick = ${JSON.stringify(viewerNick)};
    window.__toyCalls = [];
    window.__containerCb = null;
    window.toy = {
      isSupport: async () => true,
      navigate: async (r) => window.__toyCalls.push(['navigate', r]),
      getUserProfile: async () => ({ nickname: window.__viewerNick, avatar: '' }),
      getCloudStorage: async (keys) => {
        window.__cloud = window.__cloud || {};
        return Object.fromEntries((keys || []).filter(k => k in window.__cloud).map(k => [k, window.__cloud[k]]));
      },
      setCloudStorage: async (items) => {
        window.__cloud = Object.assign(window.__cloud || {}, items);
        window.__toyCalls.push(['setCloud', items]);
      },
      getAuthorRelation: async () => ({ status: 'ok', data: { isFollowing: window.__follow } }),
      getAuthorProfile: async () => ({ status: 'ok', data: { nickname: '示例作者', mid: 123456 } }),
      getQrCode: async () => ({ base64: '${QR}', url: 'https://www.bilibili.com/toy/demo/' }),
      share: async (r) => window.__toyCalls.push(['share', r]),
      onContainerChange: (cb) => {
        window.__containerCb = cb;
        cb({ orientation: 'portrait', immersive: false, changedFields: [] });
        return () => { window.__containerCb = null; };
      },
      setContainerMode: async (r) => {
        window.__toyCalls.push(['setContainerMode', r]);
        if (window.__containerCb) window.__containerCb({ ...r, changedFields: ['orientation', 'immersive'] });
      },
    };
  })();`;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- 场景 1：未关注 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // 阻断线上 SDK 脚本，避免它覆盖我们的桩
  await ctx.route('**/toy-sdk.js', (route) => route.abort());
  await ctx.addInitScript(initScript(false));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/toy/demo/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gamecard');

  const locked = await page.locator('.gamecard.locked').count();
  check('未关注：锁定卡片数 = 103', locked === 103, `实际 ${locked}`);
  check('未关注：前5款免费未被锁', await page.locator('.gamecard[data-id="fl001"].locked').count() === 0);

  await page.locator('.gamecard.locked').first().click();
  const unlockTitle = await page.locator('#dialogBody h2').textContent();
  check('锁定卡点击弹关注框', /关注 UP 主/.test(unlockTitle || ''), unlockTitle || '');
  check('关注框无开始游戏按钮', await page.locator('#playBtn').count() === 0);

  await page.locator('#gotoAuthorBtn').click();
  await page.waitForTimeout(200);
  const nav = await page.evaluate(() => window.__toyCalls.filter((x) => x[0] === 'navigate'));
  check('去关注调用 navigate(space) 且指向配置 mid', nav.length === 1 && nav[0][1].type === 'space' && nav[0][1].id === DEMO_MID, JSON.stringify(nav));

  // 直达锁定游戏不得加载 SWF
  await page.goto(`${BASE}/toy/demo/index.html#/play?id=fl044`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  check('锁定游戏直达不加载播放器', await page.locator('ruffle-player').count() === 0);
  check('锁定游戏直达弹关注框', /关注 UP 主/.test((await page.locator('#dialogBody h2').textContent()) || ''));

  // 已关注后重新验证
  await page.evaluate(() => { window.__follow = true; });
  await page.locator('#recheckFollowBtn').click();
  await page.waitForTimeout(300);
  check('重新验证后全部解锁', await page.locator('.gamecard.locked').count() === 0);

  // 免费款详情：二维码 + 分享
  await page.locator('.gamecard[data-id="fl001"]').click();
  check('详情出现扫码按钮', await page.locator('#qrGameBtn').count() === 1);
  await page.locator('#qrGameBtn').click();
  await page.waitForTimeout(250);
  check('二维码图已渲染', await page.locator('.qr-panel img').count() === 1);
  await page.locator('#qrBackBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#shareGameBtn').click();
  await page.waitForTimeout(200);
  const shares = await page.evaluate(() => window.__toyCalls.filter((x) => x[0] === 'share'));
  check('分享调用 share 且 path 合法', shares.length === 1 && /^index\.html\?play=fl001$/.test(shares[0][1].path), JSON.stringify(shares));

  // 收藏触发云写入（900ms 防抖）
  await page.locator('#favBtn').click();
  await page.waitForTimeout(1300);
  const clouds = await page.evaluate(() => window.__toyCalls.filter((x) => x[0] === 'setCloud'));
  check('收藏变更后批量写云存档', clouds.length >= 1 && 'fav' in clouds[0][1] && 'syncAt' in clouds[0][1]);

  check('未关注场景无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 场景 2：已关注 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await ctx.route('**/toy-sdk.js', (route) => route.abort());
  await ctx.addInitScript(initScript(true));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/toy/demo/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gamecard');
  const locked = await page.locator('.gamecard.locked').count();
  check('已关注：无锁定卡片', locked === 0, `实际 ${locked}`);
  await page.locator('.gamecard[data-id="fl044"]').click();
  check('已关注：可打开锁定款详情', await page.locator('#playBtn').count() === 1);

  // 横屏按钮 + 状态确认
  await page.locator('#playBtn').click();
  await page.waitForTimeout(500);
  check('横屏按钮出现', await page.locator('#orientBtn').count() === 1);
  await page.locator('#orientBtn').click();
  await page.waitForTimeout(250);
  const modes = await page.evaluate(() => window.__toyCalls.filter((x) => x[0] === 'setContainerMode'));
  check('横屏调用 setContainerMode(landscape+immersive)', modes.length === 1 && modes[0][1].orientation === 'landscape' && modes[0][1].immersive === true, JSON.stringify(modes));
  await ctx.close();
}

// ---- 场景 3：作者本人（未关注，但昵称 = 作者昵称）应当直接放行 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/toy-sdk.js', (route) => route.abort());
  await ctx.addInitScript(initScript(false, '示例作者'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/toy/demo/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gamecard');
  await page.waitForTimeout(400);
  const locked = await page.locator('.gamecard.locked').count();
  check('作者本人（昵称一致）即使未关注也全部解锁', locked === 0, `实际锁定 ${locked}`);
  await page.locator('.gamecard[data-id="fl044"]').click();
  check('作者本人可直接打开详情', await page.locator('#playBtn').count() === 1);
  check('作者本人场景无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- 场景 4：普通用户（昵称不同）不得因比对逻辑被误放行 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/toy-sdk.js', (route) => route.abort());
  await ctx.addInitScript(initScript(false, '路过的玩家'));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/toy/demo/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gamecard');
  await page.waitForTimeout(400);
  const locked = await page.locator('.gamecard.locked').count();
  check('普通用户昵称不同：仍然锁定 103 款', locked === 103, `实际 ${locked}`);
  await ctx.close();
}

// ---- 场景 5：昵称带全角波浪线/空格也要能命中（归一化） ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/toy-sdk.js', (route) => route.abort());
  await ctx.addInitScript(initScript(false, ' 示例作者～ '));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/toy/demo/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gamecard');
  await page.waitForTimeout(400);
  const locked = await page.locator('.gamecard.locked').count();
  check('昵称归一化（全角～ + 空格）仍识别为作者', locked === 0, `实际锁定 ${locked}`);
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
