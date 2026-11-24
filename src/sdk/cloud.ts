/**
 * 云存档同步：收藏 / 最近 / 设置 / 虚拟键盘偏好。
 *
 * 策略：
 * - 本地优先：启动时只有云端 syncAt 更新才覆盖本地，否则保留本地。
 * - 关键节点落盘：由 main.ts 的 save() 触发，900ms 防抖后一次批量写 5 个 key。
 * - 失败静默：未登录 / 限流 / 不支持都保留本地数据，绝不因同步失败丢存档。
 * - 128 key / 1024B 限制：4 个业务 key + 1 个时间戳，单值都远低于上限。
 */
import type { PersistState } from '../storage/db';
import { saveState } from '../storage/db';
import { cloudGet, cloudSet, inToyEnv, supported } from './toy';

const KEYS = ['fav', 'recent', 'settings', 'kb', 'syncAt'];
const DEBOUNCE_MS = 900;
let timer: number | undefined;
let latest: PersistState | null = null;

function ids(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value.split(',').filter((x) => /^(fl\d+|imp-[\w-]+)$/.test(x));
}

/** 启动时拉云端；仅在云端确实更新时覆盖本地。返回最终要用的 state。 */
export async function pullCloud(state: PersistState): Promise<PersistState> {
  if (!inToyEnv() || !(await supported('getCloudStorage'))) return state;
  const remote = await cloudGet(KEYS);
  const ts = Number(remote.syncAt || 0);
  if (!Number.isFinite(ts) || ts <= (state.cloudSyncedAt ?? 0)) return state;

  const next: PersistState = { ...state };
  if (remote.fav !== undefined) next.favorites = ids(remote.fav);
  if (remote.recent !== undefined) next.recent = ids(remote.recent).slice(0, 12);
  if (remote.settings) {
    try {
      const s = JSON.parse(remote.settings) as Partial<PersistState['settings']>;
      next.settings = { ...state.settings, ...s };
    } catch {
      // 坏数据忽略
    }
  }
  if (remote.kb) {
    try {
      const kb = JSON.parse(remote.kb) as PersistState['keyboardModes'];
      if (kb && typeof kb === 'object') {
        next.keyboardModes = Object.fromEntries(Object.entries(kb).slice(0, 20));
      }
    } catch {
      // 坏数据忽略
    }
  }
  next.cloudSyncedAt = ts;
  await saveState(next);
  return next;
}

/** 由 save() 调用；只保留最新一次状态，防抖后批量写。 */
export function scheduleCloudPush(state: PersistState): void {
  if (!inToyEnv()) return;
  latest = state;
  if (timer !== undefined) clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    void push();
  }, DEBOUNCE_MS);
}

async function push(): Promise<void> {
  const state = latest;
  if (!state || !(await supported('setCloudStorage'))) return;
  const ts = Date.now();
  const ok = await cloudSet({
    fav: state.favorites.join(','),
    recent: state.recent.join(','),
    settings: JSON.stringify(state.settings),
    kb: JSON.stringify(Object.fromEntries(Object.entries(state.keyboardModes).slice(0, 20))),
    syncAt: String(ts),
  });
  if (ok) {
    state.cloudSyncedAt = ts;
    // 直接落本地，不走 save()：避免再次触发云推送形成循环
    await saveState(state);
  }
}
