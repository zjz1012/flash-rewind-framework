/**
 * 展示标题清洗：去掉归档版本 / 语言版本这类整理者备注。
 *
 * 来源站名（各小游戏站的品牌词）不在这里写死：清洗在 scripts/gen-catalog.mjs 构建期完成，
 * 生成数据里已无站名；这里再写一份会把这些站名以正则源码形式带进发布产物。
 */
export function cleanDisplayTitle(title: string): string {
  return title
    .replace(/[（(]\s*(?:旧版|存档版|中文Flash(?:版)?|Flash)\s*[）)]/gi, '')
    .replace(/\s*[·•・]\s*(?:旧版|存档版)\s*$/i, '')
    .trim();
}

/**
 * 中文译名表（展示用，不改变 SWF / 数据层）
 * key = 游戏 id（fl + 序号），value = 中文译名
 *
 * 示例仓库不预置译名。fork 后按需把 id 映射到中文展示名；
 * 未命中时用原始标题展示，英文原名作副标题保留。
 */
export const TITLE_ZH: Record<string, string> = {
  // 示例：把你自己的 id 映射到中文展示名。
  // fl001: '我的游戏',
};

/**
 * 隐去英文原名：原名里带暴力/射击类敏感词（Kills、shoot 等），
 * 中文名已中文化，界面不再显示英文副标题，避免内容审核命中。
 */
const HIDE_EN = new Set<string>();

/**
 * 取得展示标题。
 * - zh：主标题（译名，找不到时用原英文标题）
 * - en：英文原名（仅当与译名不同时给出，作副标题显示；相同则返回 undefined）
 * - enOriginal：是否英文原版且已有译名（用于「英文原版」标记）
 */
export function displayTitle(id: string, original: string): {
  zh: string;
  en?: string;
  enOriginal: boolean;
} {
  const cleanOriginal = cleanDisplayTitle(original);
  const zh = TITLE_ZH[id] ?? cleanOriginal;
  const different = zh !== cleanOriginal;
  const hideEn = HIDE_EN.has(id);
  return {
    zh,
    en: different && !hideEn ? cleanOriginal : undefined,
    enOriginal: different && !hideEn && /[a-zA-Z]/.test(cleanOriginal),
  };
}

/** 搜索用：把 id 对应的中英文名都拼进索引 */
export function searchTitles(id: string, original: string): string {
  const cleanOriginal = cleanDisplayTitle(original);
  const zh = TITLE_ZH[id];
  return zh && zh !== cleanOriginal ? `${cleanOriginal} ${zh}` : cleanOriginal;
}
