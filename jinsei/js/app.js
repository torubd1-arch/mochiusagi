// 画面の描画と操作
// 状態（state.items）は保存に成功してから書き換える。保存に失敗したら警告し、画面と入力内容はそのまま残す。
import {
  CATEGORIES, findCategory, categoryEmoji, formatFuzzyDate, parseFuzzyDate, buildFuzzyDate, todayFuzzy,
  MIN_YEAR, MAX_YEAR, buildItem, updateItem, againItem, filterItems, sortWishes, sortMemories, groupTimeline,
  countItems, pickRandom, buildManifest, parseManifest, planMerge, needsBackupReminder, formatBytes, BACKUP_FILE,
} from './logic.js';
import * as store from './store.js';
import { processPhoto } from './photo.js';
import { createZip, readZip } from './zip.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const VIEW_MODE_KEY = 'jinsei.memMode';
const SNOOZE_DAYS = 7;

const state = {
  items: [],
  ready: false,
  route: 'wish',
  lastTab: 'wish',
  filters: {
    wish: { query: '', category: '', favoriteOnly: false },
    memories: { query: '', category: '', favoriteOnly: false },
    all: { query: '', category: '', favoriteOnly: false, status: 'all' },
  },
  memMode: readPref(VIEW_MODE_KEY) === 'timeline' ? 'timeline' : 'cards',
  meta: { lastBackupAt: null, lastChangeAt: null, snoozeUntil: null },
  detailId: null,
  lastGachaId: null,
  exportFile: null,
};

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 表示の好みなので、保存できなくても問題ない
  }
}

const getItem = (id) => state.items.find((it) => it.id === id) || null;

function replaceInState(item) {
  const i = state.items.findIndex((it) => it.id === item.id);
  if (i >= 0) state.items = state.items.map((it) => (it.id === item.id ? item : it));
  else state.items = [...state.items, item];
}

// ---- 保存（失敗したら警告して false） ----

function saveErrorText(err) {
  if (store.isQuotaError(err)) {
    return '端末の空き容量が足りないため保存できませんでした。\n写真を減らすか、iPhone の空き容量を増やしてから、もう一度お試しください。';
  }
  return `保存できませんでした。\n（${err && err.message ? err.message : err}）`;
}

async function persist(item, photoOps) {
  try {
    await store.saveItem(item, photoOps);
  } catch (err) {
    await alertDialog(saveErrorText(err));
    return false;
  }
  replaceInState(item);
  state.meta.lastChangeAt = item.updatedAt;
  return true;
}

// ---- サムネイル・写真の表示 ----

const thumbUrls = new Map(); // photoId → Promise<string | null>

function thumbUrl(photoId) {
  if (!thumbUrls.has(photoId)) {
    thumbUrls.set(photoId, store.getPhoto(photoId)
      .then((p) => (p ? URL.createObjectURL(new Blob([p.thumb], { type: p.thumbType })) : null))
      .catch(() => null));
  }
  return thumbUrls.get(photoId);
}

function forgetThumb(photoId) {
  const p = thumbUrls.get(photoId);
  if (!p) return;
  thumbUrls.delete(photoId);
  p.then((url) => url && URL.revokeObjectURL(url));
}

function forgetAllThumbs() {
  for (const id of [...thumbUrls.keys()]) forgetThumb(id);
}

// 画面に入ったサムネイルから読み込む
const lazyObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      lazyObserver.unobserve(e.target);
      fillThumb(e.target);
    }
  }, { root: $('main'), rootMargin: '300px 0px' })
  : null;

function fillThumb(box) {
  const { photoId } = box.dataset;
  thumbUrl(photoId).then((url) => {
    if (!url || !box.isConnected) return;
    const img = el('img');
    img.alt = '';
    img.src = url;
    box.textContent = '';
    box.append(img, ...box.extraNodes || []);
  });
}

/** 代表写真（なければカテゴリの絵文字）を入れる箱 */
function photoBox(className, item, extraNodes = []) {
  const box = el('div', className);
  box.append(categoryEmoji(item.category), ...extraNodes);
  if (item.photoIds.length) {
    box.dataset.photoId = item.photoIds[0];
    box.extraNodes = extraNodes;
    if (lazyObserver) lazyObserver.observe(box);
    else fillThumb(box);
  }
  return box;
}

// ---- 画面の切り替え ----

const TITLES = {
  wish: 'やりたいこと',
  memories: '思い出',
  all: 'すべて',
  archived: '保管中の項目',
  settings: '設定・バックアップ',
};
const TABS = ['wish', 'memories', 'all'];

function parseRoute() {
  const name = location.hash.replace(/^#\/?/, '');
  return TITLES[name] ? name : 'wish';
}

function onRoute() {
  state.route = parseRoute();
  if (TABS.includes(state.route)) state.lastTab = state.route;
  // 前の画面のトーストが、次の画面のボタンを覆わないように消す
  clearTimeout(toastTimer);
  hideToast();
  $('main').scrollTop = 0;
  syncFilterBar();
  render();
}

function render() {
  const { route } = state;
  document.title = route === 'wish' ? '人生コレクション100' : `${TITLES[route]} - 人生コレクション100`;
  $('pageTitle').textContent = TITLES[route];
  const isTab = TABS.includes(route);
  $('backLink').hidden = isTab;
  $('backLink').href = `#/${state.lastTab}`;
  $('settingsLink').hidden = route === 'settings';
  for (const a of document.querySelectorAll('#tabs a')) {
    if (a.dataset.tab === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('filterBar').hidden = !isTab || !state.ready;
  for (const v of ['wishView', 'memView', 'allView', 'archivedView', 'settingsView']) $(v).hidden = true;
  $('emptyText').hidden = true;
  $('archivedLink').hidden = true;
  $('pageCount').textContent = '';
  renderReminder();
  if (!state.ready) return;

  if (route === 'wish') renderWish();
  else if (route === 'memories') renderMemories();
  else if (route === 'all') renderAll();
  else if (route === 'archived') renderArchived();
  else renderSettings();
}

function showEmpty(text) {
  $('emptyText').textContent = text;
  $('emptyText').hidden = false;
}

function setCount(shown, total, unit = '件') {
  $('pageCount').textContent = shown === total ? `${total}${unit}` : `${shown}${unit}（全${total}${unit}）`;
}

function showArchivedLink() {
  const n = countItems(state.items).archived;
  if (!n) return;
  $('archivedLink').textContent = `保管中の項目（${n}件）`;
  $('archivedLink').hidden = false;
}

// ---- 検索・絞り込み ----

function currentFilter() {
  return state.filters[state.route];
}

function isFiltering(f) {
  return Boolean(f.query.trim() || f.category || f.favoriteOnly || (f.status && f.status !== 'all'));
}

/** 画面を切り替えたときに、検索欄などをその画面の状態に合わせる */
function syncFilterBar() {
  const f = currentFilter();
  if (!f) return;
  $('searchInput').value = f.query;
  $('searchInput').placeholder = { wish: 'やりたいことを検索', memories: '思い出を検索', all: 'すべてから検索' }[state.route];
  $('gachaBtn').hidden = state.route !== 'wish';
  $('viewToggle').hidden = state.route !== 'memories';
  $('statusChips').hidden = state.route !== 'all';
}

function chip(label, pressed, onClick) {
  const b = el('button', 'chip', label);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

/** カテゴリのチップ。その画面の項目で使われているカテゴリだけ出す */
function renderCategoryChips(baseItems) {
  const f = currentFilter();
  const box = $('categoryChips');
  box.textContent = '';
  const used = new Set(baseItems.map((it) => it.category));
  box.append(chip('すべて', !f.category && !f.favoriteOnly, () => {
    f.category = '';
    f.favoriteOnly = false;
    render();
  }));
  box.append(chip('★ お気に入り', f.favoriteOnly, () => {
    f.favoriteOnly = !f.favoriteOnly;
    render();
  }));
  for (const c of CATEGORIES) {
    if (!used.has(c.id) && f.category !== c.id) continue;
    box.append(chip(`${c.emoji} ${c.label}`, f.category === c.id, () => {
      f.category = f.category === c.id ? '' : c.id;
      render();
    }));
  }
  if (used.has('') && used.size > 1 || f.category === 'none') {
    box.append(chip('カテゴリなし', f.category === 'none', () => {
      f.category = f.category === 'none' ? '' : 'none';
      render();
    }));
  }
}

function renderStatusChips() {
  const f = state.filters.all;
  const box = $('statusChips');
  box.textContent = '';
  for (const [id, label] of [['all', 'すべて'], ['wish', 'やりたい'], ['done', '達成'], ['archived', '保管中']]) {
    box.append(chip(label, f.status === id, () => {
      f.status = id;
      render();
    }));
  }
}

// ---- 一覧の行 ----

function starButton(item) {
  const b = el('button', 'star-btn', '★');
  b.type = 'button';
  b.dataset.fav = item.id;
  b.setAttribute('aria-pressed', String(item.favorite));
  b.setAttribute('aria-label', item.favorite ? 'お気に入りを解除' : 'お気に入りにする');
  return b;
}

function wishRow(item) {
  const li = el('li', 'row');
  const main = el('button', 'row-main');
  main.type = 'button';
  main.dataset.open = item.id;
  main.append(el('span', 'row-emoji', categoryEmoji(item.category)), el('span', 'row-title', item.title));
  li.append(main, starButton(item));
  return li;
}

/** すべて・保管中の行（状態の印と、カテゴリ・日付の補足つき） */
function statusRow(item) {
  const li = el('li', `row${item.archived ? ' archived' : ''}`);
  const main = el('button', 'row-main');
  main.type = 'button';
  main.dataset.open = item.id;
  const mark = el('span', `row-status ${item.archived ? 'archived' : item.kind}`, item.kind === 'done' ? '✓' : '');
  mark.setAttribute('aria-label', item.archived ? '保管中' : item.kind === 'done' ? '達成' : 'やりたい');
  const title = el('span', 'row-title', item.title);
  const c = findCategory(item.category);
  const sub = [item.archived ? '保管中' : '', c ? `${c.emoji} ${c.label}` : '', item.kind === 'done' ? formatFuzzyDate(item.date) : '']
    .filter(Boolean).join(' ・ ');
  if (sub) title.append(el('span', 'row-sub', sub));
  main.append(mark, title);
  li.append(main, starButton(item));
  return li;
}

// ---- やりたいこと ----

function renderWish() {
  $('wishView').hidden = false;
  const f = state.filters.wish;
  const base = state.items.filter((it) => !it.archived && it.kind === 'wish');
  const list = sortWishes(filterItems(state.items, { status: 'wish', ...f }));
  renderCategoryChips(base);
  setCount(list.length, base.length);
  const ul = $('wishList');
  ul.textContent = '';
  ul.append(...list.map(wishRow));
  if (!base.length) showEmpty('まだやりたいことがありません。\n右上の＋から、タイトルだけで気軽に登録できます。');
  else if (!list.length) showEmpty('条件に合う項目がありません');
  showArchivedLink();
}

// ---- 思い出 ----

function memCard(item) {
  const card = el('button', 'card');
  card.type = 'button';
  card.dataset.open = item.id;
  const extras = [];
  if (item.favorite) extras.push(el('span', 'card-fav', '★'));
  if (item.photoIds.length > 1) extras.push(el('span', 'card-count', `${item.photoIds.length}枚`));
  const text = el('div', 'card-text');
  text.append(el('div', 'card-title', item.title));
  const date = formatFuzzyDate(item.date);
  if (date) text.append(el('div', 'card-date', date));
  card.append(photoBox('card-photo', item, extras), text);
  return card;
}

function timelineItem(item) {
  const li = el('li');
  const b = el('button', 'tl-item');
  b.type = 'button';
  b.dataset.open = item.id;
  const text = el('div', 'tl-text');
  text.append(el('div', 'tl-title', `${item.favorite ? '★ ' : ''}${item.title}`));
  const date = formatFuzzyDate(item.date);
  if (date) text.append(el('div', 'tl-date', date));
  b.append(photoBox('tl-photo', item), text);
  li.append(b);
  return li;
}

function renderMemories() {
  $('memView').hidden = false;
  const f = state.filters.memories;
  const base = state.items.filter((it) => !it.archived && it.kind === 'done');
  const list = filterItems(state.items, { status: 'done', ...f });
  renderCategoryChips(base);
  setCount(list.length, base.length);
  for (const b of $('viewToggle').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.memMode));

  const grid = $('cardGrid');
  const tl = $('timeline');
  grid.textContent = '';
  tl.textContent = '';
  grid.hidden = state.memMode !== 'cards';
  tl.hidden = state.memMode !== 'timeline';
  if (state.memMode === 'cards') {
    grid.append(...sortMemories(list).map(memCard));
  } else {
    for (const g of groupTimeline(list)) {
      const ul = el('ul', 'tl-list');
      ul.append(...g.items.map(timelineItem));
      tl.append(el('h3', 'tl-year', g.label), ul);
    }
  }
  if (!base.length) showEmpty('まだ思い出がありません。\nやりたいことを達成するか、＋から「過去に経験した」を選んで登録しましょう。');
  else if (!list.length) showEmpty('条件に合う思い出がありません');
  showArchivedLink();
}

// ---- すべて・保管中 ----

function renderAll() {
  $('allView').hidden = false;
  const f = state.filters.all;
  renderStatusChips();
  renderCategoryChips(state.items);
  const list = filterItems(state.items, f);
  // やりたいことを先に、続けて思い出（日付順）、最後に保管中
  const wishes = sortWishes(list.filter((it) => !it.archived && it.kind === 'wish'));
  const done = sortMemories(list.filter((it) => !it.archived && it.kind === 'done'));
  const archived = sortWishes(list.filter((it) => it.archived));
  const { wish, done: doneCount } = countItems(state.items);
  $('pageCount').textContent = isFiltering(f)
    ? `${list.length}件見つかりました`
    : `やりたいこと ${wish}件 ・ 思い出 ${doneCount}件`;
  const ul = $('allList');
  ul.textContent = '';
  ul.append(...[...wishes, ...done, ...archived].map(statusRow));
  if (!state.items.length) showEmpty('まだ何も登録されていません。\n右上の＋から登録しましょう。');
  else if (!list.length) showEmpty('条件に合う項目がありません');
}

function renderArchived() {
  $('archivedView').hidden = false;
  const list = sortWishes(state.items.filter((it) => it.archived));
  $('pageCount').textContent = `${list.length}件`;
  const ul = $('archivedList');
  ul.textContent = '';
  ul.append(...list.map(statusRow));
  if (!list.length) showEmpty('保管中の項目はありません');
}

// ---- 一覧の操作 ----

async function toggleFavorite(id) {
  const item = getItem(id);
  if (!item) return;
  if (await persist(updateItem(item, { favorite: !item.favorite }))) {
    render();
    if (state.detailId === id) renderDetail();
  }
}

function onListClick(e) {
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    toggleFavorite(fav.dataset.fav);
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) openDetail(open.dataset.open);
}

// ---- 詳細 ----

const detailUrls = [];

function clearDetailPhotos() {
  for (const url of detailUrls.splice(0)) URL.revokeObjectURL(url);
  $('detailPhotos').textContent = '';
}

function openDetail(id) {
  if (!getItem(id)) return;
  state.detailId = id;
  renderDetail(true);
  if (!$('detailDialog').open) $('detailDialog').showModal();
  $('detailDialog').querySelector('.sheet-body').scrollTop = 0;
}

function renderDetail(reloadPhotos = false) {
  const item = getItem(state.detailId);
  if (!item) {
    $('detailDialog').close();
    return;
  }
  const strip = $('detailPhotos');
  const shownIds = [...strip.querySelectorAll('figure')].map((f) => f.dataset.photoId).join();
  if (reloadPhotos || shownIds !== item.photoIds.join()) loadDetailPhotos(item);

  $('detailTitle').textContent = item.title;
  const fav = $('detailFav');
  fav.setAttribute('aria-pressed', String(item.favorite));
  fav.setAttribute('aria-label', item.favorite ? 'お気に入りを解除' : 'お気に入りにする');

  const meta = $('detailMeta');
  meta.textContent = '';
  const status = item.archived ? '保管中' : item.kind === 'done' ? '達成' : 'やりたい';
  meta.append(el('span', `badge${item.kind === 'done' && !item.archived ? ' done' : ''}`, status));
  const c = findCategory(item.category);
  const parts = [c ? `${c.emoji} ${c.label}` : ''];
  if (item.kind === 'done') parts.push(formatFuzzyDate(item.date) || '日付なし');
  meta.append(parts.filter(Boolean).join(' ・ '));
  $('detailNote').textContent = item.note;

  $('detailAchieve').hidden = item.kind !== 'wish' || item.archived;
  $('detailAgain').hidden = item.kind !== 'done' || item.archived;
  $('detailArchive').textContent = item.archived ? '保管をやめて元に戻す' : '保管する（一覧から外す）';
}

function loadDetailPhotos(item) {
  clearDetailPhotos();
  const strip = $('detailPhotos');
  const none = $('detailDialog').querySelector('.photo-none');
  if (none) none.remove();
  const pos = $('detailPhotoPos');
  pos.hidden = item.photoIds.length < 2;
  pos.textContent = `1 / ${item.photoIds.length}`;
  if (!item.photoIds.length) {
    strip.after(el('div', 'photo-none', categoryEmoji(item.category)));
    return;
  }
  for (const pid of item.photoIds) {
    const fig = el('figure');
    fig.dataset.photoId = pid;
    strip.append(fig);
    store.getPhotoData(pid).then(async (data) => {
      if (!fig.isConnected) return;
      const meta = await store.getPhoto(pid);
      if (!data || !meta || !fig.isConnected) {
        fig.append(el('span', 'hint', '写真を読み込めませんでした'));
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: meta.type }));
      detailUrls.push(url);
      const img = el('img');
      img.alt = '';
      img.src = url;
      fig.append(img);
    }).catch(() => fig.append(el('span', 'hint', '写真を読み込めませんでした')));
  }
  strip.scrollLeft = 0;
}

$('detailPhotos').addEventListener('scroll', () => {
  const strip = $('detailPhotos');
  const n = strip.children.length;
  if (n < 2) return;
  const i = Math.round(strip.scrollLeft / strip.clientWidth);
  $('detailPhotoPos').textContent = `${Math.min(n, i + 1)} / ${n}`;
}, { passive: true });

$('detailDialog').addEventListener('close', () => {
  state.detailId = null;
  clearDetailPhotos();
});

$('detailFav').addEventListener('click', () => toggleFavorite(state.detailId));
$('detailEdit').addEventListener('click', () => openForm('edit', getItem(state.detailId)));
$('detailAchieve').addEventListener('click', () => openForm('achieve', getItem(state.detailId)));

$('detailAgain').addEventListener('click', async () => {
  const item = getItem(state.detailId);
  if (!item) return;
  const again = againItem(item);
  if (await persist(again)) {
    render();
    toast('やりたいことに追加しました', '開く', () => openDetail(again.id));
  }
});

$('detailArchive').addEventListener('click', async () => {
  const item = getItem(state.detailId);
  if (!item) return;
  const archived = !item.archived;
  if (!(await persist(updateItem(item, { archived })))) return;
  $('detailDialog').close();
  render();
  toast(archived ? '保管しました' : '元に戻しました', '取り消す', async () => {
    const cur = getItem(item.id);
    if (cur && (await persist(updateItem(cur, { archived: !archived })))) render();
  });
});

$('detailDelete').addEventListener('click', async () => {
  const item = getItem(state.detailId);
  if (!item) return;
  const photoText = item.photoIds.length ? `写真${item.photoIds.length}枚も一緒に消え、` : '';
  const ok = await choiceDialog(
    `「${item.title}」を完全に削除しますか？\n${photoText}元に戻せません。\n\n残しておきたいときは「保管する」を使ってください。`,
    [{ label: '完全に削除する', value: 'delete', cls: 'danger' }, { label: 'キャンセル', value: null }],
  );
  if (ok !== 'delete') return;
  try {
    await store.deleteItem(item);
  } catch (err) {
    await alertDialog(saveErrorText(err));
    return;
  }
  state.items = state.items.filter((it) => it.id !== item.id);
  state.meta.lastChangeAt = new Date().toISOString();
  item.photoIds.forEach(forgetThumb);
  $('detailDialog').close();
  render();
  toast('削除しました');
});

// ---- 登録・編集 ----

let form = null; // { mode, baseId, photos: [{ id, url, record?, loading? }], removed: [], busy, dirty, token }
let formToken = 0;

function setupFormOptions() {
  const cat = $('fCategory');
  cat.append(new Option('なし', ''));
  for (const c of CATEGORIES) cat.append(new Option(`${c.emoji} ${c.label}`, c.id));
  const decade = $('fDecade');
  for (let y = MAX_YEAR - 80; y >= MIN_YEAR; y -= 10) decade.append(new Option(`${y}年代`, String(y)));
  for (let m = 1; m <= 12; m += 1) $('fMonth').append(new Option(String(m), String(m)));
  for (let d = 1; d <= 31; d += 1) $('fDay').append(new Option(String(d), String(d)));
}

const formEl = $('itemForm');
const radioValue = (name) => formEl.querySelector(`input[name="${name}"]:checked`)?.value;
const setRadio = (name, value) => {
  for (const r of formEl.querySelectorAll(`input[name="${name}"]`)) r.checked = r.value === value;
};

function updateFormVisibility() {
  const kind = radioValue('kind');
  $('dateField').hidden = kind !== 'done';
  $('noteLabel').textContent = kind === 'done' ? '感想・メモ' : 'メモ';
  $('fNote').placeholder = kind === 'done' ? 'どうだった？（あとからでも書けます）' : 'きっかけや、やってみたい理由など';
  const p = radioValue('precision');
  $('fDecade').hidden = p !== 'decade';
  $('fYearBox').hidden = !['year', 'month', 'day'].includes(p);
  $('fMonthBox').hidden = !['month', 'day'].includes(p);
  $('fDayBox').hidden = p !== 'day';
}

function fillDate(text) {
  const d = parseFuzzyDate(text) || { precision: 'none' };
  const now = new Date();
  setRadio('precision', d.precision);
  $('fDecade').value = String(Math.floor((d.year || now.getFullYear()) / 10) * 10);
  $('fYear').value = d.precision === 'none' || d.precision === 'decade' ? '' : String(d.year);
  $('fMonth').value = String(d.month || now.getMonth() + 1);
  $('fDay').value = String(d.day || now.getDate());
}

function readDate() {
  const precision = radioValue('precision') || 'none';
  return buildFuzzyDate({
    precision,
    year: precision === 'decade' ? $('fDecade').value : $('fYear').value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
    month: $('fMonth').value,
    day: $('fDay').value,
  });
}

function openForm(mode, item = null) {
  formToken += 1;
  form = { mode, baseId: item ? item.id : null, photos: [], removed: [], busy: 0, dirty: false, token: formToken };
  const kindDefault = mode === 'achieve' || (mode === 'new' && state.route === 'memories') ? 'done' : 'wish';
  $('formHeading').textContent = { new: '新しく登録', edit: '編集', achieve: '達成おめでとう！' }[mode];
  $('formSave').textContent = mode === 'achieve' ? '思い出に追加' : '保存';
  $('formError').hidden = true;
  $('photoStatus').textContent = '';
  $('fTitle').value = item ? item.title : '';
  setRadio('kind', mode === 'edit' ? item.kind : kindDefault);
  $('fCategory').value = item ? item.category : (state.filters[state.route]?.category || '').replace('none', '');
  $('fFavorite').checked = item ? item.favorite : false;
  $('fNote').value = item ? item.note : '';
  fillDate(mode === 'achieve' ? todayFuzzy() : item ? item.date : '');
  if (item) {
    form.photos = item.photoIds.map((id) => ({ id, url: null }));
    for (const p of form.photos) {
      const { token } = form;
      thumbUrl(p.id).then((url) => {
        if (!form || form.token !== token) return;
        p.url = url;
        renderFormPhotos();
      });
    }
  }
  updateFormVisibility();
  renderFormPhotos();
  $('formDialog').showModal();
  $('formDialog').querySelector('.sheet-body').scrollTop = 0;
  if (mode === 'new') $('fTitle').focus();
}

function renderFormPhotos() {
  const box = $('formPhotos');
  box.textContent = '';
  const n = form.photos.length;
  form.photos.forEach((p, i) => {
    const fp = el('div', `fp${p.loading ? ' fp-loading' : ''}`);
    if (p.loading) {
      fp.textContent = '縮小中…';
      box.append(fp);
      return;
    }
    if (p.url) {
      const img = el('img');
      img.alt = `写真${i + 1}`;
      img.src = p.url;
      img.dataset.cover = p.id;
      fp.append(img);
    }
    if (i === 0) fp.append(el('span', 'fp-cover', '代表'));
    const btn = (cls, text, label, action, disabled = false) => {
      const b = el('button', `fp-btn ${cls}`, text);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.dataset.action = action;
      b.dataset.id = p.id;
      b.disabled = disabled;
      return b;
    };
    fp.append(
      btn('fp-del', '✕', '写真を削除', 'del'),
      btn('fp-left', '◀', '前へ', 'left', i === 0 || form.photos[i - 1].loading),
      btn('fp-right', '▶', '後ろへ', 'right', i === n - 1 || form.photos[i + 1].loading),
    );
    box.append(fp);
  });
  $('photoHint').hidden = form.photos.filter((p) => !p.loading).length < 2;
}

$('formPhotos').addEventListener('click', (e) => {
  const target = e.target.closest('[data-action], [data-cover]');
  if (!target || !form) return;
  const id = target.dataset.id || target.dataset.cover;
  const i = form.photos.findIndex((p) => p.id === id);
  if (i < 0) return;
  const list = [...form.photos];
  const action = target.dataset.action || 'cover';
  if (action === 'del') {
    const [p] = list.splice(i, 1);
    if (p.record) URL.revokeObjectURL(p.url);
    else form.removed.push(p.id);
  } else if (action === 'left' && i > 0) {
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
  } else if (action === 'right' && i < list.length - 1) {
    [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else if (action === 'cover' && i > 0) {
    list.unshift(...list.splice(i, 1));
  } else {
    return;
  }
  form.photos = list;
  form.dirty = true;
  renderFormPhotos();
});

$('photoInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!form || !files.length) return;
  const current = form;
  current.dirty = true;
  const placeholders = files.map((_, i) => ({ id: `loading-${Date.now()}-${i}`, loading: true }));
  current.photos = [...current.photos, ...placeholders];
  current.busy += 1;
  $('photoStatus').textContent = `${files.length}枚の写真を縮小しています…`;
  renderFormPhotos();
  let failed = 0;
  // メモリを使いすぎないよう1枚ずつ処理する
  for (let i = 0; i < files.length; i += 1) {
    let next = null;
    try {
      const record = await processPhoto(files[i]);
      next = { id: record.id, record, url: URL.createObjectURL(new Blob([record.thumb], { type: record.thumbType })) };
    } catch {
      failed += 1;
    }
    if (form !== current) {
      if (next) URL.revokeObjectURL(next.url);
      continue;
    }
    current.photos = current.photos.flatMap((p) => (p === placeholders[i] ? (next ? [next] : []) : [p]));
    renderFormPhotos();
  }
  current.busy -= 1;
  if (form !== current) return;
  $('photoStatus').textContent = failed ? `${failed}枚の写真を読み込めませんでした（対応していない形式の可能性があります）` : '';
});

formEl.addEventListener('input', () => {
  if (form) form.dirty = true;
});
formEl.addEventListener('change', (e) => {
  if (e.target.id === 'photoInput') return;
  if (form) form.dirty = true;
  updateFormVisibility();
});

function showFormError(text) {
  $('formError').textContent = text;
  $('formError').hidden = false;
  $('formDialog').querySelector('.sheet-body').scrollTop = 0;
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form || form.saving) return;
  const current = form;
  if (current.busy) {
    showFormError('写真の縮小が終わるまで、少しお待ちください');
    return;
  }
  const kind = radioValue('kind') === 'done' ? 'done' : 'wish';
  const date = kind === 'done' ? readDate() : '';
  if (date === null) {
    showFormError(`日付を正しく入力してください（年は${MIN_YEAR}〜${MAX_YEAR}の4桁の数字）`);
    return;
  }
  const base = current.baseId ? getItem(current.baseId) : null;
  if (current.baseId && !base) {
    showFormError('この項目は削除されたため保存できません');
    return;
  }
  const item = buildItem({
    title: $('fTitle').value,
    kind,
    category: $('fCategory').value,
    favorite: $('fFavorite').checked,
    note: $('fNote').value,
    date,
    photoIds: current.photos.map((p) => p.id),
  }, base);
  if (!item) {
    showFormError('タイトルを入力してください');
    $('fTitle').focus();
    return;
  }
  current.saving = true;
  $('formSave').disabled = true;
  const addPhotos = current.photos.filter((p) => p.record).map((p) => p.record);
  try {
    await store.saveItem(item, { addPhotos, deletePhotoIds: current.removed });
  } catch (err) {
    // 入力内容はそのまま残し、もう一度保存できるようにする
    showFormError(`${saveErrorText(err)}\n入力した内容はそのまま残っています。`);
    return;
  } finally {
    current.saving = false;
    $('formSave').disabled = false;
  }
  replaceInState(item);
  state.meta.lastChangeAt = item.updatedAt;
  current.removed.forEach(forgetThumb);
  // 保存した新しい写真のサムネイルは、そのまま一覧で使う
  for (const p of current.photos) {
    if (p.record) thumbUrls.set(p.id, Promise.resolve(p.url));
  }
  current.photos = current.photos.map((p) => ({ id: p.id, url: p.url }));
  form = null;
  $('formDialog').close();
  render();
  if (state.detailId === item.id) renderDetail();
  if (current.mode === 'achieve') toast('おめでとうございます！思い出に追加しました');
  else if (current.mode === 'new') toast(item.kind === 'done' ? '思い出に登録しました' : 'やりたいことに登録しました', '開く', () => openDetail(item.id));
});

function discardForm() {
  if (form) {
    for (const p of form.photos) if (p.record) URL.revokeObjectURL(p.url);
  }
  form = null;
  $('formDialog').close();
}

async function cancelForm() {
  if (!form) return;
  if (form.dirty) {
    const r = await choiceDialog('入力した内容を破棄しますか？', [
      { label: '破棄する', value: 'discard', cls: 'danger' },
      { label: '編集を続ける', value: null },
    ]);
    if (r !== 'discard') return;
  }
  discardForm();
}

$('formCancel').addEventListener('click', cancelForm);
$('formDialog').addEventListener('cancel', (e) => {
  e.preventDefault();
  cancelForm();
});

$('newBtn').addEventListener('click', () => {
  if (state.ready) openForm('new');
});

// ---- ガチャ ----

function gachaPool() {
  const f = state.filters.wish;
  const filtered = filterItems(state.items, { status: 'wish', ...f });
  return filtered.length ? filtered : filterItems(state.items, { status: 'wish' });
}

function showGacha(item) {
  state.lastGachaId = item.id;
  $('gachaEmoji').textContent = categoryEmoji(item.category);
  $('gachaTitle').textContent = item.title;
}

function spinGacha() {
  const pool = gachaPool();
  const result = pickRandom(pool, state.lastGachaId);
  if (!result) return;
  const card = $('gachaCard');
  card.classList.remove('landed');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || pool.length < 2) {
    showGacha(result);
    return;
  }
  card.classList.add('spinning');
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    if (n < 9) {
      showGacha(pickRandom(pool, state.lastGachaId));
      return;
    }
    clearInterval(timer);
    showGacha(result);
    card.classList.remove('spinning');
    void card.offsetWidth; // アニメーションをやり直す
    card.classList.add('landed');
  }, 70);
}

$('gachaBtn').addEventListener('click', () => {
  if (!filterItems(state.items, { status: 'wish' }).length) {
    toast('やりたいことを登録するとガチャが引けます');
    return;
  }
  $('gachaDialog').showModal();
  spinGacha();
});
$('gachaAgain').addEventListener('click', spinGacha);
$('gachaOpen').addEventListener('click', () => {
  $('gachaDialog').close();
  if (state.lastGachaId) openDetail(state.lastGachaId);
});

// ---- 確認ダイアログ・トースト ----

let choiceResolve = null;

/** buttons: [{ label, value, cls }]。押したボタンの value（閉じたら null）を返す */
function choiceDialog(text, buttons) {
  const dlg = $('confirmDialog');
  if (choiceResolve) choiceResolve(null);
  $('confirmText').textContent = text;
  const box = $('confirmButtons');
  box.textContent = '';
  return new Promise((resolve) => {
    choiceResolve = resolve;
    for (const b of buttons) {
      const btn = el('button', b.value === null ? 'text-btn' : `wide-btn ${b.cls || ''}`, b.label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        choiceResolve = null;
        dlg.close();
        resolve(b.value);
      });
      box.append(btn);
    }
    dlg.showModal();
  });
}

$('confirmDialog').addEventListener('close', () => {
  if (choiceResolve) {
    const r = choiceResolve;
    choiceResolve = null;
    r(null);
  }
});

function alertDialog(text) {
  return choiceDialog(text, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
}

let toastTimer = 0;

function hideToast() {
  const t = $('toast');
  if (t.hidePopover && t.matches(':popover-open')) t.hidePopover();
  t.hidden = true;
}

function toast(text, actionLabel = '', action = null) {
  clearTimeout(toastTimer);
  const t = $('toast');
  $('toastText').textContent = text;
  const btn = $('toastAction');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel;
  btn.onclick = () => {
    hideToast();
    if (action) action();
  };
  t.hidden = false;
  // 開いているダイアログより手前に出す（popover 非対応の端末ではダイアログの裏になる）
  if (t.showPopover) {
    if (t.matches(':popover-open')) t.hidePopover();
    t.showPopover();
  }
  toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2500);
}

// ---- バックアップのお知らせ ----

function renderReminder() {
  const box = $('reminder');
  const { meta } = state;
  const snoozed = meta.snoozeUntil && Date.now() < Date.parse(meta.snoozeUntil);
  const show = state.ready && state.route !== 'settings' && !snoozed
    && needsBackupReminder({ ...meta, itemCount: state.items.length });
  box.hidden = !show;
  if (!show) return;
  $('reminderText').textContent = meta.lastBackupAt
    ? '最後のバックアップから1か月以上たちました。機種変更などに備えて、新しいバックアップを保存しておきましょう。'
    : 'まだバックアップがありません。記録と写真を守るため、バックアップを保存しておきましょう。';
}

$('reminderLater').addEventListener('click', async () => {
  const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  state.meta.snoozeUntil = until;
  renderReminder();
  try {
    await store.setMeta('snoozeUntil', until);
  } catch {
    // 次回また表示されるだけなので無視する
  }
});

// ---- 設定・バックアップ ----

function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function renderSettings() {
  $('settingsView').hidden = false;
  const { wish, done, archived } = countItems(state.items);
  const rows = [['やりたいこと', `${wish}件`], ['思い出', `${done}件`], ['保管中', `${archived}件`], ['写真', '…'], ['使用量', '…']];
  const dl = $('stats');
  const draw = () => {
    dl.textContent = '';
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
  };
  draw();
  $('lastBackup').textContent = state.meta.lastBackupAt
    ? `最後のバックアップ：${formatDateTime(state.meta.lastBackupAt)}`
    : 'まだバックアップしていません';

  const [photos, est, persisted] = await Promise.all([
    store.photoCount().catch(() => null),
    store.storageEstimate(),
    store.requestPersist(),
  ]);
  if (state.route !== 'settings') return;
  rows[3][1] = photos === null ? '-' : `${photos}枚`;
  rows[4][1] = est ? `${formatBytes(est.usage)}${est.quota ? ` / ${formatBytes(est.quota)}` : ''}` : '確認できません';
  draw();
  $('persistInfo').textContent = persisted === true
    ? 'このアプリのデータは、空き容量が減っても自動では削除されない設定になっています。'
    : persisted === false
      ? '端末の空き容量が少なくなると、ブラウザがデータを削除することがあります。こまめにバックアップしてください。'
      : '';
}

const pad2 = (n) => String(n).padStart(2, '0');

function backupFileName(now = new Date()) {
  return `jinsei-collection-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.zip`;
}

$('exportBtn').addEventListener('click', async () => {
  const btn = $('exportBtn');
  const msg = $('backupMsg');
  btn.disabled = true;
  $('exportReady').hidden = true;
  state.exportFile = null;
  msg.textContent = 'バックアップを作成しています…';
  try {
    const ids = state.items.flatMap((it) => it.photoIds);
    const photos = (await store.getPhotos(ids)).filter(Boolean);
    const found = new Set(photos.map((p) => p.id));
    // 写真が見つからない項目も、項目自体は必ずバックアップする
    const items = state.items.map((it) => ({ ...it, photoIds: it.photoIds.filter((id) => found.has(id)) }));
    const manifest = buildManifest(items, photos);
    const enc = new TextEncoder();
    const files = [{ name: BACKUP_FILE, data: enc.encode(JSON.stringify(manifest, null, 1)) }];
    manifest.photos.forEach((m, i) => {
      files.push({ name: m.file, data: new Uint8Array(photos[i].data) });
      files.push({ name: m.thumb, data: new Uint8Array(photos[i].thumb) });
    });
    const blob = new Blob(createZip(files), { type: 'application/zip' });
    state.exportFile = new File([blob], backupFileName(), { type: 'application/zip' });
    const missing = ids.length - photos.length;
    $('exportInfo').textContent = `項目${items.length}件・写真${photos.length}枚（${formatBytes(blob.size)}）のバックアップを作成しました。`
      + '「ファイルに保存する」を押し、「"ファイル"に保存」で iCloud Drive などに保存してください。'
      + (missing ? `\n※ 読み込めなかった写真が${missing}枚あります。` : '');
    $('exportReady').hidden = false;
    msg.textContent = '';
  } catch (err) {
    msg.textContent = `バックアップを作成できませんでした（${err.message || err}）`;
  } finally {
    btn.disabled = false;
  }
});

async function markBackedUp() {
  const now = new Date().toISOString();
  state.meta.lastBackupAt = now;
  try {
    await store.setMeta('lastBackupAt', now);
  } catch {
    // 記録できなくてもバックアップ自体は済んでいる
  }
  if (state.route === 'settings') render();
  $('backupMsg').textContent = 'バックアップを保存しました。';
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

$('saveZipBtn').addEventListener('click', async () => {
  const file = state.exportFile;
  if (!file) return;
  // iPhone では共有シートから「"ファイル"に保存」できる。使えない環境ではダウンロードする
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      await markBackedUp();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  downloadFile(file);
  await markBackedUp();
});

$('importBtn').addEventListener('click', () => $('importFile').click());

function copyBuffer(bytes) {
  return bytes.slice().buffer;
}

async function readBackupPhotos(zip, photos) {
  const out = [];
  for (const p of photos) {
    out.push({
      id: p.id,
      itemId: p.itemId,
      type: p.type,
      width: p.width,
      height: p.height,
      thumbType: p.thumbType,
      data: copyBuffer(await zip.read(p.file)),
      thumb: copyBuffer(await zip.read(p.thumb)),
    });
  }
  return out;
}

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const msg = $('backupMsg');
  msg.textContent = 'バックアップを確認しています…';
  let zip;
  let backup;
  try {
    zip = readZip(new Uint8Array(await file.arrayBuffer()));
    if (!zip.has(BACKUP_FILE)) throw new Error('人生コレクションのバックアップではありません');
    backup = parseManifest(new TextDecoder().decode(await zip.read(BACKUP_FILE)), zip.has);
  } catch (err) {
    msg.textContent = `復元できません：${err.message || err}`;
    return;
  }
  msg.textContent = '';
  const when = backup.exportedAt ? `${formatDateTime(backup.exportedAt)} に作成した` : '';
  const summary = `${when}バックアップ\n項目${backup.items.length}件・写真${backup.photos.length}枚`;
  let mode;
  if (!state.items.length) {
    mode = await choiceDialog(`${summary}\nを復元します。`, [
      { label: '復元する', value: 'replace', cls: 'primary' },
      { label: 'キャンセル', value: null },
    ]);
  } else {
    mode = await choiceDialog(`${summary}\n\nいまこの端末にある項目（${state.items.length}件）をどうしますか？`, [
      { label: '統合する（同じ項目は新しい方を残す）', value: 'merge', cls: 'primary' },
      { label: '置き換える（いまのデータは消えます）', value: 'replace', cls: 'danger' },
      { label: 'キャンセル', value: null },
    ]);
    if (mode === 'replace') {
      const sure = await choiceDialog('いまこの端末にある項目と写真は、すべて消えてバックアップの内容に置き換わります。よろしいですか？', [
        { label: '置き換える', value: 'yes', cls: 'danger' },
        { label: 'キャンセル', value: null },
      ]);
      if (sure !== 'yes') mode = null;
    }
  }
  if (!mode) return;

  msg.textContent = '復元しています…';
  $('importBtn').disabled = true;
  try {
    if (mode === 'replace') {
      await store.replaceAll(backup.items, await readBackupPhotos(zip, backup.photos));
    } else {
      const plan = planMerge(state.items, backup.items, backup.photos);
      await store.applyMerge({ ...plan, putPhotos: await readBackupPhotos(zip, plan.putPhotos) });
    }
    const { items } = await store.loadItems();
    state.items = items;
    state.meta.lastChangeAt = new Date().toISOString();
    forgetAllThumbs();
    msg.textContent = `復元しました（項目${items.length}件）。`;
    render();
  } catch (err) {
    msg.textContent = store.isQuotaError(err)
      ? '端末の空き容量が足りないため復元できませんでした。データは復元前のままです。'
      : `復元できませんでした（${err.message || err}）。データは復元前のままです。`;
  } finally {
    $('importBtn').disabled = false;
  }
});

// ---- 起動 ----

function bindEvents() {
  window.addEventListener('hashchange', onRoute);
  for (const id of ['wishList', 'cardGrid', 'timeline', 'allList', 'archivedList']) $(id).addEventListener('click', onListClick);
  $('searchInput').addEventListener('input', (e) => {
    const f = currentFilter();
    if (!f) return;
    f.query = e.target.value;
    render();
  });
  $('viewToggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.memMode = b.dataset.mode;
    writePref(VIEW_MODE_KEY, state.memMode);
    render();
  });
  for (const d of document.querySelectorAll('dialog')) {
    for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  }
}

async function init() {
  setupFormOptions();
  bindEvents();
  onRoute();
  try {
    const { items, broken } = await store.loadItems();
    state.items = items;
    const [lastBackupAt, lastChangeAt, snoozeUntil] = await Promise.all(['lastBackupAt', 'lastChangeAt', 'snoozeUntil'].map((k) => store.getMeta(k)));
    state.meta = { lastBackupAt, lastChangeAt, snoozeUntil };
    state.ready = true;
    syncFilterBar();
    render();
    if (broken) toast(`読み込めない項目が${broken}件ありました（データは消さずに残しています）`);
  } catch (err) {
    showEmpty(`データを読み込めませんでした。\n${err.message || err}\n\nプライベートブラウズでは保存できません。通常のタブかホーム画面のアプリで開いてください。`);
    $('newBtn').disabled = true;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
