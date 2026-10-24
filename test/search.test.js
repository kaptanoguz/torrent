import test from 'node:test';
import assert from 'node:assert/strict';
import { rankResults, isTurkish } from '../src/ranking.js';
import archive, { buildQuery, mapDoc, cleanText } from '../src/providers/archive.js';
import { searchAll, MAX_RESULTS } from '../src/search.js';
import { parseTorznab, createTorznabProvider } from '../src/providers/torznab.js';

// Türkçe önceliği artık istemcideki "Türkçe önce" anahtarında; sunucu yalnızca
// bayrağı üretir ve puana göre sıralar.
test('Türkçe sonuçlar işaretlenir, sıra puana göre, diğer diller listede kalır', () => {
  const ranked = rankResults([
    { id: 'a', title: 'Nosferatu', language: ['English'], relevance: 3, torrentUrl: 'u1' },
    { id: 'b', title: 'Nosferatu (Türkçe Altyazılı)', relevance: 1, torrentUrl: 'u2' },
    { id: 'c', title: 'Nosferatu', language: ['tur'], relevance: 0.5, torrentUrl: 'u3' },
    { id: 'd', title: 'Nosferatu Eine Symphonie', language: ['German'], relevance: 2, torrentUrl: 'u4' },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(ranked.map((r) => r.turkish), [false, false, true, true]);
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
  const tr = results.find((r) => r.title === 'Türk Filmi');
  assert.equal(tr.turkish, true);
  assert.equal(tr.torrentUrl, 'https://archive.org/download/tr-film/tr-film_archive.torrent');
  assert.equal(results.find((r) => r.title === 'English Film').turkish, false);
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
  assert.equal(urls[0].searchParams.get('q'), 'bunny');
  assert.equal(urls[1].searchParams.get('q'), 'bunny türkçe');
  // İki sorgu aynı sonuçları döndürse de tek kayıt kalır.
  assert.equal(results.length, 2);
  assert.equal(rankResults(results).find((r) => r.title === 'Sintel TR Dublaj').turkish, true);
});

test('80 benzersiz sonuç 60’ta kesilmez, üst sınır 120', async () => {
  const many = (n, prefix) => ({
    name: prefix,
    search: async () => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} Film ${i}`, torrentUrl: `http://x/${prefix}${i}`, relevance: i / n })),
  });
  const { results } = await searchAll({ query: 'film' }, [many(80, 'a')]);
  assert.equal(results.length, 80);
  const big = await searchAll({ query: 'film' }, [many(100, 'a'), many(100, 'b')]);
  assert.equal(big.results.length, MAX_RESULTS);
  assert.equal(MAX_RESULTS, 120);
});

test('tek başına TR Türkçe sayılmaz, Türkçe dublaj sayılır', () => {
  assert.ok(!isTurkish({ title: 'Intro.TR.2020' }));
  assert.ok(!isTurkish({ title: 'Movie.2020.1080p.TR' }));
  assert.ok(isTurkish({ title: 'Film Türkçe Dublaj' }));
  assert.ok(isTurkish({ title: 'Film.2020.TRDublaj.720p' }));
  assert.ok(isTurkish({ title: 'Film 2020 tr altyazı' }));
  assert.ok(isTurkish({ title: 'Film Altyazili 1080p' }));
});

test('çözünürlük puanı artırır, kamera kaydı düşürür', () => {
  const ranked = rankResults([
    { id: 'cam', title: 'Film 2024 HDCAM', torrentUrl: '1', relevance: 1 },
    { id: 'sd', title: 'Film 2024', torrentUrl: '2', relevance: 1 },
    { id: 'hd', title: 'Film 2024 720p', torrentUrl: '3', relevance: 1 },
    { id: 'fhd', title: 'Film 2024 1080p', torrentUrl: '4', relevance: 1 },
    { id: 'uhd', title: 'Film 2024 2160p', torrentUrl: '5', relevance: 1 },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['uhd', 'fhd', 'hd', 'sd', 'cam']);
});

test('dizi sorgusu television konusunu içerir, film sorgusu içermez', () => {
  assert.match(buildQuery({ query: 'kurtlar', category: 'tv' }), /subject:\("television" OR "tv series" OR "dizi" OR "tv show"\)/);
  assert.doesNotMatch(buildQuery({ query: 'kurtlar', category: 'movies' }), /television/);
});

test('lisans rozeti yalnızca lisans adresi varsa dolar', () => {
  assert.equal(mapDoc({ identifier: 'a', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' }, 0, 1).license, 'Kamu malı');
  assert.equal(mapDoc({ identifier: 'b', licenseurl: 'https://creativecommons.org/licenses/by-sa/4.0/' }, 0, 1).license, 'CC');
  assert.equal(mapDoc({ identifier: 'c' }, 0, 1).license, '');
  assert.equal(mapDoc({ identifier: 'd', licenseurl: 'http://example.com/terms' }, 0, 1).license, '');
});

test('Lucene işleçleri ve özel karakterler sorguyu bozmaz', async () => {
  assert.equal(cleanText('"Tom AND Jerry" (1940) OR NOT x*'), 'Tom and Jerry 1940 or not x');
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url.searchParams.get('q')); return { ok: true, json: async () => ({ response: { docs: [] } }) }; };
  assert.deepEqual(await archive.search({ query: '"()" :' }, { fetch: fakeFetch }), []);
  assert.equal(calls.length, 0);
});
