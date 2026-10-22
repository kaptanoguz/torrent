import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  downloadDir: path.join(os.homedir(), 'Downloads', 'Torrent'),
  // { id, name, url, apiKey, enabled }
  torznab: [],
  archiveEnabled: true,
};

export function createSettingsStore(file) {
  let data = { ...DEFAULTS };
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // ilk açılış ya da bozuk dosya: varsayılanlarla devam
  }
  return {
    get: () => structuredClone(data),
    update(patch) {
      const next = { ...data };
      if (typeof patch.downloadDir === 'string' && patch.downloadDir.trim()) next.downloadDir = patch.downloadDir.trim();
      if (typeof patch.archiveEnabled === 'boolean') next.archiveEnabled = patch.archiveEnabled;
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
      data = next;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return structuredClone(data);
    },
  };
}
