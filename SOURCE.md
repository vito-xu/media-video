# 源码来源说明

本仓库是 **FongMi/TV** 指定版本的完整源码快照，未做任何代码修改（仅新增本说明文件）。

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/FongMi/TV |
| 上游分支 | `fongmi` |
| 提交 | `3c29f0eab6a050ebb719ca64002f10748e873d84` |
| 提交时间 | 2024-12-31 |
| 版本 | **2.7.2**（versionCode 272） |
| 应用 ID | `com.fongmi.android.tv` |
| minSdk / targetSdk / compileSdk | 21 / 28 / 35 |
| Java 版本 | 11 |

## 该版本的关键特征

- **全内置架构**：`forcetech`（ForceTV IPTV 组播/P2P）、`quickjs`、`thunder`、`chaquo`（Python 3.8）、
  `ijkplayer`（FFmpeg）、`zlive`、`jianpian`、`tvbus`、`youtube` 均编译进主包，
  无需安装外部运行时模块（5.8.x 起改为外装模块）。
- **不依赖私有 AAR**：与 5.8.x 不同，本版本可在无 FongMi 私有 `media3` AAR 的情况下独立编译。
- `targetSdk 28` 是上游源码中有意设置的（`//noinspection ExpiredTargetSdkVersion`），
  用于兼容老设备与 legacy 存储访问。

## 与 5.8.x 的分水岭

上游 commit `970862c65`（2026-10-19，"Add modular crawler runtimes and shared network APIs"）
删除了 `forcetech` / `quickjs` / `thunder` 等模块，此后改为外装模块架构。本仓库停留在该重构之前。

## 许可证

**GPL-3.0**，见 [LICENSE.md](LICENSE.md)。版权归原作者 FongMi 所有。
本仓库仅为该版本的镜像/快照，便于获取与回溯，不代表原作者背书。

## 构建

```bash
# 需要 JDK 11+ 与 Android SDK Platform 35
./gradlew assembleDebug
```

编译产物位于 `app/build/outputs/apk/`。
