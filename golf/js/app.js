// 画面の描画と操作
import {
  CATEGORIES, COLORS, DEFAULT_COLOR, categoryLabel, normalizeUrl, importantNotes, notesInCategory, masteredNotes,
  needsRelease, saveNote, setImportant, setMastered, deleteNote, reorderCategory, buildBackup, parseBackup,
} from './logic.js';
import { loadNotes, saveNotes } from './store.js';

const APP_VERSION = '1.2.0';
const LONG_PRESS_MS = 350;
const DRAG_SCROLL_EDGE = 70; // 画面の上下端からこの距離に指が入ると自動スクロールする
const $ = (id) => document.getElementById(id);

const state = {
  notes: loadNotes(),
  route: { name: 'home' },
  form: null, // 編集中の { id, releaseId, initial }
  onRelease: null, // 上限ダイアログで解除先を選んだときの処理
};
let toastTimer = null;
let ignoreClickUntil = 0; // ドラッグ直後のタップを無視する

/** 保存してから状態を更新する。失敗したら画面は変えず false */
function commit(notes) {
  if (!saveNotes(notes)) {
    alert('保存できませんでした。端末の空き容量やプライベートブラウズ設定を確認してください。');
    return false;
  }
  state.notes = notes;
  render();
  return true;
}

function findNote(id) {
  return state.notes.find((n) => n.id === id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, text, data) {
  const btn = el('button', className, text);
  btn.type = 'button';
  Object.assign(btn.dataset, data);
  return btn;
}

function showToast(message) {
  const toast = $('toast');
  // 開いているダイアログの上に出すため、ダイアログの中へ移す
  (document.querySelector('dialog[open]') || document.body).append(toast);
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ---- 描画 ----

function parseRoute() {
  const hash = location.hash;
  if (hash === '#/settings') return { name: 'settings' };
  const m = hash.match(/^#\/category\/(.+)$/);
  if (m && categoryLabel(m[1])) return { name: 'category', category: m[1] };
  return { name: 'home' };
}

function render() {
  const { name, category } = state.route;
  $('homeView').hidden = name !== 'home';
  $('categoryView').hidden = name !== 'category';
  $('settingsView').hidden = name !== 'settings';
  $('backLink').hidden = name === 'home';
  $('pageTitle').textContent = name === 'home' ? 'ゴルフメモ' : name === 'settings' ? '設定' : categoryLabel(category);
  if (name === 'home') renderHome();
  if (name === 'category') renderCategory(category);
  if (name === 'settings') renderSettings();
}

function renderHome() {
  const points = importantNotes(state.notes);
  $('points').replaceChildren(...points.map(pointCard));
  $('pointsEmpty').hidden = points.length > 0;
  $('categories').replaceChildren(...CATEGORIES.map((c) => {
    const link = el('a', 'category');
    link.href = `#/category/${c.id}`;
    link.append(el('span', 'category-name', c.label), el('span', 'category-count', String(notesInCategory(state.notes, c.id).length)));
    return link;
  }));
}

function pointCard(note) {
  const card = el('article', `point bg-${note.color}`);
  card.dataset.edit = note.id;
  card.append(el('p', 'point-cat', categoryLabel(note.category)));
  const title = el('h3', 'point-title');
  title.append(button('point-title-btn', note.title, { edit: note.id }));
  card.append(title);
  if (note.memo) card.append(el('p', 'point-memo', note.memo));
  if (note.urls.length) card.append(videoLinks(note.urls));
  return card;
}

function videoLinks(urls) {
  const wrap = el('div', 'videos');
  urls.forEach((url) => {
    const row = el('div', 'video');
    const copy = button('video-btn', 'コピー', { copyUrl: url });
    copy.setAttribute('aria-label', `${url} をコピー`);
    const open = button('video-btn', '開く', { openUrl: url });
    open.setAttribute('aria-label', `${url} をブラウザで開く`);
    row.append(el('span', 'video-url', url.replace(/^https:\/\//, '')), copy, open);
    wrap.append(row);
  });
  return wrap;
}

async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Clipboard API が使えない環境向け
    const area = el('textarea');
    area.value = url;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, url.length);
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) {
      alert(`コピーできませんでした。\n${url}`);
      return;
    }
  }
  showToast('URLをコピーしました');
}

function openInBrowser(url) {
  // ホーム画面のアプリからは、アプリ内の簡易表示ではなく Safari で開く（iOS 17 以降の x-safari- スキーム）
  if (navigator.standalone) {
    location.href = `x-safari-${url}`;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function renderCategory(category) {
  const notes = notesInCategory(state.notes, category);
  $('noteList').replaceChildren(...notes.map(noteRow));
  $('categoryEmpty').hidden = notes.length > 0;
  $('dragHint').hidden = notes.length < 2;
}

function noteRow(note) {
  const li = el('li', `note bg-${note.color}`);
  li.dataset.id = note.id;
  const body = button('note-body', null, { edit: note.id });
  body.append(el('span', 'note-title', note.title));
  if (note.memo) body.append(el('span', 'note-memo', note.memo));

  const star = button(`note-action star${note.important ? ' is-on' : ''}`, note.important ? '★' : '☆', { star: note.id });
  star.setAttribute('aria-label', `${note.title} を最重要${note.important ? 'から解除' : 'に登録'}`);
  star.setAttribute('aria-pressed', String(note.important));
  const master = button('note-action master', '習得', { master: note.id });
  master.setAttribute('aria-label', `${note.title} を習得済みにする`);
  li.append(body, star, master);
  return li;
}

function renderSettings() {
  const mastered = masteredNotes(state.notes);
  $('masteredList').replaceChildren(...mastered.map((note) => {
    const li = el('li', `note bg-${note.color}`);
    const body = button('note-body', null, { edit: note.id });
    body.append(el('span', 'note-cat', categoryLabel(note.category)), el('span', 'note-title', note.title));
    li.append(body, button('note-action restore', '戻す', { restore: note.id }));
    return li;
  }));
  $('masteredEmpty').hidden = mastered.length > 0;
  $('settingsInfo').textContent = `保存中の注意点：${state.notes.length} 件\nデータはこの端末のブラウザ内に保存されます。Safari とホーム画面のアプリでは保存先が別になるため、ホーム画面のアプリで使ってください。\nバージョン ${APP_VERSION}`;
}

// ---- 最重要・習得済み ----

/** 上限のとき、解除する注意点を選んでもらう。onPick(解除するid) */
function askRelease(excludeId, onPick) {
  const others = importantNotes(state.notes).filter((n) => n.id !== excludeId);
  state.onRelease = onPick;
  $('limitList').replaceChildren(...others.map((n) => button('limit-item', n.title, { release: n.id })));
  $('limitDialog').showModal();
}

function toggleImportant(id) {
  const note = findNote(id);
  if (note.important) {
    commit(setImportant(state.notes, id, false));
    return;
  }
  if (needsRelease(state.notes, id)) {
    askRelease(id, (releaseId) => commit(setImportant(state.notes, id, true, { releaseId })));
    return;
  }
  commit(setImportant(state.notes, id, true));
}

function markMastered(id) {
  if (commit(setMastered(state.notes, id, true))) showToast('習得済みにしました（設定から戻せます）');
}

function restoreNote(id) {
  if (commit(setMastered(state.notes, id, false))) showToast(`「${categoryLabel(findNote(id).category)}」に戻しました`);
}

// ---- 登録・編集 ----

function addUrlRow(value = '') {
  const row = el('div', 'url-row');
  const input = el('input');
  input.type = 'url';
  input.inputMode = 'url';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.placeholder = 'https://';
  input.value = value;
  input.setAttribute('aria-label', '参考動画URL');
  const copy = button('url-btn', 'コピー', { urlAction: 'copy' });
  copy.setAttribute('aria-label', 'このURLをコピー');
  const open = button('url-btn', '開く', { urlAction: 'open' });
  open.setAttribute('aria-label', 'このURLをブラウザで開く');
  const remove = button('url-remove', '×', { removeUrl: '' });
  remove.setAttribute('aria-label', 'このURLを取り除く');
  row.append(input, copy, open, remove);
  $('urlList').append(row);
  return input;
}

/** 入力欄の URL を、保存時と同じ検証を通した形で返す。空や不正なら案内して null */
function urlOfRow(row) {
  const text = row.querySelector('input').value.trim();
  if (!text) {
    showToast('URLを入力してください');
    return null;
  }
  const url = normalizeUrl(text);
  if (!url) alert(`動画URLを確認してください。\n${text}\n（https から始まるURLを入力してください）`);
  return url;
}

function readForm() {
  const category = document.querySelector('input[name="category"]:checked');
  const color = document.querySelector('input[name="color"]:checked');
  return {
    title: $('fieldTitle').value,
    category: category ? category.value : '',
    color: color ? color.value : DEFAULT_COLOR,
    memo: $('fieldMemo').value,
    urlTexts: [...$('urlList').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
    important: $('fieldImportant').checked,
    mastered: $('fieldMastered').checked,
  };
}

function setRelease(id) {
  state.form.releaseId = id;
  const note = id ? findNote(id) : null;
  $('releaseHint').hidden = !note;
  $('releaseHint').textContent = note ? `保存すると「${note.title}」の最重要を解除します` : '';
}

function openForm(id, category = '') {
  const note = id ? findNote(id) : null;
  $('formTitle').textContent = note ? '編集' : '新規登録';
  $('fieldTitle').value = note ? note.title : '';
  $('fieldMemo').value = note ? note.memo : '';
  $('fieldImportant').checked = !!note && note.important;
  $('fieldMastered').checked = !!note && note.mastered;
  $('fieldImportant').disabled = !!note && note.mastered;
  $('formDelete').hidden = !note;
  const selected = note ? note.category : category;
  for (const radio of document.querySelectorAll('input[name="category"]')) radio.checked = radio.value === selected;
  const color = note ? note.color : DEFAULT_COLOR;
  for (const radio of document.querySelectorAll('input[name="color"]')) radio.checked = radio.value === color;
  $('urlList').replaceChildren();
  (note && note.urls.length ? note.urls : ['']).forEach((url) => addUrlRow(url));
  state.form = { id, releaseId: null, initial: '' };
  setRelease(null);
  state.form.initial = JSON.stringify(readForm());
  $('formDialog').showModal();
  $('formDialog').querySelector('.sheet-body').scrollTop = 0;
}

function formIsDirty() {
  return JSON.stringify(readForm()) !== state.form.initial;
}

function closeForm() {
  if (formIsDirty() && !confirm('入力した内容を破棄しますか？')) return;
  $('formDialog').close();
}

function submitForm() {
  const { id, releaseId } = state.form;
  const { title, category, color, memo, urlTexts, important, mastered } = readForm();
  if (!title.trim()) {
    alert('タイトルを入力してください。');
    return;
  }
  if (!category) {
    alert('カテゴリを選んでください。');
    return;
  }
  const urls = urlTexts.map(normalizeUrl);
  const bad = urlTexts.find((_, i) => !urls[i]);
  if (bad) {
    alert(`動画URLを確認してください。\n${bad}\n（https から始まるURLを入力してください）`);
    return;
  }
  const next = saveNote(state.notes, { id, title, category, color, memo, urls: [...new Set(urls)], important, mastered }, { releaseId });
  if (!next) {
    alert('最重要ポイントは3件までです。');
    return;
  }
  if (commit(next)) $('formDialog').close();
}

function deleteFromForm() {
  const note = findNote(state.form.id);
  if (!note || !confirm(`「${note.title}」を削除しますか？\nこの操作は取り消せません。`)) return;
  if (commit(deleteNote(state.notes, note.id))) $('formDialog').close();
}

function onImportantChange() {
  const input = $('fieldImportant');
  if (!input.checked) {
    setRelease(null);
    return;
  }
  if (!needsRelease(state.notes, state.form.id)) return;
  input.checked = false;
  askRelease(state.form.id, (releaseId) => {
    input.checked = true;
    setRelease(releaseId);
  });
}

function onMasteredChange() {
  const mastered = $('fieldMastered').checked;
  const input = $('fieldImportant');
  input.disabled = mastered;
  if (mastered) {
    input.checked = false;
    setRelease(null);
  }
}

// ---- バックアップ ----

function backupFileName() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `golfmemo-backup-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}.json`;
}

async function exportBackup() {
  const json = JSON.stringify(buildBackup(state.notes), null, 2);
  const file = new File([json], backupFileName(), { type: 'application/json' });
  // iPhone では共有シートから「"ファイル"に保存」できる
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importBackup(file) {
  let notes;
  try {
    notes = parseBackup(await file.text());
  } catch (err) {
    alert(`復元できませんでした。現在のデータは変更していません。\n${err.message}`);
    return;
  }
  if (!confirm(`バックアップの ${notes.length} 件で、現在のデータ（${state.notes.length} 件）を置き換えます。よろしいですか？`)) return;
  if (commit(notes)) alert(`${notes.length} 件の注意点を復元しました。`);
}

// ---- 長押しドラッグでの並び替え ----

/** 指の位置に合わせて行を入れ替える。タッチ中の要素を DOM 上で動かすと iOS で追跡が切れるので、隣の行を動かす */
function placeDragged(list, drag) {
  const { item } = drag;
  const middle = (node) => {
    const r = node.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  while (item.nextElementSibling && drag.y > middle(item.nextElementSibling)) {
    list.insertBefore(item.nextElementSibling, item);
  }
  while (item.previousElementSibling && drag.y < middle(item.previousElementSibling)) {
    list.insertBefore(item.previousElementSibling, item.nextElementSibling);
  }
  item.style.transform = '';
  item.style.transform = `translateY(${drag.y - drag.grab - item.getBoundingClientRect().top}px)`;
}

function bindDrag(list) {
  let press = null; // 長押し待ち
  let drag = null; // ドラッグ中

  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  const autoScroll = () => {
    if (!drag) return;
    const main = $('main');
    const box = main.getBoundingClientRect();
    const speed = drag.y < box.top + DRAG_SCROLL_EDGE ? -6 : drag.y > box.bottom - DRAG_SCROLL_EDGE ? 6 : 0;
    if (speed) {
      main.scrollTop += speed;
      placeDragged(list, drag);
    }
    requestAnimationFrame(autoScroll);
  };

  const finishDrag = () => {
    const { item } = drag;
    drag = null;
    item.classList.remove('is-dragging');
    item.style.transform = '';
    list.classList.remove('is-sorting');
    ignoreClickUntil = Date.now() + 400;
    const ids = [...list.children].map((li) => li.dataset.id);
    commit(reorderCategory(state.notes, state.route.category, ids));
  };

  list.addEventListener('touchstart', (e) => {
    cancelPress();
    const item = e.target.closest('.note');
    if (!item || e.touches.length !== 1 || e.target.closest('.note-action')) return;
    const { clientX: x, clientY: y } = e.touches[0];
    press = {
      x,
      y,
      timer: setTimeout(() => {
        press = null;
        drag = { item, y, grab: y - item.getBoundingClientRect().top };
        item.classList.add('is-dragging');
        list.classList.add('is-sorting');
        requestAnimationFrame(autoScroll);
      }, LONG_PRESS_MS),
    };
  }, { passive: true });

  // ドラッグ中はスクロールを止めるため passive にしない
  list.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (drag) {
      e.preventDefault();
      drag.y = touch.clientY;
      placeDragged(list, drag);
    } else if (press && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) {
      cancelPress();
    }
  }, { passive: false });

  const onTouchEnd = (e) => {
    cancelPress();
    if (!drag) return;
    if (e.cancelable) e.preventDefault();
    finishDrag();
  };
  list.addEventListener('touchend', onTouchEnd);
  list.addEventListener('touchcancel', onTouchEnd);
  list.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- イベント ----

function onMainClick(e) {
  if (Date.now() < ignoreClickUntil) return;
  const target = e.target.closest('[data-copy-url],[data-open-url],.video,[data-star],[data-master],[data-restore],[data-edit]');
  if (!target) return;
  const { copyUrl: copy, openUrl: open, star, master, restore, edit } = target.dataset;
  if (copy) copyUrl(copy);
  else if (open) openInBrowser(open);
  else if (target.classList.contains('video')) return; // URL の文字部分では編集を開かない
  else if (star) toggleImportant(star);
  else if (master) markMastered(master);
  else if (restore) restoreNote(restore);
  else openForm(edit);
}

function bindEvents() {
  window.addEventListener('hashchange', () => {
    state.route = parseRoute();
    render();
    $('main').scrollTop = 0;
  });

  $('newBtn').addEventListener('click', () => openForm(null, state.route.category));
  $('main').addEventListener('click', onMainClick);
  bindDrag($('noteList'));

  $('noteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm();
  });
  $('formCancel').addEventListener('click', closeForm);
  $('formDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeForm();
  });
  $('formDelete').addEventListener('click', deleteFromForm);
  $('fieldImportant').addEventListener('change', onImportantChange);
  $('fieldMastered').addEventListener('change', onMasteredChange);
  $('addUrl').addEventListener('click', () => addUrlRow().focus());
  $('urlList').addEventListener('click', (e) => {
    const action = e.target.closest('[data-url-action]');
    if (action) {
      const url = urlOfRow(action.closest('.url-row'));
      if (url) (action.dataset.urlAction === 'copy' ? copyUrl : openInBrowser)(url);
      return;
    }
    const remove = e.target.closest('[data-remove-url]');
    if (!remove) return;
    remove.closest('.url-row').remove();
    if (!$('urlList').children.length) addUrlRow();
  });
  // 上の1行に入力したあとキーボードの「次へ」で保存されないようにする
  $('fieldTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  $('limitList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-release]');
    if (!item) return;
    $('limitDialog').close();
    state.onRelease(item.dataset.release);
  });
  const limit = $('limitDialog');
  limit.addEventListener('click', (e) => {
    if (e.target === limit || e.target.closest('[data-close]')) limit.close();
  });

  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
}

function radio(name, value) {
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  return input;
}

function setupChoices() {
  $('fieldCategory').replaceChildren(...CATEGORIES.map((c) => {
    const label = el('label', 'choice');
    label.append(radio('category', c.id), el('span', null, c.label));
    return label;
  }));
  $('fieldColor').replaceChildren(...COLORS.map((c) => {
    const label = el('label', 'swatch');
    const input = radio('color', c.id);
    input.setAttribute('aria-label', c.label);
    label.append(input, el('span', `swatch-dot bg-${c.id}`));
    return label;
  }));
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  // 新しい版が有効になったら、入力中でなければ読み直す（入力中なら次回起動時に反映）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !document.querySelector('dialog[open]')) location.reload();
  });
}

setupChoices();
bindEvents();
state.route = parseRoute();
render();
setupServiceWorker();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
