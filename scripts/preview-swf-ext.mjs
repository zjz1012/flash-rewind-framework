/**
 * 预览适配：内置静态预览服务有扩展名白名单，.swf 会被挡掉（404）。
 * Ruffle 按字节流解析 SWF（读 FWS/CWS/ZWS 头），不依赖后缀与 MIME。
 * 本脚本：
 *  1) 为每个 dist/games/*.swf 生成一份 xxx.swf.wasm 别名（后缀在白名单内）；
 *  2) 把 dist/assets/*.js 里的 games/xxx.swf 路径改指到 games/xxx.swf.wasm。
 * 原 .swf 保留，正常部署环境不受影响。仅用于本地预览，可重复运行（幂等）。
 */
import { copyFileSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gamesDir = join(root, 'dist', 'games');
const assetsDir = join(root, 'dist', 'assets');

const swfs = readdirSync(gamesDir).filter((f) => f.endsWith('.swf') && !f.endsWith('.swf.wasm'));
let aliasCount = 0;
for (const f of swfs) {
  const alias = join(gamesDir, f + '.wasm');
  if (!existsSync(alias)) {
    copyFileSync(join(gamesDir, f), alias);
    aliasCount++;
  }
}

let changed = 0;
for (const f of readdirSync(assetsDir).filter((x) => x.endsWith('.js'))) {
  const p = join(assetsDir, f);
  let s = readFileSync(p, 'utf-8');
  const before = s;
  for (const swf of swfs) {
    // 只替换带 games/ 前缀的路径，避免误伤其他同名字符串
    s = s.split(`games/${swf}`).join(`games/${swf}.wasm`);
  }
  if (s !== before) {
    writeFileSync(p, s);
    changed++;
  }
}
console.log(`SWF 别名: ${aliasCount} 个已创建（共 ${swfs.length} 款）`);
console.log(`JS 路径改写: ${changed} 个文件（games/*.swf -> games/*.swf.wasm）`);
