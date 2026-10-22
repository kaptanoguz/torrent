// Torznab: Jackett / Prowlarr gibi kullanıcının kendi kurduğu indeksleyiciler.
// Uygulama hiçbir siteyi gömülü getirmez; adresi ve API anahtarını kullanıcı girer.

import { CATEGORIES, genreTerms } from '../categories.js';

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function attrs(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:torznab|newznab):attr\s+name="([^"]+)"\s+value="([^"]*)"/gi)) {
    out[m[1].toLowerCase()] = decode(m[2]);
  }
  return out;
}

export function parseTorznab(xml, sourceName) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  return items.map((item, index) => {
    const a = attrs(item);
    const enclosure = item.match(/<enclosure[^>]*url="([^"]+)"/i);
    const link = tag(item, 'link') || (enclosure && decode(enclosure[1])) || '';
    const magnet = a.magneturl || (link.startsWith('magnet:') ? link : '');
    const size = Number(a.size || tag(item, 'size')) || null;
    return {
      id: `torznab:${a.infohash || link || index}`,
      source: tag(item, 'jackettindexer') || sourceName,
      title: tag(item, 'title'),
      description: '',
      year: Number(a.year) || null,
      language: a.language ? [a.language] : [],
      size,
      seeders: a.seeders != null ? Number(a.seeders) : null,
      peers: a.peers != null ? Number(a.peers) : null,
      infoHash: a.infohash ? a.infohash.toLowerCase() : undefined,
      magnet: magnet || undefined,
      torrentUrl: magnet ? undefined : link || undefined,
      pageUrl: tag(item, 'comments') || undefined,
      relevance: ((items.length - index) / Math.max(items.length, 1)) * 2,
    };
  }).filter((r) => r.title && (r.magnet || r.torrentUrl));
}

export function createTorznabProvider({ id, name, url, apiKey }) {
  return {
    id,
    name: name || 'Torznab',
    description: 'Kendi indeksleyiciniz (Jackett / Prowlarr).',
    configurable: true,
    async search({ query = '', category = 'all', genre = '' }, { fetch: fetchImpl = fetch } = {}) {
      const terms = [query.trim(), genreTerms(genre)[1] || ''].filter(Boolean).join(' ');
      if (!terms) return [];
      const run = async (q) => {
        const endpoint = new URL(url.replace(/\/+$/, '') + (/\/api$/.test(url) ? '' : '/api'));
        endpoint.searchParams.set('t', 'search');
        endpoint.searchParams.set('q', q);
        if (apiKey) endpoint.searchParams.set('apikey', apiKey);
        const cats = (CATEGORIES[category] || CATEGORIES.all).torznab;
        if (cats.length) endpoint.searchParams.set('cat', cats.join(','));
        const res = await fetchImpl(endpoint);
        if (!res.ok) throw new Error(`${name || 'Torznab'} ${res.status}`);
        return parseTorznab(await res.text(), name || 'Torznab');
      };
      // Türkçe sürümleri yakalamak için ek bir "türkçe" araması yapılır.
      const [tr, all] = await Promise.all([run(`${terms} turkce`).catch(() => []), run(terms)]);
      return [...tr, ...all];
    },
  };
}
