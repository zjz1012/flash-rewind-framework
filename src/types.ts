/** 游戏候选（catalog.seed.json，100 款只读展示，不可玩） */
export interface Candidate {
  id: string;
  title: string;
  author: string;
  genre: string;
  inputHint: string;
  wave: number;
  source: string;
  status: 'candidate';
  file: string | null;
  bytes: number | null;
}

/** 正式发布条目（release.manifest.json，仅通过审核并植入 SWF 的条目） */
export interface GameEntry {
  id: string;
  title: string;
  titleZh?: string;
  author: string;
  genres: string[];
  wave: 1 | 2 | 3;
  control: 'mouse' | 'drag' | 'one' | 'two' | 'dpad' | 'pc-only';
  aspectRatio?: number;
  swfPath: string;
  thumbnailPath?: string;
  sizeBytes: number;
  sha256: string;
  /** 来源与授权信息只做内部审计，不写进发布产物（避免外链/第三方站名进入 bundle） */
  rights?: {
    license: string;
    sourceUrl: string;
    repoUrl?: string;
    approved: boolean;
    credit: string;
  };
  compatibility: {
    ruffleVersion: string;
    android: string;
    ios: string;
    desktop: string;
    saveSupport: 'none' | 'native-sol-tested' | 'unknown';
  };
  /** SWF 内部引用但不在包内的外部资源（会导致功能不完整） */
  externalDeps?: string[];
  /** 实测无法播放的原因（如域名锁 site lock）；有此字段则不计入可玩数 */
  blockReason?: string;
  status: 'released';
  preset: 'mouse' | 'one' | 'none'; // 触屏操作预设
}

/** 玩家本地导入的 SWF */
export interface ImportedGame {
  id: string;
  name: string;
  size: number;
  sha256: string;
  addedAt: number;
  lastPlayedAt?: number;
  plays: number;
}
