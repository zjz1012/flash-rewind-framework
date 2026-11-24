// 自动生成，勿手改。来源: scripts/gen-catalog.mjs + content/下载接入清单.csv
//
// 本开源仓库不含任何游戏本体，因此清单默认为空。
// 想接入自己的 SWF：把文件放到 public/games/，按 content/清单模板.csv 填好清单，
// 然后运行 `node scripts/gen-catalog.mjs` 重新生成本文件。
// 生成逻辑会校验 SWF 签名（FWS/CWS/ZWS）、重算大小与 sha256，不信任清单里的旧值。
//
// 单条数据结构示例（字段含义见 src/types.ts 的 GameEntry）：
// {
//   id: "fl001", title: "My Game", author: "someone", genres: ["休闲"],
//   wave: 1, control: "mouse", preset: "mouse", aspectRatio: 4 / 3,
//   swfPath: "games/001_my_game.swf.data", sizeBytes: 12345, sha256: "...",
//   compatibility: { ruffleVersion: "0.8.0", android: "pending", ios: "pending",
//                    desktop: "pending", saveSupport: "unknown" },
//   status: "released",
// }
import type { GameEntry } from '../types';

export const releasedGames: GameEntry[] = [];
