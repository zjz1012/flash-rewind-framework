#!/usr/bin/env python3
"""把 dist/ 打成可上传的 Toy 包（zip 根目录即 index.html）。

用法：python scripts/pack_package.py [输出路径] [--dist=dist-noimg] [--tag=noimg]

要点：
- **后缀白名单校验**：B站 Toy 只服务白名单后缀，其它文件会被平台整包丢弃
  （线上实测：`.swf` 全部 404，导致 Ruffle 报 `Failed to fetch ...swf`）。
  所以 SWF 一律以 `.swf.data` 落盘，并在这里硬校验，越界直接 FAIL。
- 排除 `.swf.wasm` 预览别名（只有本地预览用，正式包里不需要，且会让体积翻倍）
- 排除 sourcemap / 系统垃圾文件
- 统一用 `/` 作为 zip 内路径分隔符，避免 Windows 反斜杠导致解包出奇怪目录
- 输出体积对比 + 最大文件清单，便于核对 140MB 硬限
- --dist 可指定其它构建目录（如零图版 dist-noimg），--tag 给输出文件名加标记
"""
from __future__ import annotations

import os
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
LIMIT = 140_000_000          # B站 Toy 硬限（decimal）
INTERNAL = 125_000_000       # 内部告警线

SKIP_SUFFIX = (".swf.wasm", ".map")
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}

# B站 Toy 只服务这些后缀，其余会被平台丢弃（不会报错，静默消失）
TOY_WHITELIST = {
    # 页面、代码、数据
    ".html", ".htm", ".css", ".js", ".json", ".wasm", ".data", ".md", ".csv", ".tsv",
    # 图片
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    # 字体
    ".woff2", ".woff", ".ttf", ".eot",
    # 音视频
    ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm",
}


def mb(n: int) -> str:
    return f"{n / 1_000_000:.2f} MB"


def main() -> int:
    argv = sys.argv[1:]
    dist = DIST
    tag = ""
    positional: list[str] = []
    for a in argv:
        if a.startswith("--dist="):
            dist = (ROOT / a.split("=", 1)[1]).resolve()
        elif a.startswith("--tag="):
            tag = a.split("=", 1)[1].strip("-")
        else:
            positional.append(a)

    if not dist.is_dir():
        print(f"ERROR: {dist} 不存在，先跑构建")
        return 2
    if not (dist / "index.html").is_file():
        print(f"ERROR: {dist}/index.html 缺失")
        return 2

    name = f"flash-rewind-toy{'-' + tag if tag else ''}-{time.strftime('%Y%m%d-%H%M')}.zip"
    out = Path(positional[0]) if positional else ROOT / "dist-packages" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    skipped: list[Path] = []
    added = 0
    raw = 0
    illegal: dict[str, int] = {}

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, _dirnames, filenames in os.walk(dist):
            for fname in filenames:
                p = Path(dirpath) / fname
                if fname in SKIP_NAMES or fname.endswith(SKIP_SUFFIX):
                    skipped.append(p)
                    continue
                ext = p.suffix.lower()
                if ext not in TOY_WHITELIST:
                    illegal[ext or "(无后缀)"] = illegal.get(ext or "(无后缀)", 0) + 1
                arc = p.relative_to(dist).as_posix()
                z.write(p, arc)
                added += 1
                raw += p.stat().st_size

    size = out.stat().st_size
    print(f"源目录：{dist}")
    print(f"输出：{out}")
    print(f"文件数：{added}（跳过 {len(skipped)} 个预览别名/垃圾文件）")
    print(f"原始体积：{mb(raw)}  →  压缩后：{mb(size)}")

    top = sorted(
        (p for p in dist.rglob("*") if p.is_file() and not p.name.endswith(SKIP_SUFFIX)),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )[:6]
    print("最大文件：")
    for p in top:
        print(f"  {mb(p.stat().st_size):>10}  {p.relative_to(dist).as_posix()}")

    ok = True
    if size > LIMIT:
        print("FAIL: 超过 140,000,000 字节硬限")
        ok = False
    elif size > INTERNAL:
        print("WARN: 超过内部 125MB 告警线，但仍在上传硬限内")
    else:
        print("PASS: 在内部 125MB 预算内")

    if illegal:
        print("FAIL: 存在不在 Toy 白名单内的后缀，这些文件在线上会被平台丢弃：")
        for ext, cnt in sorted(illegal.items(), key=lambda kv: -kv[1]):
            print(f"  {ext:>10} × {cnt}")
        ok = False
    else:
        print("PASS: 全部文件后缀都在 Toy 白名单内")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
