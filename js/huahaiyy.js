/**
 * 花海影院（huahaiyy.com）— Tailwind SSR 模板，type 3 QuickJS 爬虫
 *
 * 结构（2026-11 核实）:
 *   /dianying.html /dianshiju.html /zongyi.html /dongman.html /duanju.html   频道列表，24 条/页
 *   ?class=剧情&area=中国大陆&year=2025&sort_field=play_hot&page=N           筛选 + 分页（page 0 基）
 *   /movie/{hash}-{id}.html   电影详情      /tv/{hash}-{id}.html   剧集详情
 *   /s.html?name=KEY&page=N   搜索
 *   集数：?origin=<线路>&p=<集序号>
 *   播放：详情页 <link rel="preload" href="/api/m3u8?origin=X&url=H">
 *         该接口 302 → https://box.dyrs.com.de/api/super?id=H&origin=X（master m3u8，变体为相对路径）
 *         部分线路 preload 直接是 CDN 绝对 m3u8
 *
 * 筛选的 class 取值每个频道都不同（各 24 个），home() 抓一次首页侧栏按频道拾取；
 * area/year 取两频道交集，避免出现点了空列表的取值。
 */

const HOST = 'https://huahaiyy.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;

const CHANNELS = [
  { type_id: 'dianying', type_name: '电影', path: '/dianying.html' },
  { type_id: 'dianshiju', type_name: '电视剧', path: '/dianshiju.html' },
  { type_id: 'zongyi', type_name: '综艺', path: '/zongyi.html' },
  { type_id: 'dongman', type_name: '动漫', path: '/dongman.html' },
  { type_id: 'duanju', type_name: '短剧', path: '/duanju.html' },
];

const AREAS = ['中国大陆', '美国', '日本', '英国', '中国香港', '法国', '韩国', '加拿大', '印度', '德国', '意大利', '中国台湾', '西班牙', '泰国', '俄罗斯', '澳大利亚', '墨西哥', '丹麦', '波兰', '土耳其', '巴西'];

const SORTS = [
  { n: '默认', v: '' },
  { n: '热度', v: 'play_hot' },
];

function headers(referer) {
  return { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: referer || HOST + '/' };
}

function request(url, referer) {
  try {
    const res = globalThis._http(url, { headers: headers(referer), timeout: 15000 });
    if (res && res.content) {
      const text = res.content;
      if (text.indexOf('404 Not Found') !== -1) return '';
      return text;
    }
  } catch (e) {}
  return '';
}

function decode(value) {
  return (value || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function abs(url) {
  if (!url) return '';
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.indexOf('/') === 0) return HOST + url;
  return url;
}

function text(value) {
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeName(name, fallback, index) {
  const n = String(name || '').replace(/[$#]/g, ' ').replace(/\s+/g, ' ').trim();
  return n || (fallback + (index + 1));
}

// ---------- 列表解析 ----------

function parseList(html) {
  const list = [];
  if (!html) return list;

  const re = /<a href="(\/(?:movie|tv)\/[^"]+-\d+\.html)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = abs(decode(m[1]));
    const vodName = text(m[2]);
    if (!vodId || !vodName) continue;
    if (list.some((item) => item.vod_id === vodId)) continue;

    const block = m[3] || '';
    let pic = '';
    const picMatch = block.match(/data-src="([^"]+)"/) || block.match(/<img[^>]*src="([^"]+)"/);
    if (picMatch) pic = abs(decode(picMatch[1]));

    let remarks = '';
    const noteMatch = block.match(/top-2 right-2[\s\S]{0,200}?>\s*([^<]{1,12}?)\s*</);
    if (noteMatch) remarks = text(noteMatch[1]);

    list.push({ vod_id: vodId, vod_name: vodName, vod_pic: pic, vod_remarks: remarks });
  }
  return list;
}

// ---------- 筛选 ----------

function parseChannels(html) {
  const genres = {};
  if (!html) return genres;
  const parts = html.split(/toggleSection\('([a-z]+)-cats'\)/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const body = (parts[i + 1] || '').slice(0, 8000);
    const re = new RegExp('href="/' + name + '\\.html\\?class=([^"]+)"[^>]*>([\\s\\S]{0,400}?)</a>', 'g');
    const items = [];
    let m;
    while ((m = re.exec(body)) !== null) {
      const val = decodeURIComponent(decode(m[1]));
      const label = text(m[2]);
      if (!val || items.some((it) => it.v === val)) continue;
      items.push({ n: label || val, v: val });
    }
    if (items.length > 0) genres[name] = items;
  }
  return genres;
}

function buildFilters(genres) {
  const area = [{ n: '全部', v: '' }];
  for (let i = 0; i < AREAS.length; i++) area.push({ n: AREAS[i], v: AREAS[i] });

  const year = [{ n: '全部', v: '' }];
  let now = 2026;
  try { now = new Date().getFullYear(); } catch (e) {}
  for (let y = now; y >= 2000; y--) year.push({ n: String(y), v: String(y) });
  year.push({ n: '2020年代', v: '2020年代' });
  year.push({ n: '2010年代', v: '2010年代' });
  year.push({ n: '2000年代', v: '2000年代' });

  const filters = [];
  if (genres && genres.length > 0) {
    filters.push({ key: 'class', name: '类型', init: '', value: [{ n: '全部', v: '' }].concat(genres) });
  }
  filters.push({ key: 'area', name: '地区', init: '', value: area });
  filters.push({ key: 'year', name: '年份', init: '', value: year });
  filters.push({ key: 'sort_field', name: '排序', init: '', value: SORTS });
  return filters;
}

// ---------- 详情/播放 ----------

function swapOrigin(url, origin) {
  return url.replace(/([?&]origin=)[^&]*/, '$1' + encodeURIComponent(origin));
}

function stripYear(name) {
  return String(name || '').replace(/\s*[（(]\s*\d{4}\s*[)）]\s*$/, '').trim();
}

function buildLines(html, pageUrl) {
  const origins = [];
  const tabRe = /<button[^>]*data-origin="([^"]+)"/g;
  let m;
  while ((m = tabRe.exec(html)) !== null) if (origins.indexOf(m[1]) === -1) origins.push(m[1]);

  const eps = [];
  const epRe = /<a href="([^"]+)"[^>]*class="episode-button[^"]*"[^>]*data-origin="([^"]+)"[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/g;
  while ((m = epRe.exec(html)) !== null) {
    const url = abs(decode(m[1]));
    eps.push({ name: safeName(text(m[3]), '第', eps.length) , url: url, origin: m[2] });
  }

  const lines = [];
  if (eps.length > 0) {
    const primary = eps[0].origin || (origins[0] || '');
    lines.push({ name: primary || '线路1', eps: eps });
    const others = origins.filter((o) => o !== primary).slice(0, 3);
    for (let i = 0; i < others.length; i++) {
      const cloned = [];
      for (let j = 0; j < eps.length; j++) cloned.push({ name: eps[j].name, url: swapOrigin(eps[j].url, others[i]) });
      lines.push({ name: others[i], eps: cloned });
    }
  } else {
    const os = origins.length > 0 ? origins.slice(0, 4) : [''];
    for (let i = 0; i < os.length; i++) {
      const url = os[i] ? pageUrl + (pageUrl.indexOf('?') === -1 ? '?' : '&') + 'origin=' + encodeURIComponent(os[i]) : pageUrl;
      lines.push({ name: os[i] || '默认', eps: [{ name: '正片', url: url }] });
    }
  }
  return lines;
}

const spider = {
  init() {
    this.genres = this.genres || null;
    this.homeHtml = this.homeHtml || '';
  },

  home() {
    this.init();
    const html = request(HOST + '/');
    this.homeHtml = html;
    this.genres = parseChannels(html);

    const classes = [];
    const filters = {};
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = CHANNELS[i];
      classes.push({ type_id: ch.type_id, type_name: ch.type_name });
      filters[ch.type_id] = buildFilters(this.genres[ch.type_id] || []);
    }
    return JSON.stringify({ class: classes, filters: filters });
  },

  homeVod() {
    this.init();
    const html = this.homeHtml || request(HOST + '/');
    if (!this.homeHtml) this.homeHtml = html;
    return JSON.stringify({ list: parseList(html).slice(0, 30) });
  },

  category(tid, pg, filter, extend) {
    this.init();
    const channel = findChannel(tid);
    const page = Math.max(0, Number(pg || 1) - 1);
    const ext = extend || {};

    const qs = [];
    if (ext.class) qs.push('class=' + encodeURIComponent(ext.class));
    if (ext.area) qs.push('area=' + encodeURIComponent(ext.area));
    if (ext.year) qs.push('year=' + encodeURIComponent(ext.year));
    if (ext.sort_field) qs.push('sort_field=' + encodeURIComponent(ext.sort_field));
    if (page > 0) qs.push('page=' + page);

    const url = HOST + channel.path + (qs.length ? '?' + qs.join('&') : '');
    const html = request(url);
    const list = parseList(html);

    return JSON.stringify({
      page: Number(pg || 1),
      pagecount: parsePageCount(html, page, list.length),
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
    let pic = '';
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/);
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
    if (ogTitle) name = stripYear(decode(ogTitle[1]));
    if (ogImage) pic = abs(decode(ogImage[1]));
    if (!name) {
      const t = html.match(/<title>([^<]+)<\/title>/);
      if (t) name = stripYear(text(t[1]).split(/[《》]/).filter(Boolean)[0] || '');
    }
    if (!pic) {
      const cover = html.match(/<img[^>]*(?:data-src|data-original)="([^"]+)"/);
      if (cover) pic = abs(decode(cover[1]));
    }

    let desc = '';
    const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/);
    if (ogDesc) desc = decode(ogDesc[1]);

    const lines = buildLines(html, pageUrl);
    let remarks = '';
    if (lines.length > 0 && lines[0].eps.length > 1) remarks = lines[0].eps.length + '集';
    else {
      const q = html.match(/(\d{3,4}[pP]|4K)/);
      if (q) remarks = q[1];
    }
    const from = lines.map((l) => l.name).join('$$$');
    const play = lines.map((l) => l.eps.map((e) => e.name + '$' + e.url).join('#')).join('$$$');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name || '视频',
        vod_pic: pic,
        vod_remarks: remarks,
        vod_content: desc,
        vod_play_from: from,
        vod_play_url: play,
      }],
    });
  },

  search(key, quick, pg) {
    const page = Math.max(0, Number(pg || 1) - 1);
    let url = HOST + '/s.html?name=' + encodeURIComponent(key);
    if (page > 0) url += '&page=' + page;
    const html = request(url);
    return JSON.stringify({ list: parseList(html) });
  },

  play(flag, id) {
    const pageUrl = abs(id);
    const html = request(pageUrl, pageUrl);
    let target = '';

    const pre = html.match(/<link[^>]*rel="preload"[^>]*href="([^"]+)"/i) ||
                html.match(/href="([^"]*\/api\/m3u8\?[^"]+)"/i) ||
                html.match(/(https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*)/);
    if (pre) target = decode(pre[1]);

    if (target.indexOf('//') === 0) target = 'https:' + target;
    else if (target.indexOf('/') === 0) target = HOST + target;

    // /api/m3u8 是 302，取 Location 拿最终 master（变体是相对路径，必须用最终地址做 base）
    if (target && target.indexOf('/api/m3u8') !== -1) {
      try {
        const res = globalThis._http(target, { headers: headers(pageUrl), redirect: 0, timeout: 10000 });
        const h = res && res.headers ? (res.headers.location || res.headers.Location) : '';
        if (h) target = h.indexOf('//') === 0 ? 'https:' + h : h;
      } catch (e) {}
    }

    return JSON.stringify({
      parse: 0,
      url: target,
      header: { 'User-Agent': UA, Referer: HOST + '/' },
    });
  },

  live() { return ''; },
  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

function findChannel(tid) {
  for (let i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].type_id === tid) return CHANNELS[i];
  return CHANNELS[0];
}

function parsePageCount(html, page, size) {
  let max = -1;
  const re = /[?&]page=(\d+)/g;
  let m;
  while ((m = re.exec(html || '')) !== null) max = Math.max(max, Number(m[1]));
  if (max >= 0) {
    const count = max + 1;
    return count > 0 ? count : 1;
  }
  return size >= PAGE_SIZE - 4 ? page + 2 : page + 1;
}

export default spider;
