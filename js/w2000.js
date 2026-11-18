/**
 * 神马电影网（w2000.com）— MacCMS10 + stui 模板，type 3 QuickJS 爬虫
 *
 * 结构（2026-11 核实）:
 *   /show/{id}-{area}-{by}-{class}-{lang}-{letter}-{level}-{order}-{page}-{state}-{tag}-{year}.html
 *   与 maccms10 官方路由逐位对应；页码 1 基（第 1 页链接也带 '1'），pagecount 取 <span class="num">1/668</span>
 *   筛选行（stui-screen__list）:
 *     按类型 → 改变 id 本身（子分类，如连续剧的 12..19），取为独立分类
 *     按剧情→slot3(class) 按地区→slot1(area) 按语言→slot4(lang) 按年份→slot11(year) 按人气→slot2(by)
 *   卡片: <a class="stui-vodlist__thumb lazyload" href="/vod/{id}.html" title="名" data-original="海报"> <span class="pic-text">备注</span>
 *   详情: /vod/{id}.html —— 海报 stui-content__thumb 的 data-original；线路 <a href="#playlistN">名(数)</a> + <div id="playlistN"> /play/{id}-{seg}-{ep}.html
 *   播放: /play/... 页 var player_aaaa = {url:"https://...m3u8"} 直链
 *   搜索: /search/{wd}-------------.html 触发「安全验证」人工验证码 → 本源 searchable=0
 */

const HOST = 'https://w2000.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 顶层频道；子分类（按类型行）在 home() 时从频道页拾取
const CHANNELS = [
  { type_id: '1', type_name: '电影', path: '/show/1-----------.html' },
  { type_id: '2', type_name: '连续剧', path: '/show/2-----------.html' },
  { type_id: '3', type_name: '综艺', path: '/show/3-----------.html' },
  { type_id: '4', type_name: '动漫', path: '/show/4-----------.html' },
];

function headers(referer) {
  const items = {};
  items['User-Agent'] = UA;
  items['Accept-Language'] = 'zh-CN,zh;q=0.9';
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
      if (text.indexOf('安全验证') !== -1) return '';
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

function findChannel(tid) {
  for (let i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].type_id === tid) return CHANNELS[i];
  return CHANNELS[0];
}

// ---------- 列表 ----------
// 卡片：<a class="stui-vodlist__thumb lazyload" href="/vod/{id}.html" title="名" data-original="海报"> … <span class="pic-text">备注</span>
// 注意：stui 模板 class 在 href 之前，属性顺序不能假设，统一从整个 <a> 标签里抓
function parseList(html) {
  const list = [];
  if (!html) return list;

  const re = /<a[^>]*class="[^"]*stui-vodlist__thumb[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const hrefM = tag.match(/href="(\/vod\/\d+\.html)"/);
    const titleM = tag.match(/title="([^"]*)"/);
    if (!hrefM || !titleM) continue;
    const vodId = abs(decode(hrefM[1]));
    const vodName = text(titleM[1]);
    if (!vodId || !vodName) continue;
    if (list.some((item) => item.vod_id === vodId)) continue;

    const block = m[1] || '';
    let pic = '';
    const picMatch = tag.match(/data-original="([^"]+)"/) || block.match(/<img[^>]*src="([^"]+)"/);
    if (picMatch) pic = abs(decode(picMatch[1]));

    let remarks = '';
    const noteMatch = block.match(/pic-text[^>]*>([^<]*)</);
    if (noteMatch) remarks = text(noteMatch[1]);

    list.push({ vod_id: vodId, vod_name: vodName, vod_pic: pic, vod_remarks: remarks });
  }
  return list;
}

function parsePageCount(html) {
  if (!html) return 1;
  const frac = html.match(/class="num"\s*>\s*\d+\s*\/\s*(\d+)\s*</);
  if (frac) return Math.max(1, Number(frac[1]));
  const tail = html.match(/尾页<\/a>|href="([^"]*)"[^>]*>尾页/);
  if (tail) {
    const seg = decode(tail[1] || '').replace(/\/show\//, '').replace(/\.html/, '').split('-');
    for (let i = 1; i < seg.length; i++) if (/^\d+$/.test(seg[i])) return Math.max(1, Number(seg[i]));
  }
  let max = 1;
  const re = /[\/-](\d+)(?:-{2,}|\.html)/g;
  let m;
  while ((m = re.exec(html)) !== null) if (Number(m[1]) > max) max = Number(m[1]);
  return max;
}

// ---------- 筛选拾取 ----------
// stui-screen__list 行：按类型（改 id）/按剧情(class)/按地区(area)/按语言(lang)/按年份(year)/按人气(by)
const ROW_KEY = { 按剧情: 3, 按地区: 1, 按语言: 4, 按年份: 11, 按人气: 2 };

function parseScreenRows(html, selfId) {
  const rows = [];
  const subTypes = [];
  if (!html) return { rows: rows, subTypes: subTypes };
  const blocks = html.split(/<ul class="stui-screen__list[^"]*"[^>]*>/);
  for (let i = 1; i < blocks.length; i++) {
    const body = blocks[i].split('</ul>')[0] || '';
    if (body.indexOf('按类型') !== -1) continue; // 类型行单独处理
    const labelM = body.match(/<span class="text-muted">([^<]{1,8})<\/span>/);
    if (!labelM) continue;
    const label = text(labelM[1]);
    const slot = ROW_KEY[label];
    if (!slot && label.indexOf('类型') === -1) continue;

    const values = [];
    const linkRe = /<li[^>]*>\s*<a href="(\/show\/[^"]*)"[^>]*>\s*([^<]{1,12})\s*<\/a>/g;
    let m;
    while ((m = linkRe.exec(body)) !== null) {
      const name = text(m[2]);
      const seg = decode(m[1]).replace(/\/show\//, '').replace(/\.html/, '').split('-');
      if (label === '按类型') {
        if (seg[0] && seg[0] !== selfId && /^\d+$/.test(seg[0])) {
          if (!subTypes.some((s) => s.type_id === seg[0])) subTypes.push({ type_id: seg[0], type_name: name });
        }
        continue;
      }
      if (!slot) continue;
      const val = decodeURIComponent(seg[slot] || '');
      if (!val || name === '全部' || values.some((v) => v.v === val)) continue;
      values.push({ n: name, v: val });
    }
    if (values.length > 0) rows.push({ label: label, slot: slot, values: values });
  }
  return { rows: rows, subTypes: subTypes };
}

function buildFilters(rows) {
  const nameByKey = { class: '类型', area: '地区', year: '年份', lang: '语言', by: '排序' };
  const filters = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const values = [{ n: '全部', v: '' }].concat(r.values);
    filters.push({ key: r.slot === 3 ? 'class' : r.slot === 1 ? 'area' : r.slot === 11 ? 'year' : r.slot === 4 ? 'lang' : 'by', name: nameByKey[r.slot === 3 ? 'class' : r.slot === 1 ? 'area' : r.slot === 11 ? 'year' : r.slot === 4 ? 'lang' : 'by'] || r.label, init: '', value: values });
  }
  return filters;
}

// ---------- URL 拼装（maccms10 vodshow 路由，页码 1 基）----------
const SHOW_SLOTS = ['area', 'by', 'class', 'lang', 'letter', 'level', 'order', 'page', 'state', 'tag', 'year'];

function buildShowUrl(tid, page, ext) {
  const e = ext || {};
  const parts = [];
  for (let i = 0; i < SHOW_SLOTS.length; i++) {
    const slot = SHOW_SLOTS[i];
    if (slot === 'page') parts.push(String(Math.max(1, Number(page) || 1)));
    else parts.push(e[slot] ? String(e[slot]) : '');
  }
  return HOST + '/show/' + tid + '-' + parts.join('-') + '.html';
}

// ---------- 详情线路 ----------
// <li><a href="#playlist1" data-toggle="tab">暴风<small>(236)</small></a> + <div id="playlist1"> <a href="/play/{id}-{seg}-{ep}.html">第01集</a>
function buildLines(html) {
  const lines = [];
  const tabs = [];
  const tabRe = /href="#(playlist\d+)"[^>]*>\s*([^<]{1,20})/g;
  let m;
  while ((m = tabRe.exec(html)) !== null) {
    const name = text(m[2]).replace(/\(\d+\)\s*$/, '').trim();
    if (!tabs.some((t) => t[0] === m[1])) tabs.push([m[1], name]);
  }

  for (let i = 0; i < tabs.length; i++) {
    const start = html.indexOf('id="' + tabs[i][0] + '"');
    if (start === -1) continue;
    const end = html.indexOf('tab-pane', start + 30);
    const block = html.slice(start, end === -1 ? start + 40000 : end);

    const eps = [];
    const epRe = /<a[^>]*href="(\/play\/[^"]+\.html)"[^>]*>\s*([^<]{1,40})\s*</g;
    while ((m = epRe.exec(block)) !== null) {
      const url = abs(decode(m[1]));
      const name = safeName(decode(m[2]).replace(/^播放/, ''), '播放', eps.length);
      if (!url || eps.some((e) => e.url === url)) continue;
      eps.push({ name: name, url: url });
    }
    if (eps.length > 0) lines.push({ name: tabs[i][1] || ('线路' + (i + 1)), eps: eps });
  }
  return lines;
}

const spider = {
  init() {
    this.rows = this.rows || {};
  },

  home() {
    this.init();
    const homeHtml = request(HOST + '/');
    const types = [];
    const seen = {};
    const navRe = /<a href="\/type\/(\d+)\.html"[^>]*>\s*([^<]{1,12})\s*</g;
    let m;
    while ((m = navRe.exec(homeHtml || '')) !== null) {
      if (!seen[m[1]] && text(m[2])) {
        seen[m[1]] = 1;
        types.push({ type_id: m[1], type_name: text(m[2]) });
      }
    }
    if (types.length === 0) for (let i = 0; i < CHANNELS.length; i++) types.push({ type_id: CHANNELS[i].type_id, type_name: CHANNELS[i].type_name });
    // 原则：爬什么给什么，不做内容过滤（站点全部频道原样呈现）

    // 每个频道抓一次 show 页：拾取子分类 + 筛选行
    const classes = [];
    const filters = {};
    const subAll = [];
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const channel = findChannel(t.type_id);
      const sh = request(HOST + (channel ? channel.path : '/show/' + t.type_id + '-----------.html'));
      const parsed = parseScreenRows(sh, t.type_id);
      this.rows[t.type_id] = parsed.rows;
      classes.push({ type_id: t.type_id, type_name: t.type_name });
      filters[t.type_id] = buildFilters(parsed.rows);
      for (let j = 0; j < parsed.subTypes.length; j++) {
        const s = parsed.subTypes[j];
        if (!classes.some((c) => c.type_id === s.type_id)) classes.push(s);
        subAll.push(s);
        filters[s.type_id] = filters[t.type_id];
      }
    }
    this.homeVodHtml = homeHtml;
    return JSON.stringify({ class: classes, filters: filters });
  },

  homeVod() {
    this.init();
    const html = this.homeVodHtml || request(HOST + '/');
    return JSON.stringify({ list: parseList(html).slice(0, 30) });
  },

  category(tid, pg, filter, extend) {
    this.init();
    const page = Math.max(1, Number(pg || 1));
    const url = buildShowUrl(tid, page, extend || null);
    const html = request(url);
    const list = parseList(html);
    return JSON.stringify({
      page: page,
      pagecount: parsePageCount(html),
      limit: list.length,
      total: list.length,
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    const html = request(pageUrl);
    if (!html) return JSON.stringify({ list: [] });

    let name = '';
    const titleMatch = html.match(/<h[13][^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]{1,60})/) ||
                       html.match(/<title>([^<]{1,80})/);
    if (titleMatch) name = text(titleMatch[1]).replace(/详情介绍.*$/, '').replace(/在线观看.*$/, '').trim();

    let pic = '';
    const thumb = html.match(/stui-content__thumb[\s\S]{0,600}?data-original="([^"]+)"/) ||
                  html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
    if (thumb) pic = abs(decode(thumb[1]));

    let desc = '';
    const descMatch = html.match(/class="desc[^"]*"[^>]*>\s*<span[^>]*>简介：<\/span>([\s\S]{0,2000}?)</) ||
                      html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    if (descMatch) desc = text(descMatch[1]).replace(/详细\s*>$/, '');

    let remarks = '';
    const picText = html.match(/stui-content__thumb[\s\S]{0,900}?pic-text[^>]*>([^<]*)</);
    if (picText) remarks = text(picText[1]);

    const lines = buildLines(html);
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

  // 站点搜索触发「安全验证」人工验证码，无法自动化
  search(key) {
    return JSON.stringify({ list: [] });
  },

  play(flag, id) {
    const pageUrl = abs(id);
    const html = request(pageUrl, pageUrl);
    let mediaUrl = '';
    if (html) {
      const playerMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[^<]*?\})\s*<\/script>/);
      if (playerMatch) {
        try {
          const player = JSON.parse(decode(playerMatch[1]));
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

export default spider;
