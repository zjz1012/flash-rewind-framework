/**
 * 原型验证：Ruffle 程序化键盘事件能否驱动答题类 SWF 的数字输入。
 * 依据 Ruffle 官方 programmatic_events 集成测试：
 *   1) player.focus() 让 Ruffle 获得焦点（否则忽略事件）
 *   2) KeyboardEvent(key/code/keyCode, bubbles, composed) 派发到 player 元素（非 window）
 * 自起自停临时服务，无后台常驻。
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

server.listen(0, '127.0.0.1', async () => {
  const PORT = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html#/play?id=${DEMO_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '00_title.png') });

  // 第一次点击：过 Ruffle 的橙色 click-to-play 遮罩（让 SWF 开始运行）
  await page.mouse.click(320, 267);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '0a_after_unmask.png') });
  // 第二次点击：标题页上的 Play 按钮（中心约 320,267）
  await page.mouse.click(320, 267);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '01_in_game.png') });

  // 抓一下此时 SWF 画面里是否有题目（截图即可，下面 ViewImage 人工看）
  // A) 真实键盘对照：连按几个数字 + Enter
  await page.keyboard.press('5'); await page.waitForTimeout(200);
  await page.keyboard.press('7'); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '02_real_keys.png') });

  // B) 程序化键盘：focus player 后派发到 player 元素
  const dispatch = async (key, code, keyCode) => {
    await page.evaluate(({ key, code, keyCode }) => {
      const rp = document.querySelector('ruffle-player');
      rp?.focus();
      rp?.shadowRoot?.querySelector('#container')?.focus?.();
      const opts = { key, code, keyCode, which: keyCode, bubbles: true, composed: true };
      rp?.dispatchEvent(new KeyboardEvent('keydown', opts));
      rp?.dispatchEvent(new KeyboardEvent('keyup', opts));
    }, { key, code, keyCode });
    await page.waitForTimeout(250);
  };
  for (const [k, c, n] of [['3','Digit3',51],['9','Digit9',57],['Enter','Enter',13]]) await dispatch(k, c, n);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '03_programmatic.png') });

  const names = ['00_title','01_in_game','02_real_keys','03_programmatic'];
  let prev = null;
  for (const n of names) {
    const b = readFileSync(path.join(OUT, n + '.png'));
    console.log(n, 'bytes', b.length, prev ? ('changed=' + !prev.equals(b)) : '(baseline)');
    prev = b;
  }
  console.log('page errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
  server.close();
});
