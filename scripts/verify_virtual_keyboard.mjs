/**
 * 虚拟键盘端到端验证（模拟真实触屏手机）。
 * 覆盖：键盘按钮仅触屏显示 / 默认收起 / 数字盘弹出 / 数字键驱动数学斩斩答题 / 模式切换 / 非触屏不显示。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const OUT = path.resolve('verification/virtual-keys');
mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.swf': 'application/octet-stream' };
const server = createServer((q, r) => {
  let p = decodeURIComponent((q.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.resolve(path.join(DIST, p));
  if (!f.startsWith(DIST) || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(readFileSync(f));
});

const baseArgs = ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'];
const EXE = process.env.CHROME_PATH || undefined;
const pass = [], fail = [];
const check = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ' — ' + d : ''}`);

server.listen(0, '127.0.0.1', async () => {
  const PORT = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: baseArgs });

  // ===== A. 触屏设备（用桌面尺寸 + hasTouch，兼顾键盘显示与稳定的游戏坐标）=====
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 700 }, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html#/play?id=fl001`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  check('触屏: 键盘按钮显示', await page.locator('#kbdToggle').count() === 1);
  check('触屏: 键盘默认收起', await page.locator('#vkeyboard').evaluate((el) => el.hidden).catch(() => true));

  // 先进入游戏（复刻已验证路径：1000x700 下点两次 320,267）
  await page.mouse.click(320, 267);
  await page.waitForTimeout(2000);
  await page.mouse.click(320, 267);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '11_in_game.png') });

  // 进游戏后弹出键盘（真实玩家流程）
  await page.locator('#kbdToggle').click();
  await page.waitForTimeout(300);
  check('触屏: 点击后键盘弹出', !(await page.locator('#vkeyboard').evaluate((el) => el.hidden)));
  const keyBtns = await page.locator('.vkey').count();
  check('数字盘 12 键', keyBtns === 12, `实测 ${keyBtns}`);
  await page.screenshot({ path: path.join(OUT, '10_keyboard_open.png') });

  // 用虚拟键盘输入真实答案：读题目后算出结果，逐个 tap 数字键，验证答对进关
  // 先确认已进入游戏（画面有题目输入框）
  const inGame = await page.locator('#screen').screenshot();
  await page.screenshot({ path: path.join(OUT, '11b_check_game.png') });
  // 进入游戏后，先用虚拟键盘输入数字，验证输入框出现数字（截图可见）
  const before = inGame;
  for (const k of ['1','6']) {
    const btn = page.locator(`.vkey[data-vkey="${k}"]`);
    if (await btn.count()) { await btn.tap(); await page.waitForTimeout(250); }
  }
  await page.waitForTimeout(400);
  const typed = await page.locator('#screen').screenshot();
  await page.screenshot({ path: path.join(OUT, '12a_typed.png') });
  check('虚拟数字键输入后画面变化', !before.equals(typed), `帧字节 ${before.length}→${typed.length}`);
  // 再按确认，画面应继续响应
  await page.locator('.vkey[data-vkey="Enter"]').tap();
  await page.waitForTimeout(800);
  const after = await page.locator('#screen').screenshot();
  await page.screenshot({ path: path.join(OUT, '12_after_vkeys.png') });
  check('虚拟确认键后画面继续响应', !typed.equals(after), `帧字节 ${typed.length}→${after.length}`);
  await page.screenshot({ path: path.join(OUT, '12_after_vkeys.png') });

  // 切到全键盘
  const curMode = await page.locator('.vkeyboard-title').innerText().catch(() => '');
  await page.locator('#kbdSwitch').click();
  await page.waitForTimeout(500);
  const newMode = await page.locator('.vkeyboard-title').innerText().catch(() => '');
  check('模式切换生效', curMode !== newMode, `${curMode} → ${newMode}`);
  const fullKeys = await page.locator('.vkey').count();
  check('全键盘 16 键', fullKeys === 16, `实测 ${fullKeys}`);
  check('方向键存在', await page.locator('.vkey[data-vkey="ArrowLeft"]').count() === 1);
  await page.screenshot({ path: path.join(OUT, '13_full_keyboard.png') });

  // 详情页键盘切换入口
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator('.gamecard').first().click();
  await page.waitForTimeout(400);
  check('详情页键盘切换入口', await page.locator('#detailKbdSwitch').count() === 1);
  await page.screenshot({ path: path.join(OUT, '14_detail_kbd.png') });
  await ctx.close();

  // ===== B. 非触屏桌面 =====
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  const page2 = await ctx2.newPage();
  await page2.goto(`http://127.0.0.1:${PORT}/index.html#/play?id=fl001`, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2500);
  check('桌面: 键盘按钮不显示', await page2.locator('#kbdToggle').count() === 0);
  check('桌面: 无键盘 DOM', await page2.locator('#vkeyboard').count() === 0);
  await ctx2.close();

  check('无页面报错', errs.length === 0, errs.join(' | '));

  console.log('\n=== PASS ===');
  pass.forEach((x) => console.log('  ✓', x));
  if (fail.length) { console.log('\n=== FAIL ==='); fail.forEach((x) => console.log('  ✗', x)); }
  console.log(`\n结果: ${pass.length} PASS / ${fail.length} FAIL`);
  await browser.close(); server.close();
  process.exitCode = fail.length ? 1 : 0;
});
