import test from 'node:test';
import assert from 'node:assert/strict';
import { rankResults, isTurkish } from '../src/ranking.js';
import archive, { buildQuery } from '../src/providers/archive.js';
import { parseTorznab, createTorznabProvider } from '../src/providers/torznab.js';

test('Türkçe sonuçlar üste çıkar, diğer diller listede kalır', () => {
  const ranked = rankResults([
    { id: 'a', title: 'Nosferatu', language: ['English'], relevance: 3, torrentUrl: 'u1' },
    { id: 'b', title: 'Nosferatu (Türkçe Altyazılı)', relevance: 1, torrentUrl: 'u2' },
    { id: 'c', title: 'Nosferatu', language: ['tur'], relevance: 0.5, torrentUrl: 'u3' },
    { id: 'd', title: 'Nosferatu Eine Symphonie', language: ['German'], relevance: 2, torrentUrl: 'u4' },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ranked.map((r) => r.turkish), [true, true, false, false]);
});

test('aynı torrent iki kez gelirse tekilleştirilir', () => {
  const ranked = rankResults([
    { id: 'x', title: 'A', torrentUrl: 'same' },
    { id: 'y', title: 'A', torrentUrl: 'same' },
  ]);
  assert.equal(ranked.length, 1);
});

test('isTurkish dublaj/altyazı ifadelerini tanır', () => {
  assert.ok(isTurkish({ title: 'Film 1080p TR Dublaj' }));
  assert.ok(isTurkish({ title: 'Movie', language: 'Turkish' }));
  assert.ok(!isTurkish({ title: 'The General 1926' }));
});

test('Internet Archive sorgusu tür ve kategoriyi içerir', () => {
  const q = buildQuery({ query: 'chaplin', category: 'movies', genre: 'komedi' }, true);
  assert.match(q, /\(chaplin\)/);
  assert.match(q, /subject:\("komedi" OR "comedy"\)/);
  assert.match(q, /mediatype:\(movies\)/);
  assert.match(q, /language:\(tur/);
});

test('Internet Archive araması Türkçe ve genel sorguyu birleştirir', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    const q = url.searchParams.get('q');
    calls.push(q);
    const docs = q.includes('language:')
      ? [{ identifier: 'tr-film', title: 'Türk Filmi', item_size: 1000, downloads: 5 }]
      : [{ identifier: 'en-film', title: 'English Film', item_size: 2000, downloads: 50, language: 'English', mediatype: 'movies' }];
    return { ok: true, json: async () => ({ response: { docs } }) };
  };
  const results = rankResults(await archive.search({ query: 'film', category: 'all' }, { fetch: fakeFetch }));
  assert.equal(calls.length, 2);
  assert.equal(results[0].title, 'Türk Filmi');
  assert.equal(results[0].torrentUrl, 'https://archive.org/download/tr-film/tr-film_archive.torrent');
  assert.equal(results[1].title, 'English Film');
});

const SAMPLE = `<?xml version="1.0"?><rss><channel>
<item><title>Big Buck Bunny 2008</title><link>http://jackett/dl/1.torrent</link><size>276134947</size>
<comments>http://example.org/1</comments>
<torznab:attr name="seeders" value="42"/><torznab:attr name="infohash" value="DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C"/>
<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&amp;dn=Big"/></item>
<item><title><![CDATA[Sintel TR Dublaj]]></title><link>http://jackett/dl/2.torrent</link>
<torznab:attr name="seeders" value="3"/></item>
</channel></rss>`;

test('Torznab XML ayrıştırılır', () => {
  const items = parseTorznab(SAMPLE, 'Jackett');
  assert.equal(items.length, 2);
  assert.equal(items[0].seeders, 42);
  assert.equal(items[0].magnet, 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big');
  assert.equal(items[0].infoHash, 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c');
  assert.equal(items[1].title, 'Sintel TR Dublaj');
  assert.equal(items[1].torrentUrl, 'http://jackett/dl/2.torrent');
});

test('Torznab sağlayıcısı API anahtarı ve kategoriyle istek atar', async () => {
  const urls = [];
  const provider = createTorznabProvider({ id: 't', name: 'Jackett', url: 'http://localhost:9117/api/v2.0/indexers/all/results/torznab', apiKey: 'k' });
  const results = await provider.search({ query: 'bunny', category: 'movies' }, {
    fetch: async (u) => { urls.push(u); return { ok: true, text: async () => SAMPLE }; },
  });
  assert.equal(urls.length, 2);
  assert.equal(urls[1].pathname, '/api/v2.0/indexers/all/results/torznab/api');
  assert.equal(urls[1].searchParams.get('apikey'), 'k');
  assert.equal(urls[1].searchParams.get('cat'), '2000');
  assert.equal(urls[0].searchParams.get('q'), 'bunny turkce');
  assert.equal(rankResults(results)[0].title, 'Sintel TR Dublaj');
});
