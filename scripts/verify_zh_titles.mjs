/**
 * 中文标题验证：卡片中文主标题 + 英文原名副标题、详情英文原版标记、中文搜索命中。
 * 进程内起临时 HTTP 服务 serve dist（别名版），自起自停，无后台常驻。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.swf': 'application/octet-stream' };
const server = createServer((q, r) => {
  let p = decodeURIComponent((q.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.resolve(path.join(DIST, p));
  if (!f.startsWith(DIST) || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(readFileSync(f));
});

server.listen(0, '127.0.0.1', async () => {
  const PORT = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const pass = [], fail = [];
  const check = (name, cond, detail) => (cond ? pass : fail).push(`${name}${detail ? ' — ' + detail : ''}`);

  // 1. 首屏卡片：中文主标题 + 英文副标题
  const cards = await page.locator('.gamecard').count();
  check('卡片总数 76', cards === 76, `实测 ${cards}`);
  const cnNames = await page.locator('.gamecard .cardname').allInnerTexts();
  const enNames = await page.locator('.gamecard .cardname-en').allInnerTexts();
  const hasCn = cnNames.filter((s) => /[一-龥]/.test(s)).length;
  check('卡片中文主标题', hasCn >= 70, `${hasCn}/${cnNames.length} 含中文`);
  check('卡片英文原名副标题', enNames.length >= 70, `${enNames.length} 张带英文副标题`);
  check('首款中文=数学斩斩', cnNames[0] === '数学斩斩', cnNames[0]);
  check('首款英文=Math Slash', enNames[0] === 'Math Slash', enNames[0]);

  // 2. 详情弹窗：中文标题 + 英文原版标记 + 英文原名
  await page.locator('.gamecard').first().click();
  await page.waitForTimeout(400);
  const h2 = await page.locator('#dialogBody h2').innerText();
  const lang = await page.locator('#dialogBody .lang-tag').count();
  const dlgEn = await page.locator('#dialogBody .dlg-en').innerText().catch(() => '');
  check('详情中文标题', h2.includes('数学斩斩'), h2);
  check('英文原版标记', lang === 1, `count=${lang}`);
  check('详情英文原名', dlgEn === 'Math Slash', dlgEn);

  // 3. 关闭弹窗，中文搜索命中
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const search = page.locator('#searchInput, .search input, input[type=search]').first();
  if (await search.count()) {
    await search.fill('打砖块');
    await page.waitForTimeout(400);
    const hit = await page.locator('.gamecard .cardname').allInnerTexts();
    check('中文搜索「打砖块」命中', hit.length >= 1 && hit.every((s) => /砖块/.test(s)), `命中 ${hit.length}: ${hit.join(',')}`);
    await search.fill('Math Slash');
    await page.waitForTimeout(400);
    const hitEn = await page.locator('.gamecard .cardname').allInnerTexts();
    check('英文搜索仍可用', hitEn.length === 1 && hitEn[0] === '数学斩斩', `命中 ${hitEn.join(',')}`);
    await search.fill('');
    await page.waitForTimeout(300);
  } else {
    check('搜索框存在', false, '未找到');
  }

  // 4. 播放页中文标题
  await page.goto(`http://127.0.0.1:${PORT}/index.html#/play?id=fl001`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const playTitle = await page.locator('.playbar .title').innerText().catch(() => '');
  check('播放页中文标题', playTitle === '数学斩斩', playTitle);

  check('无页面报错', errs.length === 0, errs.join(' | '));

  console.log('\n=== PASS ===');
  pass.forEach((x) => console.log('  ✓', x));
  if (fail.length) {
    console.log('\n=== FAIL ===');
    fail.forEach((x) => console.log('  ✗', x));
  }
  console.log(`\n结果: ${pass.length} PASS / ${fail.length} FAIL`);
  await browser.close();
  server.close();
  process.exitCode = fail.length ? 1 : 0;
});
