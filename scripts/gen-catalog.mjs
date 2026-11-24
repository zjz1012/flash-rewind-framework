/**
 * 从 content/下载接入清单.csv 生成 src/data/released.generated.ts。
 * 每个已下载 SWF 对应一个 GameEntry；sizeBytes/sha256 从真实文件重算，不信任 CSV。
 * 用法: node scripts/gen-catalog.mjs
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const zlibSync = (b) => inflateSync(b);
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = resolve(root, 'content/下载接入清单.csv');

function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field.replace(/\r$/, '')); rows.push(cur); cur = []; field = ''; }
    else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  const head = rows.shift().map((h) => h.replace(/^\uFEFF/, ''));
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

if (!existsSync(csvPath)) {
  console.error('缺少 content/下载接入清单.csv，请先运行 download_games.py');
  process.exit(1);
}
const rows = parseCSV(readFileSync(csvPath, 'utf-8'));

// 玩法分类 → 控制档位 / 触屏预设
function classify(r) {
  const s = (r['手机操作预估'] || '') + ' ' + (r['玩法分类'] || '');
  if (/画线|拖拽|拖动/.test(s)) return { control: 'drag', preset: 'mouse' };
  if (/单键/.test(s)) return { control: 'one', preset: 'one' };
  if (/少量键|方向|动作|平台/.test(s)) return { control: 'two', preset: 'mouse' };
  return { control: 'mouse', preset: 'mouse' }; // 点击/滑动默认指针直传
}
function genresOf(r) {
  return (r['玩法分类'] || '休闲').split(/[\/、]/).map((x) => x.trim()).filter(Boolean);
}
function waveOf(r) {
  const b = r['规划批次'] || '';
  if (b.includes('第一批')) return 1;
  if (b.includes('第二批')) return 2;
  return 3;
}
function jsonStr(s) { return JSON.stringify(String(s ?? '')); }

/**
 * 展示标题清洗：去掉来源站 / 归档版本 / 语言版本这类"整理者备注"，
 * 只保留玩家真正需要的游戏名。源文件与 URL 不动，避免影响已下载 SWF 的引用。
 * 来源站标记用 SITE_MARKS 配置（可用 SITE_MARKS 环境变量覆盖，逗号分隔）。
 */
const SITE_MARKS = String(process.env.SITE_MARKS || '4399,7k7k,3366,2144,17yy')
  .split(',').map((x) => x.trim()).filter(Boolean);
const MARKS_PATTERN = SITE_MARKS.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
function cleanDisplayTitle(title) {
  let out = String(title ?? '');
  if (MARKS_PATTERN) {
    out = out
      .replace(new RegExp(`[·•・]\\s*(?:${MARKS_PATTERN})[^（(]*$`, 'i'), '')
      .replace(new RegExp(`[（(][^）)]*(?:${MARKS_PATTERN}|国内流行)[^）)]*[）)]`, 'gi'), '');
  }
  return out.replace(/[（(]\s*(?:旧版|存档版|中文Flash(?:版)?|Flash)\s*[）)]/gi, '').trim();
}

/**
 * 实测受限的 SWF 应从清单中物理剔除。若保留受限项，可在 content/实测结果.csv
 * 标为「受限」，本脚本会据此写入 blockReason 并在 UI 上标灰。
 */
const TEST_RESULT_PATH = resolve(root, 'content/实测结果.csv');
const playability = new Map();
if (existsSync(TEST_RESULT_PATH)) {
  for (const line of readFileSync(TEST_RESULT_PATH, 'utf-8').split(/\r?\n/).slice(1)) {
    const m = line.match(/^(fl?)0*(\d+),/);
    if (!m) continue;
    const parts = line.split(',');
    if (parts[1] === '受限') playability.set(`fl${m[2].padStart(3, '0')}`, parts[2]);
  }
}

const entries = [];
/** 来源信息单独落盘（content/ 不进打包产物），避免外链和第三方站名被写进 bundle */
const sources = [];
for (const r of rows) {
  const file = r['本地文件'];
  // Toy 平台只服务白名单后缀，`.swf` 会被整包丢弃（线上实测 404）。
  // 因此落盘与引用统一改成 `<原名>.swf.data`，文件内容不变，Ruffle 按字节读、不看后缀。
  const packedName = file.endsWith('.data') ? file : `${file}.data`;
  const p = resolve(root, 'public/games', packedName);
  if (!existsSync(p)) { console.error('MISSING SWF:', packedName); continue; }
  const buf = readFileSync(p);
  const sig = buf.subarray(0, 3).toString('ascii');
  if (!['FWS', 'CWS', 'ZWS'].includes(sig)) { console.error('BAD SIG:', file, sig); continue; }
  const size = buf.length;
  const sha = createHash('sha256').update(buf).digest('hex');
  const { control, preset } = classify(r);
  // 扫描 SWF（含 CWS 解压后）中的典型外部资源引用
  let raw = buf;
  if (buf.subarray(0, 3).toString('ascii') === 'CWS' && buf.length > 8) {
    try { raw = Buffer.concat([buf.subarray(0, 8), zlibSync(buf.subarray(8))]); } catch { raw = buf; }
  }
  const deps = [];
  if (raw.includes(Buffer.from('levels.txt'))) deps.push('levels.txt');
  if (raw.includes(Buffer.from('Defaults.xml'))) deps.push('data/Defaults.xml');
  if (raw.includes(Buffer.from('.mp3'))) deps.push('外部 mp3 音乐');
  const id = `fl${r['序号']}`;
  const title = cleanDisplayTitle(r['游戏名称']);
  const src = r['直达URL'] || '';
  const author = extractAuthor(src, r['来源仓库'] || '');
  entries.push(`  {
    id: ${jsonStr(id)},
    title: ${jsonStr(title)},
    author: ${jsonStr(author)},
    genres: ${JSON.stringify(genresOf(r))},
    wave: ${waveOf(r)},
    control: ${jsonStr(control)},
    preset: ${jsonStr(preset)},
    aspectRatio: 4 / 3,
    swfPath: ${jsonStr('games/' + packedName)},
    sizeBytes: ${size},
    sha256: ${jsonStr(sha)},
    compatibility: {
      ruffleVersion: '0.8.0',
      android: 'pending', ios: 'pending', desktop: 'pending', saveSupport: 'unknown',
    },
    externalDeps: ${JSON.stringify(deps)},
    ${playability.has(id) ? `blockReason: ${jsonStr(playability.get(id))},` : ''}
    status: 'released',
  }`);
  sources.push({ id, title, author, sourceUrl: src, license: r['许可'] || '待逐款复核' });
}

const out = `// 自动生成，勿手改。来源: scripts/gen-catalog.mjs + content/下载接入清单.csv
import type { GameEntry } from '../types';

export const releasedGames: GameEntry[] = [
${entries.join(',\n')}
];
`;
writeFileSync(resolve(root, 'src/data/released.generated.ts'), out, 'utf-8');
writeFileSync(
  resolve(root, 'content/sources-manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, items: sources }, null, 2),
  'utf-8',
);
console.log(`生成 released.generated.ts: ${entries.length} 款（来源信息已剥离到 content/sources-manifest.json）`);

function extractAuthor(url, repo) {
  // GitHub raw URL: github.com/OWNER/REPO/... → 取 OWNER
  const m = url.match(/github\.com\/([^\/]+)\//i);
  if (m) return m[1];
  const t = repo.match(/'([^']+)'/);
  if (t) return t[1].split('/')[0];
  return '未知作者';
}
