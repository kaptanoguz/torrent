import os from 'node:os';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './jsonfile.js';

export const DEFAULTS = {
  downloadDir: path.join(os.homedir(), 'Downloads', 'Torrent'),
  // { id, name, url, apiKey, enabled }
  torznab: [],
  archiveEnabled: true,
  omdbApiKey: '',
  // Özel tracker'larda oran için biten indirmeleri paylaşmaya devam et.
  seedAfterDone: false,
};

export function createSettingsStore(file) {
  // Eski sürümlerin dosyası da açılır: eksik alanlar varsayılanlarla tamamlanır.
  const stored = readJsonSafe(file, {});
  let data = { ...DEFAULTS, ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) };
  return {
    get: () => structuredClone(data),
    update(patch) {
      const next = { ...data };
      if (typeof patch.downloadDir === 'string' && patch.downloadDir.trim()) next.downloadDir = patch.downloadDir.trim();
      if (typeof patch.archiveEnabled === 'boolean') next.archiveEnabled = patch.archiveEnabled;
      if (typeof patch.seedAfterDone === 'boolean') next.seedAfterDone = patch.seedAfterDone;
      if (typeof patch.omdbApiKey === 'string') next.omdbApiKey = patch.omdbApiKey.trim();
      if (Array.isArray(patch.torznab)) {
        next.torznab = patch.torznab
          .filter((t) => t && typeof t.url === 'string' && /^https?:\/\//i.test(t.url.trim()))
          .map((t, i) => ({
            id: `torznab-${i}`,
            name: String(t.name || '').trim() || `Kaynak ${i + 1}`,
            url: t.url.trim(),
            apiKey: String(t.apiKey || '').trim(),
            enabled: t.enabled !== false,
          }));
      }
      writeJsonAtomic(file, next);
      data = next;
      return structuredClone(data);
    },
  };
}
