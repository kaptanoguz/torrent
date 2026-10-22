import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// WebTorrent'i saran indirme yöneticisi. Liste diske yazılır, böylece
// uygulama kapanıp açılınca indirmeler kaldığı yerden devam eder.

export function createDownloadManager({ stateFile, getDownloadDir, createClient }) {
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
    const list = [...items.values()].map(({ meta }) => meta);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(list, null, 2));
  }

  function attach(item) {
    const { meta } = item;
    const source = meta.torrentFile ? Buffer.from(meta.torrentFile, 'base64') : meta.magnet || meta.torrentUrl;
    meta.status = 'connecting';
    meta.error = null;
    let torrent;
    try {
      torrent = getClient().add(source, { path: meta.path });
    } catch (err) {
      meta.status = 'error';
      meta.error = friendlyError(err.message);
      return;
    }
    item.torrent = torrent;
    torrent.on('metadata', () => {
      meta.name = torrent.name;
      meta.infoHash = torrent.infoHash;
      meta.length = torrent.length;
      if (!meta.torrentFile && torrent.torrentFile) meta.torrentFile = Buffer.from(torrent.torrentFile).toString('base64');
      save();
    });
    torrent.on('done', () => {
      meta.status = 'done';
      save();
    });
    torrent.on('error', (err) => {
      meta.status = 'error';
      meta.error = friendlyError(err.message);
      item.torrent = null;
      save();
    });
  }

  function detach(item) {
    if (item.torrent) {
      try { item.torrent.destroy(); } catch { /* zaten kapalı */ }
      item.torrent = null;
    }
  }

  function snapshot({ meta, torrent }) {
    const live = torrent && !torrent.destroyed;
    const hasMeta = live && torrent.length > 0;
    let status = meta.status;
    if (live && status !== 'done' && status !== 'error') status = torrent.done ? 'done' : hasMeta ? 'downloading' : 'connecting';
    if (live && torrent.done && meta.status !== 'done') { meta.status = 'done'; save(); }
    return {
      id: meta.id,
      key: meta.magnet || meta.torrentUrl,
      title: meta.title || meta.name || 'İndirme',
      name: meta.name || null,
      source: meta.source || null,
      status,
      error: meta.error || null,
      progress: live ? torrent.progress : meta.status === 'done' ? 1 : meta.progress || 0,
      downloaded: live ? torrent.downloaded : null,
      length: (live && torrent.length) || meta.length || null,
      downloadSpeed: live ? torrent.downloadSpeed : 0,
      uploadSpeed: live ? torrent.uploadSpeed : 0,
      timeRemaining: live && Number.isFinite(torrent.timeRemaining) ? torrent.timeRemaining : null,
      peers: live ? torrent.numPeers : 0,
      path: meta.path,
      addedAt: meta.addedAt,
    };
  }

  // Önceki oturumdan kalanları geri yükle.
  try {
    for (const meta of JSON.parse(fs.readFileSync(stateFile, 'utf8'))) {
      const item = { meta, torrent: null };
      items.set(meta.id, item);
      if (meta.status !== 'paused' && meta.status !== 'done' && meta.status !== 'error') attach(item);
      else if (meta.status === 'done') attach(item); // tamamlananları paylaşmaya devam et
    }
  } catch {
    // kayıt yok
  }

  return {
    list() {
      return [...items.values()].map(snapshot).sort((a, b) => b.addedAt - a.addedAt);
    },
    add({ magnet, torrentUrl, title, source }) {
      if (!magnet && !torrentUrl) throw new Error('Magnet bağlantısı ya da torrent adresi gerekli.');
      if (magnet && !/^magnet:\?/i.test(magnet)) throw new Error('Geçersiz magnet bağlantısı.');
      if (torrentUrl && !/^https?:\/\//i.test(torrentUrl)) throw new Error('Geçersiz torrent adresi.');
      const key = magnet || torrentUrl;
      for (const item of items.values()) {
        if ((item.meta.magnet || item.meta.torrentUrl) === key) return snapshot(item);
      }
      const meta = {
        id: crypto.randomUUID(),
        title: title || null,
        source: source || null,
        magnet: magnet || null,
        torrentUrl: torrentUrl || null,
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
    pause(id) {
      const item = items.get(id);
      if (!item) return null;
      item.meta.progress = item.torrent?.progress ?? item.meta.progress;
      detach(item);
      item.meta.status = 'paused';
      save();
      return snapshot(item);
    },
    resume(id) {
      const item = items.get(id);
      if (!item) return null;
      if (!item.torrent) attach(item);
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
      return fs.existsSync(full) ? full : item.meta.path;
    },
    async close() {
      for (const item of items.values()) {
        if (item.torrent) item.meta.progress = item.torrent.progress;
      }
      save();
      if (client) await new Promise((r) => client.destroy(() => r()));
    },
  };
}
