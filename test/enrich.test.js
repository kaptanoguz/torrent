import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle } from '../src/titles.js';
import { detectGenres, isAdult } from '../src/categories.js';
import { searchAll } from '../src/search.js';
import { buildQuery } from '../src/providers/archive.js';

test('torrent adından ad ve yıl çıkarılır', () => {
  assert.deepEqual(parseTitle('The.Matrix.1999.1080p.BluRay.x264'), { name: 'The Matrix', year: 1999, series: false });
  assert.deepEqual(parseTitle('Nosferatu (1922)'), { name: 'Nosferatu', year: 1922, series: false });
  assert.equal(parseTitle('Kurtlar Vadisi S01E05 720p').series, true);
  assert.equal(parseTitle('Kurtlar Vadisi S01E05 720p').name, 'Kurtlar Vadisi');
});

test('konu etiketlerinden tür bulunur', () => {
  assert.deepEqual(detectGenres(['HORROR', 'Silent films']), ['korku']);
  assert.deepEqual(detectGenres(['SCIENCE FICTION']), ['bilim-kurgu']);
  assert.deepEqual(detectGenres(['Comedy', 'Science Fiction']).sort(), ['bilim-kurgu', 'komedi']);
  assert.deepEqual(detectGenres(['Dramatic arts']), [], 'kelime parçası eşleşmez');
});

test('+18 içerik tanınır', () => {
  assert.ok(isAdult({ title: 'x', torznabCategory: 6040 }));
  assert.ok(isAdult({ title: 'Vintage Erotica Collection' }));
  assert.ok(!isAdult({ title: 'The Adulterer' }));
});

const provider = (results) => ({ name: 'Test', search: async () => results });

test('+18 sonuçlar normal aramada gizlenir, kendi bölümünde görünür', async () => {
  const items = [
    { id: '1', title: 'Night of the Living Dead', torrentUrl: 'a', year: 1968, subjects: ['Horror'] },
    { id: '2', title: 'Erotica Reel', torrentUrl: 'b', subjects: ['erotica'] },
  ];
  const normal = await searchAll({ query: 'x', category: 'all' }, [provider(items)]);
  assert.deepEqual(normal.results.map((r) => r.id), ['1']);
  assert.deepEqual(normal.results[0].genres, ['korku']);
  const adult = await searchAll({ query: '', category: 'adult' }, [provider(items)]);
  assert.equal(adult.results.length, 2);
  assert.ok(adult.results.every((r) => r.adult));
});

test('+18 Internet Archive sorgusu konu filtresi içerir', () => {
  assert.match(buildQuery({ query: '', category: 'adult' }), /subject:\("erotic"/);
});

test('yılı olmayan sonuçlarda yıl başlıktan okunur', async () => {
  const { results } = await searchAll({ query: 'm' }, [provider([{ id: '1', title: 'Metropolis.1927.720p', torrentUrl: 'a' }])]);
  assert.equal(results[0].year, 1927);
});

test('OMDb anahtarı varsa IMDb puanı, tür ve afiş eklenir', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({ Response: 'True', imdbID: 'tt0013442', imdbRating: '7.8', imdbVotes: '107,000', Genre: 'Fantasy, Horror', Year: '1922', Poster: 'https://img.example/p.jpg' }),
    };
  };
  const { results } = await searchAll(
    { query: 'nosferatu', category: 'movies' },
    [provider([{ id: '1', title: 'Nosferatu.1922.1080p', category: 'movies', torrentUrl: 'a' }])],
    { fetch: fakeFetch, omdbApiKey: 'k' },
  );
  assert.equal(urls[0].searchParams.get('t'), 'Nosferatu');
  assert.equal(urls[0].searchParams.get('y'), '1922');
  assert.deepEqual(results[0].rating, { value: 7.8, source: 'IMDb', votes: 107000 });
  assert.deepEqual(results[0].genres.sort(), ['fantastik', 'korku']);
  assert.equal(results[0].poster, 'https://img.example/p.jpg');
  assert.equal(results[0].imdbUrl, 'https://www.imdb.com/title/tt0013442/');
});
