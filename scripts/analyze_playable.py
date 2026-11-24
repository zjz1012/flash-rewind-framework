"""分析逐款双帧截图，量化判定可玩性。
判据（结合 2026-11-21 黑名单教训：画布存在 != 有画面）：
- 两帧都接近纯色且极暗 (std<6, lit<0.03) => 黑屏/空白 => 受限(site lock/加载失败)
- 双帧差异极小 + 颜色数极少(<5) => 静态空画面 => 受限
- 否则 => 可玩（有丰富色彩或有动态内容）
输出 content/实测结果.csv: 序号,判定,原因,mean,std,lit,colors,diff
"""
import os, glob, json, math, csv
from PIL import Image, ImageChops, ImageStat

OUT = 'verification/playtest'
res = {}
for p1 in sorted(glob.glob(os.path.join(OUT, 'fl*_1.png'))):
    base = os.path.basename(p1)[:-6]  # flXXX
    p2 = p1.replace('_1.png', '_2.png')
    if not os.path.exists(p2):
        continue
    a = Image.open(p1).convert('RGB')
    b = Image.open(p2).convert('RGB')
    a = a.resize((min(a.width, 240), min(a.height, 160)))
    b = b.resize((a.width, a.height))

    def stats(im):
        px = list(im.getdata())
        n = len(px)
        lum = [0.299 * r + 0.587 * g + 0.114 * bb for r, g, bb in px]
        mean = sum(lum) / n
        std = math.sqrt(sum((x - mean) ** 2 for x in lum) / n)
        lit = sum(1 for x in lum if x > 40) / n
        colors = len(set((r // 32, g // 32, bb // 32) for r, g, bb in px))
        return mean, std, lit, colors

    m1, s1, l1, c1 = stats(a)
    m2, s2, l2, c2 = stats(b)
    # 双帧平均绝对像素差
    diff = sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3
    mean = (m1 + m2) / 2
    std = max(s1, s2)
    lit = max(l1, l2)
    colors = max(c1, c2)

    # 判定
    if std < 6 and lit < 0.03:
        verdict, reason = '受限', '黑屏/空白：SWF 只渲染纯背景（疑似域名锁或加载失败）'
    elif colors < 5 and diff < 1.0:
        verdict, reason = '受限', '静态空画面：无有效游戏内容'
    elif colors < 8 and std < 10 and diff < 2.0:
        verdict, reason = '可疑', '画面极简或几乎静止，需人工复核'
    else:
        verdict, reason = '可玩', ''
    res[base] = {
        'mean': round(mean, 1), 'std': round(std, 1), 'lit': round(lit, 3),
        'colors': colors, 'diff': round(diff, 2),
        'verdict': verdict, 'reason': reason,
    }

# 结合请求错误：外部资源 403 但画面正常则不判受限（只是缺音乐/关卡），仅记录
rpath = {}
for f in ['verification/playtest/result_0_40.json', 'verification/playtest/result_40_79.json', 'verification/playtest/result_76_132.json']:
    if os.path.exists(f):
        for r in json.load(open(f)):
            rpath[r['id']] = r

print(f'{"id":<8}{"mean":>7}{"std":>7}{"lit":>7}{"col":>5}{"diff":>7}  verdict')
for k in sorted(res):
    v = res[k]
    print(f'{k:<8}{v["mean"]:>7}{v["std"]:>7}{v["lit"]:>7}{v["colors"]:>5}{v["diff"]:>7}  {v["verdict"]}')

# 写出实测结果 CSV（gen-catalog.mjs 读取；仅"受限"写入 blockReason）
with open('content/实测结果.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['序号', '判定', '原因', 'mean', 'std', 'lit', 'colors', 'diff'])
    for k in sorted(res):
        v = res[k]
        w.writerow([k, v['verdict'], v['reason'], v['mean'], v['std'], v['lit'], v['colors'], v['diff']])

from collections import Counter
summary = Counter(v['verdict'] for v in res.values())
print('\n汇总:', dict(summary), ' 总计', len(res))
json.dump(res, open('verification/playtest/stats.json', 'w'), indent=1, ensure_ascii=False)
