// Arayüzdeki kategori ve tür kısayolları. Türkçe tür adı, kaynaklarda
// İngilizce etiketlerle de aranır ki farklı dillerdeki içerik de bulunsun.

export const CATEGORIES = {
  all: { label: 'Hepsi', archive: ['movies', 'audio', 'texts', 'software'], torznab: [] },
  movies: { label: 'Film', archive: ['movies'], torznab: [2000] },
  tv: { label: 'Dizi', archive: ['movies'], torznab: [5000] },
  music: { label: 'Müzik', archive: ['audio'], torznab: [3000] },
  books: { label: 'Kitap', archive: ['texts'], torznab: [7000] },
  software: { label: 'Yazılım', archive: ['software'], torznab: [4000] },
  adult: {
    label: '+18',
    archive: ['movies', 'texts'],
    archiveSubjects: ['erotic', 'erotica', 'erotik', 'adult', 'nudity', 'pin-up', 'burlesque', 'sexploitation'],
    torznab: [6000],
    adult: true,
  },
};

export const GENRES = {
  aksiyon: { label: 'Aksiyon', terms: ['aksiyon', 'action'] },
  komedi: { label: 'Komedi', terms: ['komedi', 'comedy'] },
  dram: { label: 'Dram', terms: ['dram', 'drama'] },
  korku: { label: 'Korku', terms: ['korku', 'horror'] },
  gerilim: { label: 'Gerilim', terms: ['gerilim', 'thriller', 'suspense'] },
  'bilim-kurgu': { label: 'Bilim Kurgu', terms: ['bilim kurgu', 'science fiction', 'sci-fi'] },
  romantik: { label: 'Romantik', terms: ['romantik', 'romance'] },
  animasyon: { label: 'Animasyon', terms: ['animasyon', 'animation', 'cartoon'] },
  belgesel: { label: 'Belgesel', terms: ['belgesel', 'documentary'] },
  suc: { label: 'Suç', terms: ['suç', 'crime', 'film noir', 'noir'] },
  macera: { label: 'Macera', terms: ['macera', 'adventure'] },
  fantastik: { label: 'Fantastik', terms: ['fantastik', 'fantasy'] },
  western: { label: 'Western', terms: ['western', 'kovboy'] },
  muzikal: { label: 'Müzikal', terms: ['müzikal', 'musical'] },
  klasik: { label: 'Klasik', terms: ['klasik', 'classic'] },
  yesilcam: { label: 'Yeşilçam', terms: ['yeşilçam', 'yesilcam', 'türk filmi', 'turkish film'] },
};

export function genreTerms(genre) {
  return GENRES[genre]?.terms || [];
}

// Konu etiketleri, OMDb türleri ve başlıktan sonucun türlerini çıkarır.
export function detectGenres(texts) {
  const hay = texts.filter(Boolean).join(' | ').toLowerCase();
  if (!hay) return [];
  return Object.entries(GENRES)
    .filter(([key, g]) => key !== 'klasik' && g.terms.some((t) => new RegExp(`(^|[^\\p{L}])${t}([^\\p{L}]|$)`, 'u').test(hay)))
    .map(([key]) => key);
}

const ADULT = /(^|[^\p{L}])(xxx|porn\w*|erotic\w*|erotik\w*|nsfw|adult|hentai|sexploitation|\+18|18\+)([^\p{L}]|$)/iu;

export function isAdult(result) {
  if (result.torznabCategory >= 6000 && result.torznabCategory < 7000) return true;
  return ADULT.test([result.title, ...(result.subjects || [])].join(' | '));
}

export function categoryFromTorznab(cat) {
  if (cat >= 2000 && cat < 3000) return 'movies';
  if (cat >= 5000 && cat < 6000) return 'tv';
  if (cat >= 3000 && cat < 4000) return 'audio';
  if (cat >= 7000 && cat < 8000) return 'texts';
  if (cat >= 4000 && cat < 5000) return 'software';
  if (cat >= 6000 && cat < 7000) return 'movies';
  return 'movies';
}
