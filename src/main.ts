import './style.css';
import { candidates, releasedGames, findCandidate, findReleased, searchTitles, displayTitle, isNumberGame, isTouchDevice } from './data/catalog';
import type { Candidate, GameEntry, ImportedGame } from './types';
import type { PersistState } from './storage/db';
import { cardHtml, detailHtml, categoryOf, hashIndex, NO_IMAGES } from './ui';
import { RuffleHost } from './player/RuffleHost';
import {
  loadState, saveState, saveImportBlob, loadImportBlob, deleteImportBlob,
  newImportedId, sha256Of, exportMetadata,
} from './storage/db';
import {
  inToyEnv, supported, checkFollow, prefetchAuthor, prefetchViewer, isAuthorSelf,
  gotoAuthorSpace, authorName,
  qrForGame, shareGame, requestLandscape, restorePortrait, watchContainer,
  type FollowState,
} from './sdk/toy';
import { pullCloud, scheduleCloudPush } from './sdk/cloud';

const base = import.meta.env.BASE_URL || './';
const app = document.querySelector<HTMLDivElement>('#app')!;

/** 游戏库：全部已收录游戏（内部审核状态不展示给玩家） */
const GAME_COUNT = releasedGames.length;

/**
 * 开源框架仓库与许可摘要（在「关于」里展示，便于追溯许可来源）。
 * 可用 VITE_PROJECT_URL 改成自己的 fork 地址。
 */
const OSS_REPO_URL = String(import.meta.env.VITE_PROJECT_URL || 'https://github.com/zjz1012/flash-rewind-framework');

let state: PersistState;
let route: { page: string; id?: string } = { page: 'home' };
let uiState = { nav: 'all', chip: '全部', q: '' };
let host: RuffleHost | null = null;
let overlayOpen = false;

/**
 * 关注门禁的免费名单：默认前 5 款免费，其余需关注 UP 主后解锁（本地预览无条件放行）。
 * fork 可用 VITE_FREE_IDS="fl001,fl002" 指定具体 id；留空则按列表顺序取前 5 款。
 */
const FREE_CONFIGURED = String(import.meta.env.VITE_FREE_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const FREE_IDS = new Set(FREE_CONFIGURED.length
  ? FREE_CONFIGURED
  : releasedGames.slice(0, 5).map((g) => g.id));
let followState: FollowState = 'yes';
let canOrient = false;
let containerOff: (() => void) | undefined;

const CHIPS = ['全部', '解谜／点击', '画线／物理', '轻动作', '休闲／其他'];
const NAV_TITLES: Record<string, string> = {
  all: '探索游戏', fav: '我的收藏', recent: '最近浏览', local: '本地导入',
};

async function boot() {
  state = await loadState();
  state = await pullCloud(state);
  await prefetchAuthor();
  await prefetchViewer();
  followState = await resolveFollow();
  canOrient = isTouchDevice() && (await supported('setContainerMode')) && (await supported('onContainerChange'));
  parseHash();
  // 同步 page → nav，保证带 hash 直达（如 #/local）时 UI 状态一致
  if (route.page && route.page !== 'play' && NAV_TITLES[route.page]) uiState.nav = route.page;
  window.addEventListener('hashchange', () => {
    parseHash();
    if (route.page && route.page !== 'play' && NAV_TITLES[route.page]) uiState.nav = route.page;
    render();
  });
  // 从作者主页返回后重新验证关注状态（不打断正在进行的游戏）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void resolveFollow().then((next) => {
      if (next === followState) return;
      followState = next;
      if (route.page !== 'play') render();
      if (next === 'yes') toast('已关注 UP 主，所有游戏已解锁');
    });
  });
  render();
}

function parseHash() {
  // 二维码/分享链接用 ?play=<id>（SDK 的 path 只允许相对路径 + query，不带 hash）
  const playParam = new URLSearchParams(location.search).get('play');
  const h = location.hash.replace(/^#\/?/, '');
  const [page, query] = h.split('?');
  if (playParam && releasedGames.some((g) => g.id === playParam)) {
    route = { page: 'play', id: playParam };
    return;
  }
  route = page ? { page, id: query ? decodeURIComponent(query.split('=')[1] || '') : undefined } : { page: 'home' };
}

function isUnlocked(id: string): boolean {
  return FREE_IDS.has(id) || followState === 'yes';
}

/**
 * 关注状态解析：作者本人（昵称一致）直接视为已解锁。
 *
 * 为什么需要这条：作者打开自己的 Toy 时同样会被门禁挡住，而 B站不允许关注自己，
 * 于是自己反而看不到自己上传的作品。SDK 拿不到 UID/MID，只能靠昵称比对，
 * 所以这里做的是弱校验，仅用于作者自测，不替代 getAuthorRelation 的正式校验。
 */
async function resolveFollow(): Promise<FollowState> {
  if (isAuthorSelf()) return 'yes';
  return await checkFollow();
}

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2400);
  setTimeout(() => el.remove(), 3000);
}

function go(page: string, id?: string) {
  location.hash = `#/${page}${id ? `?id=${encodeURIComponent(id)}` : ''}`;
}

function save() { void saveState(state); scheduleCloudPush(state); }

function toggleFav(id: string) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.unshift(id);
  save();
}

function touch(id: string) {
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 12);
  save();
}

function isReleased(id: string): GameEntry | undefined { return findReleased(id); }

function itemOf(id: string): Candidate | GameEntry | undefined {
  return findReleased(id) ?? findCandidate(id);
}

// ---------- 视图 ----------
function render() {
  closeOverlay(true);
  teardownPlayer();
  if (route.page === 'play' && route.id) {
    const lockedId = route.id;
    if (!isUnlocked(lockedId)) {
      // 直达链接命中锁定游戏：回到游戏库并弹关注提示，不加载 SWF
      history.replaceState(null, '', location.pathname);
      route = { page: 'all' };
      uiState.nav = 'all';
      renderLibrary();
      openUnlock(lockedId);
      return;
    }
    renderPlay(route.id);
    return;
  }
  renderLibrary();
}

function renderLibrary() {
  const nav = uiState.nav;
  let list: (Candidate | GameEntry)[];

  if (nav === 'all') {
    // 已收录游戏优先，去掉与已收录同 id 的重复项
    const released = releasedGames;
    const rest = candidates.filter((c) => !isReleased(c.id));
    list = [...released, ...rest];
  } else if (nav === 'fav') {
    list = state.favorites.map(itemOf).filter(Boolean) as (Candidate | GameEntry)[];
  } else if (nav === 'recent') {
    list = state.recent.map(itemOf).filter(Boolean) as (Candidate | GameEntry)[];
  } else {
    list = [];
  }

  const q = uiState.q.trim().toLowerCase();
  if (q) list = list.filter((g) => [searchTitles(g.id, g.title), g.author, ...(Array.isArray((g as GameEntry).genres) ? (g as GameEntry).genres : [(g as Candidate).genre])].join(' ').toLowerCase().includes(q));

  const chip = uiState.chip;
  if (chip !== '全部') {
    list = list.filter((g) => {
      const genre = Array.isArray((g as GameEntry).genres)
        ? (g as GameEntry).genres.join(' ')
        : (g as Candidate).genre;
      return categoryOf({ genre }) === chip;
    });
  }

  app.innerHTML = `
    <div class="app">
      ${sidebarHtml()}
      <main class="content">
        ${toolbarHtml()}
        <div class="notice">
          <b>Flash 时光机</b> · 收藏了 <b>${GAME_COUNT}</b> 款经典小游戏，点开就能玩。也可以导入自己的 SWF，随时重温旧时光。
        </div>
        ${nav === 'all' ? heroHtml() : ''}
        <div class="sectionhead">
          <h2>${NAV_TITLES[nav] ?? '探索游戏'}</h2>
          <p>${nav === 'all' ? '每款作品都有自己的故事' : ''}</p>
        </div>
        ${nav === 'local' ? localIntroHtml() : `
          <div class="subtoolbar">
            <div class="chips">${CHIPS.map((c) => `<button class="chip ${uiState.chip === c ? 'active' : ''}" data-chip="${c}">${c}</button>`).join('')}</div>
            <span class="counter">共 ${list.length} 款</span>
          </div>
          <div class="gamegrid ${NO_IMAGES ? 'rows' : ''}">${list.length ? list.map((g) => cardHtml(g, { fav: state.favorites.includes(g.id), released: !!isReleased(g.id), locked: !isUnlocked(g.id) })).join('') : emptyHtml()}</div>
        `}
        ${nav === 'local' ? `<div class="sectionhead"><h2>我的导入</h2></div><div id="localList">${importListHtml()}</div>` : ''}
        <div class="footer">Flash 时光机 · 把那些年的小游戏，带回来。</div>
      </main>
      ${mobileNavHtml()}
    </div>
    <div class="overlay" id="overlay"><div class="dialog"><button class="close" id="closeDialog">✕</button><div id="dialogBody"></div></div></div>`;

  bindCommon();
}

function sidebarHtml(): string {
  const btn = (nav: string, icon: string, label: string) => `<button class="sidebtn ${uiState.nav === nav ? 'active' : ''}" data-nav="${nav}"><span class="sideicon">${icon}</span>${label}</button>`;
  return `<aside class="sidebar">
    <div class="logo">Flash<span>◈</span><br>时光机</div>
    <div class="tiny">怀旧游戏 · 自由重启</div>
    <div class="sdiv">探索</div>
    ${btn('all', '▦', '全部游戏')}
    ${btn('fav', '☆', '我的收藏')}
    ${btn('recent', '◷', '最近浏览')}
    <div class="sdiv">本地</div>
    ${btn('local', '⬆', '导入SWF')}
    <div class="sdiv">系统</div>
    ${btn('settings', '⚙', '设置')}
    ${btn('about', 'ⓘ', '关于')}
    <div class="sidefoot">◉ 收录 <b>${GAME_COUNT}</b> 款经典小游戏<br>资源内置 · 加载后可离线玩<br>你的游戏，你的时光</div>
  </aside>`;
}

function toolbarHtml(): string {
  return `<header class="toolbar">
    <div class="logo-mobile mobile-only">Flash ◈</div>
    <div class="breadcrumbs">档案馆 / <strong>${NAV_TITLES[uiState.nav] ?? '探索游戏'}</strong></div>
    <div class="toolgrow"></div>
    <div class="search"><span>⌕</span><input id="search" placeholder="搜索游戏 / 作者 / 类型..." value="${uiState.q.replace(/"/g, '&quot;')}" aria-label="搜索游戏"></div>
    <button class="topbtn desktop-only" id="importBtn">↑ 导入SWF</button>
    <div class="profile">F</div>
  </header>`;
}

function heroHtml(): string {
  return `<section class="herozone">
    <div class="hero"><div>
      <div class="hero-tag">经典 Flash 小游戏合集 · 2026</div>
      <h1>把那些年的<br><span>小游戏，带回来。</span></h1>
      <p>点开就玩，经典的画线、解谜和一键操作。把喜欢的都收进自己的 Flash 游戏厅。</p>
      <div class="hero-actions">
        <button class="primary" id="randomBtn">✦ 随便逛逛</button>
        <button class="outline" id="heroImportBtn">↑ 导入我的SWF</button>
      </div>
    </div>${NO_IMAGES ? '' : '<div class="arcade-illus">🕹️</div>'}</div>
    <div class="microcard">
      <div><div class="heading">◈ 游戏库</div><div class="sub">经典小游戏合集<br>随时打开，随时开玩</div></div>
      <div class="stats">
        <div><div class="num">${GAME_COUNT}<small> 款</small></div><div class="stat-label">已收录</div></div>
        <div><div class="num">${state.favorites.length}<small> 款</small></div><div class="stat-label">我的收藏</div></div>
      </div>
      <div class="dim">资源内置 · 加载后可离线玩</div>
    </div>
  </section>`;
}

function mobileNavHtml(): string {
  const b = (nav: string, icon: string, label: string) => `<button class="${uiState.nav === nav ? 'active' : ''}" data-nav="${nav}"><span>${icon}</span>${label}</button>`;
  return `<nav class="mobile-nav">${b('all', '▦', '游戏库')}${b('fav', '☆', '收藏')}${b('recent', '◷', '最近')}${b('local', '⬆', '本地')}${b('settings', '⚙', '设置')}</nav>`;
}

function emptyHtml(): string {
  return '<div class="empty">这里暂时还没有内容。换个分类，或者收藏几款喜欢的游戏。</div>';
}

function localIntroHtml(): string {
  return `<div class="hint" style="margin-bottom:14px">
    选择本机 <b>.swf</b> 文件，即可在这里收藏并游玩。文件只保存在你的设备上，不会上传到任何地方。
  </div>
  <div class="uploadbox">
    <div class="em">📂</div>
    <strong>导入我的 Flash 游戏</strong><br>
    <span class="dim">支持 .swf 文件 · 保存在本机</span><br>
    <label>＋ 选择本地文件
      <input type="file" id="swfFile" accept=".swf,application/x-shockwave-flash">
    </label>
    <div class="hint">PC 也可把 .swf 文件直接拖入下方区域。</div>
    <div id="fileResult" style="margin-top:12px"></div>
  </div>`;
}

function importListHtml(): string {
  if (!state.imports.length) return '<div class="empty">还没有导入过游戏。选一个你喜欢的 SWF 文件试试吧。</div>';
  return `<div class="filelist">${state.imports.map((f) => `
    <div class="fileitem">
      <span style="font-size:20px">🎞</span>
      <div class="grow"><div class="nm">${escHtml(f.name)}</div>
        <div class="dim">${(f.size / 1e6).toFixed(2)} MB · 已玩 ${f.plays} 次</div></div>
      <button class="iconbtn" data-play-imp="${f.id}">▶ 播放</button>
      <button class="iconbtn danger" data-del-imp="${f.id}">删除</button>
    </div>`).join('')}</div>
    <div class="dialog-actions" style="margin-top:16px">
      <button class="outline" id="exportMeta">⤓ 导出导入元数据(JSON)</button>
    </div>`;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ---------- 虚拟键盘 ----------
import type { KeyboardMode } from './storage/db';

/** 声音按钮文案与状态同源，避免两处漂移 */
function muteLabel(muted: boolean): string {
  return muted ? '🔇 已静音' : '🔊 声音';
}
function paintMute(btn: Element | null, muted: boolean): void {
  if (!btn) return;
  btn.textContent = muteLabel(muted);
  btn.classList.toggle('muted', muted);
  btn.setAttribute('aria-pressed', String(muted));
}

/** 需数字输入的游戏默认数字盘，其余全键盘（判断源在 catalog，与详情操作文案同源） */
function defaultKeyboardMode(id: string): KeyboardMode {
  return isNumberGame(id) ? 'numbers' : 'full';
}
function keyboardModeOf(id: string): KeyboardMode {
  return state.keyboardModes[id] ?? defaultKeyboardMode(id);
}

/** 键盘按键定义：[显示文案, key, code, keyCode] */
const KEY_NUMBERS: [string, string, string, number][] = [
  ['1','1','Digit1',49], ['2','2','Digit2',50], ['3','3','Digit3',51],
  ['4','4','Digit4',52], ['5','5','Digit5',53], ['6','6','Digit6',54],
  ['7','7','Digit7',55], ['8','8','Digit8',56], ['9','9','Digit9',57],
  ['←','Backspace','Backspace',8], ['0','0','Digit0',48], ['✓','Enter','Enter',13],
];
const KEY_FULL: [string, string, string, number][] = [
  ['◀','ArrowLeft','ArrowLeft',37], ['▲','ArrowUp','ArrowUp',38], ['▶','ArrowRight','ArrowRight',39],
  ['▼','ArrowDown','ArrowDown',40], ['空格',' ','Space',32], ['✓','Enter','Enter',13],
  ['1','1','Digit1',49], ['2','2','Digit2',50], ['3','3','Digit3',51],
  ['4','4','Digit4',52], ['5','5','Digit5',53], ['6','6','Digit6',54],
  ['7','7','Digit7',55], ['8','8','Digit8',56], ['9','9','Digit9',57], ['0','0','Digit0',48],
];

/** 生成虚拟键盘 HTML（默认收起，由键盘按钮切换） */
function virtualKeyboardHtml(id: string, mode: KeyboardMode): string {
  if (!isTouchDevice()) return '';
  const keys = mode === 'numbers' ? KEY_NUMBERS : KEY_FULL;
  const btn = keys.map(([label, key, code, keyCode]) =>
    `<button class="vkey" data-vkey="${escHtml(key)}" data-vcode="${escHtml(code)}" data-vkc="${keyCode}">${escHtml(label)}</button>`
  ).join('');
  const otherLabel = mode === 'numbers' ? '全键盘' : '数字盘';
  return `<div class="vkeyboard" id="vkeyboard" hidden>
    <div class="vkeyboard-head">
      <span class="vkeyboard-title">⌨ ${mode === 'numbers' ? '数字键盘' : '全键盘'}</span>
      <button class="vkeyboard-switch" id="kbdSwitch" title="切换键盘">切到${otherLabel}</button>
      <button class="vkeyboard-close" id="kbdClose" title="收起">×</button>
    </div>
    <div class="vkeyboard-keys ${mode === 'numbers' ? 'numbers' : 'full'}">${btn}</div>
  </div>`;
}

// ---------- 播放器页 ----------
function renderPlay(id: string) {
  const released = isReleased(id);
  const imported = state.imports.find((f) => f.id === id);
  const rawTitle = released?.title ?? imported?.name ?? '未知游戏';
  const shownTitle = released ? displayTitle(id, rawTitle).zh : rawTitle;
  const mode = keyboardModeOf(id);
  app.innerHTML = `
    <div class="app"><main class="content play-page">
      <div class="playbar">
        <button class="iconbtn" id="backBtn">← 返回</button>
        <span class="title">${escHtml(shownTitle)}</span>
        <span class="grow"></span>
        ${isTouchDevice() ? '<button class="iconbtn" id="kbdToggle" title="虚拟键盘">⌨ 键盘</button>' : ''}
        <button class="iconbtn" id="restartBtn">↻ 重开</button>
        <button class="iconbtn ${state.settings.muted ? 'muted' : ''}" id="muteBtn" aria-pressed="${state.settings.muted}">${muteLabel(state.settings.muted)}</button>
        ${canOrient ? '<button class="iconbtn" id="orientBtn">▭ 横屏</button>' : ''}
        <button class="iconbtn" id="fsBtn">⛶ 全屏</button>
      </div>
      ${isTouchDevice() && !state.settings.fullscreenHintSeen ? '<div class="hintbar" id="hintBar">💡 横屏玩更尽兴，点此收起提示。</div>' : ''}
      <div class="stage-inner" id="stage" style="touch-action:none">
        <div class="screen" id="screen"><div class="stage-msg"><span class="spin"></span><br>正在载入游戏…</div></div>
      </div>
      ${virtualKeyboardHtml(id, mode)}
    </main></div>`;

  bindPlay(id, released, imported);
}

async function bindPlay(id: string, released: GameEntry | undefined, imported: ImportedGame | undefined) {
  const screen = document.querySelector<HTMLElement>('#screen')!;
  host = new RuffleHost(screen, base);
  if (released) {
    host.setVolume(state.settings.muted ? 0 : state.settings.volume);
    try {
      await host.loadGame({ url: released.swfPath });
      touch(id);
    } catch (e) {
      screen.innerHTML = `<div class="stage-msg">❌ 游戏加载失败<br>请换个游戏试试。</div>`;
    }
  } else if (imported) {
    try {
      const blob = await loadImportBlob(id);
      if (!blob) throw new Error('本地文件已丢失（可能被清理缓存）');
      host.setVolume(state.settings.muted ? 0 : state.settings.volume);
      await host.loadGame({ data: blob, name: imported.name });
      imported.lastPlayedAt = Date.now();
      imported.plays++;
      touch(id);
      save();
    } catch (e) {
      screen.innerHTML = `<div class="stage-msg">❌ 加载失败：${escHtml(String(e))}</div>`;
    }
  } else {
    screen.innerHTML = '<div class="stage-msg">找不到该游戏。</div>';
  }
  bindPlayControls(id, released);
}

function bindPlayControls(id: string, released?: GameEntry) {
  document.querySelector('#backBtn')?.addEventListener('click', () => go('all'));
  document.querySelector('#restartBtn')?.addEventListener('click', async () => {
    try { await host?.reload(); } catch (e) { console.warn('reload failed', e); }
  });
  const muteBtn = document.querySelector('#muteBtn');
  muteBtn?.addEventListener('click', () => {
    state.settings.muted = !state.settings.muted;
    host?.setVolume(state.settings.muted ? 0 : state.settings.volume);
    paintMute(muteBtn, state.settings.muted);
    save();
  });
  document.querySelector('#fsBtn')?.addEventListener('click', () => {
    const el = document.querySelector('#stage') as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (!document.fullscreenElement) (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
    else void document.exitFullscreen();
  });
  document.querySelector('#hintBar')?.addEventListener('click', (e) => {
    state.settings.fullscreenHintSeen = true; save();
    (e.currentTarget as HTMLElement).remove();
  });

  // 虚拟键盘：开关 / 按键发送 / 模式切换
  const kbd = document.querySelector<HTMLElement>('#vkeyboard');
  document.querySelector('#kbdToggle')?.addEventListener('click', () => {
    if (!kbd) return;
    kbd.hidden = !kbd.hidden;
    if (!kbd.hidden) {
      // 打开时聚焦播放器，确保 Ruffle 接受键盘事件
      (document.querySelector('ruffle-player') as HTMLElement | null)?.focus();
    }
  });
  document.querySelector('#kbdClose')?.addEventListener('click', () => { if (kbd) kbd.hidden = true; });
  document.querySelector('#kbdSwitch')?.addEventListener('click', () => {
    const cur = keyboardModeOf(id);
    const next: KeyboardMode = cur === 'numbers' ? 'full' : 'numbers';
    state.keyboardModes[id] = next;
    save();
    // 重渲染播放页保留当前键盘展开状态
    const wasOpen = !!kbd && !kbd.hidden;
    renderPlay(id);
    const nkbd = document.querySelector<HTMLElement>('#vkeyboard');
    if (nkbd) nkbd.hidden = !wasOpen;
  });
  kbd?.querySelectorAll<HTMLElement>('.vkey').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      host?.sendKey(btn.dataset.vkey!, btn.dataset.vcode!, Number(btn.dataset.vkc));
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 120);
    });
  });

  // B站 App 横屏沉浸：setContainerMode 的 Promise 不是回执，靠状态回调确认
  if (canOrient) {
    let pending = false;
    containerOff = watchContainer((s) => {
      if (pending && s.orientation === 'landscape' && s.immersive) {
        pending = false;
        toast('已进入横屏沉浸模式');
      }
    });
    document.querySelector('#orientBtn')?.addEventListener('click', async () => {
      pending = true;
      if (await requestLandscape()) toast('正在切换横屏…');
      else { pending = false; toast('当前环境不支持横屏切换'); }
    });
    document.querySelector('#backBtn')?.addEventListener('click', () => { void restorePortrait(); });
  }

  // 切后台挂起，回前台恢复（省资源）
  document.addEventListener('visibilitychange', onVisibility);
}

function onVisibility() {
  if (!host) return;
  if (document.hidden) host.suspend(); else host.resume();
}

function teardownPlayer() {
  document.removeEventListener('visibilitychange', onVisibility);
  containerOff?.();
  containerOff = undefined;
  if (host) { host.destroy(); host = null; }
}

// ---------- 弹窗 ----------
function openDetail(id: string) {
  const item = itemOf(id);
  if (!item) return;
  if (!isUnlocked(id)) { openUnlock(id); return; }
  const released = isReleased(id);
  touch(id);
  const body = document.querySelector<HTMLElement>('#dialogBody')!;
  body.innerHTML = detailHtml(item, { fav: state.favorites.includes(id), released: !!released });

  // 触屏设备：详情页提供虚拟键盘模式切换（玩家可按游戏自行指定）
  if (isTouchDevice() && released) {
    const mode = keyboardModeOf(id);
    const kbRow = document.createElement('div');
    kbRow.className = 'detail-kbd';
    kbRow.innerHTML = `<span>⌨ 虚拟键盘：<b>${mode === 'numbers' ? '数字盘' : '全键盘'}</b></span>
      <button class="outline" id="detailKbdSwitch">切换为${mode === 'numbers' ? '全键盘' : '数字盘'}</button>`;
    body.insertBefore(kbRow, body.querySelector('.dialog-actions'));
    kbRow.querySelector('#detailKbdSwitch')?.addEventListener('click', () => {
      state.keyboardModes[id] = mode === 'numbers' ? 'full' : 'numbers';
      save();
      openDetail(id);
    });
  }

  // B站 Toy：扫码接力 / 分享（本地预览不显示）
  if (inToyEnv() && released) {
    const sdkRow = document.createElement('div');
    sdkRow.className = 'settingrow';
    sdkRow.innerHTML = `<span class="grow">在小屏继续玩</span>
      <button class="outline" id="qrGameBtn">扫码</button>
      <button class="outline" id="shareGameBtn">分享</button>`;
    body.insertBefore(sdkRow, body.querySelector('.dialog-actions'));
    body.querySelector('#qrGameBtn')?.addEventListener('click', () => { void showQrPanel(id); });
    body.querySelector('#shareGameBtn')?.addEventListener('click', async () => {
      const r = await shareGame(id);
      toast(r === 'shared' ? '已打开分享面板' : r === 'copied' ? '链接已复制，发给朋友吧' : '暂时无法分享');
    });
  }

  document.querySelector('#overlay')?.classList.add('open');
  overlayOpen = true;

  body.querySelector('#favBtn')?.addEventListener('click', () => { toggleFav(id); openDetail(id); renderLibraryKeep(); });
  body.querySelector('#playBtn')?.addEventListener('click', () => { closeOverlay(); go('play', id); });
}

function openUnlock(id: string) {
  const item = itemOf(id);
  const name = item ? displayTitle(id, item.title).zh : '这款游戏';
  const body = document.querySelector<HTMLElement>('#dialogBody')!;
  const author = authorName() || 'UP 主';
  const statusTip = followState === 'unavailable'
    ? '暂时没能确认关注状态（可能需要先在 B站 App 登录），请稍后重试。'
    : '关注后返回这里点「我已关注」，验证通过即解锁全部游戏。';
  body.innerHTML = `
    <div class="dim">解锁提示</div>
    <h2>关注 UP 主，解锁全部游戏</h2>
    <p class="dlgsub">「${escHtml(name)}」需要关注作者后游玩</p>
    <div class="unlock-note">
      前 <b>5</b> 款可免费体验，其余游戏在关注 <b>${escHtml(author)}</b> 后全部解锁。<br>${statusTip}
    </div>
    <div class="dialog-actions">
      <button class="outline" id="gotoAuthorBtn">去关注 UP 主</button>
      <button class="primary" id="recheckFollowBtn">我已关注，重新验证</button>
    </div>`;
  document.querySelector('#overlay')?.classList.add('open');
  overlayOpen = true;
  body.querySelector('#gotoAuthorBtn')?.addEventListener('click', () => {
    const r = gotoAuthorSpace();
    if (r === 'manual') toast('没能自动打开，请手动前往作者主页关注');
    else toast('已打开作者主页，关注后返回这里点「我已关注」');
  });
  body.querySelector('#recheckFollowBtn')?.addEventListener('click', async () => {
    followState = await resolveFollow();
    if (followState === 'yes') {
      closeOverlay();
      render();
      toast('验证通过，全部游戏已解锁');
    } else {
      openUnlock(id);
      toast('还没检测到关注，请确认后重试');
    }
  });
}

async function showQrPanel(id: string) {
  const body = document.querySelector<HTMLElement>('#dialogBody')!;
  const back = body.innerHTML;
  body.innerHTML = `<div class="dim">扫码接力</div><h2>在手机上继续玩</h2>
    <div class="qr-panel"><div class="qr-loading">二维码生成中…</div>
    <div class="dim">用 B站 App 扫码，直接打开这款游戏</div></div>
    <div class="dialog-actions"><button class="outline" id="qrBackBtn">返回详情</button></div>`;
  body.querySelector('#qrBackBtn')?.addEventListener('click', () => {
    body.innerHTML = back;
    openDetail(id);
  });
  const base64 = await qrForGame(id);
  const panel = body.querySelector<HTMLElement>('.qr-panel');
  if (!panel) return;
  if (base64) {
    const img = document.createElement('img');
    img.src = base64;
    img.alt = '游戏二维码';
    panel.prepend(img);
  } else {
    panel.innerHTML = '<div class="dim">当前环境不支持生成二维码</div>';
  }
}

function renderLibraryKeep() {
  // 收藏切换后仅刷新卡片上的星标，避免关闭弹窗
  document.querySelectorAll<HTMLElement>('.fav').forEach((el) => {
    const id = el.dataset.fav!;
    const on = state.favorites.includes(id);
    el.classList.toggle('on', on);
    el.textContent = on ? '★' : '☆';
  });
}

function openSettings() {
  const body = document.querySelector<HTMLElement>('#dialogBody')!;
  const importBytes = state.imports.reduce((s, f) => s + f.size, 0);
  body.innerHTML = `
    <div class="dim">PREFERENCES · 偏好设置</div>
    <h2>设置</h2>
    <p class="dlgsub">按你的习惯调整游玩方式</p>
    <div class="statgrid">
      <div class="statbox"><div class="n">${GAME_COUNT}</div><div class="l">已收录游戏</div></div>
      <div class="statbox"><div class="n">${state.imports.length}</div><div class="l">我导入的</div></div>
      <div class="statbox"><div class="n">${(importBytes / 1e6).toFixed(1)}MB</div><div class="l">本机占用</div></div>
    </div>
    <div class="settingrow"><span class="grow">默认静音</span><button class="switch ${state.settings.muted ? 'on' : ''}" id="setMute"></button></div>
    ${isTouchDevice() ? `<div class="settingrow"><span class="grow">不再显示横屏提示</span><button class="switch ${state.settings.fullscreenHintSeen ? 'on' : ''}" id="setHint"></button></div>` : ''}
    ${inToyEnv() ? `<div class="settingrow"><span class="grow">云同步</span><span class="dim">${state.cloudSyncedAt ? '已开启 · 收藏/最近/设置跨设备' : '已开启 · 等待首次同步'}</span></div>
    <div class="settingrow"><span class="grow">UP 主关注</span><span class="dim">${followState === 'yes' ? '已关注 · 全部解锁' : followState === 'no' ? '未关注 · 仅前 5 款免费' : '状态未知 · 请稍后重试'}</span></div>` : ''}
    <div class="dialog-actions"><button class="outline" id="clearRecent">清空最近浏览</button><button class="outline" id="openAbout">关于本应用</button></div>`;
  document.querySelector('#overlay')?.classList.add('open');
  overlayOpen = true;
  body.querySelector('#setMute')?.addEventListener('click', (e) => {
    state.settings.muted = !state.settings.muted; save();
    (e.currentTarget as HTMLElement).classList.toggle('on', state.settings.muted);
  });
  body.querySelector('#setHint')?.addEventListener('click', (e) => {
    state.settings.fullscreenHintSeen = !state.settings.fullscreenHintSeen; save();
    (e.currentTarget as HTMLElement).classList.toggle('on', state.settings.fullscreenHintSeen);
  });
  body.querySelector('#clearRecent')?.addEventListener('click', () => { state.recent = []; save(); closeOverlay(); render(); });
  body.querySelector('#openAbout')?.addEventListener('click', () => openAbout());
}

function openAbout() {
  const body = document.querySelector<HTMLElement>('#dialogBody')!;
  body.innerHTML = `
    <div class="dim">关于</div>
    <h2>Flash 时光机</h2>
    <p class="dlgsub">打开就能玩的经典 Flash 小游戏库</p>
    <div class="about-story">
      <p>还记得那些年点开就玩的小游戏吗？画线、解谜、一键闯关、打发一整个下午……它们陪很多人度过了真实的旧时光。</p>
      <p>这里收录了 <b>${GAME_COUNT}</b> 款经典小游戏，点开就能玩，随时重温那份简单的快乐。</p>
    </div>
    <div class="info-grid">
      <div><b▶ 即点即玩</b>无需安装，点开就玩<br>选一款，马上开始</div>
      <div><b✦ 随手收藏</b>喜欢的游戏收进收藏<br>下次打开还在</div>
      <div><b⬆ 导入自己的</b>把你的 SWF 带进来<br>一起放进游戏库</div>
      <div><b♡ 安静陪伴</b>打开即玩，专注游戏本身<br>不打扰，只陪你玩</div>
    </div>
    <div class="oss-credit">
      <div class="oss-head">开源与许可</div>
      <p>本框架以 <b>MIT</b> 许可开源，播放器内核 Ruffle 采用 <b>MIT OR Apache-2.0</b> 双许可。</p>
      <p>项目地址：<a href="${OSS_REPO_URL}" target="_blank" rel="noopener">${OSS_REPO_URL}</a></p>
    </div>
    <div class="disclaimer">本 Toy 收录的 Flash 小游戏版权归各自权利人所有。如权利人认为使用方式不妥，欢迎联系我们，我们会尽快核实并移除。</div>`;
  document.querySelector('#overlay')?.classList.add('open');
  overlayOpen = true;
}

function closeOverlay(silent = false) {
  document.querySelector('#overlay')?.classList.remove('open');
  overlayOpen = false;
  if (!silent) { /* 保留弹窗 DOM，下次覆盖 */ }
}

// ---------- 本地导入 ----------
async function handleFile(file: File) {
  const result = document.querySelector<HTMLElement>('#fileResult');
  const show = (html: string) => { if (result) result.innerHTML = html; };
  try {
    if (!/\.swf$/i.test(file.name)) throw new Error('请选择 .swf 文件');
    if (file.size > 32_000_000) throw new Error('这个文件有点大，暂时只支持 32MB 以内的游戏');
    const data = await file.arrayBuffer();
    const sig = new TextDecoder('ascii').decode(data.slice(0, 3));
    if (!['FWS', 'CWS', 'ZWS'].includes(sig)) throw new Error('这个文件好像不是可用的 SWF 游戏，换一个试试');
    const sha = await sha256Of(data);
    const dup = state.imports.find((f) => f.sha256 === sha);
    if (dup) { show(`⚠️ 文件已存在：<b>${escHtml(dup.name)}</b>，可直接到「我的导入」播放。`); return; }
    const id = newImportedId();
    await saveImportBlob(id, data);
    state.imports.unshift({ id, name: file.name, size: file.size, sha256: sha, addedAt: Date.now(), plays: 0 });
    save();
    show(`✅ 已保存到本设备：<b>${escHtml(file.name)}</b> (${(file.size / 1e6).toFixed(2)} MB)。`);
    const list = document.querySelector<HTMLElement>('#localList');
    if (list) list.innerHTML = importListHtml();
    bindLocalList();
  } catch (e) {
    show(`❌ ${escHtml(String(e))}`);
  }
}

function bindLocalList() {
  document.querySelectorAll<HTMLElement>('[data-play-imp]').forEach((el) => {
    el.onclick = () => go('play', el.dataset.playImp);
  });
  document.querySelectorAll<HTMLElement>('[data-del-imp]').forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.delImp!;
      state.imports = state.imports.filter((f) => f.id !== id);
      await deleteImportBlob(id); save(); render();
    };
  });
  document.querySelector('#exportMeta')?.addEventListener('click', () => {
    const blob = new Blob([exportMetadata(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flash-rewind-metadata.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- 事件 ----------
function bindCommon() {
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.onclick = () => {
      const nav = el.dataset.nav!;
      if (nav === 'settings') { openSettings(); return; }
      if (nav === 'about') { openAbout(); return; }
      uiState.nav = nav; uiState.chip = '全部'; uiState.q = '';
      render();
    };
  });
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', (e) => {
    uiState.q = (e.target as HTMLInputElement).value;
    const grid = document.querySelector('.gamegrid');
    if (grid) {
      const q = uiState.q.trim().toLowerCase();
      let list: (Candidate | GameEntry)[] = [...releasedGames, ...candidates.filter((c) => !isReleased(c.id))];
      if (q) list = list.filter((g) => [searchTitles(g.id, g.title), g.author].join(' ').toLowerCase().includes(q));
      grid.innerHTML = list.length ? list.map((g) => cardHtml(g, { fav: state.favorites.includes(g.id), released: !!isReleased(g.id), locked: !isUnlocked(g.id) })).join('') : emptyHtml();
    }
  });
  document.querySelectorAll<HTMLElement>('[data-chip]').forEach((el) => {
    el.onclick = () => { uiState.chip = el.dataset.chip!; render(); };
  });
  document.querySelectorAll<HTMLElement>('.gamecard').forEach((el) => {
    el.onclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-fav]')) return;
      openDetail(el.dataset.id!);
    };
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(el.dataset.id!); } };
  });
  document.querySelectorAll<HTMLElement>('[data-fav]').forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); toggleFav(el.dataset.fav!); save(); renderLibraryKeep(); };
  });
  document.querySelector('#importBtn')?.addEventListener('click', () => { uiState.nav = 'local'; render(); });
  document.querySelector('#heroImportBtn')?.addEventListener('click', () => { uiState.nav = 'local'; render(); });
  document.querySelector('#randomBtn')?.addEventListener('click', () => {
    const pool = [...releasedGames, ...candidates.filter((c) => !isReleased(c.id))];
    openDetail(pool[hashIndex(String(Date.now()), pool.length)].id);
  });
  document.querySelector('#swfFile')?.addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void handleFile(f);
  });
  // PC 拖放导入
  const uploadbox = document.querySelector<HTMLElement>('.uploadbox');
  if (uploadbox) {
    uploadbox.addEventListener('dragover', (e) => { e.preventDefault(); uploadbox.style.borderColor = '#36E0C1'; });
    uploadbox.addEventListener('dragleave', () => { uploadbox.style.borderColor = ''; });
    uploadbox.addEventListener('drop', (e) => {
      e.preventDefault(); uploadbox.style.borderColor = '';
      const f = e.dataTransfer?.files?.[0];
      if (f) void handleFile(f);
    });
  }
  bindLocalList();
  document.querySelector('#closeDialog')?.addEventListener('click', () => closeOverlay());
  document.querySelector('#overlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay(); });
  document.addEventListener('keydown', onKey);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (route.page === 'play') go('all');
    else if (overlayOpen) closeOverlay();
  }
}

void boot();
