// Türkçe içeriği öne çıkaran sıralama.
// Diğer diller elenmez; yalnızca Türkçe olduğu anlaşılan sonuçlar üste taşınır.

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
// Sözcük sınırı Türkçe harfleri de tanısın diye \b yerine harf/rakam bakışı.
const TR_WORDS = /(?<![\p{L}\p{N}])(t[uü]rk[cç]e|turkish|dublaj|altyaz[ıi]l?[ıi]?|yerli)(?![\p{L}\p{N}])/iu;
// Tek başına "TR" (ör. Intro.TR.2020) Türkçe sayılmaz; yalnızca bitişik kalıplar.
const TR_TAGS = /(?<![\p{L}\p{N}])tr[\s._-]?(dub|dublaj|altyaz[ıi]|sub)/iu;
const TR_LANG = /^(tur|tr|turkish|t[uü]rk[cç]e)$/i;
const RESOLUTION_BONUS = [[/2160p|\b4k\b|uhd/i, 0.4], [/1080p/i, 0.3], [/720p/i, 0.15]];
const LOW_QUALITY = /\b(cam|hdcam|camrip|telesync|hdts|tsrip|ts-rip)\b/i;
// Düz "ts" çoğu zaman yalnızca .ts video uzantısıdır; telesync etiketi sayılması
// için yıldan sonra ya da kodek/çözünürlük gibi sürüm bilgisinden önce gelmeli.
const TS_TAG = /(?:\b(?:19|20)\d{2}[)\]]?(?:[\s_-]+ts\b|\.ts\b(?!\s*$))|\bts[\s._-]+(?:x26[45]|h\.?26[45]|xvid|divx|aac|ac3|mp3|\d{3,4}p|line|audio)\b)/i;

export function isTurkish(result) {
  const langs = [].concat(result.language || []);
  if (langs.some((l) => TR_LANG.test(String(l).trim()))) return true;
  const text = `${result.title || ''} ${result.description || ''}`;
  return TR_CHARS.test(result.title || '') || TR_WORDS.test(text) || TR_TAGS.test(text);
}

export function score(result) {
  let s = result.relevance ?? 0;
  if (result.seeders != null) s += Math.log10(result.seeders + 1) * 2;
  if (result.downloads != null) s += Math.log10(result.downloads + 1);
  const title = result.title || '';
  const res = RESOLUTION_BONUS.find(([re]) => re.test(title));
  if (res) s += res[1];
  if (LOW_QUALITY.test(title) || TS_TAG.test(title)) s -= 0.8;
  return s;
}

// Tekrarları atar ve puana göre sıralar. Türkçe önceliği istemcideki anahtara
// bırakılır; sunucu yalnızca turkish bayrağını üretir.
export function rankResults(results) {
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = r.infoHash || r.torrentUrl || r.magnet || `${r.source}:${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...r, turkish: isTurkish(r) });
  }
  return unique.sort((a, b) => score(b) - score(a));
}
