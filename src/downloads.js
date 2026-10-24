import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import parseTorrent from 'parse-torrent';
import { readJsonSafe, writeJsonAtomic } from './jsonfile.js';

function friendlyError(message) {
  if (/duplicate/i.test(message)) return 'Bu torrent zaten listede.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Error downloading torrent/i.test(message)) {
    return 'Torrent dosyası alınamadı. İnternet bağlantını kontrol edip tekrar dene.';
  }
  if (/Invalid torrent identifier|Torrent is missing required field/i.test(message)) return 'Geçersiz torrent dosyası.';
  if (/ENOSPC/.test(message)) return 'Diskte yer kalmadı.';
  if (/EACCES|EPERM/.test(message)) return 'İndirme klasörüne yazılamıyor. Ayarlar’dan başka bir klasör seç.';
  return message;
}

const VIDEO_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.ts': 'video/mp2t',
};
// Yerleşik oynatıcının (Chromium <video>) güvenle açabildiği kaplar. HEVC/x265
// kodlu dosyalar mp4 içinde olsa bile çoğu sistemde açılmaz.
const BROWSER_PLAYABLE = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv']);

export function playableInBrowser(name) {
  return BROWSER_PLAYABLE.has(path.extname(name).toLowerCase()) && !/(^|[^a-z0-9])(hevc|x265|h\.?265)([^a-z0-9]|$)/i.test(name);
}
const SUBTITLE_EXT = new Set(['.srt', '.vtt']);

export const fileKind = (name) => {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_TYPES[ext]) return 'video';
  if (SUBTITLE_EXT.has(ext)) return 'subtitle';
  return 'other';
};

function describeFiles(torrent) {
  return torrent.files.map((f) => ({ name: f.name, path: f.path, length: f.length }));
}

// SRT'yi tarayıcının anladığı WebVTT'ye çevirir. Türkçe altyazılar çoğu zaman
// Windows-1254 kodlamasıyla gelir; UTF-8 bozuk görünürse o kodlama denenir.
export function subtitleToVtt(buf, name) {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('\uFFFD')) {
    try { text = new TextDecoder('windows-1254').decode(buf); } catch { /* ICU yoksa UTF-8 kalsın */ }
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (path.extname(name).toLowerCase() === '.vtt') return text;
  return `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}

const SEED_CHECK_MS = 2000;

// İstemciden gelen dosya indekslerini doğrular: boş olmayan, tekrarsız, sıralı tamsayılar.
function cleanIndexes(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('En az bir dosya seçin.');
  if (!list.every((i) => Number.isInteger(i) && i >= 0)) throw new Error('Geçersiz dosya seçimi.');
  return [...new Set(list)].sort((a, b) => a - b);
}

// Magnet bağlantısındaki btih değerini (40 hex ya da 32 base32) küçük harf hex'e çevirir.
// Bulunamazsa null: çağıran eski (ham metin) karşılaştırmaya döner.
export function magnetInfoHash(magnet) {
  const m = /[?&]xt=urn:btih:([0-9a-f]{40}|[a-z2-7]{32})(?=&|$)/i.exec(String(magnet || ''));
  if (!m) return null;
  const v = m[1];
  if (v.length === 40) return v.toLowerCase();
  let bits = '';
  for (const c of v.toUpperCase()) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
  return bits.match(/.{4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
}

// WebTorrent'i saran indirme yöneticisi. Liste diske yazılır, böylece
// uygulama kapanıp açılınca indirmeler kaldığı yerden devam eder.

export function createDownloadManager({ stateFile, getDownloadDir, createClient, shouldSeed = () => false }) {
  let client = null;
  const items = new Map(); // id -> { meta, torrent }

  function getClient() {
    if (!client) {
      client = createClient();
      client.on('error', (err) => console.error('[webtorrent]', err.message));
    }
    return client;
  }

  function save() {
    writeJsonAtomic(stateFile, [...items.values()].map(({ meta }) => meta));
  }

  // seed: biten bir torrenti yalnızca paylaşmak için açar. Hiçbir parça seçili
  // olmadığından eksik ya da taşınmış dosyalar asla yeniden indirilmez.
  // Dosya seçimi: selectedIndexes yoksa tüm dosyalar iner (eski kayıtlar böyle kalır).
  // pickFiles, dosya listesi henüz bilinmeyen magnet/URL'nin seçim beklediğini söyler.
  function attach(item, { seed = false } = {}) {
    const { meta } = item;
    const source = meta.torrentFile ? Buffer.from(meta.torrentFile, 'base64') : meta.magnet || meta.torrentUrl;
    if (!seed) {
      meta.status = 'connecting';
      meta.error = null;
    }
    const partial = Array.isArray(meta.selectedIndexes);
    let torrent;
    try {
      torrent = getClient().add(source, { path: meta.path, deselect: seed || partial || Boolean(meta.pickFiles) });
    } catch (err) {
      if (seed) return;
      meta.status = 'error';
      meta.error = friendlyError(err.message);
      return;
    }
    item.torrent = torrent;
    let finished = false;
    const finish = () => {
      if (seed || finished) return;
      finished = true;
      meta.status = 'done';
      meta.progress = 1;
      meta.completedAt ??= Date.now();
      meta.files = describeFiles(torrent);
      save();
      // Paylaşım kapalıysa biten torrent kapatılır: dosyalar sonradan taşınsa
      // ya da silinse bile uygulama onları yeniden indirmeye çalışmaz.
      if (!shouldSeed()) setImmediate(() => detach(item));
    };
    // Seçili dosyalar bitince indirme biter; WebTorrent'in kendi 'done'u yalnızca
    // tüm dosyalar inince gelir.
    const checkSelected = () => {
      const chosen = selectedFiles(meta).map((f) => torrent.files[f.index]).filter(Boolean);
      if (chosen.length && chosen.every((f) => f.done)) finish();
    };
    torrent.on('metadata', () => {
      meta.name = torrent.name;
      meta.infoHash = torrent.infoHash;
      meta.length = torrent.length;
      meta.files = describeFiles(torrent);
      if (!meta.torrentFile && torrent.torrentFile) meta.torrentFile = Buffer.from(torrent.torrentFile).toString('base64');
      if (!seed && Array.isArray(meta.selectedIndexes)) {
        meta.selectedIndexes = meta.selectedIndexes.filter((i) => i < torrent.files.length);
        if (!meta.selectedIndexes.length) delete meta.selectedIndexes;
      }
      if (!seed && Array.isArray(meta.selectedIndexes)) {
        for (const i of meta.selectedIndexes) {
          torrent.files[i].select();
          torrent.files[i].once('done', checkSelected);
        }
      } else if (!seed && meta.pickFiles) {
        if (torrent.files.length > 1) {
          // Birden fazla dosya: kullanıcı seçene kadar hiçbir parça indirilmez.
          meta.status = 'picking';
          meta.progress = 0;
          save();
          setImmediate(() => detach(item));
          return;
        }
        torrent.select(0, torrent.pieces.length - 1);
      }
      save();
    });
    torrent.on('ready', () => { if (!seed && Array.isArray(meta.selectedIndexes)) checkSelected(); });
    torrent.on('done', finish);
    torrent.on('error', (err) => {
      if (meta.status === 'done') { // paylaşım hatası: sessizce dur, indirme durumu bozulmasın
        detach(item);
        save();
        return;
      }
      meta.status = 'error';
      meta.error = friendlyError(err.message);
      item.torrent = null;
      save();
    });
  }

  function detach(item) {
    if (item.torrent) {
      item.meta.uploaded = (item.meta.uploaded || 0) + (item.torrent.uploaded || 0);
      try { item.torrent.destroy(); } catch { /* zaten kapalı */ }
      item.torrent = null;
    }
  }

  function filePath(meta, f) {
    return path.join(meta.path, f.path);
  }

  function isSelected(meta, index) {
    return !Array.isArray(meta.selectedIndexes) || meta.selectedIndexes.includes(index);
  }

  function selectedFiles(meta) {
    return (meta.files || []).map((f, index) => ({ ...f, index })).filter((f) => isSelected(meta, f.index));
  }

  function fileList(meta) {
    const done = meta.status === 'done';
    return (meta.files || []).map((f, index) => ({
      index,
      name: f.name,
      path: f.path,
      length: f.length,
      kind: fileKind(f.name),
      selected: isSelected(meta, index),
      exists: done ? fs.existsSync(filePath(meta, f)) : null,
    }));
  }

  // Seçili dosyaların tümü diskte, beklenen boyuttaysa paylaşılabilir.
  function complete(meta) {
    const files = selectedFiles(meta);
    return files.length > 0 && files.every((f) => {
      try { return fs.statSync(filePath(meta, f)).size === f.length; } catch { return false; }
    });
  }

  // Seçim varsa ilerleme yalnızca seçili dosyalar üzerinden hesaplanır.
  function progressOf(item) {
    const { meta, torrent } = item;
    if (!Array.isArray(meta.selectedIndexes) || !torrent?.files?.length) {
      return { progress: torrent.progress, downloaded: torrent.downloaded, length: torrent.length };
    }
    const chosen = meta.selectedIndexes.map((i) => torrent.files[i]).filter(Boolean);
    const length = chosen.reduce((n, f) => n + f.length, 0);
    const downloaded = chosen.reduce((n, f) => n + Math.min(f.downloaded, f.length), 0);
    return { progress: length ? downloaded / length : 0, downloaded, length };
  }

  function snapshot(item) {
    const { meta } = item;
    const files = fileList(meta).filter((f) => f.selected);
    const missing = meta.status === 'done' && files.length > 0 && files.every((f) => !f.exists);
    const { torrent } = item;
    const live = torrent && !torrent.destroyed;
    const uploaded = (meta.uploaded || 0) + (live ? torrent.uploaded || 0 : 0);
    const hasMeta = live && torrent.length > 0;
    const prog = live ? progressOf(item) : null;
    const selectedLength = Array.isArray(meta.selectedIndexes) && meta.files ? files.reduce((n, f) => n + f.length, 0) : null;
    let status = meta.status;
    if (live && status !== 'done' && status !== 'error' && status !== 'picking') status = torrent.done ? 'done' : hasMeta || status === 'downloading' ? 'downloading' : 'connecting';
    return {
      id: meta.id,
      key: meta.magnet || meta.torrentUrl || `infohash:${meta.infoHash}`,
      infoHash: meta.infoHash || null,
      fileCount: (meta.files || []).length,
      title: meta.title || meta.name || 'İndirme',
      name: meta.name || null,
      source: meta.source || null,
      status,
      error: meta.error || null,
      progress: live ? prog.progress : meta.status === 'done' ? 1 : meta.progress || 0,
      downloaded: live ? prog.downloaded : null,
      length: (live && prog.length) || selectedLength || meta.length || null,
      downloadSpeed: live ? torrent.downloadSpeed : 0,
      uploadSpeed: live ? torrent.uploadSpeed : 0,
      timeRemaining: live && Number.isFinite(torrent.timeRemaining) ? torrent.timeRemaining : null,
      peers: live ? torrent.numPeers : 0,
      seeding: Boolean(live && meta.status === 'done' && files.every((f) => f.exists)),
      uploaded,
      ratio: (selectedLength || meta.length) ? uploaded / (selectedLength || meta.length) : 0,
      path: meta.path,
      addedAt: meta.addedAt,
      completedAt: meta.completedAt || null,
      missing,
      // İzlenebilir videolar: indirme sürerken de akış olarak açılabilir.
      videos: files.filter((f) => f.kind === 'video' && f.exists !== false)
        .map(({ index, name, length }) => ({ index, name, length, playableInBrowser: playableInBrowser(name) })),
    };
  }

  // Önceki oturumdan kalanları geri yükle.
  const stored = readJsonSafe(stateFile, []);
  for (const meta of Array.isArray(stored) ? stored : []) {
    if (!meta?.id) continue;
    const item = { meta, torrent: null };
    items.set(meta.id, item);
    try {
      // Tamamlananlar yeniden açılmaz; dosyaları taşınmış olsa bile tekrar indirilmez.
      // Seçim bekleyen (picking) indirme kullanıcı dosya seçene kadar açılmaz.
      if (!['paused', 'done', 'error', 'picking'].includes(meta.status)) attach(item);
      else if (meta.status === 'done' && shouldSeed() && complete(meta)) attach(item, { seed: true });
    } catch (err) {
      meta.status = 'error';
      meta.error = friendlyError(err.message);
    }
  }

  // Paylaşılan dosyalardan biri taşınır ya da silinirse paylaşımı durdur.
  // Liste okumak (snapshot) yan etkisiz kalsın diye bu iş ayrı bir zamanlayıcıda.
  function stopBrokenSeeds() {
    let changed = false;
    for (const item of items.values()) {
      if (item.torrent && item.meta.status === 'done' && !complete(item.meta)) {
        detach(item);
        changed = true;
      }
    }
    if (changed) save();
  }
  const seedWatch = setInterval(stopBrokenSeeds, SEED_CHECK_MS);
  seedWatch.unref?.();

  return {
    list() {
      return [...items.values()].map(snapshot).sort((a, b) => b.addedAt - a.addedAt);
    },
    // Bilgisayardaki bir .torrent dosyasını (base64) okur; listeye eklemeden önce göstermek için.
    async inspect(torrentFile) {
      const buf = Buffer.from(String(torrentFile || ''), 'base64');
      let t;
      try {
        t = await parseTorrent(buf);
      } catch {
        throw new Error('Geçerli bir .torrent dosyası değil.');
      }
      if (!t?.infoHash || !t.files) throw new Error('Geçerli bir .torrent dosyası değil.');
      const existing = [...items.values()].find((i) => i.meta.infoHash === t.infoHash);
      return {
        infoHash: t.infoHash,
        name: t.name,
        length: t.length,
        fileCount: t.files.length,
        files: t.files.slice(0, 500).map((f, index) => ({ index, name: f.name, path: f.path, length: f.length, kind: fileKind(f.name) })),
        private: Boolean(t.private),
        existing: existing ? snapshot(existing).status : null,
      };
    },
    async add({ magnet, torrentUrl, torrentFile, title, source, fileIndexes }) {
      const indexes = fileIndexes == null ? null : cleanIndexes(fileIndexes);
      if (torrentFile) {
        const info = await this.inspect(torrentFile);
        const found = [...items.values()].find((i) => i.meta.infoHash === info.infoHash);
        if (found) return snapshot(found);
        if (indexes && indexes.some((i) => i >= info.fileCount)) throw new Error('Geçersiz dosya seçimi.');
        const meta = {
          id: crypto.randomUUID(),
          title: title || info.name,
          source: source || 'Torrent dosyası',
          magnet: null,
          torrentUrl: null,
          torrentFile: Buffer.from(torrentFile, 'base64').toString('base64'),
          infoHash: info.infoHash,
          name: info.name,
          length: info.length,
          ...(indexes && indexes.length < info.fileCount ? { selectedIndexes: indexes } : {}),
          path: getDownloadDir(),
          status: 'connecting',
          addedAt: Date.now(),
        };
        fs.mkdirSync(meta.path, { recursive: true });
        const item = { meta, torrent: null };
        items.set(meta.id, item);
        attach(item);
        save();
        return snapshot(item);
      }
      if (!magnet && !torrentUrl) throw new Error('Magnet bağlantısı ya da torrent adresi gerekli.');
      if (magnet && !/^magnet:\?/i.test(magnet)) throw new Error('Geçersiz magnet bağlantısı.');
      if (torrentUrl && !/^https?:\/\//i.test(torrentUrl)) throw new Error('Geçersiz torrent adresi.');
      const key = magnet || torrentUrl;
      const hash = magnet ? magnetInfoHash(magnet) : null;
      for (const item of items.values()) {
        const same = hash ? item.meta.infoHash === hash : (item.meta.magnet || item.meta.torrentUrl) === key;
        if (!same) continue;
        // Dosyaları silinmiş/taşınmış bir indirmeyi kullanıcı bilerek yeniden isterse indir.
        if (snapshot(item).missing) {
          item.meta.path = getDownloadDir();
          item.meta.completedAt = null;
          fs.mkdirSync(item.meta.path, { recursive: true });
          attach(item);
          save();
        }
        return snapshot(item);
      }
      const meta = {
        id: crypto.randomUUID(),
        title: title || null,
        source: source || null,
        magnet: magnet || null,
        torrentUrl: torrentUrl || null,
        infoHash: hash || undefined,
        // Seçim verilmediyse dosya listesi gelince kullanıcıya sorulur.
        ...(indexes ? { selectedIndexes: indexes } : { pickFiles: true }),
        path: getDownloadDir(),
        status: 'connecting',
        addedAt: Date.now(),
      };
      fs.mkdirSync(meta.path, { recursive: true });
      const item = { meta, torrent: null };
      items.set(meta.id, item);
      attach(item);
      save();
      return snapshot(item);
    },
    // Ayar değişince biten indirmelerin paylaşımını aç ya da kapat.
    setSeeding(on) {
      for (const item of items.values()) {
        if (item.meta.status !== 'done') continue;
        if (on && !item.torrent && complete(item.meta)) attach(item, { seed: true });
        if (!on && item.torrent) detach(item);
      }
      save();
    },
    // Dosya seçme penceresi için liste. Magnet'te metadata gelene kadar boştur.
    files(id) {
      const item = items.get(id);
      if (!item) return null;
      const snap = snapshot(item);
      return { id: snap.id, title: snap.title, status: snap.status, files: fileList(item.meta).slice(0, 500).map(({ exists, ...f }) => f) };
    },
    // Yalnızca seçilen dosyaları indir. Seçim downloads.json'a yazılır ve
    // yeniden açılışta aynı dosyalar seçili kalır.
    selectFiles(id, fileIndexes) {
      const item = items.get(id);
      if (!item) return null;
      const indexes = cleanIndexes(fileIndexes);
      const count = (item.meta.files || []).length;
      if (!count) throw new Error('Dosya listesi henüz gelmedi.');
      if (indexes.some((i) => i >= count)) throw new Error('Geçersiz dosya seçimi.');
      detach(item);
      if (indexes.length === count) delete item.meta.selectedIndexes;
      else item.meta.selectedIndexes = indexes;
      delete item.meta.pickFiles;
      item.meta.completedAt = null;
      attach(item);
      item.meta.status = 'downloading';
      save();
      return snapshot(item);
    },
    pause(id) {
      const item = items.get(id);
      if (!item) return null;
      if (item.meta.status === 'picking') return snapshot(item);
      if (item.torrent) item.meta.progress = progressOf(item).progress;
      detach(item);
      item.meta.status = 'paused';
      save();
      return snapshot(item);
    },
    resume(id) {
      const item = items.get(id);
      if (!item) return null;
      if (!item.torrent && item.meta.status !== 'done') attach(item);
      save();
      return snapshot(item);
    },
    remove(id) {
      const item = items.get(id);
      if (!item) return false;
      detach(item);
      items.delete(id);
      save();
      return true;
    },
    get(id) {
      const item = items.get(id);
      return item ? snapshot(item) : null;
    },
    folderOf(id) {
      const item = items.get(id);
      if (!item) return null;
      const name = item.torrent?.name || item.meta.name;
      const full = name ? path.join(item.meta.path, name) : item.meta.path;
      if (fs.existsSync(full)) return full;
      fs.mkdirSync(item.meta.path, { recursive: true });
      return item.meta.path;
    },
    // Video ya da altyazı dosyasını okur. Bitmişse diskten, sürüyorsa torrent
    // üzerinden (istenen parçalar öne alınarak) akış verir.
    openFile(id, index) {
      const item = items.get(id);
      const f = item?.meta.files?.[index];
      if (!f) return null;
      const live = item.torrent && !item.torrent.destroyed ? item.torrent.files?.[index] : null;
      const full = filePath(item.meta, f);
      const type = VIDEO_TYPES[path.extname(f.name).toLowerCase()] || 'application/octet-stream';
      if (live && item.meta.status !== 'done') {
        return { name: f.name, size: live.length, type, stream: (opts) => live.createReadStream(opts) };
      }
      if (!fs.existsSync(full)) return null;
      return { name: f.name, size: fs.statSync(full).size, type, path: full, stream: (opts) => fs.createReadStream(full, opts) };
    },
    // Videoya en uygun altyazı: aynı adlı .srt, yoksa Türkçe olanı, yoksa ilki.
    subtitleFor(id, index) {
      const item = items.get(id);
      const files = item?.meta.files || [];
      const video = files[index];
      if (!video || item.meta.status !== 'done') return null;
      const base = video.name.replace(/\.[^.]+$/, '').toLowerCase();
      const subs = files
        .map((f, i) => ({ ...f, i }))
        .filter((f) => fileKind(f.name) === 'subtitle' && fs.existsSync(filePath(item.meta, f)));
      const score = (f) => {
        const n = f.name.toLowerCase();
        return (n.startsWith(base) ? 4 : 0) + (/(^|[^a-z])(tr|tur|turkish|türkçe|turkce)([^a-z]|$)/.test(n) ? 2 : 0);
      };
      const best = subs.sort((a, b) => score(b) - score(a))[0];
      if (!best) return null;
      return { name: best.name, vtt: subtitleToVtt(fs.readFileSync(filePath(item.meta, best)), best.name) };
    },
    stopBrokenSeeds,
    async close() {
      clearInterval(seedWatch);
      for (const item of items.values()) {
        if (!item.torrent) continue;
        if (item.meta.status !== 'done' && item.meta.status !== 'picking') item.meta.progress = progressOf(item).progress;
        item.meta.uploaded = (item.meta.uploaded || 0) + (item.torrent.uploaded || 0);
      }
      save();
      if (client) await new Promise((r) => client.destroy(() => r()));
    },
  };
}
