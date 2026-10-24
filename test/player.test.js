import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebTorrent from 'webtorrent';
import createTorrent from 'create-torrent';
import { startServer } from '../src/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-bul-player-'));
const client = () => new WebTorrent({ dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false, utp: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(app, p, opts = {}) {
  const res = await fetch(new URL(`api/${p}`, app.url), { ...opts, headers: { 'X-App-Token': app.token, 'Content-Type': 'application/json' } });
  return { status: res.status, body: await res.json() };
}

test('indirme bitmeden altyazı VTT olarak döner', async () => {
  const video = Buffer.alloc(256 * 1024, 6);
  const srt = Buffer.from('1\r\n00:00:01,000 --> 00:00:02,500\r\nMerhaba dünya\r\n');
  const files = { 'film.mp4': video, 'film.srt': srt };
  // Video hiç gelmez (yavaş eş gibi); altyazı hemen gelir.
  let torrentBuf;
  const server = http.createServer((req, res) => {
    if (req.url === '/item.torrent') { res.writeHead(200); return res.end(torrentBuf); }
    const name = decodeURIComponent(req.url).replace(/^\/Film\//, '');
    if (name === 'film.mp4') return; // yanıt verme
    const body = files[name];
    const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : body.length - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1 });
    res.end(body.subarray(start, end + 1));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = Object.entries(files).map(([name, buf]) => Object.assign(Buffer.from(buf), { name }));
  torrentBuf = Buffer.from(await new Promise((resolve, reject) =>
    createTorrent(input, { name: 'Film', pieceLength: 16384, urlList: [`${base}/`], announceList: [] }, (e, t) => (e ? reject(e) : resolve(t)))));

  const dataDir = tmp();
  const app = await startServer({ dataDir, openPath: () => {}, createClient: client });
  try {
    await call(app, 'settings', { method: 'PUT', body: JSON.stringify({ downloadDir: path.join(dataDir, 'dl') }) });
    const { body: d } = await call(app, 'downloads', { method: 'POST', body: JSON.stringify({ torrentFile: torrentBuf.toString('base64'), fileIndexes: [0, 1] }) });
    await wait(300);
    const res = await fetch(new URL(`media/${d.id}/0/subtitle.vtt?t=${app.token}`, app.url));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:02\.500\nMerhaba dünya/);
    assert.notEqual((await call(app, 'downloads')).body[0].status, 'done');
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('yerel altyazı önizlemesi VTT döner, 1 MB üstü reddedilir, diske yazılmaz', async () => {
  const dataDir = tmp();
  const app = await startServer({ dataDir, openPath: () => {}, createClient: client });
  try {
    // Windows-1254 kodlu Türkçe altyazı.
    const srt = Buffer.concat([Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), Buffer.from([0xd0, 0xfc, 0xfe])]);
    const ok = await call(app, 'subtitles/preview', { method: 'POST', body: JSON.stringify({ name: 'film.tr.srt', data: srt.toString('base64') }) });
    assert.equal(ok.status, 200);
    assert.match(ok.body.vtt, /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000\nĞüş/);
    const big = await call(app, 'subtitles/preview', { method: 'POST', body: JSON.stringify({ name: 'buyuk.srt', data: Buffer.alloc(1024 * 1024 + 1, 65).toString('base64') }) });
    assert.equal(big.status, 400);
    const bad = await call(app, 'subtitles/preview', { method: 'POST', body: JSON.stringify({ name: 'virus.exe', data: 'QQ==' }) });
    assert.equal(bad.status, 400);
    assert.deepEqual(fs.readdirSync(dataDir).filter((f) => /srt|vtt/.test(f)), []);
    const anon = await fetch(new URL('api/subtitles/preview', app.url), { method: 'POST', body: '{}' });
    assert.equal(anon.status, 403);
  } finally {
    await app.close();
  }
});
