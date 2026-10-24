import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './jsonfile.js';
import { VIDEO_TYPES, playableInBrowser } from './downloads.js';

// Kütüphane: biten indirmelerin afişli kataloğu ve izleme kaydı. İndirme
// listesinden bağımsızdır; indirme kaldırılsa da kayıt (ve ilerleme) durur.
// Anahtar infohash'tir, aynı torrent tekrar inerse kayıt güncellenir.

export const PROGRESS_SAVE_MS = 5000;

export function createLibrary({ file, saveDelayMs = PROGRESS_SAVE_MS }) {
  const stored = readJsonSafe(file, {});
  const entries = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  let timer = null;
  let lastSave = 0;

  function save() {
    clearTimeout(timer);
    timer = null;
    lastSave = Date.now();
    writeJsonAtomic(file, entries);
  }

  // Oynatıcı birkaç saniyede bir konum gönderir; disk en fazla 5 sn'de bir yazılır.
  function saveSoon() {
    if (timer) return;
    const wait = Math.max(0, saveDelayMs - (Date.now() - lastSave));
    timer = setTimeout(save, wait);
    timer.unref?.();
  }

  function view(entry) {
    const items = entry.items.map(({ path: full, ...item }) => ({ ...item, playableInBrowser: playableInBrowser(item.name), missing: !full || !fs.existsSync(full) }));
    return { ...entry, items, missing: items.length > 0 && items.every((i) => i.missing) };
  }

  return {
    // Biten indirmeden kayıt oluştur ya da güncelle. Önceki izleme konumu korunur.
    upsert(info) {
      if (!info?.infoHash) return null;
      const old = entries[info.infoHash];
      const previous = new Map((old?.items || []).map((i) => [i.fileIndex, i]));
      entries[info.infoHash] = {
        infoHash: info.infoHash,
        title: info.title || old?.title || 'Adsız',
        year: info.year ?? old?.year ?? null,
        poster: info.poster || old?.poster || null,
        genres: info.genres?.length ? info.genres : old?.genres || [],
        source: info.source || old?.source || null,
        imdbId: info.imdbId || old?.imdbId || null,
        imdbUrl: info.imdbUrl || old?.imdbUrl || null,
        pageUrl: info.pageUrl || old?.pageUrl || null,
        license: info.license || old?.license || null,
        addedAt: old?.addedAt || info.addedAt || Date.now(),
        completedAt: info.completedAt || old?.completedAt || Date.now(),
        items: info.files.map((f) => {
          const prev = previous.get(f.index);
          return {
            downloadId: info.downloadId,
            fileIndex: f.index,
            name: f.name,
            path: f.path,
            positionSec: prev?.positionSec || 0,
            durationSec: prev?.durationSec || 0,
            watched: prev?.watched || false,
          };
        }),
      };
      save();
      return view(entries[info.infoHash]);
    },
    has(infoHash) {
      return Boolean(entries[infoHash]);
    },
    list() {
      return Object.values(entries)
        .map(view)
        .sort((a, b) => (b.lastPlayedAt || b.completedAt || 0) - (a.lastPlayedAt || a.completedAt || 0));
    },
    progress(infoHash, { fileIndex, positionSec, durationSec, watched } = {}) {
      const entry = entries[infoHash];
      const item = entry?.items.find((i) => i.fileIndex === Number(fileIndex));
      if (!item) return null;
      if (Number.isFinite(positionSec) && positionSec >= 0) item.positionSec = Math.round(positionSec);
      if (Number.isFinite(durationSec) && durationSec > 0) item.durationSec = Math.round(durationSec);
      if (typeof watched === 'boolean') item.watched = watched;
      entry.lastPlayedAt = Date.now();
      saveSoon();
      return view(entry);
    },
    // İndirme listeden kaldırılmış olsa da dosya diskteyse oynatılabilsin.
    openFile(infoHash, fileIndex) {
      const item = entries[infoHash]?.items.find((i) => i.fileIndex === Number(fileIndex));
      if (!item?.path || !fs.existsSync(item.path)) return null;
      const full = item.path;
      return {
        name: item.name,
        size: fs.statSync(full).size,
        type: VIDEO_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
        path: full,
        stream: (opts) => fs.createReadStream(full, opts),
      };
    },
    close() {
      if (timer) save();
    },
  };
}
