#!/usr/bin/env node
/**
 * 零图版构建：VITE_NO_IMAGES=1 + 独立输出目录 dist-noimg。
 * 用途：审核判定实验——产物里不含任何封面图，界面为纯文字列表。
 * 不会覆盖正常版 dist/，两版可以同时存在、分别打包。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = 'dist-noimg';
const env = { ...process.env, VITE_NO_IMAGES: '1' };

function run(label, cmd, args) {
  console.log(`\n[noimg] ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[noimg] 失败：${label}（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

run('类型检查', 'npx', ['tsc', '--noEmit']);
run('构建（输出到 dist-noimg）', 'npx', ['vite', 'build', '--outDir', outDir]);

const covers = join(root, outDir, 'covers');
if (existsSync(covers)) {
  rmSync(covers, { recursive: true, force: true });
  console.log(`[noimg] 已剔除 ${outDir}/covers（零图版不携带任何封面文件）`);
}
console.log('\n[noimg] 完成');
