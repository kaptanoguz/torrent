// İndirme motoru adaptörü. downloads.js WebTorrent'i doğrudan çağırmaz; bu ince
// katmanı kullanır. Şimdilik tek sürücü WebTorrent; ileride başka bir motor bu
// arayüzle (add, pause, resume, selectFiles, throttle, destroy) eklenebilir.

export function createEngine(createClient) {
  let client = null;
  let limits = { download: 0, upload: 0 }; // bayt/sn, 0 = sınırsız

  function applyLimits() {
    if (!client) return;
    // WebTorrent'te -1 sınırı kaldırır.
    if (typeof client.throttleDownload === 'function') client.throttleDownload(limits.download > 0 ? limits.download : -1);
    if (typeof client.throttleUpload === 'function') client.throttleUpload(limits.upload > 0 ? limits.upload : -1);
  }

  function getClient() {
    if (!client) {
      client = createClient();
      client.on('error', (err) => console.error('[webtorrent]', err.message));
      applyLimits();
    }
    return client;
  }

  return {
    // seçimsiz başlatma: hiçbir parça seçilmez, dosyalar sonra selectFiles ile seçilir.
    add(source, { path, deselect = false }) {
      return getClient().add(source, { path, deselect });
    },
    // Duraklatma torrenti motordan çıkarır; devam etmek yeniden eklemektir.
    // Parçalar diskte kaldığı için kaldığı yerden sürer.
    pause(torrent) {
      if (!torrent || torrent.destroyed) return;
      try { torrent.destroy(); } catch { /* zaten kapalı */ }
    },
    resume(source, opts) {
      return this.add(source, opts);
    },
    selectFiles(torrent, indexes) {
      for (const i of indexes) torrent.files[i]?.select();
    },
    // Varsayılan "hepsini seç"i geri alır (yalnızca seçili dosyalar insin diye).
    deselectAll(torrent) {
      if (torrent.pieces.length) torrent.deselect(0, torrent.pieces.length - 1);
    },
    selectAll(torrent) {
      if (torrent.pieces.length) torrent.select(0, torrent.pieces.length - 1);
    },
    throttle({ download = 0, upload = 0 } = {}) {
      limits = { download: Math.max(0, Number(download) || 0), upload: Math.max(0, Number(upload) || 0) };
      applyLimits();
    },
    destroy() {
      if (!client) return Promise.resolve();
      const c = client;
      client = null;
      return new Promise((r) => c.destroy(() => r()));
    },
  };
}
