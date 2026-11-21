#!/usr/bin/env python3
"""
把 ysp-live（央视频全频道）与本仓库的广东频道合并成一份 m3u，写进 live/cn.m3u。

背景：
  央视/卫视走本机 ysp-live 服务（真高清 + 7天回看，需 Mac 开机且 IP 不变）
  广东频道走公开静态源（不依赖本机）

用法：
  python3 tools/merge_ysp.py                 # 自动探测本机局域网 IP
  python3 tools/merge_ysp.py --ip 192.168.1.104 --port 8767
  python3 tools/merge_ysp.py --check         # 只检查服务是否可用，不写文件

输出：live/cn.m3u（69 台：央视 30 / 卫视 34 / 广东 5）

注意：
  - 本文件内的流地址会硬编码成 http://<局域网IP>:<端口>/xxx.m3u8
    换网络/换 IP 后必须重跑本脚本并重新打包 APK
  - ysp-live 未启动时会直接报错退出
"""
import argparse
import os
import re
import socket
import ssl
import sys
from urllib.request import Request, build_opener, HTTPSHandler, ProxyHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
OPENER = build_opener(ProxyHandler({}), HTTPSHandler(context=CTX))

# 广东频道（不依赖本机，公开源）
GUANGDONG = [
    ("大湾区卫视", "http://38.75.136.137:98/gslb/dsdqpub/nfws.m3u8?auth=testpub"),
    ("广东体育",   "http://38.75.136.137:98/gslb/dsdqpub/gdty.m3u8?auth=testpub"),
    ("广东民生",   "http://38.75.136.137:98/gslb/dsdqpub/gdgg.m3u8?auth=testpub"),
    ("广东珠江",   "http://38.75.136.137:98/gslb/dsdqpub/gdzj.m3u8?auth=testpub"),
    ("广州综合",   "https://tencentplay.gztv.com/live/zonghes.m3u8"),
]

GROUP_MAP = {"央视": "央视频道", "卫视": "卫视频道", "广东频道": "广东频道"}
GROUP_ORDER = ["央视频道", "卫视频道", "广东频道"]


def guess_ip():
    """取本机在局域网中的 IPv4（不实际发包）"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.1.1", 80))
        return s.getsockname()[0]
    except Exception:
        return ""
    finally:
        s.close()


def fetch(url, host=None, timeout=20):
    hdr = {"User-Agent": "okhttp/3.15"}
    if host:
        hdr["Host"] = host
    with OPENER.open(Request(url, headers=hdr), timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def cctv_no(name):
    m = re.match(r"CCTV-(\d+)", name)
    if m:
        return int(m.group(1))
    if name.startswith("CCTV-5+"):
        return 0
    return 99


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", default="", help="本机局域网 IP，默认自动探测")
    ap.add_argument("--port", type=int, default=8767)
    ap.add_argument("--out", default=os.path.join(ROOT, "live", "cn.m3u"))
    ap.add_argument("--check", action="store_true", help="只检查服务，不写文件")
    args = ap.parse_args()

    ip = args.ip or guess_ip()
    if not ip:
        sys.exit("无法探测本机 IP，请用 --ip 指定")

    base = f"http://{ip}:{args.port}"
    print(f"· 目标地址 {base}")
    try:
        m3u = fetch(f"{base}/all.m3u", host=f"{ip}:{args.port}")
    except Exception as e:
        sys.exit(f"ysp-live 不可用（{type(e).__name__}）。先启动：\n"
                 f"  python3 ysp-live.py {args.port} --data-dir ./data --no-engine")

    head = [l for l in m3u.split("\n") if l.startswith("#EXTM3U") or l.startswith("#EXT-X-")]
    items = []
    for m, n, u in re.findall(r"#EXTINF:-1 ([^\n]*),([^\n]+)\n(https?://[^\s]+)", m3u):
        raw_group = (re.search(r'group-title="([^"]*)"', m) or [None, ""])[1]
        group = GROUP_MAP.get(raw_group, raw_group)
        meta = m.replace(f'group-title="{raw_group}"', f'group-title="{group}"')
        items.append({"meta": meta, "name": n.strip(), "group": group, "url": u.strip()})

    ysp_n = len(items)
    for name, url in GUANGDONG:
        items.append({
            "meta": f'tvg-name="{name}" group-title="广东频道"',
            "name": name, "group": "广东频道", "url": url,
        })

    items.sort(key=lambda i: (GROUP_ORDER.index(i["group"]) if i["group"] in GROUP_ORDER else 9,
                              cctv_no(i["name"]) if i["group"] == "央视频道" else 0,
                              i["name"]))

    from collections import Counter
    cnt = Counter(i["group"] for i in items)
    print(f"· ysp-live {ysp_n} 台 + 广东 {len(GUANGDONG)} 台 = {len(items)} 台 {dict(cnt)}")

    if args.check:
        print("· --check 模式，未写文件")
        return

    out = head or ["#EXTM3U"]
    for i in items:
        out.append(f'#EXTINF:-1 {i["meta"]},{i["name"]}')
        out.append(i["url"])
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print(f"✓ 已写入 {args.out}")
    print("  下一步：gradle assembleMobileJavaArm64_v8aRelease 重新打包")


if __name__ == "__main__":
    main()
