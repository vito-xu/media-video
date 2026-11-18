/**
 * 555电影（555cin.vip）— maccms10，type 3 QuickJS 爬虫
 *
 * 站点结构（2026-11 核实）:
 *   /vodtype/{tid}.html        「XX首页」= 策划模块页，无分页、无筛选（旧的 category 用这个 → 所以只出首页内容）
 *   /vodshow/{tid}-----------.html  「XX库」= 列表页，带筛选 + 分页（11 个占位符全空）
 *   /voddetail/{id}.html       详情
 *   /vodplay/{id}-1-1.html     播放
 *
 * vodshow 路由（maccms10 官方 route.php）:
 *   /vodshow/<id>-<area>-<by>-<class>-<lang>-<letter>-<level>-<order>-<page>-<state>-<tag>-<year>.html
 *   全空时是 11 个 '-'；页码在第 9 段（order 之后、state 之前）
 *   例：第 2 页 → /vodshow/2-------2---.html
 *
 * 筛选（extend 的 key 即路由占位符名）:
 *   area 地区（中文值，如 大陆/韩国）、year 年份（数字）
 *   class（剧情）是 vod_class 的自增 id，站点改版会变 → 不在 home 里写死，
 *   改成首次 category 时从库页 HTML 的筛选块里自动拾取（见 harvestFilters）
 */

const HOST = 'https://555cin.vip';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7',
};

const AREAS = ['大陆', '香港', '台湾', '韩国', '美国', '日本', '法国', '英国', '德国', '泰国', '印度', '其他'];
const PAGE_SIZE = 20;

function headers(referer) {
  const items = {};
  for (const key in HEADERS) items[key] = HEADERS[key];
  if (referer) items.Referer = referer;
  return items;
}

function request(url, referer) {
  try {
    const res = globalThis._http(url, { headers: headers(referer), timeout: 15000 });
    if (res && res.content) {
      const text = res.content;
      if (text.indexOf('404 Not Found') !== -1) return '';
      if (text.indexOf('Attention Required') !== -1 || text.indexOf('Just a moment') !== -1) return '';
      return text;
    }
  } catch (e) {}
  return '';
}

function decode(value) {
  return (value || '')
    .replace(/\\\//g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function abs(url) {
  if (!url) return '';
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.indexOf('/') === 0) return HOST + url;
  return url;
}

function text(value) {
  return decode(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function safeName(name, fallback, index) {
  const n = String(name || '').replace(/[$#]/g, ' ').replace(/\s+/g, ' ').trim();
  return n || (fallback + (index + 1));
}

// 占位图（懒加载未触发时 img 的 src），不要当封面
function isPlaceholder(pic) {
  return !pic || pic.indexOf('community.image.video.qpic.cn') !== -1 || pic.indexOf('data:image') === 0;
}

function pickPic(block) {
  const m = block.match(/data-original="([^"]+)"/) || block.match(/data-src="([^"]+)"/);
  if (m) return abs(decode(m[1]));
  const s = block.match(/<img[^>]*src="([^"]+)"/);
  if (s) {
    const pic = abs(decode(s[1]));
    if (!isPlaceholder(pic)) return pic;
  }
  return '';
}

// 列表卡片：<a href title class="module-poster-item ..."> ... </a>
function parseList(html) {
  const list = [];
  if (!html) return list;

  const re = /<a[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*title="([^"]*)"[^>]*class="[^"]*module-poster-item[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = abs(decode(m[1]));
    const vodName = text(m[2]);
    const block = m[3] || '';
    if (!vodId || !vodName) continue;
    if (list.some((item) => item.vod_id === vodId)) continue;
    const note = block.match(/module-item-note[^>]*>([^<]*)</);
    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: pickPic(block),
      vod_remarks: note ? text(note[1]) : '',
    });
  }

  if (list.length === 0) {
    const fallbackRe = /<a[^>]*class="[^"]*module-poster-item[^"]*"[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*title="([^"]*)"/g;
    while ((m = fallbackRe.exec(html)) !== null) {
      const vodId = abs(decode(m[1]));
      const vodName = text(m[2]);
      if (!vodId || !vodName || list.some((item) => item.vod_id === vodId)) continue;
      list.push({ vod_id: vodId, vod_name: vodName, vod_pic: '', vod_remarks: '' });
    }
  }
  return list;
}

function parseSearch(html) {
  const list = [];
  if (!html) return list;

  const re = /<a[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*class="[^"]*module-card-item-poster[^"]*"[\s\S]*?<a[^>]*href="\1"[^>]*>\s*<strong>(.*?)<\/strong>\s*<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = abs(decode(m[1]));
    const vodName = text(m[2]);
    if (!vodId || !vodName || list.some((item) => item.vod_id === vodId)) continue;
    list.push({ vod_id: vodId, vod_name: vodName, vod_pic: '' });
  }

  if (list.length === 0) {
    const cardRe = /<a[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*class="[^"]*module-card-item-poster[^"]*"/g;
    while ((m = cardRe.exec(html)) !== null) {
      const vodId = abs(decode(m[1]));
      if (!vodId || list.some((item) => item.vod_id === vodId)) continue;
      list.push({ vod_id: vodId, vod_name: '', vod_pic: '' });
    }
  }

  if (list.length > 0) {
    const titleRe = /<a[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*>(?:<strong>)?([^<]*<[^>]+>[^<]*|[^<]+)(?:<\/strong>)?<\/a>/g;
    while ((m = titleRe.exec(html)) !== null) {
      const vodId = abs(decode(m[1]));
      for (let i = 0; i < list.length; i++) {
        if (list[i].vod_id === vodId && !list[i].vod_name) list[i].vod_name = text(m[2]);
      }
    }
  }
  return list.filter((item) => item.vod_name);
}

// ---------- vodshow 路由拼装 ----------

// 顺序必须与 maccms10 route.php 一致
const SHOW_SLOTS = ['area', 'by', 'class', 'lang', 'letter', 'level', 'order', 'page', 'state', 'tag', 'year'];

function buildShowUrl(tid, page, ext) {
  const e = ext || {};
  const parts = [];
  for (let i = 0; i < SHOW_SLOTS.length; i++) {
    const slot = SHOW_SLOTS[i];
    if (slot === 'page') parts.push(Number(page) > 1 ? String(page) : '');
    else parts.push(e[slot] ? String(e[slot]) : '');
  }
  return HOST + '/vodshow/' + tid + '-' + parts.join('-') + '.html';
}

/**
 * 从页内分页链接反推页码模板（自校正）：
 * 找到文字是 "2" 的同类型链接，把其中值为 2 的段替换成 {page}
 */
function pageTemplate(html, tid) {
  if (!html) return '';
  const re = /<a[^>]*href="(\/vodshow\/[^"]*?)"[^>]*>\s*2\s*<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decode(m[1]);
    if (href.indexOf('/vodshow/' + tid + '-') !== 0) continue;
    const seg = href.replace(/^\/vodshow\//, '').replace(/\.html.*$/, '').split('-');
    for (let i = 1; i < seg.length; i++) {
      if (seg[i] === '2') {
        seg[i] = '{page}';
        return '/vodshow/' + seg.join('-') + '.html';
      }
    }
  }
  return '';
}

function parsePageCount(html, tid, page, size) {
  let max = page;
  if (html) {
    const total = html.match(/共\s*(\d+)\s*页/);
    if (total) max = Math.max(max, Number(total[1]));
    const re = new RegExp('<a[^>]*href="\\/vodshow\\/' + tid + '[^"]*"[^>]*>\\s*(\\d{1,4})\\s*<\\/a>', 'g');
    let m;
    while ((m = re.exec(html)) !== null) max = Math.max(max, Number(m[1]));
  }
  if (max > page) return max;
  // 分页块抓不到时：满页就认为还有下一页（宁可多请求一次，也不要提前锁死）
  return size >= Math.min(15, PAGE_SIZE - 5) ? page + 1 : page;
}

// 从库页的筛选块里拾取「剧情」的真实取值（maccms 的 vod_class id，站点改版会变，不能写死）
function harvestClasses(html) {
  if (!html) return [];
  const items = [];
  const re = /<a[^>]*href="\/vodshow\/\d+-([^"]*?)"[^>]*>([^<]{1,12})<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const seg = decode(m[1]).split('-');
    const name = text(m[2]);
    if (!name || name === '全部') continue;
    // class 是第 3 段（area by class ...）
    const val = seg.length > 2 ? seg[2] : '';
    if (!val || /^\d+$/.test(val) === false) continue;
    if (items.some((i) => i.v === val)) continue;
    items.push({ n: name, v: val });
  }
  return items;
}

function buildFilters(classValues) {
  const area = [{ n: '全部', v: '' }];
  for (let i = 0; i < AREAS.length; i++) area.push({ n: AREAS[i], v: AREAS[i] });

  const year = [{ n: '全部', v: '' }];
  let now = 2026;
  try { now = new Date().getFullYear(); } catch (e) {}
  for (let y = now; y >= 2000; y--) year.push({ n: String(y), v: String(y) });

  const filters = [
    { key: 'area', name: '地区', init: '', value: area },
    { key: 'year', name: '年份', init: '', value: year },
  ];
  if (classValues && classValues.length > 0) {
    filters.splice(1, 0, { key: 'class', name: '剧情', init: '', value: [{ n: '全部', v: '' }].concat(classValues) });
  }
  return filters;
}

const CLASSES = [
  { type_id: '1', type_name: '电影' },
  { type_id: '2', type_name: '连续剧' },
  { type_id: '126', type_name: '短剧' },
  { type_id: '4', type_name: '动漫' },
  { type_id: '3', type_name: '综艺纪录' },
];

const spider = {
  init() {
    this.classCache = this.classCache || {};
    this.pageTpl = this.pageTpl || {};
  },

  home() {
    this.init();
    const filters = buildFilters(this.classValues || []);
    const map = {};
    for (let i = 0; i < CLASSES.length; i++) map[CLASSES[i].type_id] = filters;
    return JSON.stringify({ class: CLASSES, filters: map });
  },

  homeVod() {
    const html = request(HOST + '/vodtype/1.html');
    return JSON.stringify({ list: parseList(html) });
  },

  category(tid, pg, filter, extend) {
    this.init();
    const page = Number(pg || 1);
    const typeId = String(tid || '1');
    const ext = extend || null;

    const key = typeId;
    let url = buildShowUrl(typeId, page, ext);
    // 第 2 页起优先用页内反推出的模板（自校正，防止路由段位记错）
    if (page > 1 && this.pageTpl[key]) url = HOST + this.pageTpl[key].replace('{page}', String(page));

    const html = request(url);

    // 首次成功进入库页时补齐筛选（剧情）并缓存
    if (page === 1 && html && !this.classValues) {
      const items = harvestClasses(html);
      if (items.length > 0) this.classValues = items;
    }
    if (page === 1 && html && !this.pageTpl[key]) {
      const tpl = pageTemplate(html, typeId);
      if (tpl) this.pageTpl[key] = tpl;
    }

    const list = parseList(html);
    return JSON.stringify({
      page: page,
      pagecount: parsePageCount(html, typeId, page, list.length),
      limit: list.length || PAGE_SIZE,
      total: list.length,
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    const html = request(pageUrl);
    if (!html) return JSON.stringify({ list: [] });

    let name = '';
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) name = text(titleMatch[1]).replace(/高清.*$/, '').replace(/555电影.*$/, '').trim();

    let pic = '';
    const picMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
                      html.match(/<div[^>]*class="[^"]*(?:mobile-play|cover)[^"]*"[^>]*>[\s\S]*?<img[^>]*(?:data-original|src)="([^"]+)"/);
    if (picMatch) pic = abs(decode(picMatch[1]));

    let desc = '';
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    if (descMatch) desc = decode(descMatch[1]);

    let remarks = '';
    const remarkMatch = html.match(/module-item-note[^>]*>([^<]*)</);
    if (remarkMatch) remarks = text(remarkMatch[1]);

    const playItems = [];
    const playRe = /<a[^>]*class="[^"]*module-play-list-link[^"]*"[^>]*href="([^"]*\/vodplay\/[^"?]+\.html)"[^>]*title="([^"]*)"/g;
    let m;
    while ((m = playRe.exec(html)) !== null) {
      const url = abs(decode(m[1]));
      const itemName = safeName(decode(m[2]).replace(/^播放/, ''), '播放', playItems.length);
      if (!playItems.some((item) => item.url === url)) playItems.push({ name: itemName, url: url });
    }

    // 兜底：有些模板播放列表不带 title
    if (playItems.length === 0) {
      const looseRe = /<a[^>]*class="[^"]*module-play-list-link[^"]*"[^>]*href="([^"]*\/vodplay\/[^"?]+\.html)"[^>]*>([\s\S]*?)<\/a>/g;
      while ((m = looseRe.exec(html)) !== null) {
        const url = abs(decode(m[1]));
        const itemName = safeName(text(m[2]).replace(/^播放/, ''), '播放', playItems.length);
        if (!playItems.some((item) => item.url === url)) playItems.push({ name: itemName, url: url });
      }
    }

    const playUrls = playItems.map((item) => item.name + '$' + item.url).join('#');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name || '视频',
        vod_pic: pic,
        vod_remarks: remarks,
        vod_content: desc,
        vod_play_from: '在线播放',
        vod_play_url: playUrls,
      }],
    });
  },

  search(key) {
    const url = HOST + '/vodsearch/-------------.html?wd=' + encodeURIComponent(key);
    const html = request(url);
    return JSON.stringify({ list: parseSearch(html) });
  },

  play(flag, id) {
    const pageUrl = abs(id);
    const html = request(pageUrl, pageUrl);
    let mediaUrl = '';
    if (html) {
      const playerMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[^<]*?\})\s*<\/script>/);
      if (playerMatch) {
        try {
          const player = JSON.parse(decode(playerMatch[1]).replace(/\\\//g, '/'));
          mediaUrl = player.url || '';
        } catch (e) {}
      }
      if (!mediaUrl) {
        const direct = html.match(/(?:https?:\\\/\\\/|https?:\/\/)[^"'<> ]+\.(?:m3u8|mp4)[^"'<> ]*/);
        if (direct) mediaUrl = decode(direct[0]).replace(/\\\//g, '/');
      }
    }
    return JSON.stringify({
      parse: 0,
      url: mediaUrl,
      header: {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': HOST + '/',
      },
    });
  },

  live() { return ''; },
  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

export default spider;
