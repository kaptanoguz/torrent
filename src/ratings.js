// Film ve dizi sonuçlarına IMDb puanı, tür ve afiş eklenir. Ayarlar'da OMDb
// anahtarı varsa OMDb, yoksa anahtar gerektirmeyen Cinemeta (Stremio'nun açık
// film/dizi bilgi servisi, IMDb verisi) kullanılır.

import { parseTitle } from './titles.js';
import { readJsonSafe, writeJsonAtomic } from './jsonfile.js';

const MAX_LOOKUPS = 20;
const BUDGET_MS = 2500; // arama en fazla bu kadar bekler; geç gelenler önbelleğe yazılır, sonraki aramada hazırdır
const CINEMETA = 'https://v3-cinemeta.strem.io';
const MAX_CACHED = 500;
const FOUND_TTL = 30 * 24 * 3600e3; // bulunan yapım 30 gün
const MISS_TTL = 6 * 3600e3; // "bulunamadı" 6 saat; yeni çıkan yapımlar sonra bulunabilsin

// OMDb cevapları için kalıcı önbellek: uygulama yeniden açıldığında aynı adlar
// tekrar sorulmaz, günlük ücretsiz kota boşa harcanmaz. file verilmezse yalnızca bellekte tutar.
export function createRatingsCache(file) {
  const stored = file ? readJsonSafe(file, {}) : {};
  const entries = new Map(Object.entries(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}));
  let dirty = false;
  return {
    // undefined: önbellekte yok ya da süresi dolmuş; null: bulunamadı olarak biliniyor.
    get(key, now = Date.now()) {
      const e = entries.get(key);
      if (!e) return undefined;
      if (now - e.at > (e.value ? FOUND_TTL : MISS_TTL)) {
        entries.delete(key);
        dirty = true;
        return undefined;
      }
      return e.value;
    },
    set(key, value, now = Date.now()) {
      entries.delete(key);
      entries.set(key, { value, at: now });
      // En eski kayıtlar atılır (Map ekleme sırasını korur).
      while (entries.size > MAX_CACHED) entries.delete(entries.keys().next().value);
      dirty = true;
    },
    flush() {
      if (!dirty || !file) return;
      dirty = false;
      try {
        writeJsonAtomic(file, Object.fromEntries(entries));
      } catch (err) {
        console.warn('[omdb] önbellek yazılamadı:', err.message);
      }
    },
  };
}

const memoryCache = createRatingsCache(null);
const inflight = new Map();

function cacheKey(result) {
  const { name, year, series } = parseTitle(result.title);
  return result.imdbId || `${name.toLowerCase()}|${result.year || year || ''}|${series || result.category === 'tv'}`;
}

async function fetchInfo(fetchImpl, apiKey, result) {
  const { name, year, series } = parseTitle(result.title);
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', apiKey);
  if (result.imdbId) url.searchParams.set('i', result.imdbId);
  else {
    url.searchParams.set('t', name);
    if (result.year || year) url.searchParams.set('y', String(result.year || year));
    url.searchParams.set('type', series || result.category === 'tv' ? 'series' : 'movie');
  }
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`OMDb ${res.status}`); // geçici hata: önbelleğe yazılmaz
  const d = await res.json();
  if (d.Response !== 'True') return null;
  return {
    imdbId: d.imdbID,
    rating: Number(d.imdbRating) || null,
    votes: Number(String(d.imdbVotes || '').replace(/,/g, '')) || null,
    genre: d.Genre && d.Genre !== 'N/A' ? d.Genre : '',
    year: Number.parseInt(d.Year, 10) || null,
    poster: /^https:\/\//.test(d.Poster || '') ? d.Poster : null,
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Cinemeta adla arar; aynı adlı (ve yıl biliniyorsa yılı tutan) ilk yapım seçilir.
async function fetchCinemeta(fetchImpl, result) {
  const { name, year: parsedYear, series } = parseTitle(result.title);
  const year = result.year || parsedYear;
  const type = series || result.category === 'tv' ? 'series' : 'movie';
  const get = async (p) => {
    const res = await fetchImpl(`${CINEMETA}/${p}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Cinemeta ${res.status}`);
    return res.json();
  };
  let meta;
  if (result.imdbId) {
    meta = (await get(`meta/${type}/${result.imdbId}.json`)).meta;
  } else {
    const { metas = [] } = await get(`catalog/${type}/top/search=${encodeURIComponent(name)}.json`);
    const startYear = (m) => Number.parseInt(m.releaseInfo || m.year, 10) || null;
    const sameName = metas.filter((m) => norm(m.name) === norm(name));
    meta = (year && sameName.find((m) => Math.abs((startYear(m) || 0) - year) <= 1))
      || (!year && sameName[0])
      || (year && metas.find((m) => startYear(m) === year && norm(m.name).includes(norm(name))));
    if (meta && !meta.imdbRating) meta = (await get(`meta/${type}/${meta.id || meta.imdb_id}.json`)).meta || meta;
  }
  if (!meta || !/^tt\d+$/.test(meta.imdb_id || meta.id || '')) return null;
  return {
    imdbId: meta.imdb_id || meta.id,
    rating: Number(meta.imdbRating) || null,
    votes: null,
    genre: Array.isArray(meta.genres) ? meta.genres.join(', ') : Array.isArray(meta.genre) ? meta.genre.join(', ') : '',
    year: Number.parseInt(meta.releaseInfo || meta.year, 10) || null,
    poster: /^https:\/\//.test(meta.poster || '') ? meta.poster : null,
  };
}

async function lookup(fetchImpl, apiKey, result, cache, key) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = (apiKey ? fetchInfo(fetchImpl, apiKey, result) : fetchCinemeta(fetchImpl, result))
    // Her cevap gelir gelmez diske yazılır: arama yarıda kesilse de o tur kaybolmaz.
    .then((value) => { cache.set(key, value); cache.flush(); return value; })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function addImdbRatings(results, apiKey, { fetch: fetchImpl = fetch, ratingsCache = memoryCache, budgetMs = BUDGET_MS } = {}) {
  // Önbellekte olanlar kotadan düşmez; yalnızca gerçekten sorulanlar 20 ile sınırlı.
  // Anahtarsız kaynağın önbelleği ayrı tutulur; OMDb anahtarı girilince yeniden sorulur.
  const prefix = apiKey ? '' : 'cm:';
  let lookups = 0;
  const targets = results.filter((r) => r.category === 'movies' || r.category === 'tv');
  const found = new Array(targets.length).fill(null);
  const pending = targets.map((r, i) => {
    const key = prefix + cacheKey(r);
    const cached = ratingsCache.get(key);
    if (cached !== undefined) { found[i] = cached; return null; }
    if (lookups >= MAX_LOOKUPS) return null;
    lookups++;
    return lookup(fetchImpl, apiKey, r, ratingsCache, key).then((v) => { found[i] = v; });
  }).filter(Boolean);
  let timer;
  await Promise.race([Promise.all(pending), new Promise((r) => { timer = setTimeout(r, budgetMs); })]);
  clearTimeout(timer);
  ratingsCache.flush();
  targets.forEach((r, i) => {
    const info = found[i];
    if (!info) return;
    if (info.rating) r.rating = { value: info.rating, source: 'IMDb', votes: info.votes };
    if (info.genre) r.subjects = [...(r.subjects || []), ...info.genre.split(/,\s*/)];
    if (!r.year && info.year) r.year = info.year;
    if (info.poster) r.poster = info.poster;
    r.imdbUrl = `https://www.imdb.com/title/${info.imdbId}/`;
  });
  return results;
}
