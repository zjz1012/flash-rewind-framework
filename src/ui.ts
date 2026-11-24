import type { Candidate, GameEntry } from './types';
import { displayTitle, isNumberGame, isTouchDevice, REAL_COVER_IDS } from './data/catalog';

const ASSET_BASE = import.meta.env.BASE_URL || './';

/**
 * 零图模式（构建期常量，VITE_NO_IMAGES=1 时启用）。
 * 用途：审核判定实验——完全不出图，只出文字列表，用来验证是否封面图触发了驳回。
 * 该模式不渲染任何 <img>，打包时同时剔除 public/covers。
 */
export const NO_IMAGES = import.meta.env.VITE_NO_IMAGES === '1';

// 卡片配色：按标题哈希做几何封面（方案 3.4：程序生成，不用失效盗链）
const COLORS: [string, string][] = [
  ['#183c69', '#285c88'], ['#314366', '#914a7c'], ['#175e64', '#23988b'], ['#5d3b61', '#b46876'],
  ['#54476b', '#8b6ba6'], ['#564522', '#b38349'], ['#1e526c', '#427ca8'], ['#485c38', '#7aab73'],
  ['#6a3541', '#a85a62'], ['#294a63', '#3f7a92'],
];
const GLYPHS = ['◇', '✦', '▣', '▤', '◈', '▰', '◆', '▥', '◎', '✷'];

/**
 * 采集时全程卡在加载页 / 平台 logo / 纯文字说明页、截不到真实游戏画面的封面。
 * 这几款不显示截图，回退到几何占位封面，避免加载页当封面破坏网格观感。
 */
// 早期无法截到真实画面的款已重新处理：22 款救回真实截图，
// 无法截到画面的款可改成本地生成的标题封面，因此这里默认不设黑名单。
const BAD_COVERS = new Set<string>();

export function hashIndex(id: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

/** 作者展示：真实署名（含海外原名）原样保留，仅把占位值收敛成统一轻占位 */
export function displayAuthor(author: string): string {
  return !author || author === '未知作者' ? '—' : author;
}

export function categoryOf(g: { genre: string | string[] }): string {
  const s = Array.isArray(g.genre) ? g.genre.join(' ') : g.genre;
  if (/画线|物理/.test(s)) return '画线／物理';
  if (/益智|拼图|解谜|点击成长|密室|棋类|纸牌|寻物|数学/.test(s)) return '解谜／点击';
  if (/动作|平台|躲避|射击|竞速|飞行/.test(s)) return '轻动作';
  return '休闲／其他';
}

/** 统一游戏卡：几何封面 + 名称 + 作者 + 玩法分类 */
export function cardHtml(item: Candidate | GameEntry, opts: { fav?: boolean; released: boolean; locked?: boolean }): string {
  if (NO_IMAGES) return rowHtml(item, opts);
  const id = item.id;
  const k = hashIndex(id, COLORS.length);
  const { zh, en } = displayTitle(id, item.title);
  const author = displayAuthor(item.author);
  const genre = Array.isArray((item as GameEntry).genres)
    ? (item as GameEntry).genres.join('/')
    : (item as Candidate).genre;
  const fav = opts.fav ?? false;
  // 分批试审：不在本批名单里的用自制标题卡；命中名单才加载真实截图
  const useReal = opts.released && REAL_COVER_IDS.has(id) && !BAD_COVERS.has(id);
  const coverSrc = useReal ? `${ASSET_BASE}covers/${esc(id)}.jpg` : `${ASSET_BASE}covers-card/${esc(id)}.jpg`;
  return `<div class="gamecard ${opts.locked ? 'locked' : ''}" data-id="${esc(id)}" data-released="${opts.released}" role="button" tabindex="0" aria-label="查看${esc(zh)}">
    <div class="cover" style="--gr:linear-gradient(140deg,${COLORS[k][0]},${COLORS[k][1]})">
      <span class="glyph">${GLYPHS[k]}</span>
      ${opts.locked ? '<span class="lockbadge" title="关注 UP 主后解锁">🔒</span>' : ''}
      <img class="cover-img" src="${coverSrc}" alt="" loading="lazy" decoding="async" onerror="this.remove()">
      <button class="fav ${fav ? 'on' : ''}" data-fav="${esc(id)}" aria-label="收藏">${fav ? '★' : '☆'}</button>
    </div>
    <div class="cardinfo">
      <div class="cardname" title="${esc(zh)}">${esc(zh)}</div>
      ${en ? `<div class="cardname-en" title="${esc(en)}">${esc(en)}</div>` : ''}
      <div class="cardby">${esc(author)}</div>
      <div class="tags">
        <span class="smalltag">${esc(categoryOf({ genre }))}</span>
      </div>
    </div>
  </div>`;
}

/** 零图模式的列表行：只有文字，不出现任何图片元素 */
function rowHtml(item: Candidate | GameEntry, opts: { fav?: boolean; released: boolean; locked?: boolean }): string {
  const id = item.id;
  const { zh, en } = displayTitle(id, item.title);
  const author = displayAuthor(item.author);
  const genre = Array.isArray((item as GameEntry).genres)
    ? (item as GameEntry).genres.join('/')
    : (item as Candidate).genre;
  const fav = opts.fav ?? false;
  return `<div class="gamecard gamerow ${opts.locked ? 'locked' : ''}" data-id="${esc(id)}" data-released="${opts.released}" role="button" tabindex="0" aria-label="查看${esc(zh)}">
    <div class="rowmain">
      <div class="rowtitle">${esc(zh)}</div>
      ${en ? `<div class="rowen">${esc(en)}</div>` : ''}
    </div>
    <div class="rowby">${esc(author)}</div>
    <div class="rowtag">${esc(categoryOf({ genre }))}</div>
    ${opts.locked ? '<div class="rowlock">🔒 关注后解锁</div>' : ''}
    <button class="rowfav ${fav ? 'on' : ''}" data-fav="${esc(id)}" aria-label="收藏">${fav ? '★' : '☆'}</button>
  </div>`;
}

/** 详情弹窗：玩家视角，只展示玩法、作者与开始游戏 */
export function detailHtml(
  item: Candidate | GameEntry,
  opts: { fav: boolean; released: boolean }
): string {
  const released = opts.released;
  const g = item as GameEntry;
  const c = item as Candidate;
  const { zh, en, enOriginal } = displayTitle(item.id, item.title);
  const author = displayAuthor(item.author);
  // 卡片与筛选栏都用归一化分类，详情这里保持同一口径，避免两处说法不一致
  const genre = categoryOf({ genre: released ? g.genres : c.genre });
  // 数字游戏默认就是数字盘，操作说明要跟着一致，别再显示 data 里的「双键」
  const inputHint = released
    ? (isNumberGame(item.id) ? '数字键输入' : controlLabel(g.control))
    : c.inputHint;

  const info = `
    <div class="info-grid">
      <div><b>作者</b>${esc(author)}</div>
      <div><b>玩法</b>${esc(genre)}</div>
      <div><b>操作</b>${esc(inputHint)}</div>
    </div>`;

  if (released) {
    return `<div class="dim">Flash 时光机 · 游戏档案</div>
      <h2>${esc(zh)}${enOriginal ? ' <span class="lang-tag">英文原版</span>' : ''}</h2>
      ${en ? `<p class="dlg-en">${esc(en)}</p>` : ''}
      <p class="dlgsub">${esc(author)} · ${esc(genre)}</p>
      ${info}
      <div class="howto pl-side">
        <h3>🕹 怎么玩</h3>
        <div class="row dim">点下方「开始游戏」即可进入，首次载入稍等几秒。</div>
        ${isTouchDevice() ? '<div class="row dim">横屏玩更尽兴；需要按键的游戏可点播放器上的「⌨ 键盘」。</div>' : ''}
        <div class="row dim">喜欢的游戏点「收藏」，下次打开还能找到。</div>
      </div>
      <div class="dialog-actions">
        <button class="primary" id="playBtn">▶ 开始游戏</button>
        <button class="outline" id="favBtn">${opts.fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>`;
  }

  return `<div class="dim">Flash 时光机 · 游戏档案</div>
    <h2>${esc(zh)}${enOriginal ? ' <span class="lang-tag">英文原版</span>' : ''}</h2>
    ${en ? `<p class="dlg-en">${esc(en)}</p>` : ''}
    <p class="dlgsub">${esc(author)} · ${esc(genre)}</p>
    ${info}
    <div class="dialog-actions">
      <button class="outline" id="favBtn">${opts.fav ? '★ 已收藏' : '☆ 收藏'}</button>
    </div>`;
}

function controlLabel(c: string): string {
  const m: Record<string, string> = {
    mouse: '鼠标点击 / 拖动', drag: '拖动', one: '单键', two: '双键', dpad: '方向+动作', 'pc-only': '建议 PC',
  };
  return m[c] ?? c;
}
