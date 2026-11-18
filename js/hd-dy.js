/**
 * 蜜蜂电影（hd-dy.cc）— MacCMS dytt 模板变体，type 3 QuickJS 爬虫
 *
 * 结构（2026-11 核实）:
 *   /dy/dianying/ /dy/lianxuju/ /dy/zongyi/ /dy/dongman/ /dy/duanju/ /dy/yingshijieshuo/
 *   频道页一页列完（/page/N/ 是假的，内容与第 1 页相同）→ pagecount 恒 1，无筛选
 *   卡片: <a href="/hddy/{id}/" class="tcl-img" title="名"> <img data-original="海报"> <p class="tc_wz">更新至04集</p>
 *   详情: /hddy/{id}/ —— 无海报 img，标题取 og:title 的《名》
 *   线路: tab_con_playlist_N 块（N 与 URL 段不对应！集数 href 原样使用）
 *         <a switch="tab_con_playlist_1"><a>FFZY</a> … <div id="tab_con_playlist_1"> <a href="/hdvod/{id}-{seg}-{ep}/" title="第01集">
 *   播放: /hdvod/... 页内 var player_aaaa = {..., url:"https://...m3u8"} 直链
 *   搜索: /sshd/ 需要人工输验证码（index.php/ajax/verify_check）→ 本源 searchable=0
 */

const HOST = 'https://hd-dy.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CHANNELS = [
  { type_id: 'dianying', type_name: '电影', path: '/dy/dianying/' },
  { type_id: 'lianxuju', type_name: '连续剧', path: '/dy/lianxuju/' },
  { type_id: 'zongyi', type_name: '综艺', path: '/dy/zongyi/' },
  { type_id: 'dongman', type_name: '动漫', path: '/dy/dongman/' },
  { type_id: 'duanju', type_name: '短剧', path: '/dy/duanju/' },
  { type_id: 'yingshijieshuo', type_name: '影视解说', path: '/dy/yingshijieshuo/' },
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

// 列表卡片：<a href="/hddy/{id}/" class="tcl-img" title="名"> … <img data-original="海报"> … <p class="tc_wz">备注</p>
function parseList(html) {
  const list = [];
  if (!html) return list;

  const re = /<a href="(\/hddy\/\d+\/)"[^>]*class="[^"]*tcl-img[^"]*"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = abs(decode(m[1]));
    const vodName = text(m[2]);
    if (!vodId || !vodName) continue;
    if (list.some((item) => item.vod_id === vodId)) continue;

    const block = m[3] || '';
    let pic = '';
    const picMatch = block.match(/data-original="([^"]+)"/) || block.match(/<img[^>]*src="([^"]+)"/);
    if (picMatch) pic = abs(decode(picMatch[1]));

    let remarks = '';
    const noteMatch = block.match(/tc_wz[^>]*>([^<]*)</);
    if (noteMatch) remarks = text(noteMatch[1]);

    list.push({ vod_id: vodId, vod_name: vodName, vod_pic: pic, vod_remarks: remarks });
  }
  return list;
}

// 详情线路：<li class="tab-switch" switch="tab_con_playlist_N"><a>线路名</a> + <div id="tab_con_playlist_N">…集数…
function buildLines(html) {
  const lines = [];
  const tabs = [];
  const tabRe = /switch="(tab_con_playlist_\d+)"[\s\S]{0,200}?<a[^>]*>([^<]{1,16})<\/a>/g;
  let m;
  while ((m = tabRe.exec(html)) !== null) {
    if (!tabs.some((t) => t[0] === m[1])) tabs.push([m[1], text(m[2])]);
  }

  for (let i = 0; i < tabs.length; i++) {
    const start = html.indexOf('id="' + tabs[i][0] + '"');
    if (start === -1) continue;
    const end = html.indexOf('tab-content', start + 30);
    const block = html.slice(start, end === -1 ? start + 30000 : end);

    const eps = [];
    const epRe = /<a[^>]*href="(\/hdvod\/[^"]+)"[^>]*title="([^"]*)"/g;
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
  init() {},

  home() {
    return JSON.stringify({
      class: CHANNELS.map((c) => ({ type_id: c.type_id, type_name: c.type_name })),
    });
  },

  homeVod() {
    return JSON.stringify({ list: parseList(request(HOST + '/')).slice(0, 30) });
  },

  // 站点分页是假的（/page/N/ 内容与第 1 页相同），一页列完 → pagecount 恒 1
  category(tid, pg, filter, extend) {
    const channel = findChannel(tid);
    const page = Number(pg || 1);
    const html = request(HOST + channel.path);
    const list = parseList(html);
    return JSON.stringify({
      page: page,
      pagecount: page <= 1 ? 1 : 0,
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
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ||
                    html.match(/<title>《([^》]+)》/);
    if (ogTitle) {
      const raw = decode(ogTitle[1]);
      const book = raw.match(/《([^》]+)》/);
      name = book ? book[1] : stripSuffix(text(raw));
    }

    let desc = '';
    const ogDesc = html.match(/<meta[^>]*(?:property="og:description"|name="description")[^>]*content="([^"]*)"/);
    if (ogDesc) desc = decode(ogDesc[1]);

    let pic = '';
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
    if (ogImage) pic = abs(decode(ogImage[1]));

    const lines = buildLines(html);
    const from = lines.map((l) => l.name).join('$$$');
    const play = lines.map((l) => l.eps.map((e) => e.name + '$' + e.url).join('#')).join('$$$');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name || '视频',
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: from,
        vod_play_url: play,
      }],
    });
  },

  // 站点搜索需人工输入验证码，无法自动化
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

function stripSuffix(raw) {
  return String(raw || '').replace(/(高清|完整版|在线观看|免费|全集|-.*|蜜蜂电影).*$/, '').replace(/[《》]/g, '').trim();
}

export default spider;
