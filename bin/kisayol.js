#!/usr/bin/env node
// Linux'ta uygulama menüsüne "Torrent Bul" kısayolu ve simgesi ekler.
// GNOME/KDE pencereyi bu .desktop dosyasıyla eşleştirir; dosya yoksa görev
// çubuğunda genel çark simgesi görünür. Yalnızca kullanıcının kendi klasörüne yazar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') {
  console.log('Bu komut yalnızca Linux içindir. Windows ve macOS kurulum dosyası simgeyi kendisi ekler.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(root, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) {
  console.error('Önce "npm install" çalıştır.');
  process.exit(1);
}

const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const iconDir = path.join(data, 'icons', 'hicolor', '512x512', 'apps');
const appDir = path.join(data, 'applications');
fs.mkdirSync(iconDir, { recursive: true });
fs.mkdirSync(appDir, { recursive: true });
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(iconDir, 'torrent-bul.png'));

const q = (s) => `"${s.replace(/(["`$\\])/g, '\\$1')}"`;
const desktop = `[Desktop Entry]
Type=Application
Name=Torrent Bul
Comment=Film, dizi ve kitap bul, tek tıkla indir
Exec=${q(electron)} ${q(root)} --class=torrent-bul %U
Icon=torrent-bul
Terminal=false
Categories=Network;FileTransfer;P2P;
StartupWMClass=torrent-bul
`;
const file = path.join(appDir, 'torrent-bul.desktop');
fs.writeFileSync(file, desktop);
fs.chmodSync(file, 0o755);
// Menünün hemen yenilenmesi için; araç yoksa sorun değil.
spawnSync('update-desktop-database', [appDir], { stdio: 'ignore' });
spawnSync('gtk-update-icon-cache', ['-f', '-t', path.join(data, 'icons', 'hicolor')], { stdio: 'ignore' });

console.log(`Kısayol eklendi: ${file}`);
console.log('Uygulama menüsünde "Torrent Bul" diye aratabilirsin. Klasörü taşırsan bu komutu yeniden çalıştır.');
