/**
 * Ruffle 播放器封装。基于官方 selfhosted 0.8.0：window.RufflePlayer.newest().createPlayer()
 * 使用 player.ruffle().load({ url | data }) 稳定 API。
 */

type LoadOptions = {
  url?: string;
  data?: ArrayBuffer;
  swfFileName?: string;
  openUrlMode?: string;
  allowScriptAccess?: boolean;
  allowNetworking?: string;
  [k: string]: unknown;
};

interface RufflePlayerV1 {
  load(options: LoadOptions): Promise<void>;
  reload(): Promise<void>;
  suspend(): void;
  resume(): void;
  volume: number;
  isPlaying?: boolean;
}

interface RuffleElement extends HTMLElement {
  ruffle(): RufflePlayerV1;
}

interface RuffleNamespace {
  newest(): { createPlayer(): RuffleElement };
  publicPath?: string;
}
declare global {
  interface Window {
    RufflePlayer?: RuffleNamespace;
    __RUFFLE_READY__?: Promise<void>;
  }
}

let loaderPromise: Promise<void> | null = null;

/** 动态加载本地 ruffle.js（selfhosted，无 CDN） */
export function loadRuffle(base: string): Promise<void> {
  if (window.__RUFFLE_READY__) return window.__RUFFLE_READY__;
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<void>((resolve, reject) => {
    if (window.RufflePlayer?.newest) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${base}ruffle/ruffle.js`;
    script.async = true;
    script.onload = () => {
      if (!window.RufflePlayer?.newest) {
        reject(new Error('Ruffle 脚本已加载但 window.RufflePlayer 未就绪'));
        return;
      }
      // 告诉 ruffle.js 去哪里找 wasm；两个 wasm 已本地随包发布
      window.RufflePlayer.publicPath = `${base}ruffle/`;
      resolve();
    };
    script.onerror = () => reject(new Error('无法加载本地 Ruffle 运行时'));
    document.head.appendChild(script);
  });
  window.__RUFFLE_READY__ = loaderPromise;
  return loaderPromise;
}

export class RuffleHost {
  private player: RuffleElement | null = null;
  private api: RufflePlayerV1 | null = null;
  private base: string;

  constructor(private container: HTMLElement, base = './') {
    this.base = base.endsWith('/') ? base : base + '/';
  }

  async loadGame(swfPathOrData: { url: string } | { data: ArrayBuffer; name: string }): Promise<void> {
    await loadRuffle(this.base);
    this.destroy();
    const player = window.RufflePlayer!.newest().createPlayer();
    player.style.width = '100%';
    player.style.height = '100%';
    player.style.display = 'block';
    this.container.replaceChildren(player);
    this.player = player;
    this.api = player.ruffle();

    const common: Record<string, unknown> = {
      openUrlMode: 'deny',
      allowScriptAccess: false,
      allowNetworking: 'internal', // 注意：'none' 未实现，'internal' 也非完全断网保证
      backgroundColor: '#0b1020',
    };
    // 测试用：?renderer=canvas 强制软件渲染，用于排查 wgpu-webgl 兼容性。
    // 正式构建不应带此参数（构建自检会拦截）。
    const testRenderer = new URLSearchParams(location.search).get('renderer');
    if (testRenderer === 'canvas' || testRenderer === 'webgl') {
      common.renderer = testRenderer;
    }

    if ('url' in swfPathOrData) {
      await this.api.load({ ...common, url: this.resolveAsset(swfPathOrData.url) });
    } else {
      const sig = new TextDecoder('ascii').decode(swfPathOrData.data.slice(0, 3));
      if (!['FWS', 'CWS', 'ZWS'].includes(sig)) throw new Error('SWF 文件头无效（应为 FWS/CWS/ZWS）');
      await this.api.load({
        ...common,
        data: swfPathOrData.data,
        swfFileName: swfPathOrData.name,
      });
    }
  }

  private resolveAsset(url: string): string {
    if (/^https?:\/\//.test(url)) return url;
    return this.base + url.replace(/^\.\//, '');
  }

  /**
   * 向 SWF 发送一个键盘事件（虚拟键盘用）。
   * 依据 Ruffle 官方集成测试 programmatic_events：
   *   1) 先让 player（或其 shadow #container）获得焦点，否则 Ruffle 忽略事件；
   *   2) 事件派发到 ruffle-player 宿主元素（不是 window）；
   *   3) keydown 与 keyup 成对，带上 key/code/keyCode/which + bubbles + composed。
   * 实测：答题类 SWF 用此法输入数字能正常进关。
   */
  sendKey(key: string, code: string, keyCode: number): void {
    if (!this.player) return;
    const el = this.player;
    // Ruffle 只接受获得焦点的播放器的键盘事件
    (el.shadowRoot?.querySelector('#container') as HTMLElement | null)?.focus?.();
    el.focus();
    const opts: KeyboardEventInit & { keyCode: number; which: number } = {
      key, code, keyCode, which: keyCode, bubbles: true, composed: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  setVolume(v: number): void {
    if (this.api) this.api.volume = Math.max(0, Math.min(1, v));
  }

  getVolume(): number {
    return this.api?.volume ?? 1;
  }

  suspend(): void {
    this.api?.suspend();
  }

  resume(): void {
    this.api?.resume();
  }

  async reload(): Promise<void> {
    await this.api?.reload();
  }

  /** 播放器卸载，释放 wasm/WebGL 资源 */
  destroy(): void {
    try {
      this.api?.suspend();
    } catch {
      /* ignore */
    }
    if (this.player) {
      this.player.remove();
      this.player = null;
      this.api = null;
    }
    this.container.replaceChildren();
  }
}
