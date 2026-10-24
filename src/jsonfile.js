import fs from 'node:fs';
import path from 'node:path';

// Durum dosyaları için güvenli JSON okuma/yazma. Yazma önce aynı dizinde geçici
// dosyaya yapılır, diske zorlanır (fsync) ve tek adımda yerine taşınır; böylece
// çökme ya da elektrik kesintisi yarım bir dosya bırakmaz. Önceki sağlam sürüm
// .bak olarak saklanır.

export function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(file) && readJson(file) !== undefined) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  try {
    // Taşımanın kendisinin de kalıcı olması için dizini eşitle (Windows'ta desteklenmez).
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* desteklenmeyen platform */ }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// Ana dosya bozuksa .bak denenir. İkisi de okunamazsa varsayılan döner; bozuk
// dosya silinmez, incelenebilsin diye .bozuk-<zaman> adıyla kenara alınır.
export function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) {
    const bak = readJson(`${file}.bak`);
    return bak !== undefined ? bak : fallback;
  }
  const main = readJson(file);
  if (main !== undefined) return main;
  const bak = readJson(`${file}.bak`);
  try {
    fs.renameSync(file, `${file}.bozuk-${Date.now()}`);
  } catch { /* salt okunur dizin vb. */ }
  console.warn(`[durum] ${path.basename(file)} okunamadı; ${bak !== undefined ? 'yedekten' : 'varsayılanlarla'} devam ediliyor.`);
  return bak !== undefined ? bak : fallback;
}
