const HOST = 'https://555cin.vip';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7',
};

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

function parseList(html) {
  const list = [];
  if (!html) return list;

  const re = /<a[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*title="([^"]*)"[^>]*class="[^"]*module-poster-item[^"]*"[^>]*>[\s\S]*?<img[^>]*?(?:data-original|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vodId = abs(decode(m[1]));
    const vodName = text(m[2]);
    const vodPic = abs(decode(m[3]));
    if (!vodId || !vodName || vodPic === HOST + '/') continue;
    if (list.some((item) => item.vod_id === vodId)) continue;
    list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
  }

  if (list.length === 0) {
    const fallbackRe = /<a[^>]*class="[^"]*module-poster-item[^"]*"[^>]*href="(\/voddetail\/[^"?#]+\.html)"[^>]*title="([^"]*)"/g;
    while ((m = fallbackRe.exec(html)) !== null) {
      const vodId = abs(decode(m[1]));
      const vodName = text(m[2]);
      if (!vodId || !vodName || list.some((item) => item.vod_id === vodId)) continue;
      list.push({ vod_id: vodId, vod_name: vodName, vod_pic: '' });
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
        if (list[i].vod_id === vodId && !list[i].vod_name) {
          list[i].vod_name = text(m[2]);
        }
      }
    }
  }
  return list.filter((item) => item.vod_name);
}

const spider = {
  init() {},

  home() {
    return JSON.stringify({
      class: [
        { type_id: '1', type_name: '电影' },
        { type_id: '2', type_name: '连续剧' },
        { type_id: '126', type_name: '短剧' },
        { type_id: '4', type_name: '动漫' },
        { type_id: '3', type_name: '综艺纪录' },
      ],
    });
  },

  homeVod() {
    return this.category('1', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    const categoryId = String(tid || '1');
    const url = HOST + '/vodtype/' + categoryId + '.html';
    const html = request(url);
    const list = parseList(html);
    return JSON.stringify({
      page: page,
      pagecount: 1,
      limit: list.length || 24,
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

    const playItems = [];
    const playRe = /<a[^>]*class="[^"]*module-play-list-link[^"]*"[^>]*href="([^"]*\/vodplay\/[^"?]+\.html)"[^>]*title="([^"]*)"/g;
    let m;
    while ((m = playRe.exec(html)) !== null) {
      const url = abs(decode(m[1]));
      const itemName = safeName(decode(m[2]).replace(/^播放/, ''), '播放', playItems.length);
      if (!playItems.some((item) => item.url === url)) playItems.push({ name: itemName, url: url });
    }

    const playUrls = playItems
      .map((item) => item.name + '$' + item.url)
      .join('#');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name || '视频',
        vod_pic: pic,
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
