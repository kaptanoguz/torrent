// İsteğe bağlı IMDb puanı: kullanıcı Ayarlar'a ücretsiz bir OMDb API anahtarı
// girerse film ve dizi sonuçlarına puan, tür ve afiş eklenir.

import { parseTitle } from './titles.js';

const cache = new Map();
const MAX_LOOKUPS = 20;

async function lookup(fetchImpl, apiKey, result) {
  const { name, year, series } = parseTitle(result.title);
  const key = result.imdbId || `${name.toLowerCase()}|${result.year || year || ''}|${series || result.category === 'tv'}`;
  if (cache.has(key)) return cache.get(key);
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', apiKey);
  if (result.imdbId) url.searchParams.set('i', result.imdbId);
  else {
    url.searchParams.set('t', name);
    if (result.year || year) url.searchParams.set('y', String(result.year || year));
    url.searchParams.set('type', series || result.category === 'tv' ? 'series' : 'movie');
  }
  const promise = (async () => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
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
  })().catch(() => null);
  cache.set(key, promise);
  const value = await promise;
  if (value === null) cache.delete(key); // geçici hatalar tekrar denenebilsin
  return value;
}

export async function addImdbRatings(results, apiKey, { fetch: fetchImpl = fetch } = {}) {
  if (!apiKey) return results;
  const targets = results.filter((r) => r.category === 'movies' || r.category === 'tv').slice(0, MAX_LOOKUPS);
  const found = await Promise.all(targets.map((r) => lookup(fetchImpl, apiKey, r)));
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
