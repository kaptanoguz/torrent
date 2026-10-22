const TOKEN = document.querySelector('meta[name="app-token"]').content;
const $ = (id) => document.getElementById(id);

const ICONS = {
  movies: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.5 4.5 2.5L10 14.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  texts: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V5.5M8 7h8"/></svg>',
  software: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3M8 9l-2 2 2 2M16 9l2 2-2 2"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m7 4 13 8-13 8z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="star"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* gizli pencere vb. */ }
  },
};

const state = {
  category: 'all',
  genre: '', // ana sayfadaki tür kartından gelen sunucu araması
  genreFilter: '', // sonuçlar içinde istemci tarafı süzme
  sort: store.get('sort', 'year-desc'),
  trFirst: store.get('trFirst', '1') === '1',
  genres: {},
  results: [],
  downloads: [],
  searchSeq: 0,
};

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'X-App-Token': TOKEN, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir şeyler ters gitti.');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toLocaleString('tr-TR', { maximumFractionDigits: i >= 3 ? 2 : 1 })} ${u[i]}`;
}

function formatTime(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  if (s < 3600) return `${Math.round(s / 60)} dk`;
  const h = Math.floor(s / 3600);
  return `${h} sa ${Math.round((s % 3600) / 60)} dk`;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------- Kategori ve türler ---------- */

const GENRE_HUES = [262, 16, 210, 340, 190, 150, 28, 280, 120, 0, 45, 230, 95, 310, 200, 355];

async function loadMeta() {
  const meta = await api('meta');
  state.genres = meta.genres;
  $('category').innerHTML = Object.entries(meta.categories)
    .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`)
    .join('');
  $('category').value = state.category;
  $('genres').innerHTML = Object.entries(meta.genres)
    .map(([g, label], i) => `<button type="button" class="genre-card" data-genre="${g}" data-hue="${GENRE_HUES[i % GENRE_HUES.length]}">
        <span>${esc(label)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </button>`)
    .join('');
  for (const el of $('genres').querySelectorAll('[data-hue]')) el.style.setProperty('--hue', el.dataset.hue);
}

$('category').addEventListener('change', async () => {
  const next = $('category').value;
  if (next === 'adult' && store.get('ageOk') !== '1') {
    $('age-gate').returnValue = '';
    $('age-gate').showModal();
    const ok = await new Promise((resolve) => $('age-gate').addEventListener('close', () => resolve($('age-gate').returnValue === 'ok'), { once: true }));
    if (!ok) { $('category').value = state.category; return; }
    store.set('ageOk', '1');
  }
  state.category = next;
  document.body.classList.toggle('adult-mode', next === 'adult');
  if (hasQuery() || next === 'adult') search();
});

$('genres').addEventListener('click', (e) => {
  const card = e.target.closest('[data-genre]');
  if (!card) return;
  state.genre = card.dataset.genre;
  search();
});

$('genre-pill').addEventListener('click', () => {
  state.genre = '';
  if ($('q').value.trim()) search();
  else goHome();
});

function hasQuery() {
  return $('q').value.trim() || state.genre;
}

/* ---------- Arama ---------- */

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});

$('home-link').addEventListener('click', (e) => {
  e.preventDefault();
  $('q').value = '';
  state.genre = '';
  goHome();
  $('q').focus();
});

function goHome() {
  state.searchSeq++;
  $('main').classList.add('is-home');
  $('results').innerHTML = '';
  $('toolbar').hidden = true;
  $('notice').hidden = true;
  $('search-btn').disabled = false;
}

async function search() {
  const q = $('q').value.trim();
  if (/^magnet:\?/i.test(q)) return showMagnet(q);
  if (!q && !state.genre && state.category !== 'adult') return goHome();

  const seq = ++state.searchSeq;
  $('main').classList.remove('is-home');
  $('notice').hidden = true;
  $('toolbar').hidden = true;
  $('results').innerHTML = Array.from({ length: 5 }, () => '<li class="skeleton"></li>').join('');
  $('search-btn').disabled = true;

  try {
    const params = new URLSearchParams({ q, category: state.category, genre: state.genre });
    const data = await api(`search?${params}`);
    if (seq !== state.searchSeq) return;
    state.results = data.results;
    state.genreFilter = '';
    state.errors = data.errors;
    renderResults();
  } catch (err) {
    if (seq !== state.searchSeq) return;
    $('results').innerHTML = '';
    showNotice(`<strong>Arama yapılamadı.</strong> ${esc(err.message)}`);
  } finally {
    if (seq === state.searchSeq) $('search-btn').disabled = false;
  }
}

function showNotice(html, cls = '') {
  $('notice').className = `notice ${cls}`;
  $('notice').innerHTML = html;
  $('notice').hidden = false;
}

function showMagnet(magnet) {
  $('main').classList.remove('is-home');
  $('results').innerHTML = '';
  $('toolbar').hidden = true;
  showNotice(
    `<span><strong>Magnet bağlantısı algılandı.</strong> Doğrudan indirmeye başlayabilirsin.</span>
     <button class="primary-btn" type="button" id="magnet-dl">İndir</button>`,
    'magnet',
  );
  $('magnet-dl').addEventListener('click', () => startDownload({ magnet }));
}

/* ---------- Sıralama ve süzme ---------- */

const popularity = (r) => (r.seeders ?? 0) * 50 + (r.downloads ?? 0);
const genreLabel = (key) => state.genres[key] || key;

const SORTERS = {
  'year-desc': (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
  'year-asc': (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity),
  rating: (a, b) => (b.rating?.value ?? -1) - (a.rating?.value ?? -1),
  popular: (a, b) => popularity(b) - popularity(a),
  size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
  genre: (a, b) => {
    const ga = a.genres?.[0] ? genreLabel(a.genres[0]) : '￿';
    const gb = b.genres?.[0] ? genreLabel(b.genres[0]) : '￿';
    return ga.localeCompare(gb, 'tr');
  },
  relevance: () => 0, // sunucunun sırası korunur
};

function visibleResults() {
  const list = state.results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !state.genreFilter || r.genres?.includes(state.genreFilter));
  const cmp = SORTERS[state.sort] || SORTERS['year-desc'];
  list.sort((a, b) => {
    if (state.trFirst && a.r.turkish !== b.r.turkish) return a.r.turkish ? -1 : 1;
    return cmp(a.r, b.r) || a.i - b.i;
  });
  return list.map(({ r }) => r);
}

function renderGenreFilter() {
  const counts = new Map();
  for (const r of state.results) for (const g of r.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  $('genre-filter').innerHTML = `<option value="">Tümü (${state.results.length})</option>`
    + options.map(([g, n]) => `<option value="${g}">${esc(genreLabel(g))} (${n})</option>`).join('');
  $('genre-filter').value = state.genreFilter;
  $('genre-filter').disabled = options.length === 0;
}

$('sort').value = state.sort;
$('tr-first').checked = state.trFirst;
$('sort').addEventListener('change', () => {
  state.sort = $('sort').value;
  store.set('sort', state.sort);
  renderList();
});
$('tr-first').addEventListener('change', () => {
  state.trFirst = $('tr-first').checked;
  store.set('trFirst', state.trFirst ? '1' : '0');
  renderList();
});
$('genre-filter').addEventListener('change', () => {
  state.genreFilter = $('genre-filter').value;
  renderList();
});

/* ---------- Sonuç listesi ---------- */

function healthPill(r) {
  if (r.webSeed && r.seeders == null) return '<span class="pill health" title="Sunucudan doğrudan iner">Hızlı kaynak</span>';
  if (r.seeders == null) return '';
  const cls = r.seeders >= 10 ? '' : r.seeders > 0 ? 'low' : 'dead';
  return `<span class="pill health ${cls}" title="Paylaşan kişi sayısı">${r.seeders.toLocaleString('tr-TR')} paylaşan</span>`;
}

function ratingBadge(r) {
  if (!r.rating) return '';
  const value = r.rating.value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const votes = r.rating.votes ? ` · ${r.rating.votes.toLocaleString('tr-TR')} oy` : '';
  const body = `${ICONS.star}<strong>${value}</strong><small>${esc(r.rating.source)}</small>`;
  return r.imdbUrl
    ? `<a class="rating" href="${esc(r.imdbUrl)}" target="_blank" rel="noopener" title="${esc(r.rating.source)} puanı${votes}">${body}</a>`
    : `<span class="rating" title="${esc(r.rating.source)} puanı (10 üzerinden)${votes}">${body}</span>`;
}

function resultButton(r) {
  const d = findDownload(r);
  if (!d) return `<button class="primary-btn" type="button" data-dl="${esc(r.id)}">İndir</button>`;
  if (d.status === 'done') return `<button class="primary-btn done" type="button" data-open="${d.id}">Aç</button>`;
  if (d.status === 'error') return `<button class="primary-btn" type="button" data-resume="${d.id}">Tekrar dene</button>`;
  if (d.status === 'paused') return `<button class="primary-btn" type="button" data-resume="${d.id}">Devam et</button>`;
  return `<button class="primary-btn going" type="button" data-show-downloads>%${Math.floor(d.progress * 100)}</button>`;
}

function findDownload(r) {
  return state.downloads.find((d) => d.key === (r.magnet || r.torrentUrl));
}

function renderResults() {
  const { results, errors } = state;
  $('toolbar').hidden = !results.length;
  $('genre-pill').hidden = !state.genre;
  $('genre-pill').innerHTML = state.genre ? `${esc(genreLabel(state.genre))} ${ICONS.x}` : '';
  $('genre-pill').title = 'Tür seçimini kaldır';
  $('notice').hidden = true;
  if (errors?.length) {
    showNotice(`Bazı kaynaklara ulaşılamadı: ${errors.map((e) => `<strong>${esc(e.provider)}</strong>`).join(', ')}.`);
  }
  if (!results.length) {
    $('results').innerHTML = '';
    if (!errors?.length) showNotice('<strong>Sonuç bulunamadı.</strong> Farklı bir kelime ya da başka bir kategori dene.');
    return;
  }
  renderGenreFilter();
  renderList();
}

function renderList() {
  const list = visibleResults();
  const trCount = list.filter((r) => r.turkish).length;
  $('results-summary').innerHTML = `<strong>${list.length}</strong> sonuç${trCount ? ` <span class="muted">· ${trCount} Türkçe</span>` : ''}`;
  $('results').innerHTML = list.map((r, i) => {
    const type = ICONS[r.category] ? r.category : 'movies';
    const genres = (r.genres || []).slice(0, 2).map(genreLabel).join(', ');
    const meta = [
      r.turkish ? '<span class="pill tr">Türkçe</span>' : '',
      r.adult ? '<span class="pill adult">+18</span>' : '',
      r.year ? `<span>${r.year}</span>` : '',
      genres ? `<span>${esc(genres)}</span>` : '',
      r.size ? `<span>${formatBytes(r.size)}</span>` : '',
      healthPill(r),
      `<span class="source">${esc(r.source)}</span>`,
    ].filter(Boolean).join('<span class="dot"></span>');
    const title = r.pageUrl
      ? `<a href="${esc(r.pageUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
      : esc(r.title);
    const tile = r.poster
      ? `<img class="poster" src="${esc(r.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="type-tile ${type}">${ICONS[type]}</div>`;
    return `<li class="result" data-delay="${Math.min(i, 12) * 25}" data-id="${esc(r.id)}">
      ${tile}
      <div class="result-main">
        <h3 class="result-title" title="${esc(r.title)}">${title}</h3>
        <div class="result-meta">${meta}</div>
      </div>
      <div class="result-actions">${ratingBadge(r)}${resultButton(r)}</div>
    </li>`;
  }).join('') || '<li class="notice">Bu türde sonuç yok.</li>';
  applyInlineStyles($('results'));
  for (const img of $('results').querySelectorAll('img.poster')) {
    img.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('div'), { className: 'type-tile movies', innerHTML: ICONS.movies })), { once: true });
  }
}

// CSP satır içi style özniteliklerine izin vermez; değerler JS ile atanır.
function applyInlineStyles(root) {
  for (const el of root.querySelectorAll('[data-delay]')) el.style.animationDelay = `${el.dataset.delay}ms`;
  for (const el of root.querySelectorAll('[data-width]')) el.style.width = `${el.dataset.width}%`;
}

function refreshResultButtons() {
  for (const li of $('results').children) {
    const r = state.results.find((x) => x.id === li.dataset.id);
    const btn = li.querySelector('.result-actions > button');
    if (r && btn) btn.outerHTML = resultButton(r);
  }
}

$('results').addEventListener('click', (e) => {
  const dl = e.target.closest('[data-dl]');
  if (dl) {
    const r = state.results.find((x) => x.id === dl.dataset.dl);
    if (r) startDownload({ magnet: r.magnet, torrentUrl: r.torrentUrl, title: r.title, source: r.source }, dl);
  }
  const open = e.target.closest('[data-open]');
  if (open) api(`downloads/${open.dataset.open}/open`, { method: 'POST' }).catch((err) => toast(err.message, 'error'));
  const resume = e.target.closest('[data-resume]');
  if (resume) api(`downloads/${resume.dataset.resume}/resume`, { method: 'POST' }).then(refreshDownloads).catch((err) => toast(err.message, 'error'));
  if (e.target.closest('[data-show-downloads]')) openDrawer();
});

async function startDownload(body, button) {
  if (button) { button.disabled = true; button.textContent = 'Başlıyor…'; }
  try {
    await api('downloads', { method: 'POST', body: JSON.stringify(body) });
    toast('İndirme başladı');
    await refreshDownloads();
  } catch (err) {
    toast(err.message, 'error');
    if (button) { button.disabled = false; button.textContent = 'İndir'; }
  }
}

/* ---------- İndirmeler ---------- */

const STATUS = {
  connecting: 'Bağlanıyor…',
  downloading: 'İndiriliyor',
  paused: 'Duraklatıldı',
  done: 'Tamamlandı',
  error: 'Hata',
};

function renderDownloads() {
  const list = state.downloads;
  const active = list.filter((d) => d.status === 'downloading' || d.status === 'connecting').length;
  $('downloads-badge').hidden = !active;
  $('downloads-badge').textContent = active;
  $('downloads-empty').hidden = list.length > 0;
  const html = list.map((d) => {
    const pct = Math.floor(d.progress * 100);
    let right = '';
    if (d.status === 'downloading') {
      right = [`${formatBytes(d.downloadSpeed) || '0 B'}/sn`, d.timeRemaining != null ? `${formatTime(d.timeRemaining)} kaldı` : '', `${d.peers} bağlantı`].filter(Boolean).join(' · ');
    } else if (d.status === 'done') right = formatBytes(d.length);
    else if (d.status === 'error') right = esc(d.error || '');
    const toggle = d.status === 'paused' || d.status === 'error'
      ? `<button class="icon-btn" data-act="resume" aria-label="Devam et" title="Devam et">${ICONS.play}</button>`
      : d.status === 'done' ? '' : `<button class="icon-btn" data-act="pause" aria-label="Duraklat" title="Duraklat">${ICONS.pause}</button>`;
    return `<li class="dl ${d.status}" data-id="${d.id}">
      <div class="dl-top">
        <p class="dl-title" title="${esc(d.title)}">${esc(d.title)}</p>
        <div class="dl-actions">
          ${toggle}
          <button class="icon-btn" data-act="open" aria-label="Klasörde göster" title="Klasörde göster">${ICONS.folder}</button>
          <button class="icon-btn" data-act="remove" aria-label="Listeden kaldır" title="Listeden kaldır (dosyalar silinmez)">${ICONS.trash}</button>
        </div>
      </div>
      <div class="bar"><span data-width="${pct}"></span></div>
      <div class="dl-stats"><span><span class="state">${STATUS[d.status] || d.status}</span>${d.status !== 'connecting' ? ` · %${pct}` : ''}</span><span>${right}</span></div>
    </li>`;
  }).join('');

  // Var olan kartları yerinde güncelle ki ilerleme çubuğu akıcı ilerlesin
  // ve imleç altındaki butonlar her saniye yeniden oluşmasın.
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const container = $('downloads');
  const existing = new Map([...container.children].map((el) => [el.dataset.id, el]));
  const next = [...tpl.content.children].map((fresh) => {
    const old = existing.get(fresh.dataset.id);
    if (!old || old.className !== fresh.className || old.querySelector('.dl-actions').innerHTML !== fresh.querySelector('.dl-actions').innerHTML) {
      applyInlineStyles(fresh);
      return fresh;
    }
    old.querySelector('.bar > span').style.width = `${fresh.querySelector('.bar > span').dataset.width}%`;
    old.querySelector('.dl-stats').replaceWith(fresh.querySelector('.dl-stats'));
    return old;
  });
  container.replaceChildren(...next);
}

async function refreshDownloads() {
  try {
    const list = await api('downloads');
    state.downloads = list;
    renderDownloads();
    refreshResultButtons();
  } catch {
    // sunucu kapanıyor olabilir
  }
}

$('downloads').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'remove') await api(`downloads/${id}`, { method: 'DELETE' });
    else await api(`downloads/${id}/${act}`, { method: 'POST' });
    if (act === 'remove') toast('Listeden kaldırıldı. Dosyalar klasörde duruyor.');
    refreshDownloads();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function openDrawer() {
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').hidden = false;
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').hidden = true;
}
$('downloads-btn').addEventListener('click', openDrawer);
$('drawer-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
$('open-dir-btn').addEventListener('click', () => api('open-download-dir', { method: 'POST' }).catch((err) => toast(err.message, 'error')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

/* ---------- Ayarlar ---------- */

function addTorznabRow(t = {}) {
  const row = $('torznab-row').content.firstElementChild.cloneNode(true);
  for (const input of row.querySelectorAll('[data-k]')) input.value = t[input.dataset.k] || '';
  row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
  $('torznab-list').append(row);
}

$('settings-btn').addEventListener('click', async () => {
  const s = await api('settings');
  $('set-dir').value = s.downloadDir;
  $('set-archive').checked = s.archiveEnabled !== false;
  $('set-omdb').value = s.omdbApiKey || '';
  $('torznab-list').innerHTML = '';
  s.torznab.forEach(addTorznabRow);
  $('settings').showModal();
});
$('add-torznab').addEventListener('click', () => addTorznabRow());

$('settings').addEventListener('close', async () => {
  if ($('settings').returnValue !== 'save') return;
  const torznab = [...$('torznab-list').children].map((row) => {
    const t = {};
    for (const input of row.querySelectorAll('[data-k]')) t[input.dataset.k] = input.value.trim();
    return t;
  }).filter((t) => t.url);
  try {
    await api('settings', {
      method: 'PUT',
      body: JSON.stringify({ downloadDir: $('set-dir').value, archiveEnabled: $('set-archive').checked, omdbApiKey: $('set-omdb').value, torznab }),
    });
    toast('Ayarlar kaydedildi');
  } catch (err) {
    toast(err.message, 'error');
  }
});

window.addEventListener('scroll', () => {
  document.querySelector('.topbar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

/* ---------- Başlat ---------- */

loadMeta().catch((err) => toast(err.message, 'error'));
refreshDownloads();
setInterval(refreshDownloads, 1000);
$('q').focus();
