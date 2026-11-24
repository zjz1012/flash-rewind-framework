/**
 * B站 Toy JS SDK 极薄封装。
 *
 * 设计原则：
 * 1. 本地预览（file:// / localhost / 外部浏览器）没有 window.toy 时，所有能力静默降级，
 *    不弹窗、不报错、不阻塞游戏——这样开发调试和成品预览都能正常玩。
 * 2. 只有「B站 App / Web 的 /toy/<slug>/ 路径」才视为正式环境，避免本地意外触发解锁门禁。
 * 3. navigate 必须在用户手势中同步调用，所以作者资料要提前取好，点击时不再 await。
 */

export interface AuthorRelationResult {
  status: 'ok' | string;
  data?: { isFollowing?: boolean; hasFanMedal?: boolean; [k: string]: unknown };
}

export interface AuthorProfileResult {
  status: 'ok' | string;
  data?: { nickname?: string; mid?: number; [k: string]: unknown };
}

/** 当前登录用户资料（SDK 的 toy.getUserProfile，返回 nickname/avatar，不返回 UID、MID） */
export interface UserProfileResult {
  nickname?: string;
  avatar?: string;
  toyOpenId?: string;
  [k: string]: unknown;
}

export interface ToyContainerState {
  orientation?: 'portrait' | 'landscape';
  immersive?: boolean;
  deviceType?: string;
  changedFields?: string[];
  [k: string]: unknown;
}

interface ToySDK {
  isSupport(ability: string): Promise<boolean>;
  navigate(req: { type: string; id: string; extra?: Record<string, string> }): Promise<void>;
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
  setCloudStorage(items: Record<string, string>): Promise<void>;
  getQrCode(req?: { path?: string; size?: number }): Promise<{ base64: string; url: string }>;
  share(req: { path: string }): Promise<void>;
  getAuthorRelation(): Promise<AuthorRelationResult>;
  getAuthorProfile(): Promise<AuthorProfileResult>;
  /** 当前登录用户；部分环境（外部手机浏览器）会直接抛错，调用方需兜住 */
  getUserProfile?(): Promise<UserProfileResult>;
  onContainerChange(listener: (s: ToyContainerState) => void): (() => void) | void;
  setContainerMode(req: { orientation?: 'portrait' | 'landscape' | 'auto'; immersive?: boolean }): Promise<void>;
}

declare global {
  interface Window {
    toy?: ToySDK;
  }
}

function sdk(): ToySDK | undefined {
  return typeof window === 'undefined' ? undefined : window.toy;
}

/** 是否处于 B站 Toy 正式环境（App WebView 或 bilibili.com/toy/<slug>/） */
export function inToyEnv(): boolean {
  return !!sdk() && /\/toy\/[^/]+/.test(location.pathname);
}

/** 能力是否可用：本地环境一律 false */
export async function supported(ability: string): Promise<boolean> {
  const t = sdk();
  if (!t || !inToyEnv()) return false;
  try {
    return await t.isSupport(ability);
  } catch {
    return false;
  }
}

/** 云存档：读取。本地环境返回空对象。 */
export async function cloudGet(keys: string[]): Promise<Record<string, string>> {
  const t = sdk();
  if (!t || !inToyEnv()) return {};
  try {
    return await t.getCloudStorage(keys);
  } catch {
    return {};
  }
}

/** 云存档：批量写入（128 key / 1024B 限制由调用方保证）。 */
export async function cloudSet(items: Record<string, string>): Promise<boolean> {
  const t = sdk();
  if (!t || !inToyEnv()) return false;
  try {
    await t.setCloudStorage(items);
    return true;
  } catch {
    return false;
  }
}

export type FollowState = 'yes' | 'no' | 'unavailable';

/** 关注状态：本地环境视为已解锁；正式环境取不到一律按未解锁处理（fail closed） */
export async function checkFollow(): Promise<FollowState> {
  const t = sdk();
  if (!t || !inToyEnv()) return 'yes';
  try {
    const r = await t.getAuthorRelation();
    if (r.status === 'ok' && r.data?.isFollowing) return 'yes';
    if (r.status === 'ok') return 'no';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * 作者（UP 主）主页 mid —— 构建期配置，默认值为示例作者主页。
 *
 * 为什么不依赖 getAuthorProfile().data.mid：该字段文档未承诺一定返回，取不到就会
 * 退化成昵称搜索、跳错页。这里用固定 mid 作为唯一权威，getAuthorProfile 只用来取昵称显示。
 *
 *  forks 请在 .env.local 里设 VITE_AUTHOR_MID=<你的 mid>、VITE_AUTHOR_NICK=<你的昵称>，
 *  否则会沿用示例值。跳转方式固定为 SDK 的 navigate({ type:'space', id: AUTHOR_MID })，
 *  不拼 URL 外跳，这样在 App 内是原生跳转，不会把用户甩到浏览器里。
 */
export const AUTHOR_MID = import.meta.env.VITE_AUTHOR_MID || '63650';

let authorNickname: string | undefined;

/** 提前取作者昵称（mid 由 AUTHOR_MID 固定，不从 SDK 覆盖） */
export async function prefetchAuthor(): Promise<void> {
  const t = sdk();
  if (!t || !inToyEnv()) return;
  try {
    const r = await t.getAuthorProfile();
    if (r.status !== 'ok' || !r.data) return;
    const d = r.data as Record<string, unknown>;
    if (typeof d.nickname === 'string' && d.nickname) authorNickname = d.nickname;
  } catch {
    // 取不到昵称不影响解锁流程，文案回退成「UP 主」
  }
}

export type NavigateResult = 'space' | 'manual';

/**
 * 跳作者主页。必须在 click 事件里直接调用，调用前不要 await。
 * 用 SDK 的 navigate({ type:'space', id }) 在 App 内打开主页，mid 由 AUTHOR_MID 固定配置，
 * 不再依赖 getAuthorProfile().data.mid（文档未承诺返回，取不到会退化成昵称搜索、跳错页）。
 */
export function gotoAuthorSpace(): NavigateResult {
  const t = sdk();
  if (!t || !inToyEnv()) return 'manual';
  try {
    void t.navigate({ type: 'space', id: AUTHOR_MID }).catch(() => {});
    return 'space';
  } catch {
    return 'manual';
  }
}

export function authorName(): string | undefined {
  return authorNickname;
}

/**
 * 作者昵称兜底值：getAuthorProfile 取不到昵称时用它比对。
 * 之所以要兜底：作者本人打开自己的 Toy 时同样会被关注门禁挡住（自己没法关注自己），
 * 而 SDK 不提供 UID / MID，也没有「我是否等于作者」的接口，唯一能比的只有昵称。
 */
export const AUTHOR_NICK_FALLBACK = import.meta.env.VITE_AUTHOR_NICK || 'Flash 时光机';

let viewerNickname: string | undefined;

/** 昵称归一化：去空白、全角波浪线转半角、转小写，避免全角/半角波浪线与空格差异漏判 */
function normNick(s: string): string {
  return s.replace(/\s+/g, '').replace(/[~～]/g, '~').toLowerCase();
}

/** 提前取当前登录用户昵称（用于「作者本人放行」） */
export async function prefetchViewer(): Promise<void> {
  const t = sdk();
  if (!t || !inToyEnv() || typeof t.getUserProfile !== 'function') return;
  try {
    const p = await t.getUserProfile();
    if (p && typeof p.nickname === 'string' && p.nickname) viewerNickname = p.nickname;
  } catch {
    // 外部手机浏览器等环境不支持该能力；保持 undefined，继续走正常关注校验
  }
}

/**
 * 当前用户是否就是作者本人（昵称一致）。
 *
 * 注意这是**弱校验**：B站昵称可重名，任何人都能改成同名，所以它只用来让作者自己
 * 不被自己的门禁挡住，不承担鉴权职责；正式解锁仍以 getAuthorRelation 的
 * isFollowing 为准。
 */
export function isAuthorSelf(): boolean {
  if (!viewerNickname) return false;
  const mine = normNick(viewerNickname);
  if (!mine) return false;
  const targets = [authorNickname, AUTHOR_NICK_FALLBACK]
    .filter((x): x is string => typeof x === 'string' && !!x)
    .map(normNick);
  return targets.includes(mine);
}

export function viewerName(): string | undefined {
  return viewerNickname;
}

/** 二维码内容只能指向当前 Toy 内的相对路径，这里统一生成 */
export function toyPlayPath(id: string): string {
  return `index.html?play=${encodeURIComponent(id)}`;
}

export async function qrForGame(id: string): Promise<string | undefined> {
  const t = sdk();
  if (!t || !inToyEnv()) return undefined;
  try {
    const r = await t.getQrCode({ path: toyPlayPath(id), size: 320 });
    return r.base64;
  } catch {
    return undefined;
  }
}

export async function shareGame(id: string): Promise<'shared' | 'copied' | 'failed'> {
  const t = sdk();
  if (!t || !inToyEnv()) return 'failed';
  try {
    if (await t.isSupport('share')) {
      await t.share({ path: toyPlayPath(id) });
      return 'shared';
    }
  } catch {
    // 降级复制链接
  }
  try {
    const url = `${location.origin}${location.pathname}${toyPlayPath(id)}`;
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** 横屏沉浸：Promise 只代表调用返回，不代表生效；生效由 onContainerChange 确认 */
export async function requestLandscape(): Promise<boolean> {
  const t = sdk();
  if (!t || !inToyEnv()) return false;
  try {
    await t.setContainerMode({ orientation: 'landscape', immersive: true });
    return true;
  } catch {
    return false;
  }
}

export async function restorePortrait(): Promise<void> {
  const t = sdk();
  if (!t || !inToyEnv()) return;
  try {
    await t.setContainerMode({ orientation: 'portrait', immersive: false });
  } catch {
    // 忽略
  }
}

export function watchContainer(listener: (s: ToyContainerState) => void): (() => void) | undefined {
  const t = sdk();
  if (!t || !inToyEnv()) return undefined;
  try {
    const off = t.onContainerChange(listener);
    return typeof off === 'function' ? off : undefined;
  } catch {
    return undefined;
  }
}
