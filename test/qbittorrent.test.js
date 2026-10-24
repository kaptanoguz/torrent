import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQbEngine, launchQbittorrent, findQbittorrent } from '../src/qbittorrent.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-bul-qb-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';

// Yalnızca çağrıları kaydeden sahte qBittorrent API'si.
function fakeApi() {
  const calls = [];
  const torrents = new Set();
  return {
    calls,
    api: {
      async get(p, params) {
        if (p === 'torrents/info') return [...torrents].filter((h) => !params?.hashes || params.hashes === h).map((h) => ({ hash: h, state: 'metaDL', total_size: 0 }));
        return [];
      },
      async post(p, body) {
        calls.push(p);
        if (p === 'torrents/add') torrents.add(hash);
        if (p === 'torrents/delete') torrents.delete(body.get ? body.get('hashes') : body.hashes);
        return 'Ok.';
      },
    },
  };
}

test('duraklatılan torrent qBittorrent\'te bekler, devam edince yeniden eklenmez (dosyalar baştan kontrol edilmez)', async () => {
  const { api, calls } = fakeApi();
  const engine = createQbEngine({ start: async () => ({ api }), pollMs: 20 });
  const magnet = `magnet:?xt=urn:btih:${hash}`;
  const a = engine.add(magnet, { path: tmp() });
  await wait(50);
  engine.pause(a);
  await wait(20);
  const b = engine.add(magnet, { path: tmp() });
  await wait(50);
  assert.equal(calls.filter((c) => c === 'torrents/add').length, 1, 'ikinci kez eklenmedi');
  assert.ok(!calls.includes('torrents/delete'), 'duraklatma silmez');
  engine.remove(b); // listeden kaldırma ise qBittorrent'ten de siler (dosyalar kalır)
  await wait(20);
  assert.ok(calls.includes('torrents/delete'));
  await engine.destroy();
});

test('çöken oturumdan kalan qBittorrent kapatılır, yenisi aynı profille açılır', { skip: !findQbittorrent() && 'qbittorrent-nox kurulu değil' }, async () => {
  const profileDir = tmp();
  await launchQbittorrent({ profileDir }); // stop çağrılmaz: uygulama çökmüş gibi
  const old = Number(fs.readFileSync(path.join(profileDir, 'torrent-bul.pid'), 'utf8'));
  const qb = await launchQbittorrent({ profileDir });
  try {
    assert.match(await qb.api.get('app/version'), /^v\d/);
    assert.throws(() => process.kill(old, 0), 'eski süreç kapandı');
  } finally {
    await qb.stop();
  }
});
