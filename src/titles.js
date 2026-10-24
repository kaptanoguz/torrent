// Torrent adlarından ("Film.Adi.2019.1080p.BluRay.x264") okunabilir ad ve yıl çıkarır.

const NOISE = /\b(2160p|1080p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web|hdtv|dvdrip|dvd|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|remux|proper|repack|extended|unrated|türkçe|turkce|dublaj|altyazı|altyazılı|tr|multi|dual)\b/i;

export function parseTitle(raw = '') {
  let title = String(raw).replace(/\[[^\]]*\]/g, ' ');
  if (!/\s/.test(title.trim())) title = title.replace(/[._]+/g, ' ');
  const series = /\bS\d{1,2}(E\d{1,3})?\b|\bsezon\b|\bseason\b/i.test(title);
  const yearMatch = title.match(/[([\s.](19[0-9]{2}|20[0-9]{2})(?=[)\]\s.]|$)/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  let cut = title.length;
  for (const re of [/[([\s.](19|20)\d{2}(?=[)\]\s.]|$)/, /\bS\d{1,2}(E\d{1,3})?\b/i, /\b(season|sezon)\s*\d+/i, /\bcomplete\b/i, NOISE, /\s[-–—:]\s/]) {
    const m = title.match(re);
    if (m && m.index > 0) cut = Math.min(cut, m.index);
  }
  const name = title.slice(0, cut).replace(/[(\[]\s*$/, '').replace(/\s+/g, ' ').trim();
  return { name: name || title.trim(), year, series };
}
