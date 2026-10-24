// İsteğe bağlı IMDb puanı: kullanıcı Ayarlar'a ücretsiz bir OMDb API anahtarı
// girerse film ve dizi sonuçlarına puan, tür ve afiş eklenir.

import { parseTitle } from './titles.js';
import { readJsonSafe, writeJsonAtomic } from './jsonfile.js';

const MAX_LOOKUPS = 20;
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

async function lookup(fetchImpl, apiKey, result, cache, key) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetchInfo(fetchImpl, apiKey, result)
    .then((value) => { cache.set(key, value); return value; })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function addImdbRatings(results, apiKey, { fetch: fetchImpl = fetch, ratingsCache = memoryCache } = {}) {
  if (!apiKey) return results;
  // Önbellekte olanlar kotadan düşmez; yalnızca gerçekten sorulanlar 20 ile sınırlı.
  let lookups = 0;
  const targets = results.filter((r) => r.category === 'movies' || r.category === 'tv');
  const found = await Promise.all(targets.map((r) => {
    const key = cacheKey(r);
    const cached = ratingsCache.get(key);
    if (cached !== undefined) return cached;
    if (lookups >= MAX_LOOKUPS) return null;
    lookups++;
    return lookup(fetchImpl, apiKey, r, ratingsCache, key);
  }));
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
