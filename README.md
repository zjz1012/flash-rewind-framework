# Flash 时光机（框架版）

一个自托管的 Flash 游戏加载框架：用 [Ruffle](https://ruffle.rs/) 在浏览器里跑 SWF，
前端为原生 TypeScript + Vite，适配 B 站 Toy 平台（关注解锁、云存档、二维码、分享、横屏），
也支持本地浏览器直接预览与「导入自己的 SWF」。

> **本仓库只含框架代码，不含任何游戏本体（SWF）、封面截图或第三方游戏素材。**
> 克隆后游戏库为空，可通过「导入我的 SWF」立即试玩自己的文件；批量接入见下文。

---

## 1. 选型到落地：为什么是这套栈

| 决策点 | 候选 | 结论 | 理由 |
|---|---|---|---|
| SWF 运行时 | Ruffle selfhosted / 在线 CDN / 自研播放器 | **Ruffle 0.8.0 自托管** | 纯 Rust→WASM，无 Flash 插件；自托管避免 CDN 不可用；官方 selfhosted 包把 `ruffle.js` + 两个 wasm 一起发布 |
| 前端框架 | React / Vue / 原生 TS | **原生 TypeScript** | Toy 有 140MB 硬限，框架运行时能省则省；本项目 DOM 结构不复杂，手写模板够用 |
| 路由 | History / Hash | **Hash** | Toy 静态托管无 rewrite 规则，hash 不需要服务端配合 |
| 样式 | Tailwind / 手写 CSS | **手写 CSS** | 单文件即可覆盖双端布局，避免构建期依赖 |
| 状态持久化 | localStorage / IndexedDB | **IndexedDB** | 要存导入的 SWF `Blob`，localStorage 容量不够；且收藏/最近/设置分表 |
| 平台能力 | Toy SDK / 自行实现 | **Toy SDK 薄封装** | 关注关系、云存档、扫码、分享都依赖平台私有接口，只能调 SDK；本地环境全部静默降级 |
| 封面 | 远程盗链 / 本地真实截图 / 程序生成标题卡 | **本地生成优先** | 远程盗链会失效且审核会读到外链；程序生成标题卡零版权风险，作为兜底 |
| 构建输出 | 相对路径 / 绝对路径 | **全部 `./` 相对路径** | Toy 部署在 `/toy/<slug>/` 子路径，绝对路径会 404 |

## 2. 目录结构

```
.
├── src/
│   ├── main.ts                 应用主体：路由、视图、事件、播放器生命周期
│   ├── ui.ts                   卡片/详情/键盘等 HTML 模板
│   ├── style.css               双端样式
│   ├── types.ts                数据契约（GameEntry / Candidate / 持久化状态）
│   ├── data/
│   │   ├── catalog.ts          清单聚合、封面分批、触屏判断
│   │   ├── released.generated.ts  ← 生成产物，示例仓库为空
│   │   └── title-zh.ts         中文译名表（示例为空）
│   ├── player/RuffleHost.ts    Ruffle 加载 / 播放 / 键盘事件 / 音量
│   ├── sdk/toy.ts              Toy SDK 封装（关注、跳转、云、二维码、横屏）
│   ├── sdk/cloud.ts            云存档字段与容量控制
│   └── storage/db.ts           IndexedDB：收藏 / 最近 / 导入 SWF / 设置
├── scripts/
│   ├── gen-catalog.mjs         CSV + SWF 文件 → released.generated.ts（签名/sha 校验）
│   ├── build-batch.mjs         分批构建（审核定位用）
│   ├── build-noimg.mjs         零图版构建（审核定位用）
│   ├── pack_package.py         打 Toy 上传 zip + 后缀白名单门禁
│   ├── capacity_check.py       140MB 体积门禁
│   ├── verify_package.mjs      解包后端到端验收
│   ├── verify_toy_sdk.mjs      Toy SDK 门禁专项（注入桩）
│   └── verify_*.mjs            标题 / UI / 虚拟键盘 / 零图 回归
├── content/清单模板.csv         批量接入用清单格式
├── public/
│   ├── games/.gitkeep          放 SWF 的地方（本仓库不留任何游戏文件）
│   └── licenses/               Ruffle 随附许可证
├── docs/
│   └── DEVLOG.md               从选型到落地的完整过程与踩坑
├── LICENSE / NOTICE
└── index.html                  仅通过 CDN 引用 Toy SDK，不 vendored
```

## 3. 快速开始

```bash
npm install          # postinstall 会把 Ruffle 运行时从 npm 包复制到 public/ruffle/
npm run dev          # http://127.0.0.1:5173
```

`public/ruffle/` 不入库（两个 wasm 约 29MB）。如需手动准备：
`node scripts/setup-ruffle.mjs`。它只从官方 npm 包复制，不修改 Ruffle 源码。

本地预览没有 `window.toy`，所有平台能力自动降级：游戏全解锁、云存档落到本地、
二维码/分享按钮不显示——这是刻意设计，方便调试。

**立即试玩**：首页点「导入我的 SWF」，选择任意 `.swf` 文件（≤32MB），
签名必须是 `FWS` / `CWS` / `ZWS`，导入后用 IndexedDB 保存，刷新仍在。

## 4. 批量接入自己的 SWF

1. 把 SWF 放进 `public/games/`，文件名建议 `<编号>_<英文名>.swf`。
2. 复制 `content/清单模板.csv` 为 `content/下载接入清单.csv`，逐行填写。
   必填列：`序号`、`游戏名称`、`本地文件`、`直达URL`（可空）、`玩法分类`、`规划批次`、
   `已索引大小(字节)`、`手机操作预估`。
3. 生成清单（会校验签名并重算大小/sha256）：

   ```bash
   node scripts/gen-catalog.mjs
   ```

4. 构建 + 打包：

   ```bash
   npm run build
   python scripts/capacity_check.py ./dist
   python scripts/pack_package.py
   ```

### ⚠️ 平台后缀白名单（重要）

B 站 Toy 只服务白名单后缀，`.swf` 会被**静默丢弃**——线上表现是 Ruffle 报
`Failed to fetch ...swf`。生成脚本会把落盘与引用统一改成 `<原名>.swf.data`，
`pack_package.py` 会硬校验越界后缀。**不要手动改回 `.swf`。**

## 5. Toy SDK 接入点

| 能力 | 位置 | 行为 |
|---|---|---|
| 关注解锁 | `src/sdk/toy.ts` `checkFollow()` | 未关注锁前 N 款之外的游戏，跳作者主页用 `navigate({type:'space', id})` |
| 作者本人放行 | `isAuthorSelf()` | SDK 不提供 UID/MID，只能昵称比对（`VITE_AUTHOR_NICK`），弱校验、仅放行本人 |
| 云存档 | `src/sdk/cloud.ts` | 批量写，≤128 key / 1024B；超限降级本地 |
| 二维码 / 分享 | `qrForGame()` / `shareGame()` | 只能指向 Toy 内相对路径 `index.html?play=<id>` |
| 横屏沉浸 | `requestLandscape()` | 调用只代表发出请求，生效靠 `onContainerChange` 确认 |

Fork 请在 `.env.local` 配置：

```
VITE_AUTHOR_MID=你的mid
VITE_AUTHOR_NICK=你的昵称
VITE_FREE_IDS=fl001,fl002        # 可选：免费游戏 id，逗号分隔
```

## 6. 验证

```bash
npm run build                       # 类型检查 + 构建
node scripts/verify_package.mjs dist   # 解包后端到端（需 Chrome 或 Playwright chromium）
node scripts/verify_toy_sdk.mjs        # Toy SDK 门禁桩
```

无 Chrome 时脚本用 Playwright 自带 chromium；如需指定：
`CHROME_PATH=/path/to/chrome node scripts/verify_package.mjs dist`。

## 7. 许可与素材边界

- 框架代码：MIT（见 `LICENSE`）。
- Ruffle：MIT OR Apache-2.0，随附双许可见 `NOTICE` 与 `public/licenses/`。
- Toy SDK：B 站平台提供，本项目只通过 CDN 引用，不 vendored、不修改。
- **游戏 SWF / 封面截图 / 宣传片素材均不在本仓库**，接入第三方游戏前请自行确认授权。
- `docs/DEVLOG.md` 记录的是工程过程与平台适配经验，不含任何第三方游戏文件。
