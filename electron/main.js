import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import { startServer } from '../src/server.js';

let server;

async function createWindow() {
  server ??= await startServer({
    dataDir: app.getPath('userData'),
    openPath: (p) => shell.openPath(p),
  });
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: 'Torrent Bul',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0f14' : '#f6f7fb',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Dış bağlantılar (ör. archive.org sayfası) varsayılan tarayıcıda açılsın.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.url)) { e.preventDefault(); shell.openExternal(url); }
  });
  await win.loadURL(server.url);
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async (e) => {
  if (!server) return;
  e.preventDefault();
  const s = server;
  server = null;
  await s.close().catch(() => {});
  app.quit();
});
