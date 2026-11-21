# 2.7.2 自编译说明（2026-11-18）

上游代码 `3c29f0eab`，产物为 `mobile-java-arm64_v8a`（androidx.media3 官方版替代私有 AAR）。

## 环境

| 组件 | 版本/路径 |
|---|---|
| JDK | 17（`~/jdks/jdk-17.0.20.1+1`） |
| Gradle | 8.9（`~/gradle/gradle-8.9`，与项目 wrapper 一致） |
| AGP | 8.7.3（源码自带） |
| SDK Platform | android-35（需补装） |
| build-tools | 35.0.0（需补装） |

```bash
sdkmanager "platforms;android-35" "build-tools;35.0.0"
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
JAVA_HOME=~/jdks/jdk-17.0.20.1+1/Contents/Home \
  ~/gradle/gradle-8.9/bin/gradle assembleMobileJavaArm64_v8aDebug --no-daemon
# 产物: app/build/outputs/apk/mobileJavaArm64_v8a/debug/mobile-java-arm64_v8a.apk
```

## 上游缺失的私有 AAR 及替代

上游 `app/build.gradle` 用 `flatDir app/libs` 引用 20 个 `fongmi:*-release` AAR，仓库里 `app/libs` 是空的。

### 1. 仓库内自带源码 → 自行编译（11 个，成功）

`settings.gradle` 原本只 include `:app :catvod :chaquo :quickjs`，需要补上：

```gradle
include ':forcetech' ':thunder' ':jianpian' ':nanohttpd' ':tvbus' ':youtube' ':hook' ':zlive'
```

```bash
gradle :forcetech:assembleRelease ...（逐个）
# 产物 xxx/build/outputs/aar/xxx-release.aar → 复制到 app/libs/
```

### 2. DLNA 投屏（3 个）→ 上游开源仓库

源码：https://github.com/devin1014/DLNA-Cast（`dlna-core` / `dlna-dmc` / `dlna-dmr`，namespace 完全匹配 `com.android.cast.dlna.*`）

需要两处改动才能编：
- AGP `8.13.0` → `8.7.3`（配合本机 Gradle 8.9）
- `minSdk 24` → `21`（与主项目一致，否则 manifest 合并失败）

### 3. QuickJS JNI 层（`wrapper-android-release`）→ 自造

`quickjs` 模块引用 `com.whl.quickjs.android.QuickJSLoader`（只有 `init()` 一个调用点）。
自建最小 AAR：放入从官方 2.7.2 APK 提取的 `libquickjs-android-wrapper.so`，并重建：

```java
package com.whl.quickjs.android;
public final class QuickJSLoader {
    public static void init() { System.loadLibrary("quickjs-android-wrapper"); }
}
```

### 4. media3 系列（17 个）→ 官方 Maven 1.5.1

`lib-common/database/datasource/decoder/exoplayer/extractor/ui...` 全部替换：

```gradle
implementation 'androidx.media3:media3-exoplayer:1.5.1'
// ... 共 14 个（Maven 上有发布的）
```

**3 个 Maven 上没有**（需自编，官方不发布带 so 的包）：`decoder-ffmpeg`、`decoder-av1`、`decoder-iamf`。
app 代码只在**运行期反射**使用它们，编译期无引用 → 直接不引入。

## 为适配官方 media3 而修改的 app 代码（6 处）

FongMi 的 media3 是魔改版，以下私有 API 官方没有：

| 文件 | 原代码 | 改为 |
|---|---|---|
| `player/Players.java` | `exo.setRender(Setting.getRender())` | 删除 |
| `player/exo/ExoUtil.java` | `new DefaultLoadControl(buffer)` | `DefaultLoadControl.Builder().setBufferDurationsMs(...)` |
| `player/exo/ExoUtil.java` | `builder.setForceUseRtpTcp(...)` | 删除 |
| `player/exo/ExoUtil.java` | `builder.setAds(Sniffer.getRegex(uri))` | 删除 |
| `player/exo/ExoUtil.java` | `.setBottomPosition(x)` | `.setBottomPaddingFraction(x)` |
| `ui/dialog/SubtitleDialog.java` | `addPosition/subPosition/getPosition/addTextSize/subTextSize/getTextSize/setUserDefaultTextSize` | 改用 `Setting` 存值 + 官方 `setBottomPaddingFraction`/`setFractionalTextSize` |
| `player/exo/TrackNameProvider.java` | `MimeTypes.AUDIO_AV3A` / `VIDEO_ProRes` / `APPLICATION_OCTET` | 字符串字面量 `"audio/av3a"` / `"video/x-prores"` / `"application/octet-stream"` |

## 内置直播源（2026-11-21 改为混合方案）

`live/cn.m3u` 共 **69 台**，三组：

| 分组 | 台数 | 来源 | 依赖 |
|---|---|---|---|
| 央视频道 | 30 | 本机 ysp-live（央视频官方 CDN，10M 码率 + 7 天回看） | **需本机 8767 服务在线** |
| 卫视频道 | 34 | 同上 | 同上 |
| 广东频道 | 5 | 公开静态源（38.75.136.137 / gztv） | 无 |

生成方式：`python3 tools/merge_ysp.py`

- 自动探测本机局域网 IP，拉 `http://<IP>:8767/all.m3u`，再并入广东 5 台
- **流地址写死成 `http://<局域网IP>:8767/xxx.m3u8`**：换网络/换 IP 必须重跑脚本并重新打包
- ysp-live 未启动时脚本直接报错退出（不会生成半残的 m3u）

### ysp-live 启动方法（无需 Docker）
```bash
# 源码约 190KB，纯标准库
curl -o ysp-live.py https://ghproxy.net/raw.githubusercontent.com/evanzme/ysp-live/main/ysp-live.py
env -u HTTP_PROXY -u HTTPS_PROXY python3 ysp-live.py 8767 --data-dir ./data --no-engine
```
`--no-engine` 跳过 Node WASM 兜底引擎。注意不要用 `curl -C -` 续传，会把源码和 Cloudflare 页面混在一起。

### 实测结论（重要）
- CCTV-1 等能直接拿到**高码率设备协议直链**（`tlivecloud-playback-cdn.ysp.cctv.cn`），平板直连，画质明显好于公开源
- 未升级到高码率的台会走 `http://<IP>:8767/proxy.ts` **由本机转发**，本机到 `cctv.cn` 只有 25-143KB/s，会卡（表现为错误码 2004）
- 央视频有风控：切台过快返回「您的操作过于频繁，请稍后再试」，需停留 10s+ 等待升级
- 因此：本机中转的 1080p 流不可用，只有升到高码率直链才流畅；NAS/软路由（家宽直连 + 24h 在线）才是这套的正常运行环境

### 旧的纯静态方案（已被替换，保留说明）
`tools/iptv_check.py --groups 央视频道,卫视频道,广东频道` 可从公开源池现测 58 台，
四层筛选（探活 → 解析最高档 → 真实拉 2 个分片 → 吞吐≥0.3MB/s 且余量≥2.0），
不依赖本机服务，但画质只有 720p 级别。需要"不依赖电脑"时可切回。

## 产物与原版官方 APK 的差异

| 项 | 官方 2.7.2 APK | 本产物 |
|---|---|---|
| 签名 | CN=FongMi | **Android Debug**（需卸载官方版才能装） |
| 大小 | 36 MB | 27 MB |
| Python 运行时 | 内置 `libpython3.8.so`（python flavor） | **无**（java flavor） |
| FFmpeg / AV1 / IAMF 解码 | 内置 so | **无**（Maven 不发布，运行期缺失则回退） |
| 字幕位置/字号微调 | FongMi 魔改 API | 改为官方等价 API（行为基本一致） |
| 广告过滤（setAds） | 有 | **无** |
| 迅雷 / ForceTV / QuickJS | 内置 | 内置（so 齐全） |

结论：**H.264/AAC 的常规播放、JS 爬虫源、迅雷/组播能力都在**；缺 Python 源支持与部分特殊音频解码。
如需完整版，还需从 `FongMi/media` 编译该仓库 1.5.x 时期的 `decoder-ffmpeg/av1/iamf`（当前公开分支已到 3.11，版本不匹配）。
