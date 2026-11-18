---
name: tvbox-config-builder
description: 影视资源网站分析并生成 TVBox/FongMi 配置（config.json + QuickJS 爬虫）的完整工作流。当接入新站点、编写或修复 TVBox spider 爬虫、分析网站数据结构（苹果CMS API / SSR HTML / Alpine+Recombee / eval packed JS / 签名 API）、排查站点改版导致解析失效、真机播放验证、或部署配置托管时使用。覆盖 type:0/1 API 接入、type:3 JS 爬虫、封锁分级应对、本地测试闭环、真机验证与 raw 托管。
agent_created: true
---

# TVBox 配置生成：网站分析 → 爬虫 → 配置上线

## 核心原则（先读，决定成败）

1. **API 优先于 HTML 解析**。先找站点背后的 JSON API（苹果CMS `/api.php/provide/vod/`、Recombee、JSONP）。API 稳定、不受页面改版影响；HTML 正则永远是最脆弱的兜底。
2. **渲染方式决定解析对象**。SSR（curl 拿到的 HTML 就有数据）→ 解析 HTML；客户端渲染（Alpine/React/Vue，初始 HTML 是空壳）→ 必须追 XHR 找数据 API，不在空壳上写正则。
3. **抓取基建与解析逻辑分离**。爬虫只依赖 `globalThis._http(url, {headers, timeout})` 一个同步接口。封锁升级时只换基建（代理 / cloudscraper / stealth 浏览器），解析代码不动。
4. **测试闭环先行**。先建 harness 存真实 HTML 样本，再写解析；每轮改正则都用样本回归，不重复抓网站。

## 选源标准（决定要不要接）
- 搜索（searchable）：实测 `ac=videolist&wd=` 或站点搜索端点返回有效结果才可宣称支持
- **无搜索可接受的前提：片库丰富（万部级）**；无搜索且片库小（千部级以下）一律不接
- type 1 采集站：播放链接必须是直链 m3u8/mp4（`/share/` 中转页、html 播放页不算）；`t=` 仅对子分类生效属正常
- 原则：爬什么给什么，不做内容过滤

## Phase 0 — 接入方式决策（30 秒）

按顺序试，命中即停：

1. 访问 `https://域名/api.php/provide/vod/?ac=list&pg=1`，返回 JSON（含 `code`/`list`/`class`/`total`）→ **type:1**，api 填该地址，收工。国内 90% 影视站是苹果CMS。辅助特征：网页含 `var maccms`、URL 形如 `/show/1-----------.html`。
2. 站点有开放 JSON/JSONP 数据接口（Recombee、自定义 api）→ **type:3 JS 爬虫直连 API**。
3. 以上都没有 → **type:3 JS 爬虫解析 HTML**。
4. 页面重度混淆、需执行复杂 JS → JAR/Python 爬虫（超出本 skill 范围）。

## Phase 1 — 网站分析 SOP

### 1.1 通路探测与封锁分级
运行 `scripts/probe_site.py <url> [--proxy http://127.0.0.1:7890]`，按输出选基建（分级详表见 references/anticrawl.md）：

| 探测结果 | 含义 | 基建选择 |
|---|---|---|
| 直连 200 | 无防护 | 爬虫直连 |
| 直连超时 / DNS 异常 | GFW 封锁 | 必须走海外代理 |
| 403 + `cf-mitigated: challenge` + `cType:'managed'` | CF 托管挑战 | cloudscraper 已无效，需 stealth 浏览器 / FlareSolverr |
| 403 + `cf_chl_opt`（无 managed） | CF JS 挑战 | cloudscraper 通常可解 |
| 响应含 "you have been blocked" | IP 封禁 | 换 IP |

### 1.2 列表页结构分析
用 `assets/analyze_page.js`（Playwright，支持代理）dump 列表页，然后：
- 数卡片容器 class、`<a href>` 模式、图片属性（`src`/`data-src`/`data-echo`）、标题位置（`alt`/子 div）
- 对比 `domcontentloaded` 与 `networkidle` 两次 HTML 长度：几乎不变 = SSR；暴涨 = 客户端渲染 → 转 1.3
- 记录分页参数（`?page=N` / `/page-N` / JSONP `page_num`）

### 1.3 数据源定位（客户端渲染站点必做）
在 analyze_page.js 的 XHR 拦截输出里找 JSON 响应（recombee、`/api/`、graphql）。记录完整 URL、方法、必需请求头。能复现 → 爬虫直连 API（最稳）；不能 → 退回 HTML 解析 + 基建升级。

API 要签名时（返回"应用签名不可为空"等）：用 playwright 拦 **request 头**找 sign/t/deviceId，再下载站点 JS grep `signKey` 定位算法，最后用浏览器捕获的真实 sign 复算验证。完整逆向流程见 references/site-patterns.md 模式 9。

### 1.4 详情页提取点定位
按优先级找播放 URL，命中即止（各模式解析策略见 references/site-patterns.md）：
1. `og:title`/`og:image`/`description` meta（几乎所有站都有，先拿标题海报）
2. 专用下载页（如 `/download?v=`）的直链表格
3. `data-source` 等自定义属性
4. `<source>`/`<video>` 内联 src
5. `eval(function(p,a,c,k,e,d){...})` packed JS → 用 assets/spider_template.js 内置的修复版 unpacker

### 1.5 筛选项盘点（站点有筛选就必须接）
把每个列表页的筛选区 dump 下来，逐组记录成契约，缺失这一步 = App 没有筛选按钮：

| 记录项 | 示例 |
|---|---|
| 分组与参数名 | 分类=`class`、地区=`area`、年份=`year`、排序=`sort_field` |
| 取值全集 | **逐频道核对**——常见坑：各频道类型表不同；侧栏可能只列部分（如 21/24）；某频道值更少（短剧地区 17 个） |
| 值形态 | 中文原文（需 encodeURIComponent）、数字 id、枚举码 |
| 翻页基制 | `?page=N` 是 0 基还是 1 基；带筛选时翻页参数怎么组合 |
| 特殊组 | 「高级/排除」类：判断是否依赖登录态（已观看/不想看之类 TVBox 直接放弃） |

取值表过长的处理：静态原样表（准确但会过期）∪ 能一次抓到的页面实时拾取（如首页侧栏），两者合并。

### 1.6 输出分析结论
写一段简短结论：数据源（API / SSR / 客户端）、列表选择器、详情提取点、分页方式、筛选组契约、反爬等级、所需基建。后续实现与测试全部以此为契约。

## Phase 2 — 爬虫实现

从 `assets/spider_template.js` 拷贝骨架，按分析结论填空。骨架已内置：`request()`（CF 挑战页检测 + 可选 PROXY）、修复版 `decode()`（HTML 实体）、修复版 `decodeEval()` + `packerKey()`（radix ≤ 62）。

契约速查（完整版见 references/spider-contract.md）：
- 所有方法返回 **JSON 字符串**；`home` 回 `{class:[{type_id,type_name}], filters:{type_id:[Filter]}}`
- **站点有筛选项就必须下发 `filters`**（App 的筛选按钮只在 filters 非空时出现）；结构见 1.5 与 references
- 列表项：`vod_id`（详情回传的唯一键，用稳定值）、`vod_name`、`vod_pic`
- `category(tid,pg,filter,extend)`：**签名必须带满 4 个参数**；extend 的 key 即 filters 里定义的 key，直接映射站点 query 参数
- 详情：`vod_play_from` + `vod_play_url`，格式 `名$URL#名$URL`，多线路 `$$$` 分隔；集数名不能含 `$` `#`
- 播放：`{parse:0, url, header:{Referer,User-Agent}}`；防盗链站点必须带对 Referer；Origin 慎用（部分 CDN 校验 Origin 会 403）
- `search(key)` 与列表共用 parseList
- 环境约束：QuickJS 无 DOM/BOM；`_http` 同步阻塞；模块格式 `export default spider`

## Phase 3 — 测试闭环

用 `scripts/test_spider.js`（Node，vm 加载 + mock 同步 `_http`）：

```bash
# 实网模式（走代理）
node scripts/test_spider.js js/xxx.js category dm 1 '{"class":"剧情","area":"大陆"}' --proxy http://127.0.0.1:7890
# 样本回放模式（不抓网站，秒级回归）
node scripts/test_spider.js js/xxx.js category dm 1 --sample 'dm=./samples/dm_p1.html'
```

验收断言（每条都必须过）：
1. `home()` 分类数与站点一致；**站点有筛选时 filters 组数与站点一致**（harness 会打印每组的取值数）
2. `category()` 条数 > 0、`pagecount` 合理、`vod_id` 唯一
3. **筛选回归**：每组任取 1–2 个值跑 `category(tid,1,true,{"key":"值"})`，非空才算过；值为空时对照站点官方筛选链接是否同样为空（空=站点数据稀疏，保留取值）
4. `detail()` 至少 1 条播放线路、URL 以 http 开头、`curl -I`（带 header）验证可达
5. `search()` 条数 > 0
6. 用 analyze_page.js 产出存样本；站点改版后先用旧样本定位变化，再抓新页

## Phase 4 — 配置接线与托管

config.json 的 sites 片段：

```json
{
  "key": "站点key（全局唯一）",
  "name": "显示名",
  "type": 3,
  "api": "./js/xxx.js",
  "searchable": 1,
  "quickSearch": 1,
  "filterable": 0,
  "style": { "type": "rect", "ratio": 1.33 }
}
```

- `api` 相对路径相对 **config URL 本身**解析：config 在 `raw.githubusercontent.com/u/r/main/config.json`，则 `./js/xxx.js` → `.../main/js/xxx.js`。js 必须与 config 同仓库同相对位置。
- 托管：GitHub raw（国内不稳）/ Gitee raw（国内推荐）；TVBox 填 raw 直链。
- **改名坑**：改 config 文件名 = 改 TVBox 里填的 URL，必须同步所有引用；不要为"刷新缓存"反复改名，用查询串 `?v=2` 破缓存。
- 横版封面（视频站缩略图 16:9）加 `style.ratio: 1.33`；直式海报省略。
- `quickSearch:1` 要求 search 快（<3s），慢站点关掉。

### 部署目标（谁在消费这份配置）

- **TVBoxOSC（自研）**：`feature/js-spider` 起原生支持 type:3 QuickJS（运行时同源移植自 FongMi），相对路径解析规则一致；对极简配置（仅 sites 数组）做了空安全——parses/ads/ijk 缺失可正常加载，ijkCodes 为空自动补软解码项。
- **FongMi/TV、影视仓等**：原生支持 QuickJS，极简配置一般可行；分发给"未知播放器"的公开配置建议带最小 parses/ijk 兜底（老内核缺字段会 NPE）。
- **老 TVBox OSC 内核**：只有 JarLoader（JAR 爬虫），完全不支持 type:3——接入前先确认目标播放器能不能跑 JS。

## Phase 5 — 真机验证（harness 全绿 ≠ 能播）

设备侧还有配置解析、QuickJS 运行时差异、播放器内核、CDN 网络四道关，最后一道验收必须上真机。完整手册见 references/device-testing.md，最小流程：

1. 配置托管到 LAN：配置目录内 `python3 -m http.server 8898 --bind <LAN-IP>`，手机 App 配置填 `http://<LAN-IP>:8898/config.json`
2. 爬虫里加 `console.log`（会打进 logcat `quickjs` tag），`adb logcat -s quickjs` 现场看 apiGet/play 调用
3. 驱动到播放页触发 play()，断言 **`PREPARED` 且 `RENDERING_START`**（前者只是就绪，后者才是真的在播）
4. 三大坑提前防：屏幕常亮（锁屏 = dump 全空）、触摸注入失效改 DPAD 焦点导航（`keyevent 23` 确认）、点击打偏查 mAppBounds 刘海偏移

## Phase 6 — 运维循环

站点改版处理流：探活（probe_site.py）→ 抓新样本（analyze_page.js）→ 与旧样本 diff 找结构变化 → 修正则 → harness 回归 → 提交。每个修复提交附带一条新测试样本。

## 坑清单（全部来自实战）

- packer unpacker：radix > 36 时 `toString(radix)` 抛 RangeError，必须用 base-N 自定义编码；逐 key 替换有顺序依赖，必须单次正则（key 按长度降序）
- HTML 实体：`decode()` 的 `&amp;/&quot;/&lt;/&gt;` 别写成 no-op 的 `/&/g → '&'`（实体名被抹掉）
- QuickJS 无 crypto：需要 MD5/SHA1 时内置纯 JS 实现，并与 Node crypto 交叉验证；**SHA1 长度字段大端序、MD5 小端序**，写反静默出错
- 签名 API 的 signKey 硬编码在 JS 里会随站点改版变更，抓取失败时先复查 JS
- 详情解析失败不要拿详情页 URL 当播放源兜底（假源），返回空让上层报错
- `vod_id` 用完整绝对 URL，别用相对路径（detail 回传会拼错 base）
- `pagecount` 从页面解析，别写死；解析不到给 1，别给 999
- 播放 URL 带 `expires`/签名参数的不要长期缓存（过期即失效）
- 列表页第一屏常混广告卡片（如 Erolabs 赞助位），解析前先甄别链接域名
- 分页 URL 拼接注意 `?` 与 `&`：带 filter 参数时翻页用 `&page=`；先确认站点 page 是 0 基还是 1 基（App 恒传 1 起，0 基站点要 -1）
- **filters 的 `init` 必须是空串 `""` 而不是 null**：FongMi 的 `Class.getExtend(true)` 只带 `init != null` 的组，null 会导致初始 extend 缺 key
- filters 是 **按 type_id 键控的 map**（`{"1":[...]}`），不是数组；漏键 = 该分类没有筛选按钮
- 各频道筛选取值往往不同（类型表、地区表），照抄一个频道的表到其他频道会出现「选了是空列表」；先逐频道核对再定表
- 站点自身筛选链接可能返回空（数据稀疏），与站点行为一致即可，别急着当 bug 修
- 排除类筛选（已观看/不想看）依赖登录态，TVBox 无账号体系，直接放弃
- 真机 UI 自动化三坑：锁屏 = uiautomator 空 dump（先常亮）；触摸注入对部分视图失效（改 DPAD 焦点导航 + `keyevent 23`）；dump 窗口坐标与 input tap 屏幕坐标有刘海偏移（查 `mAppBounds`）
- App 配置对话框：输入后软键盘会盖住确定按钮，先 `keyevent 4` 收键盘再点，否则提交是假象（用服务器访问日志验证真到达）
- 无线 adb 配对端口 ≠ 连接端口，断连后 `adb mdns services` 查新端口重连

## Resources

### scripts/
- `probe_site.py` — 站点通路与封锁分级探测（stdlib，支持代理）
- `test_spider.js` — QuickJS 爬虫本地测试 harness（vm 加载 + mock `_http`，实网/样本回放双模式）
- `test_unpacker.js` — 模板 unpacker 单元测试（radix 16/36/62 + 替换顺序回归），改模板后必跑

### references/
- `spider-contract.md` — Spider 方法契约、JSON 返回格式、site 配置字段、相对路径解析规则
- `site-patterns.md` — 九种站点数据模式（CMS API / SSR / Alpine+API / og meta / 下载页 / data-source / packed JS / JSONP / 签名 API）的识别与解析策略，含真实案例
- `anticrawl.md` — 封锁分级、基建选型、GFW 部署现实、cloudscraper 没落与 stealth 替代
- `device-testing.md` — 真机验证手册：无线 adb、LAN 托管、UI 自动化四坑、console.log 调试管道、播放断言与静默失败速查

### assets/
- `spider_template.js` — 爬虫骨架模板（含修复版 decode/unpacker，拷贝后填空）
- `analyze_page.js` — Playwright 页面分析脚本模板（dump HTML + 模式计数 + XHR 拦截 + SSR 判定，支持代理）
