# 开发记录：从选型到落地

> 这是一份工程过程记录，聚焦**框架与平台适配**，不含任何游戏本体或第三方素材。
> 具体游戏 id、作者昵称、审核试错定位等过程细节已脱敏。

## 阶段 0：需求与边界

目标：做一个跑在 B 站 Toy 上的 Flash 小游戏合集框架，双端（手机 + PC），
整包 ≤140MB（平台硬限），支持本机 SWF 导入，游戏库可分批接入。

一开始就把两件事分开：
- **框架**（本仓库）：加载器、清单生成、UI、平台 SDK 适配、构建与验收脚本。
- **内容**（不在本仓库）：SWF 本体、封面截图、宣传片。

这条边界是整个项目最重要的决定——它让框架可以独立开源，也避免把未授权内容
和平台审核试错细节一起带出去。

## 阶段 1：技术选型

| 问题 | 当时的判断 |
|---|---|
| 为什么不用 EmulatorJS / 在线 Flash 站 iframe | 前者体积大且面向多核心，后者有站外链接与授权问题，Toy 审核过不了 |
| 为什么 Ruffle selfhosted | 官方 WASM 构建，纯前端；GitHub Release zip 在本机网络下 TLS 频繁中断，改用 npm 包 `@ruffle-rs/ruffle` 拿到同样的产物 |
| 为什么不用 UI 框架 | 140MB 预算下能省则省；DOM 结构不复杂，手写模板 + 事件委托足够 |
| 为什么 hash 路由 | Toy 静态托管没有 rewrite 规则，history 模式刷新会 404 |
| 为什么 IndexedDB | 要存导入的 SWF Blob；localStorage 容量不够，且收藏/最近/设置需要分表 |
| 封面策略 | 远程盗链会失效、审核会读到外链；改成「本地真实截图 + 程序生成标题卡兜底」 |

## 阶段 2：最小可玩闭环

第一版只有 3 款自托管 SWF，验证链路：

```
CSV 清单 → gen-catalog.mjs 生成 manifest → Vite 构建 → Ruffle 加载 → 收藏/导入/设置
```

几个早期踩坑（都已沉淀进代码注释）：

- `new URL().pathname` 在 Windows 上会得到 `D:\D:\...` 这种坏路径，
  统一改用 `fileURLToPath(import.meta.url)`。
- `stat/readFile` 从 `node:fs` 导入后在 `await` 下会得到 `undefined`，
  异步 API 必须从 `node:fs/promises` 导入。
- 大文件下载在此网络反复超时，最后用 `curl --retry 3 --max-time 180` 才成功。
- Windows 下 `/tmp` 映射到别处，临时脚本要放项目目录。

## 阶段 3：验证方法的两次纠错（最值得记的教训）

### 3.1 假阳性：画布存在 ≠ 游戏能玩

第一版验收脚本判据是「`ruffle-player` 元素存在 + shadow DOM 里有 canvas」，
于是报告「全部渲染成功」。用户点开发现大量黑屏。

根因：Ruffle 有橙色 click-to-play 遮罩，元素存在不代表游戏画面出来了。

修正：
1. 真实点击启动遮罩；
2. 截图游戏区做像素判定（颜色数 / 标准差），不能只看 DOM；
3. 多帧确认——发布商标题页的 Play 按钮、加载页动画都会骗过单帧判定。

这条教训比任何一行代码都重要：**验证要对齐用户真正看到的东西**。

### 3.2 假阳性：像素判定也会误杀

加长等待 + 多帧后，仍有发布商标题页被当成"可玩"。
最终结论：自动判定只能筛掉明显坏的，**最终可玩性以真机实测为准**。
受限项（域名锁 site lock、外部关卡依赖）改成在清单里标注并从包里物理剔除。

## 阶段 4：Toy 平台适配

平台 SDK 提供能力，但有几处必须小心：

1. **关注解锁**：`getAuthorRelation().data.isFollowing` 为准；本地无 SDK 一律放行，
   方便调试。跳作者主页必须在 click 里同步调 `navigate({type:'space'})`，
   不能先 `await` 别的东西，否则会被浏览器当成非用户手势拦截。
2. **作者主页 mid**：不能依赖 `getAuthorProfile().data.mid`（文档未承诺返回，
   取不到会退化成昵称搜索、跳错页），用固定配置 mid 作为唯一权威。
3. **作者本人放行**：SDK 不提供 UID / MID，也没有「我是否等于作者」接口，
   只能昵称比对。这是弱校验，只用来让作者自己不被门禁挡住，不承担鉴权。
4. **二维码 / 分享**：`path` 只允许 Toy 内相对路径，不能带完整 URL，
   统一生成 `index.html?play=<id>`。
5. **横屏沉浸**：`setContainerMode()` 返回只代表调用成功，不代表生效；
   真正生效靠 `onContainerChange` 回调确认。
6. **云存档**：128 key / 1024B 硬限，批量写要压缩字段、超限降级本地。

## 阶段 5：虚拟键盘（推翻旧结论）

一开始代码注释写着「合成键盘事件不被 Ruffle 可靠接受」，于是虚拟按键面板
做成死代码（DOM 存在但永远 hidden）。用户问「是不是不支持虚拟按键」，
查 Ruffle 官方集成测试 `programmatic_events` 发现可以做，之前是错的。

根因不是"不接受"，是**没先 focus**。正确做法：
1. 先 `player.focus()`（或 shadow 里的 `#container`）；
2. 事件派发到 `ruffle-player` 宿主元素，不是 `window`；
3. `keydown` / `keyup` 成对，带 `key/code/keyCode/which` + `bubbles` + `composed`。

实现后答题类 SWF 用程序化按键能正常输入、进关，与真实键盘效果一致。

配套踩坑：
- Windows 触屏笔记本 `navigator.maxTouchPoints` 也可能 >0，
  判断触屏只认 `'ontouchstart' in window`。
- 键盘浮层用 normal flow 会把画布挤扁，改成 `position:fixed` 浮层。
- "帧字节变化"判据要确认真的进了游戏，否则标题页动画也会变，仍是假阳性。

## 阶段 6：平台后缀白名单（线上 404 事故）

上线后 Ruffle 报 `Failed to fetch .../xxx.swf`。排查发现：
Toy 静态托管只服务白名单后缀，`.swf` 被整包**静默丢弃**——构建产物里有，
上传后就没了，且没有任何报错。

解法：SWF 落盘与引用统一改成 `<原名>.swf.data`，打包脚本硬校验越界后缀。
这个文件后缀不变内容，Ruffle 按字节流解析（读 FWS/CWS/ZWS 头），不看后缀和 MIME。

同理，本地预览服务也有扩展名白名单：给每个 SWF 生成一个 `.swf.wasm` 别名
（后缀在白名单内）并把 JS 里的路径改写过去，本地就能预览。别名只用于预览，
正式打包时剔除。

## 阶段 7：审核试错的方法论

平台 AI 审核驳回时，日志不会告诉你是哪个文件的问题。有效的定位方法：

1. **零图版**：先去掉全部封面，只留文字列表，确认是不是图片问题；
2. **分批恢复**：按列表顺序分批发版，定位问题区间；
3. **跳过法**：把可疑项跳过，若能过审则问题就在被跳过的项里；
4. **镜像包对照**：同时出两个包，只有一个能过审，差异项就是嫌疑。

这套流程沉淀成了 `build-batch.mjs`（分批）、`build-noimg.mjs`（零图）两个脚本，
它们在本框架里保留为通用调试工具，但对具体游戏的试错结果不在本仓库。

## 阶段 8：文案与界面收敛

- 面向用户的界面不出现版权、审核、批次、技术术语，这些只留在数据层与开发文档。
- 标题统一清洗：把来源站标记、归档版本、语言版本等"整理者备注"在构建期去掉，
  只留玩家真正需要的游戏名。清洗规则做成 `SITE_MARKS` 环境变量可配置。
- 中文译名表与英文原名分工：主标题用中文（命中率高），英文原名作副标题保留，
  避免翻译不准影响识别。
- 改过滤逻辑时踩过一次坑：两种数据类型字段不同（一个是 `genre` 单数，
  一个是 `genres` 复数），用错字段会让所有项落进同一分类。回归测试抓到了。

## 阶段 9：构建与验收的可复现性

最终沉淀下来的验收链：

```
npm run build                          # 类型检查 + 构建
python scripts/capacity_check.py ./dist # 140MB 体积门禁
python scripts/pack_package.py          # 后缀白名单 + zip
node scripts/verify_package.mjs dist    # 解包后端到端（真机路径 /toy/<slug>/）
node scripts/verify_toy_sdk.mjs         # SDK 门禁桩（关注/解锁/分享/二维码/横屏）
node scripts/verify_ui_regression.mjs   # UI 回归
node scripts/verify_virtual_keyboard.mjs
node scripts/verify_zh_titles.mjs
node scripts/verify_noimg.mjs
```

本机环境有两个特殊约束，脚本里都做了处理：
- 不允许常驻后台进程 → 所有验证脚本**同进程自起自停**静态服务；
- `http_proxy` 会劫持本地访问 → Playwright 启动加 `--no-proxy-server`，
  curl 加 `--noproxy '*'`。

脚本统一支持 `CHROME_PATH` 环境变量指定浏览器，默认用 Playwright 自带 chromium，
便于在其他机器上复现。

## 收尾：什么没放进这个仓库

- 所有 SWF 本体（88MB+）与封面截图；
- 批量接入的真实清单与来源 URL（可能指向第三方站点）；
- 平台审核试错的具体游戏 id 与定位过程；
- 宣传片工程（口播、BGM、渲染产物）——那是一次独立的视频制作，不属于框架。

留下的，是一个能独立构建、独立验证、可以安全 fork 的加载框架。
