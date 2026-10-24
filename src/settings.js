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
  // Aynı anda en fazla kaç indirme (fazlası sıraya girer).
  maxActiveDownloads: 3,
  // KB/sn; 0 = sınırsız.
  downloadLimitKbps: 0,
  uploadLimitKbps: 0,
};

const intIn = (v, min, max) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.min(max, Math.max(min, Math.round(Number(v)))) : null);

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
      if (patch.maxActiveDownloads != null && intIn(patch.maxActiveDownloads, 1, 10) != null) next.maxActiveDownloads = intIn(patch.maxActiveDownloads, 1, 10);
      for (const k of ['downloadLimitKbps', 'uploadLimitKbps']) {
        if (patch[k] != null && intIn(patch[k], 0, 1e6) != null) next[k] = intIn(patch[k], 0, 1e6);
      }
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
