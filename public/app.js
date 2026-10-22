const TOKEN = document.querySelector('meta[name="app-token"]').content;
const $ = (id) => document.getElementById(id);

const GENRE_LABELS = {
  korku: 'Korku', komedi: 'Komedi', dram: 'Dram', 'bilim-kurgu': 'Bilim Kurgu', belgesel: 'Belgesel',
  animasyon: 'Animasyon', aksiyon: 'Aksiyon', gerilim: 'Gerilim', romantik: 'Romantik',
  western: 'Western', klasik: 'Klasik', yesilcam: 'Yeşilçam',
};

const ICONS = {
  movies: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.5 4.5 2.5L10 14.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  texts: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V5.5M8 7h8"/></svg>',
  software: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3M8 9l-2 2 2 2M16 9l2 2-2 2"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m7 4 13 8-13 8z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
};

const state = {
  category: 'all',
  genre: '',
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

/* ---------- Filtreler ---------- */

async function loadMeta() {
  const meta = await api('meta');
  $('categories').innerHTML = Object.entries(meta.categories)
    .map(([k, label]) => `<button type="button" role="tab" data-cat="${k}" aria-selected="${k === state.category}">${esc(label)}</button>`)
    .join('');
  $('genres').innerHTML = meta.genres
    .map((g) => `<button type="button" class="chip" data-genre="${g}" aria-pressed="false">${esc(GENRE_LABELS[g] || g)}</button>`)
    .join('');
}

$('categories').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  state.category = btn.dataset.cat;
  for (const b of $('categories').children) b.setAttribute('aria-selected', String(b === btn));
  if (hasQuery()) search();
});

$('genres').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-genre]');
  if (!btn) return;
  state.genre = state.genre === btn.dataset.genre ? '' : btn.dataset.genre;
  for (const b of $('genres').children) b.setAttribute('aria-pressed', String(b.dataset.genre === state.genre));
  if (hasQuery()) search();
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
  for (const b of $('genres').children) b.setAttribute('aria-pressed', 'false');
  goHome();
  $('q').focus();
});

function goHome() {
  $('main').classList.add('is-home');
  $('results').innerHTML = '';
  $('results-head').hidden = true;
  $('notice').hidden = true;
}

async function search() {
  const q = $('q').value.trim();
  if (/^magnet:\?/i.test(q)) return showMagnet(q);
  if (!q && !state.genre) return goHome();

  const seq = ++state.searchSeq;
  $('main').classList.remove('is-home');
  $('notice').hidden = true;
  $('results-head').hidden = true;
  $('results').innerHTML = Array.from({ length: 5 }, () => '<li class="skeleton"></li>').join('');
  $('search-btn').disabled = true;

  try {
    const params = new URLSearchParams({ q, category: state.category, genre: state.genre });
    const data = await api(`search?${params}`);
    if (seq !== state.searchSeq) return;
    state.results = data.results;
    renderResults(data);
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
  $('results-head').hidden = true;
  showNotice(
    `<span><strong>Magnet bağlantısı algılandı.</strong> Doğrudan indirmeye başlayabilirsin.</span>
     <button class="primary-btn" type="button" id="magnet-dl">İndir</button>`,
    'magnet',
  );
  $('magnet-dl').addEventListener('click', () => startDownload({ magnet }));
}

function healthPill(r) {
  if (r.webSeed && r.seeders == null) return '<span class="pill health" title="Sunucudan doğrudan iner">Hızlı kaynak</span>';
  if (r.seeders == null) return '';
  const cls = r.seeders >= 10 ? '' : r.seeders > 0 ? 'low' : 'dead';
  return `<span class="pill health ${cls}" title="Paylaşan kişi sayısı">${r.seeders.toLocaleString('tr-TR')} paylaşan</span>`;
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

function renderResults({ results, errors }) {
  const trCount = results.filter((r) => r.turkish).length;
  $('results-head').hidden = !results.length;
  $('results-summary').textContent = `${results.length} sonuç${trCount ? ` · ${trCount} Türkçe sonuç üstte` : ''}`;
  if (errors?.length) {
    showNotice(`Bazı kaynaklara ulaşılamadı: ${errors.map((e) => `<strong>${esc(e.provider)}</strong>`).join(', ')}.`);
  }
  if (!results.length) {
    $('results').innerHTML = '';
    if (!errors?.length) showNotice('<strong>Sonuç bulunamadı.</strong> Farklı bir kelime ya da başka bir kategori dene.');
    return;
  }
  $('results').innerHTML = results.map((r, i) => {
    const type = ICONS[r.category] ? r.category : 'movies';
    const meta = [
      r.turkish ? '<span class="pill tr">Türkçe</span>' : '',
      r.year ? `<span>${r.year}</span>` : '',
      r.size ? `<span>${formatBytes(r.size)}</span>` : '',
      healthPill(r),
      `<span>${esc(r.source)}</span>`,
    ].filter(Boolean).join('<span class="dot"></span>');
    const title = r.pageUrl
      ? `<a href="${esc(r.pageUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
      : esc(r.title);
    return `<li class="result" data-delay="${Math.min(i, 12) * 25}" data-id="${esc(r.id)}">
      <div class="type-tile ${type}">${ICONS[type]}</div>
      <div class="result-main">
        <h3 class="result-title" title="${esc(r.title)}">${title}</h3>
        <div class="result-meta">${meta}</div>
      </div>
      <div class="result-actions">${resultButton(r)}</div>
    </li>`;
  }).join('');
  applyInlineStyles($('results'));
}

// CSP satır içi style özniteliklerine izin vermez; değerler JS ile atanır.
function applyInlineStyles(root) {
  for (const el of root.querySelectorAll('[data-delay]')) el.style.animationDelay = `${el.dataset.delay}ms`;
  for (const el of root.querySelectorAll('[data-width]')) el.style.width = `${el.dataset.width}%`;
}

function refreshResultButtons() {
  for (const li of $('results').children) {
    const r = state.results.find((x) => x.id === li.dataset.id);
    if (r) li.querySelector('.result-actions').innerHTML = resultButton(r);
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
      body: JSON.stringify({ downloadDir: $('set-dir').value, archiveEnabled: $('set-archive').checked, torznab }),
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
