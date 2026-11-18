> ## 本仓库说明（自编译可用版）
>
> 这是 **FongMi TV 2.7.2** 的修改版，目标是让这版**能独立编译出包**。
>
> - 上游：`https://github.com/FongMi/TV` 提交 `3c29f0eab`（2024-12-31，versionCode 272）
> - 上游 `app/build.gradle` 引用的 20 个 `fongmi:*-release` 私有 AAR **未随源码发布**，
>   本仓库通过「仓库内源码自编 + DLNA 上游开源库 + 官方 media3 1.5.1 替代」补齐，AAR 已随仓库提供
> - 已实测：可编译、可安装、可播放（Redmi 平板 / Android 16）
> - 编译步骤与全部改动见 [BUILD-NOTES.md](BUILD-NOTES.md)
> - 附带 `skills/` 目录：TVBox 配置生成技能（站点分析 → 爬虫 → config.json）
> - 许可证 **GPL-3.0**（见 [LICENSE.md](LICENSE.md)），版权归原作者 FongMi，本仓库仅做编译适配
>
> ---

# 影視

### 基於 CatVod 項目

https://github.com/CatVodTVOfficial/CatVodTVJarLoader

### 點播欄位

| 欄位名稱       | 預設值  | 說明   | 其他         |
|------------|------|------|------------|
| searchable | 1    | 是否搜索 | 0：關閉；1：啟用  |
| changeable | 1    | 是否換源 | 0：關閉；1：啟用  |
| timeout    | 15   | 播放超時 | 單位：秒       |
| header     | none | 請求標頭 | 格式：json    |
| click      | none | 點擊js | javascript |

### 直播欄位

| 欄位名稱     | 預設值   | 說明    | 其他         |
|----------|-------|-------|------------|
| ua       | none  | 用戶代理  |            |
| origin   | none  | 來源    |            |
| referer  | none  | 參照地址  |            |
| epg      | none  | 節目地址  |            |
| logo     | none  | 台標地址  |            |
| pass     | false | 是否免密碼 |            |
| boot     | false | 是否自啟動 |            |
| timeout  | 15    | 播放超時  | 單位：秒       |
| header   | none  | 請求標頭  | 格式：json    |
| click    | none  | 點擊js  | javascript |
| catchup  | none  | 回看參數  |            |
| timeZone | none  | 時區    |            |

### 樣式

| 欄位名稱  | 值    | 說明  |
|-------|------|-----|
| type  | rect | 矩形  |
|       | oval | 橢圓  |
|       | list | 列表  |
| ratio | 0.75 | 3：4 |
|       | 1.33 | 4：3 |

直式

```json
{
  "style": {
    "type": "rect"
  }
}
```

橫式

```json
{
  "style": {
    "type": "rect",
    "ratio": 1.33
  }
}
```

正方

```json
{
  "style": {
    "type": "rect",
    "ratio": 1
  }
}
```

正圓

```json
{
  "style": {
    "type": "oval"
  }
}
```

橢圓

```json
{
  "style": {
    "type": "oval",
    "ratio": 1.1
  }
}
```

### API

刷新詳情

```
http://127.0.0.1:9978/action?do=refresh&type=detail
```

刷新播放

```
http://127.0.0.1:9978/action?do=refresh&type=player
```

刷新直播

```
http://127.0.0.1:9978/action?do=refresh&type=live
```

推送字幕

```
http://127.0.0.1:9978/action?do=refresh&type=subtitle&path=http://xxx
```

新增緩存字串

```
http://127.0.0.1:9978/cache?do=set&key=xxx&value=xxx
```

取得緩存字串

```
http://127.0.0.1:9978/cache?do=get&key=xxx
```

刪除緩存字串

```
http://127.0.0.1:9978/cache?do=del&key=xxx
```

### Proxy

scheme 支持 http, https, socks4, socks5

```
scheme://username:password@host:port
```

配置 rules 新增 proxy 判斷 host 是否走代理

```json
{
  "name": "proxy",
  "hosts": [
    "api.nivodz.com"
  ]
}
```

### 配置範例

[點播-線上](other/sample/vod/online.json)  
[點播-本地](other/sample/vod/offline.json)  
[直播-線上](other/sample/live/online.json)  
[直播-本地](other/sample/live/offline.json)

### 飛機群

[討論群組](https://t.me/fongmi_offical)  
[發布頻道](https://t.me/fongmi_release)

### 贊助

![photo_2024-01-10_11-39-12](https://github.com/FongMi/TV/assets/3471963/fdc12771-386c-4d5d-9a4d-d0bec0276fa7)
