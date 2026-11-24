#!/usr/bin/env node
/**
 * 从 npm 包 @ruffle-rs/ruffle 复制 selfhosted 运行时到 public/ruffle/。
 *
 * 为什么不直接把 ruffle.js + wasm 入库：
 *   - 两个 wasm 合计约 29MB，二进制大文件不适合 git；
 *   - npm 包里已有完全一致、带哈希的官方构建产物。
 *
 * 用法：npm install 后跑一次 `node scripts/setup-ruffle.mjs`（package.json 的 postinstall 会自动跑）。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'node_modules/@ruffle-rs/ruffle');
const outDir = resolve(root, 'public/ruffle');

if (!existsSync(srcDir)) {
  console.error('找不到 node_modules/@ruffle-rs/ruffle，请先 npm install');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter(
  (f) => f === 'ruffle.js' || f.endsWith('.wasm'),
);
for (const f of files) {
  copyFileSync(join(srcDir, f), join(outDir, f));
  console.log('copied', f);
}
console.log(`Ruffle 运行时就绪：${outDir}（${files.length} 个文件）`);
