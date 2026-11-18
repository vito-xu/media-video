/**
 * 百元电影网（k.feiborui.com）— maccms10 + bydyw 模板，SSR，type 3 QuickJS 爬虫
 *
 * 站点结构（2026-11-19 核实）:
 *   列表  /s/{cate}.html                        第 1 页，60 条/页
 *         /s/{cate}/page/{n}.html               翻页（1 基）
 *         /s/{cate}/area/{地区}/page/{n}.html    地区筛选（中文，需 URL 编码）
 *         /s/{cate}/year/{年}/page/{n}.html      年份筛选
 *   详情  /v/{id}.html   线路 tab: <span id="spanN">线名</span> ↔ <ul id="dxN"><li><a href="/p/...">集名</a></li>
 *   播放  /p/{id}-{sid}-{nid}.html   页内 var player_aaaa={...,"url":"https://...m3u8",...} 直链
 *   搜索  /index.php/ajax/suggest?mid=1&wd={关键词}&page={n}  → JSON {total,pagecount,list:[{id,name,pic}]}
 *         （站内 /vodsearch/ 路由有人机验证，不可用；suggest 接口无验证，带海报）
 *
 * 注意：站点「言情片(yanqingpian)」分类未接入。
 */

console.log('SPIDER feiborui loaded v1');

const HOST = 'http://k.feiborui.com';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const PAGE_SIZE = 60;

const CLASSES = [
  ['dianying', '电影'],
  ['lianxuju', '连续剧'],
  ['zongyi', '综艺'],
  ['dongman', '动漫'],
  ['duanju', '短剧'],
  ['dongzuopian', '动作片'],
  ['xijupian', '喜剧片'],
  ['aiqingpian', '爱情片'],
  ['kehuanpian', '科幻片'],
  ['kongbupian', '恐怖片'],
  ['juqingpian', '剧情片'],
  ['zhanzhengpian', '战争片'],
  ['guochanju', '国产剧'],
  ['gangtaiju', '港台剧'],
  ['rihanju', '日韩剧'],
  ['oumeiju', '欧美剧'],
  ['qitaju', '其他剧'],
];

const AREAS = ['内地', '香港', '台湾', '美国', '法国', '英国', '日本', '韩国', '德国', '泰国', '印度', '其它'];
const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016'];

// ==================== 基础工具 ====================

function headers(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: referer || HOST + '/',
  };
}

function request(url, referer) {
  try {
    const res = globalThis._http(url, { headers: headers(referer), timeout: 15000 });
    if (res && res.content) return res.content;
  } catch (e) {
    console.log('REQ FAIL ' + url + ' ' + e);
  }
  return '';
}

function decode(v) {
  return (v || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function abs(u) {
  if (!u) return '';
  if (u.indexOf('//') === 0) return 'http:' + u;
  if (u.indexOf('/') === 0) return HOST + u;
  return u;
}

function strip(v) {
  return decode(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeName(v) {
  return String(v || '').replace(/[$#]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ==================== 列表 ====================

function parseList(html) {
  const list = [];
  if (!html) return list;
  // 卡片两种写法：<li class="lif"> 与 <li class="">；统一按「详情链接 + 海报 img + alt 片名」抓
  const re = /<a href="\/v\/(\d+)\.html">\s*<img[^>]*?data-original="([^"]*)"[^>]*?alt="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const name = strip(m[3]);
    if (!name) continue;
    if (list.some(function (x) { return x.vod_id === id; })) continue;
    list.push({
      vod_id: id,
      vod_name: name,
      vod_pic: abs(decode(m[2])),
      vod_remarks: '',
    });
  }
  return list;
}

function parsePageCount(html, pg) {
  let max = 0;
  const re = /\/page\/(\d+)\.html/g;
  let m;
  while ((m = re.exec(html || '')) !== null) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  if (max > 0) return max;
  return pg;
}

// ==================== 详情 ====================

function parseInfo(html) {
  const info = {};
  const re = /<p class="fl">\s*<span>([^<]+)<\/span>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    info[strip(m[1]).replace(':', '').replace('：', '')] = strip(m[2]);
  }
  return info;
}

function detail(ids) {
  const vid = String(ids || '').match(/(\d+)/);
  if (!vid) return '';
  const id = vid[1];
  const url = HOST + '/v/' + id + '.html';
  const html = request(url);
  if (!html) return '';

  const namem = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = strip(namem ? namem[1] : '');
  const picm = html.match(/<img[^>]*data-original="(https?:\/\/[^"]+)"/) || html.match(/<img[^>]*src="(https?:\/\/[^"]+)"/);
  const info = parseInfo(html);

  // 线路：span(id=spanN, 名称) 顺序 ↔ ul(id=dxN) 集数
  const tabs = [];
  const tabRe = /<span id="span(\d+)">([^<]+)<\/span>/g;
  let t;
  while ((t = tabRe.exec(html)) !== null) tabs.push({ sid: t[1], name: strip(t[2]) });

  const uls = {};
  const ulRe = /<ul id="dx(\d+)">([\s\S]*?)<\/ul>/g;
  let u;
  while ((u = ulRe.exec(html)) !== null) uls[u[1]] = u[2];

  const from = [];
  const urls = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const body = uls[tab.sid] || '';
    if (!body) continue;
    const eps = [];
    const epRe = /<li>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/g;
    let e;
    while ((e = epRe.exec(body)) !== null) {
      const epName = safeName(strip(e[2]));
      if (!epName) continue;
      eps.push(epName + '$' + abs(decode(e[1])));
    }
    if (!eps.length) continue;
    from.push(safeName(tab.name));
    urls.push(eps.join('#'));
  }
  if (!from.length) return '';

  const remarks = [info['年代'], info['地区']].filter(Boolean).join('·');
  const content = [info['导演'] ? '导演: ' + info['导演'] : '', info['主演'] || info['演员'] ? '主演: ' + (info['主演'] || info['演员']) : '']
    .filter(Boolean)
    .join('　');

  const vod = {
    vod_id: id,
    vod_name: name,
    vod_pic: abs(decode(picm ? picm[1] : '')),
    vod_year: info['年代'] || '',
    vod_area: info['地区'] || '',
    vod_remarks: remarks,
    type_name: info['类型'] || '',
    vod_actor: info['主演'] || info['演员'] || '',
    vod_director: info['导演'] || '',
    vod_content: content,
    vod_play_from: from.join('$$$'),
    vod_play_url: urls.join('$$$'),
  };
  return JSON.stringify({ list: [vod] });
}

// ==================== 播放 ====================

function play(flag, id) {
  let url = abs(decode(id));
  const html = request(url);
  let target = '';
  const m = html.match(/var player_aaaa=(\{[\s\S]*?\})<\/script>/);
  if (m) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && obj.url) target = String(obj.url);
    } catch (e) {
      const um = m[1].match(/"url":"([^"]+)"/);
      if (um) target = um[1].replace(/\\\//g, '/');
    }
  }
  if (!target) {
    const um = html.match(/"url":"(https?:[^"]+?\.(?:m3u8|mp4)[^"]*)"/);
    if (um) target = um[1].replace(/\\\//g, '/');
  }
  console.log('PLAY ' + flag + ' -> ' + target);
  if (!target) return JSON.stringify({ parse: 0, url: '', header: {} });
  return JSON.stringify({
    parse: 0,
    url: target,
    header: { 'User-Agent': UA, Referer: HOST + '/' },
  });
}

// ==================== 首页 / 分类 / 搜索 ====================

function buildFilters() {
  const groups = [
    {
      key: 'area',
      name: '地区',
      init: '',
      value: [{ n: '全部', v: '' }].concat(AREAS.map(function (a) { return { n: a, v: a }; })),
    },
    {
      key: 'year',
      name: '年份',
      init: '',
      value: [{ n: '全部', v: '' }].concat(YEARS.map(function (y) { return { n: y, v: y }; })),
    },
  ];
  const filters = {};
  for (let i = 0; i < CLASSES.length; i++) filters[CLASSES[i][0]] = groups;
  return filters;
}

const spider = {
  home() {
    return JSON.stringify({
      class: CLASSES.map(function (c) { return { type_id: c[0], type_name: c[1] }; }),
      filters: buildFilters(),
    });
  },

  homeVod() {
    const html = request(HOST + '/s/dianying.html');
    return JSON.stringify({ list: parseList(html) });
  },

  category(tid, pg, filter, extend) {
    const page = Number(pg) > 0 ? Number(pg) : 1;
    const ext = extend || {};
    let url = HOST + '/s/' + tid;
    if (ext.area) url += '/area/' + encodeURIComponent(ext.area);
    if (ext.year) url += '/year/' + encodeURIComponent(ext.year);
    url += '/page/' + page + '.html';
    const html = request(url);
    const list = parseList(html);
    const pagecount = parsePageCount(html, page);
    console.log('CAT ' + tid + ' p' + page + ' -> ' + list.length + ' items, pagecount=' + pagecount);
    return JSON.stringify({
      page: page,
      pagecount: pagecount,
      limit: PAGE_SIZE,
      total: pagecount * PAGE_SIZE,
      list: list,
    });
  },

  detail(ids) {
    return detail(ids);
  },

  search(wd, quick, pg) {
    const page = Number(pg) > 0 ? Number(pg) : 1;
    const url = HOST + '/index.php/ajax/suggest?mid=1&wd=' + encodeURIComponent(wd) + '&page=' + page;
    const raw = request(url);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.log('SEARCH parse fail');
      return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
    const list = (data.list || []).map(function (x) {
      return {
        vod_id: String(x.id),
        vod_name: strip(x.name),
        vod_pic: abs(decode(x.pic || '')),
        vod_remarks: '',
      };
    });
    console.log('SEARCH ' + wd + ' -> ' + list.length + '/' + (data.total || 0));
    return JSON.stringify({
      page: data.page || page,
      pagecount: data.pagecount || 1,
      limit: data.limit || 20,
      total: data.total || 0,
      list: list,
    });
  },

  play(flag, id) {
    return play(flag, id);
  },

  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

export default spider;
