// Arayüzdeki kategori ve tür kısayolları. Türkçe tür adı, kaynaklarda
// İngilizce etiketlerle de aranır ki farklı dillerdeki içerik de bulunsun.

export const CATEGORIES = {
  all: { label: 'Hepsi', archive: ['movies', 'audio', 'texts', 'software'], torznab: [] },
  movies: { label: 'Film', archive: ['movies'], torznab: [2000] },
  tv: { label: 'Dizi', archive: ['movies'], torznab: [5000] },
  music: { label: 'Müzik', archive: ['audio'], torznab: [3000] },
  books: { label: 'Kitap', archive: ['texts'], torznab: [7000] },
  software: { label: 'Yazılım', archive: ['software'], torznab: [4000] },
};

export const GENRES = {
  korku: ['korku', 'horror'],
  komedi: ['komedi', 'comedy'],
  dram: ['dram', 'drama'],
  'bilim-kurgu': ['bilim kurgu', 'science fiction', 'sci-fi'],
  belgesel: ['belgesel', 'documentary'],
  animasyon: ['animasyon', 'animation', 'cartoon'],
  aksiyon: ['aksiyon', 'action'],
  gerilim: ['gerilim', 'thriller'],
  romantik: ['romantik', 'romance'],
  western: ['western', 'kovboy'],
  klasik: ['klasik', 'classic'],
  'yesilcam': ['yeşilçam', 'yesilcam', 'türk filmi', 'turkish film'],
};

export function genreTerms(genre) {
  return GENRES[genre] || [];
}
