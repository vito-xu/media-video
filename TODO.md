# TODO — 后续待补项

本仓库是 FongMi TV 2.7.2 的「可编译修改版」。以下功能因上游私有依赖缺失而未能保留，
记录在此，便于后续有空时补齐。

当前已实测可用：**QuickJS（JS 源）、Python 源、迅雷、ForceTV 组播、H.264/AAC 播放**。

---

## 1. ffmpeg / av1 / iamf 硬件解码（优先级：中）

### 现状
`app/build.gradle` 里这 3 个依赖已被移除（原为 `fongmi:lib-decoder-ffmpeg-release` 等私有 AAR）：

```gradle
// NATIVE_TODO implementation(ext: 'aar', name: 'lib-decoder-av1-release', ...)
// NATIVE_TODO implementation(ext: 'aar', name: 'lib-decoder-iamf-release', ...)
// NATIVE_TODO implementation(ext: 'aar', name: 'lib-decoder-ffmpeg-release', ...)
```

### 影响
| 缺失 | 具体表现 |
|---|---|
| `decoder-ffmpeg` | **AC3 / DTS / EAC3 等音轨的电影没有声音**（很多高清电影是这类音轨） |
| `decoder-av1` | AV1 编码视频无法硬解（部分 B 站/YouTube 片源） |
| `decoder-iamf` | IAMF 空间音频无法解码（少见） |

H.264 + AAC 不受影响。

### 根因
- media3 官方**不在 Maven 发布**这 3 个 module（逐个试过，均 404）——因为它们含原生 `.so`，需自行交叉编译
- 上游 `FongMi/media` 分支只剩 `release`(3.11) 和 `release-1.11.0-fongmi`，**2.7.2 时代的 1.5.x fork 已删除**

### 可行路径（按推荐顺序）

**A. 自编 AOSP media3 1.5.1 的 3 个 decoder 模块**

```bash
# 1. 取 1.5.1 源码（含上述模块）
git clone --filter=blob:none --sparse https://github.com/androidx/media.git
cd media && git sparse-checkout set libraries/decoder_ffmpeg libraries/decoder_av1 libraries/decoder_iamf
git checkout 1.5.1

# 2. decoder_ffmpeg 需要 FFmpeg 源码（子模块或自行下载 4.x）
#    decoder_av1 需要 libgav1；decoder_iamf 需要 libiamf
# 3. 用项目自带 build-logic 编译（需要 Gradle 8.x + AGP 对应版本 + NDK）
./gradlew :lib-decoder_ffmpeg:assembleRelease
```

产物重命名为 `lib-decoder-ffmpeg-release.aar` 等放入 `app/libs/`，并把上面 3 行注释恢复。

⚠️ 风险：media3 的 Gradle 构建依赖 `build-logic`（Kotlin DSL），可能因版本差异编译失败；
FFmpeg 交叉编译耗时较长（约 20–30 分钟）。

**B. 提取官方 APK 的 so + 自编 Java 层**

- 官方 2.7.2 APK 里有 `libavcodec.so`、`libavutil.so`、`libswresample.so`、`libswscale.so`、
  `libgav1JNI.so`、`libiamf.so`、`libiamfJNI.so`（可从已安装设备 `pm path` 后 pull）
- Java 层（`FfmpegAudioRenderer`、`Av1Decoder`、`IamfDecoder`）需从 AOSP 源码编译
- 组合成 AAR：`jni/arm64-v8a/*.so` + `classes.jar`
- 风险：官方 so 是 FongMi 编译的，JNI 签名可能与 AOSP Java 层不匹配 → 运行时崩溃

**C. 放弃**（当前选择）：H.264/AAC 场景够用

### 验收
装一台有 AC3 音轨的影片，确认有声音；或播放 AV1 片源确认不黑屏。

---

## 2. 广告过滤（优先级：低）

### 现状
`ExoUtil.getMediaItem()` 里原有一行私有 API 调用，已删除：

```java
// 原：builder.setAds(Sniffer.getRegex(uri));
```

### 影响
播放列表中的广告片段不会被自动跳过（FongMi 的 `setAds` 是其 media3 魔改功能）。

### 可行路径
需要修改 media3 的 `MediaItem.Builder` 加自定义字段，并在 `MediaSource` 创建时读取——
本质是复刻 FongMi 对 media3 的 patch。工作量较大，收益低（很多源本身没有广告段）。

### 验收
播放带广告的源，确认自动跳过。

---

## 3. 渲染模式切换（优先级：低）

### 现状
上游设置里有 `Render`（Surface / Texture）选项，而 `PlayerView` 的 surface 由运行时私有方法
`PlayerView.setRender(int)` 挂载（布局里写的是 `surface_type="none"`）。

本仓库改为**固定 `texture_view`**（6 个布局），设置项因此失效。

### 影响
- 无法切回 Surface（Surface 在某些设备上性能更好、延迟更低）
- 优点：TextureView 兼容性更好，且 `adb screencap` 能抓到画面

### 可行路径
参考 media3 官方 `PlayerView` 的 `surface_type` 实现，在 `onCreate` 时按 `Setting.getRender()`
动态 inflate 对应类型，或复刻 `setRender` 的 view 替换逻辑。

### 验收
设置里切换 Render，画面不黑且生效。

---

## 4. 其他小项（优先级：低）

| 项 | 说明 |
|---|---|
| `MimeTypes.AUDIO_AV3A` / `VIDEO_ProRes` | 已用字符串 `"audio/av3a"` / `"video/x-prores"` 替代，与私有常量等价 |
| 字幕位置/字号 | 已改用官方 `setBottomPaddingFraction` / `setFractionalTextSize`，行为基本一致，但默认值与上游略有差异 |
| 签名 | 当前为 Android Debug 签名；如需正式分发，应生成自己的 keystore（`*.jks` 已在 .gitignore） |

---

## 环境备忘（复现编译）

| 组件 | 版本 |
|---|---|
| JDK | 17 |
| Gradle | 8.9（项目 wrapper 一致） |
| AGP | 8.7.3 |
| SDK Platform | android-35 |
| build-tools | 35.0.0 |
| Python（仅 python flavor） | 3.8–3.12，用 `BUILD_PYTHON` 环境变量指定 |

```bash
export BUILD_PYTHON=/path/to/python3.11
./gradlew assembleMobilePythonArm64_v8aDebug   # 或 assembleMobileJavaArm64_v8aDebug
```

详见 [BUILD-NOTES.md](BUILD-NOTES.md)。
