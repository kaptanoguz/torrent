// Türkçe içeriği öne çıkaran sıralama.
// Diğer diller elenmez; yalnızca Türkçe olduğu anlaşılan sonuçlar üste taşınır.

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TR_WORDS = /\b(t[uü]rk[cç]e|turkish|dublaj|altyaz[ıi]l?[ıi]?|tr\s?dub|yerli)\b/i;
const TR_LANG = /^(tur|tr|turkish|t[uü]rk[cç]e)$/i;

export function isTurkish(result) {
  const langs = [].concat(result.language || []);
  if (langs.some((l) => TR_LANG.test(String(l).trim()))) return true;
  const text = `${result.title || ''} ${result.description || ''}`;
  return TR_CHARS.test(result.title || '') || TR_WORDS.test(text);
}

function score(result) {
  let s = result.relevance ?? 0;
  if (result.seeders != null) s += Math.log10(result.seeders + 1) * 2;
  if (result.downloads != null) s += Math.log10(result.downloads + 1);
  return s;
}

export function rankResults(results) {
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = r.infoHash || r.torrentUrl || r.magnet || `${r.source}:${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...r, turkish: isTurkish(r) });
  }
  return unique.sort((a, b) => {
    if (a.turkish !== b.turkish) return a.turkish ? -1 : 1;
    return score(b) - score(a);
  });
}
