#!/usr/bin/env node
/**
 * 分批试审构建
 *   VITE_COVER_BATCH=N   首页顺序前 N 款用真实截图（其余用自制标题卡）
 *   VITE_COVER_SKIP=a-b  在 N 的范围内跳过这些位次（1 起，逗号分隔，可写 31-60,75）
 *
 * 用法：
 *   node scripts/build-batch.mjs 30              → 前 30 真图
 *   node scripts/build-batch.mjs 60              → 前 60 真图
 *   node scripts/build-batch.mjs 108 --skip=31-60 → 除 31-60 外全部真图
 *
 * 构建完会自动删掉产物里用不到的原封面，然后调用 pack_package.py 打包。
 * 加 --no-pack 可只构建不打包。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const batchArg = args.find((a) => !a.startsWith('--')) ?? '30';
const skipArg = (args.find((a) => a.startsWith('--skip=')) ?? '').split('=')[1] ?? '';

const batch = Math.max(0, Math.floor(Number(batchArg)));
if (!Number.isFinite(batch)) {
  console.error('用法：node scripts/build-batch.mjs <数量> [--skip=31-60] [--no-pack]');
  process.exit(2);
}

function parseSkip(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return out;
}

const skip = parseSkip(skipArg);
const outDir = join('dist-batch', `batch-${batch}${skipArg ? `-skip-${skipArg.replace(/,/g, '_')}` : ''}`);
const tag = `batch${batch}${skipArg ? `-skip${skipArg.replace(/,/g, '_')}` : ''}`;
const env = { ...process.env, VITE_COVER_BATCH: String(batch), VITE_COVER_SKIP: skipArg };

function run(label, cmd, cmdArgs) {
  console.log(`\n[${tag}] ${label}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[${tag}] 失败：${label}（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

const genSrc = readFileSync('src/data/released.generated.ts', 'utf-8');
const ids = [...genSrc.matchAll(/id: "(fl\d+)"/g)].map((m) => m[1]);
const keep = new Set(
  ids.slice(0, batch).filter((_, i) => !skip.has(i + 1))
);

run('类型检查', 'npx', ['tsc', '--noEmit']);
run('构建', 'npx', ['vite', 'build', '--outDir', outDir]);

const coversDir = join(outDir, 'covers');
let removed = 0;
if (existsSync(coversDir)) {
  for (const f of readdirSync(coversDir)) {
    const gid = f.replace(/\.jpg$/i, '');
    if (!keep.has(gid)) {
      rmSync(join(coversDir, f), { force: true });
      removed++;
    }
  }
}

console.log(`\n[${tag}] 完成：${outDir}`);
console.log(`  真实封面 ${keep.size}/${ids.length} 款；已删除 ${removed} 张未使用的原封面`);

if (!args.includes('--no-pack')) {
  console.log(`\n[${tag}] 打包`);
  const r = spawnSync('python', ['scripts/pack_package.py', `--dist=${outDir}`, `--tag=${tag}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
