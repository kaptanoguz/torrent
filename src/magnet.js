import { magnetInfoHash } from './downloads.js';

// İşletim sistemi bir magnet bağlantısını uygulamaya komut satırı argümanı
// (Windows/Linux) ya da open-url (macOS) ile verir. Argümanlar arasından geçerli
// (btih içeren) ilk magnet'i bulur; yoksa null.
export function magnetFromArgv(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    const value = arg.trim().replace(/^["']|["']$/g, '');
    if (/^magnet:\?/i.test(value) && magnetInfoHash(value)) return value;
  }
  return null;
}
