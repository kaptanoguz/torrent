// Internet Archive: kamu malı ve özgür lisanslı içerik. Her öğenin
// web-seed içeren bir .torrent dosyası vardır, yani eş (peer) olmasa da iner.

import { CATEGORIES, genreTerms } from '../categories.js';

const API = 'https://archive.org/advancedsearch.php';
const FIELDS = ['identifier', 'title', 'item_size', 'downloads', 'language', 'year', 'mediatype', 'description', 'subject', 'avg_rating', 'num_reviews'];
const TR_LANGUAGE = 'language:(tur OR turkish OR "Türkçe" OR "Turkce")';

function quote(term) {
  return `"${String(term).replace(/["\\]/g, ' ').trim()}"`;
}

export function buildQuery({ query = '', category = 'all', genre = '' }, turkishOnly = false) {
  const parts = [];
  const text = query.replace(/[()":\\]/g, ' ').trim();
  if (text) parts.push(`(${text})`);
  const terms = genreTerms(genre);
  if (terms.length) parts.push(`subject:(${terms.map(quote).join(' OR ')})`);
  const cat = CATEGORIES[category] || CATEGORIES.all;
  if (cat.archiveSubjects) parts.push(`subject:(${cat.archiveSubjects.map(quote).join(' OR ')})`);
  parts.push(`mediatype:(${cat.archive.join(' OR ')})`);
  if (turkishOnly) parts.push(TR_LANGUAGE);
  return parts.join(' AND ');
}

function firstText(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return v == null ? '' : String(v).replace(/<[^>]+>/g, '').trim();
}

export function mapDoc(doc, index, total) {
  const id = doc.identifier;
  return {
    id: `archive:${id}`,
    source: 'Internet Archive',
    title: firstText(doc.title) || id,
    description: firstText(doc.description).slice(0, 220),
    year: doc.year ? Number(doc.year) || null : null,
    language: [].concat(doc.language || []),
    category: doc.mediatype,
    size: Number(doc.item_size) || null,
    seeders: null,
    downloads: Number(doc.downloads) || 0,
    subjects: [].concat(doc.subject || []).map(String).slice(0, 20),
    // Internet Archive kullanıcı puanı 5 üzerindendir; 10'luk ölçeğe çevrilir.
    rating: Number(doc.num_reviews) >= 2 && Number(doc.avg_rating) ? { value: Number(doc.avg_rating) * 2, source: 'Archive', votes: Number(doc.num_reviews) } : null,
    webSeed: true,
    torrentUrl: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_archive.torrent`,
    pageUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    relevance: ((total - index) / total) * 3,
  };
}

async function fetchDocs(fetchImpl, q, rows, sort) {
  const url = new URL(API);
  url.searchParams.set('q', q);
  for (const f of FIELDS) url.searchParams.append('fl[]', f);
  url.searchParams.set('rows', String(rows));
  url.searchParams.set('output', 'json');
  if (sort) url.searchParams.append('sort[]', sort);
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Internet Archive ${res.status}`);
  const data = await res.json();
  return data?.response?.docs || [];
}

export default {
  id: 'archive',
  name: 'Internet Archive',
  description: 'Kamu malı filmler, müzik, kitap ve yazılımlar (yasal).',
  configurable: false,
  async search(params, { fetch: fetchImpl = fetch } = {}) {
    // Sadece tür seçildiyse en popülerleri getir; aksi halde alaka sırası.
    const sort = params.query?.trim() ? '' : 'downloads desc';
    // Türkçe sonuçlar ayrı sorgu ile garanti altına alınır, genel sorgu
    // diğer dillerdeki içeriği getirir.
    const [tr, all] = await Promise.all([
      fetchDocs(fetchImpl, buildQuery(params, true), 20, sort).catch(() => []),
      fetchDocs(fetchImpl, buildQuery(params, false), 40, sort),
    ]);
    return [
      ...tr.map((d, i) => ({ ...mapDoc(d, i, tr.length), language: [].concat(d.language || 'tur') })),
      ...all.map((d, i) => mapDoc(d, i, all.length)),
    ];
  },
};
