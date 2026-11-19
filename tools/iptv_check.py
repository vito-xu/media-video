#!/usr/bin/env python3
"""
IPTV 源聚合 + 测速（纯标准库，不需要 Docker / FFmpeg）

源池可来自：
  --pool <url|file>   外部 m3u（默认用 Guovin/TV 的公开结果，频道覆盖最全）
  无 --pool           回退到 iptv-org 中国频道表

流程：拉源池 → 并发探活（读 m3u8 主列表取分辨率）→ 每频道保留最快的 N 条
     → 写出 live/cn.m3u（每频道 1 条）+ live/cn.bak.txt（备用接口表）

用法：
  python3 tools/iptv_check.py                      # 全量刷新
  python3 tools/iptv_check.py --no-fetch           # 用缓存池，只重测
  python3 tools/iptv_check.py --min-height 720 --topn 3 --workers 40
"""
import argparse
import json
import os
import re
import ssl
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
UA = "okhttp/3.15"

DEFAULT_POOL = "https://cdn.jsdelivr.net/gh/Guovin/TV@gd/output/result.m3u"

# 明确排除：境外宗教 / 政治敏感 / 非大陆频道
BLOCK = [
    "VoA", "VOA", "BRICS", "ABN China", "Angel TV", "Ando TV", "Bread TV",
    "Kangba", "CCTV+", "Religious", "Gospel", "Epoch", "NTD", "Falun",
    "港·澳·台", "翡翠台", "明珠台", "凤凰", "TVBS", "纬来", "东森", "三立",
    "靖天", "星卫", "无线新闻", "Viutv", "Now剧集",
]

# 分组归一（按 group-title 关键词 → 展示分组）
GROUP_RULES = [
    ("央视", "央视频道"),
    ("卫视", "卫视频道"),
    ("体育", "体育频道"),
    ("电影", "电影频道"),
    ("动画", "少儿动画"),
    ("咪咕", "咪咕直播"),
    ("音乐", "音乐频道"),
    ("剧场", "经典剧场"),
    ("游戏", "游戏频道"),
]

GROUP_ORDER = ["央视频道", "卫视频道", "体育频道", "电影频道", "少儿动画",
               "咪咕直播", "音乐频道", "游戏频道", "经典剧场"]


def clean_group(raw):
    g = re.sub(r"[^\u4e00-\u9fa5A-Za-z·]+", "", raw or "").strip()
    for kw, name in GROUP_RULES:
        if kw in g:
            return name
    return g or "其他频道"


def group_rank(g):
    return GROUP_ORDER.index(g) if g in GROUP_ORDER else len(GROUP_ORDER)


def fetch(url, timeout=30):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return urlopen(Request(url, headers={"User-Agent": UA}), timeout=timeout, context=ctx).read()


def load_pool(src, refresh=True):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, "pool.m3u")
    if refresh or not os.path.exists(local):
        print(f"· 拉取源池 {src[:70]} ...")
        data = fetch(src)
        open(local, "wb").write(data)
    txt = open(local, encoding="utf-8", errors="ignore").read()

    chans, order = {}, []
    for meta, name, url in re.findall(r"#EXTINF:-1 ([^\n]*),([^\n]+)\n(https?://[^\s]+)", txt):
        name = name.strip()
        # 跳过更新时间注释行被误当频道名的情况
        if re.match(r"^\d{4}-\d{2}-\d{2}", name):
            continue
        if not name or any(b.lower() in name.lower() for b in BLOCK):
            continue
        g = clean_group((re.search(r'group-title="([^"]*)"', meta) or [None, ""])[1])
        logo = (re.search(r'tvg-logo="([^"]*)"', meta) or [None, ""])[1]
        if name not in chans:
            chans[name] = {"group": g, "logo": logo, "urls": []}
            order.append(name)
        if url not in chans[name]["urls"]:
            chans[name]["urls"].append(url)
    return chans, order


def probe(url, timeout=7):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    t0 = time.time()
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=timeout, context=ctx) as r:
            head = r.read(4096)
        ms = int((time.time() - t0) * 1000)
    except Exception:
        return None
    if b"#EXTM3U" not in head and b"#EXTINF" not in head:
        return None
    text = head.decode("utf-8", "ignore")
    hs = [int(m.group(1)) for m in re.finditer(r"RESOLUTION=\d+x(\d+)", text)]
    return {"url": url, "ms": ms, "h": max(hs) if hs else 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=DEFAULT_POOL)
    ap.add_argument("--min-height", type=int, default=0)
    ap.add_argument("--topn", type=int, default=4)
    ap.add_argument("--workers", type=int, default=40)
    ap.add_argument("--out", default=os.path.join(ROOT, "live", "cn.m3u"))
    ap.add_argument("--no-fetch", action="store_true")
    args = ap.parse_args()

    chans, order = load_pool(args.pool, refresh=not args.no_fetch)
    tasks = [(n, u) for n in order for u in chans[n]["urls"]]
    print(f"· 源池 {len(chans)} 频道 / {len(tasks)} 接口，并发 {args.workers} 测速 ...")

    hits = {}
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(probe, u): n for n, u in tasks}
        for f in futs:
            n = futs[f]
            r = f.result()
            done += 1
            if done % 200 == 0:
                print(f"   {done}/{len(tasks)}  {int(time.time()-t0)}s")
            if r and r["h"] >= args.min_height:
                hits.setdefault(n, []).append(r)

    picked = []
    for n in order:
        if n not in hits:
            continue
        cands = sorted(hits[n], key=lambda c: (-c["h"], c["ms"]))
        info = chans[n]
        picked.append((group_rank(info["group"]), n, info, cands))
    picked.sort(key=lambda x: (x[0], x[1]))

    out = ["#EXTM3U"]
    for _, name, info, cands in picked:
        logo = f' tvg-logo="{info["logo"]}"' if info["logo"] else ""
        out.append(f'#EXTINF:-1{logo} group-title="{info["group"]}",{name}')
        out.append(cands[0]["url"])

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8").write("\n".join(out) + "\n")

    bak = args.out.replace(".m3u", ".bak.txt")
    lines = []
    for _, name, info, cands in picked:
        for c in cands[: args.topn]:
            lines.append(f'{name}\t{info["group"]}\t{c["h"]}p\t{c["ms"]}ms\t{c["url"]}')
    open(bak, "w", encoding="utf-8").write("\n".join(lines) + "\n")

    from collections import Counter
    groups = Counter(info["group"] for _, _, info, _ in picked)
    print(f"\n✓ {args.out}  {len(picked)} 频道 / 池内 {len(chans)}，耗时 {int(time.time()-t0)}s")
    for g, c in groups.most_common():
        print(f"   {g:<8} {c}")
    print(f"✓ {bak}（每频道前 {args.topn} 条备用）")


if __name__ == "__main__":
    main()
