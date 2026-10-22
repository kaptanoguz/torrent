import archive from './providers/archive.js';
import { createTorznabProvider } from './providers/torznab.js';
import { rankResults } from './ranking.js';
import { detectGenres, isAdult } from './categories.js';
import { parseTitle } from './titles.js';
import { addImdbRatings } from './ratings.js';

export function activeProviders(settings) {
  const list = [];
  if (settings.archiveEnabled !== false) list.push(archive);
  for (const t of settings.torznab || []) if (t.enabled !== false) list.push(createTorznabProvider(t));
  return list;
}

export async function searchAll(params, providers, deps = {}) {
  const settled = await Promise.allSettled(providers.map((p) => p.search(params, deps)));
  const results = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(...s.value);
    else errors.push({ provider: providers[i].name, message: s.reason?.message || String(s.reason) });
  });

  // +18 içerik yalnızca kendi bölümünde görünür.
  const adultMode = params.category === 'adult';
  let ranked = rankResults(results)
    .map((r) => ({ ...r, adult: adultMode || isAdult(r) }))
    .filter((r) => adultMode || !r.adult)
    .slice(0, 60);

  for (const r of ranked) if (!r.year) r.year = parseTitle(r.title).year;
  ranked = await addImdbRatings(ranked, deps.omdbApiKey, deps);
  for (const r of ranked) r.genres = detectGenres(r.subjects || []);
  return { results: ranked, errors };
}
