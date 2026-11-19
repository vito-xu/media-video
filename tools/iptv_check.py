#!/usr/bin/env python3
"""
IPTV 源聚合 + 真实拉流测速（纯标准库，不需要 Docker / FFmpeg）

与"只看首包能不能回 m3u8"的区别：本脚本会真的去拉视频分片，按
「吞吐 ÷ 码率」算缓冲余量，余量不足的直接淘汰，避免选到首包快但播放卡的源。

四层筛选：
  L1 探活   取 m3u8，校验 #EXTM3U
  L2 解析   多码率(master) 取最高档 = 最坏情况；单码率直接用分片表
  L3 拉流   下载前 2 个分片（单片限 1.5MB / 4s），记录字节与耗时
  L4 判定   吞吐 ≥ 0.3MB/s（够 720p）、余量(吞吐÷码率) ≥ 2.0、成功分片 ≥ 2
          注：深测并发不要开太高（建议 ≤12），并发过高会互相抢带宽造成误判

用法：
  python3 tools/iptv_check.py                       # 全量：轻测 + 深测
  python3 tools/iptv_check.py --fast                # 只轻测（快速看覆盖）
  python3 tools/iptv_check.py --no-fetch            # 用缓存池
  python3 tools/iptv_check.py --min-margin 3 --deep 3
"""
import argparse
import os
import re
import ssl
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
from urllib.request import Request, build_opener, HTTPSHandler, ProxyHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
UA = "okhttp/3.15"
DEFAULT_POOL = "https://cdn.jsdelivr.net/gh/Guovin/TV@gd/output/result.m3u"



BLOCK = [
    "VoA", "VOA", "BRICS", "ABN China", "Angel TV", "Ando TV", "Bread TV",
    "Kangba", "CCTV+", "Religious", "Gospel", "Epoch", "NTD", "Falun",
    "港·澳·台", "翡翠台", "明珠台", "凤凰", "TVBS", "纬来", "东森", "三立",
    "靖天", "星卫", "无线新闻", "Viutv", "Now剧集",
]

GROUP_RULES = [
    ("央视", "央视频道"), ("卫视", "卫视频道"), ("体育", "体育频道"),
    ("电影", "电影频道"), ("动画", "少儿动画"), ("咪咕", "咪咕直播"),
    ("音乐", "音乐频道"), ("剧场", "经典剧场"), ("游戏", "游戏频道"),
]
GROUP_ORDER = ["央视频道", "卫视频道", "体育频道", "电影频道", "少儿动画",
               "咪咕直播", "音乐频道", "游戏频道", "经典剧场"]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# 禁用系统/环境变量代理：测速必须反映真实直连质量，走代理会失真
OPENER = build_opener(ProxyHandler({}), HTTPSHandler(context=CTX))


def clean_group(raw):
    g = re.sub(r"[^\u4e00-\u9fa5A-Za-z·]+", "", raw or "").strip()
    for kw, name in GROUP_RULES:
        if kw in g:
            return name
    return g or "其他频道"


def group_rank(g):
    return GROUP_ORDER.index(g) if g in GROUP_ORDER else len(GROUP_ORDER)


def fetch_bytes(url, timeout=8, limit=None):
    """返回 (bytes, 耗时秒, 最终URL)；异常返回 (None, 0, url)
    最终URL 很重要：302 后面的相对分片路径必须基于它解析，否则全 404。"""
    t0 = time.time()
    try:
        with OPENER.open(Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            data = r.read(limit) if limit else r.read()
            return data, time.time() - t0, r.geturl()
    except Exception:
        return None, 0, url


def load_pool(src, refresh=True):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, "pool.m3u")
    if refresh or not os.path.exists(local):
        print(f"· 拉取源池 {src[:70]} ...")
        data, _, _ = fetch_bytes(src, timeout=30)
        if not data:
            sys.exit("源池拉取失败")
        open(local, "wb").write(data)
    txt = open(local, encoding="utf-8", errors="ignore").read()

    chans, order = {}, []
    for meta, name, url in re.findall(r"#EXTINF:-1 ([^\n]*),([^\n]+)\n(https?://[^\s]+)", txt):
        name = name.strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}", name) or not name:
            continue
        if any(b.lower() in name.lower() for b in BLOCK):
            continue
        g = clean_group((re.search(r'group-title="([^"]*)"', meta) or [None, ""])[1])
        logo = (re.search(r'tvg-logo="([^"]*)"', meta) or [None, ""])[1]
        if name not in chans:
            chans[name] = {"group": g, "logo": logo, "urls": []}
            order.append(name)
        if url not in chans[name]["urls"]:
            chans[name]["urls"].append(url)
    return chans, order


def parse_playlist(text, base):
    """返回 ('master', [(height,bandwidth,url)]) 或 ('media', [(dur,url)])"""
    text = text.replace("\r", "")
    if "#EXT-X-STREAM-INF" in text:
        out = []
        for b in text.split("#EXT-X-STREAM-INF")[1:]:
            head, _, rest = b.partition("\n")
            h = (re.search(r"RESOLUTION=\d+x(\d+)", head) or [None, 0])[1]
            bw = (re.search(r"BANDWIDTH=(\d+)", head) or [None, 0])[1]
            lines = [x.strip() for x in rest.split("\n")
                     if x.strip() and not x.strip().startswith("#")]
            if lines:
                out.append((int(h), int(bw), urljoin(base, lines[0])))
        return "master", out
    if "#EXTINF" in text:
        segs, cur = [], None
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("#EXTINF"):
                m = re.search(r"#EXTINF:\s*([\d.]+)", line)
                cur = float(m.group(1)) if m else 4.0
            elif line and not line.startswith("#") and cur is not None:
                segs.append((cur, urljoin(base, line)))
                cur = None
        return "media", segs
    return None, []


def deep_probe(url, max_segments=2, seg_bytes=1500 * 1024, seg_timeout=4.0):
    """真实拉流。返回 dict(ok, mbps, bitrate, margin, segs_ok, height, latency)"""
    t0 = time.time()
    data, dt, final = fetch_bytes(url, timeout=7, limit=8192)
    if not data:
        return {"ok": False, "why": "列表拉取失败"}
    kind, items = parse_playlist(data.decode("utf-8", "ignore"), final)
    if not kind:
        return {"ok": False, "why": "非播放列表"}

    height = 0
    if kind == "master":
        if not items:
            return {"ok": False, "why": "master 无档位"}
        items.sort(key=lambda x: (-x[0], -x[1]))
        height, _, base_url = items[0]  # 最高档 = 最坏情况
        data2, _, final2 = fetch_bytes(base_url, timeout=7, limit=16384)
        if not data2:
            return {"ok": False, "why": "档位列表失败"}
        kind, segs = parse_playlist(data2.decode("utf-8", "ignore"), final2)
        if kind != "media" or not segs:
            return {"ok": False, "why": "档位无分片"}
    else:
        segs = items

    if len(segs) < max_segments:
        return {"ok": False, "why": "分片太少"}

    total_b, total_t, ok_n, dur_sum = 0, 0.0, 0, 0.0
    for dur, surl in segs[:max_segments]:
        buf, st, _ = fetch_bytes(surl, timeout=seg_timeout, limit=seg_bytes)
        if buf and len(buf) > 8192:
            total_b += len(buf)
            total_t += st
            dur_sum += dur
            ok_n += 1

    if ok_n < max_segments:
        return {"ok": False, "why": f"分片仅成功 {ok_n}"}
    if total_t <= 0 or dur_sum <= 0:
        return {"ok": False, "why": "计时异常"}

    mbps = (total_b / 1024 / 1024) / total_t
    bitrate = (total_b / 1024 / 1024) / dur_sum
    margin = mbps / bitrate if bitrate > 0 else 0
    return {"ok": True, "mbps": round(mbps, 2), "bitrate": round(bitrate, 2),
            "margin": round(margin, 1), "segs_ok": ok_n, "height": height,
            "latency": int(dt * 1000), "cost": round(time.time() - t0, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=DEFAULT_POOL)
    ap.add_argument("--out", default=os.path.join(ROOT, "live", "cn.m3u"))
    ap.add_argument("--no-fetch", action="store_true")
    ap.add_argument("--fast", action="store_true", help="只做 L1 轻测")
    ap.add_argument("--deep", type=int, default=2, help="每频道深测候选数")
    ap.add_argument("--min-margin", type=float, default=2.0)
    ap.add_argument("--min-speed", type=float, default=0.3)
    ap.add_argument("--min-height", type=int, default=0)
    ap.add_argument("--workers", type=int, default=36)
    ap.add_argument("--deep-workers", type=int, default=12)
    ap.add_argument("--topn", type=int, default=4)
    ap.add_argument("--groups", default="", help="只保留这些分组，逗号分隔，如 央视频道,卫视频道,广东频道")
    args = ap.parse_args()

    chans, order = load_pool(args.pool, refresh=not args.no_fetch)
    tasks = [(n, u) for n in order for u in chans[n]["urls"]]
    print(f"· 源池 {len(chans)} 频道 / {len(tasks)} 接口")
    print(f"· L1 探活（{args.workers} 并发）...")

    l1, done, t0 = {}, 0, time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_bytes, u, 6, 8192): (n, u) for n, u in tasks}
        for f in futs:
            n, u = futs[f]
            data, dt, _ = f.result()
            done += 1
            if done % 200 == 0:
                print(f"   {done}/{len(tasks)}  {int(time.time()-t0)}s")
            if data and (b"#EXTM3U" in data or b"#EXTINF" in data):
                l1.setdefault(n, []).append({"url": u, "ms": int(dt * 1000)})
    print(f"· L1 通过 {sum(len(v) for v in l1.values())} 接口 / {len(l1)} 频道，{int(time.time()-t0)}s")

    if args.fast:
        final = {n: sorted(v, key=lambda x: x["ms"]) for n, v in l1.items()}
    else:
        cand = []
        for n, v in l1.items():
            v.sort(key=lambda x: x["ms"])
            for c in v[: args.deep]:
                cand.append((n, c["url"]))
        print(f"· L2/L3 真实拉流深测 {len(cand)} 个候选（{args.deep_workers} 并发，单片限 1.5MB/4s）...")
        final, dropped, t1, done = {}, [], time.time(), 0
        with ThreadPoolExecutor(max_workers=args.deep_workers) as ex:
            futs = {ex.submit(deep_probe, u): (n, u) for n, u in cand}
            for f in futs:
                n, u = futs[f]
                r = f.result()
                done += 1
                if done % 50 == 0:
                    print(f"   {done}/{len(cand)}  {int(time.time()-t1)}s")
                if r.get("ok") and r["margin"] >= args.min_margin \
                        and r["mbps"] >= args.min_speed and r["height"] >= args.min_height:
                    final.setdefault(n, []).append(dict(r, url=u))
                else:
                    dropped.append((n, r))
        print(f"· L4 达标 {len(final)} 频道（淘汰 {len(dropped)} 个候选），深测耗时 {int(time.time()-t1)}s")
        for n in final:
            final[n].sort(key=lambda x: (-x["margin"], -x["mbps"]))

    picked = [(group_rank(chans[n]["group"]), n, chans[n], v) for n, v in final.items() if v]
    if args.groups:
        keep = {g.strip() for g in args.groups.split(",") if g.strip()}
        picked = [p for p in picked if p[2]["group"] in keep]
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
            if args.fast:
                lines.append(f'{name}\t{info["group"]}\t-\t-\t-\t{c["ms"]}ms\t{c["url"]}')
            else:
                lines.append(f'{name}\t{info["group"]}\t{c["height"]}p\t{c["mbps"]}MB/s'
                             f'\t余量{c["margin"]}x\t{c["latency"]}ms\t{c["url"]}')
    open(bak, "w", encoding="utf-8").write("\n".join(lines) + "\n")

    from collections import Counter
    print(f"\n✓ 输出 {len(picked)} 频道 → {args.out}")
    for g, c in Counter(info["group"] for _, _, info, _ in picked).most_common():
        print(f"   {g:<8} {c}")
    if not args.fast:
        avg = sum(v[0]["margin"] for _, _, _, v in picked) / max(len(picked), 1)
        slow = [x for x in picked if x[3][0]["mbps"] < 2]
        print(f"   平均缓冲余量 {avg:.1f}x，吞吐 <2MB/s 的频道 {len(slow)} 个")
    print(f"✓ 备用表 {bak}")


if __name__ == "__main__":
    main()
