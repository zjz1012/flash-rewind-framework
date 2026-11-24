import type { Candidate, GameEntry } from '../types';
import { releasedGames as generated } from './released.generated';

/**
 * 候选展示池（待接入项）。示例仓库默认为空。
 *
 * 设计上刻意不 import 带外链的种子清单：来源 URL / 归档仓库地址一旦被打进 bundle，
 * 平台审核会读到站外链接。来源与授权信息应统一放在 content/ 下的清单里，不进打包产物。
 */
export const candidates: Candidate[] = [];

/** 真正待核验的候选数 */
export const PENDING_COUNT = candidates.length;

/**
 * 正式可玩清单：从 content/下载接入清单.csv 自动生成（scripts/gen-catalog.mjs）。
 * 仅含真实下载到 public/games/ 且签名/大小校验通过的 SWF。
 */
export const releasedGames: GameEntry[] = generated;

/** 中文译名（展示用，完整 76 款）——见 title-zh.ts */
export { displayTitle, searchTitles, TITLE_ZH } from './title-zh';

/**
 * 封面分批试审：VITE_COVER_BATCH=N 表示首页顺序前 N 款用真实截图，
 * 其余全部用程序生成的标题卡（public/covers-card/）。
 * 默认 = 全部真实封面，保持正常版行为不变。
 * 用法：npm run pack:batch -- 30 / 60 / 108
 */
const rawBatch = Number(import.meta.env.VITE_COVER_BATCH ?? releasedGames.length);
export const COVER_BATCH = Number.isFinite(rawBatch)
  ? Math.max(0, Math.min(releasedGames.length, Math.floor(rawBatch)))
  : releasedGames.length;

/** VITE_COVER_SKIP=31-60 或 31-60,75：按首页顺序跳过这些位次（1 起），不接入真实封面 */
function parseSkip(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return out;
}

export const COVER_SKIP = parseSkip(String(import.meta.env.VITE_COVER_SKIP ?? ''));
export const REAL_COVER_IDS = new Set(
  releasedGames.filter((_, i) => i < COVER_BATCH && !COVER_SKIP.has(i + 1)).map((g) => g.id)
);

export function findCandidate(id: string): Candidate | undefined {
  return candidates.find((g) => g.id === id);
}
export function findReleased(id: string): GameEntry | undefined {
  return releasedGames.find((g) => g.id === id);
}

/**
 * 需要数字键盘的游戏（数学/答题类）。操作文案与默认虚拟键位都以此为准，
 * 避免详情写「双键」而进游戏却是数字盘这种自相矛盾。
 */
export const NUMBER_GAMES = new Set<string>([
  // 示例：答题/数字输入类游戏填这里，让详情页与默认虚拟键位一致。
  // 'fl001',
]);
export function isNumberGame(id: string): boolean {
  return NUMBER_GAMES.has(id);
}

/**
 * 触屏设备才显示移动端专属文案与控件。桌面 Windows 触屏笔记本 navigator.maxTouchPoints
 * 也可能 >0（实测桌面 Chrome 报 10），但桌面浏览器没有 ontouchstart，故只认后者。
 * 放在共享模块让 main / ui 用同一判断，避免桌面与手机两处漂移。
 */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window;
}
