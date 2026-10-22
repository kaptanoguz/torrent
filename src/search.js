import archive from './providers/archive.js';
import { createTorznabProvider } from './providers/torznab.js';
import { rankResults } from './ranking.js';

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
  return { results: rankResults(results).slice(0, 60), errors };
}
