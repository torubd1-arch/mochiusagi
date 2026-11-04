// 画面の描画と操作
import {
  toDateKey, fromDateKey, isDateKey, addDays, weekStart, monthMatrix, tasksForDate, createTask,
  completedDateOf, buildBackup, parseBackup,
} from './logic.js';
import { loadTasks, saveTasks } from './store.js';

const APP_VERSION = '1.1.0';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const $ = (id) => document.getElementById(id);

const state = {
  tasks: loadTasks(),
  today: toDateKey(new Date()),
  selected: null,
  calMonth: null, // 月間カレンダーで表示中の月の1日
  editingId: null,
};
state.selected = state.today;

function persist() {
  if (!saveTasks(state.tasks)) {
    alert('保存できませんでした。端末の空き容量やプライベートブラウズ設定を確認してください。');
  }
}

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function shortDate(key) {
  const d = fromDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

function weekdayClass(key) {
  const wd = fromDateKey(key).getDay();
  return wd === 0 ? ' sun' : wd === 6 ? ' sat' : '';
}

/** 登録日にタスクがある日付（週・カレンダーの点表示用） */
function registeredDates() {
  return new Set(state.tasks.map((t) => t.date));
}

function selectDate(key) {
  state.selected = key;
  render();
  $('main').scrollTop = 0;
}

// ---- 描画 ----

function render() {
  const sel = fromDateKey(state.selected);
  $('monthLabel').textContent = `${sel.getFullYear()}年${sel.getMonth() + 1}月`;
  $('todayBtn').classList.toggle('is-hidden', state.selected === state.today);
  renderWeek();
  renderList();
}

function renderWeek() {
  const week = $('week');
  const start = weekStart(state.selected);
  const marked = registeredDates();
  week.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const key = addDays(start, i);
    const btn = el('button', `day${weekdayClass(key)}`);
    btn.type = 'button';
    btn.dataset.date = key;
    if (key === state.today) btn.classList.add('is-today');
    if (key === state.selected) {
      btn.classList.add('is-selected');
      btn.setAttribute('aria-current', 'date');
    }
    if (marked.has(key)) btn.classList.add('has');
    btn.append(el('span', 'wd', WEEKDAYS[i]), el('span', 'num', String(fromDateKey(key).getDate())), el('span', 'dot'));
    btn.setAttribute('aria-label', shortDate(key));
    week.append(btn);
  }
}

function renderList() {
  const sel = state.selected;
  const d = fromDateKey(sel);
  const { open, done } = tasksForDate(state.tasks, sel, state.today);

  $('dayTitle').textContent = `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
  const diff = Math.round((d - fromDateKey(state.today)) / 86400000);
  $('dayTag').textContent = diff === 0 ? '今日' : diff === 1 ? '明日' : diff === -1 ? '昨日' : '';
  $('dayCount').textContent = open.length + done.length > 0 ? `残り ${open.length} 件` : '';
  $('dayNote').hidden = sel <= state.today;

  $('openList').replaceChildren(...open.map((t) => taskItem(t, sel)));
  $('doneList').replaceChildren(...done.map((t) => taskItem(t, sel)));

  const empty = $('empty');
  empty.hidden = open.length > 0;
  empty.textContent = done.length > 0 ? 'すべて完了しました' : 'タスクはありません';
}

function taskItem(t, sel) {
  const li = el('li', 'task');
  li.dataset.id = t.id;

  const label = el('label', 'check');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!t.completedAt;
  cb.setAttribute('aria-label', `${t.text} を${t.completedAt ? '未完了に戻す' : '完了にする'}`);
  label.append(cb, el('span', 'box'));

  const body = el('button', 'task-body');
  body.type = 'button';
  body.append(el('span', 'task-text', t.text));
  const meta = [];
  if (t.date < sel) meta.push(`${shortDate(t.date)} 登録`);
  const doneOn = completedDateOf(t);
  if (doneOn && doneOn !== sel) meta.push(`${shortDate(doneOn)} 完了`);
  if (meta.length) body.append(el('span', 'task-meta', meta.join(' ・ ')));

  // 左スワイプで行がずれ、下に隠れた削除ボタンが見える
  const del = el('button', 'task-del', '削除');
  del.type = 'button';
  const row = el('div', 'task-row');
  row.append(label, body);
  li.append(del, row);
  return li;
}

function renderCalendar() {
  const m = fromDateKey(state.calMonth);
  const year = m.getFullYear();
  const month = m.getMonth();
  $('calTitle').textContent = `${year}年${month + 1}月`;
  const marked = registeredDates();
  const grid = $('calGrid');
  grid.replaceChildren(...WEEKDAYS.map((w, i) => el('span', `cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, w)));
  for (const key of monthMatrix(year, month)) {
    const d = fromDateKey(key);
    const btn = el('button', `cal-day${weekdayClass(key)}`);
    btn.type = 'button';
    btn.dataset.date = key;
    if (d.getMonth() !== month) btn.classList.add('is-out');
    if (key === state.today) btn.classList.add('is-today');
    if (key === state.selected) btn.classList.add('is-selected');
    if (marked.has(key)) btn.classList.add('has');
    btn.setAttribute('aria-label', shortDate(key));
    btn.append(el('span', 'num', String(d.getDate())), el('span', 'dot'));
    grid.append(btn);
  }
}

// ---- 操作 ----

function addTask(text) {
  const t = createTask(text, state.selected);
  state.tasks.push(t);
  persist();
  render();
  const li = $('openList').querySelector(`[data-id="${t.id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

function setCompleted(id, completed) {
  const t = findTask(id);
  if (!t) return;
  t.completedAt = completed ? new Date().toISOString() : null;
  persist();
  render();
}

function openEditor(id) {
  const t = findTask(id);
  if (!t) return;
  state.editingId = id;
  $('editText').value = t.text;
  $('editDate').value = t.date;
  const info = [`作成：${new Date(t.createdAt).toLocaleString('ja-JP')}`];
  if (t.completedAt) info.push(`完了：${new Date(t.completedAt).toLocaleString('ja-JP')}`);
  $('editInfo').textContent = info.join('\n');
  $('editDialog').showModal();
}

function saveEdit() {
  const t = findTask(state.editingId);
  if (!t) return;
  const text = $('editText').value.trim();
  const date = $('editDate').value;
  if (!text) {
    alert('タスクの内容を入力してください。');
    return;
  }
  if (!isDateKey(date)) {
    alert('日付を選んでください。');
    return;
  }
  t.text = text;
  t.date = date;
  persist();
  $('editDialog').close();
  render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist();
  render();
}

function deleteEditing() {
  const t = findTask(state.editingId);
  if (!t || !confirm(`「${t.text}」を削除しますか？`)) return;
  $('editDialog').close();
  deleteTask(t.id);
}

function openCalendar() {
  const d = fromDateKey(state.selected);
  state.calMonth = toDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
  renderCalendar();
  $('calDialog').showModal();
}

function shiftCalendar(months) {
  const d = fromDateKey(state.calMonth);
  state.calMonth = toDateKey(new Date(d.getFullYear(), d.getMonth() + months, 1));
  renderCalendar();
}

function openMenu() {
  const open = state.tasks.filter((t) => !t.completedAt).length;
  $('menuInfo').textContent = `保存中のタスク：${state.tasks.length} 件（未完了 ${open} 件）\nデータはこの端末のブラウザ内に保存されます。\nバージョン ${APP_VERSION}`;
  $('menuDialog').showModal();
}

function backupFileName() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `taskkun-backup-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}.json`;
}

async function exportBackup() {
  const json = JSON.stringify(buildBackup(state.tasks), null, 2);
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
  let tasks;
  try {
    tasks = parseBackup(await file.text());
  } catch (err) {
    alert(`復元できませんでした。\n${err.message}`);
    return;
  }
  if (!confirm(`バックアップの ${tasks.length} 件で、現在のデータ（${state.tasks.length} 件）を置き換えます。よろしいですか？`)) return;
  state.tasks = tasks;
  persist();
  $('menuDialog').close();
  selectDate(state.today);
  alert(`${tasks.length} 件のタスクを復元しました。`);
}

/** 日付が変わっていたら「今日」を更新する（開きっぱなし・バックグラウンド復帰の両方に対応） */
function checkDateChange() {
  const now = toDateKey(new Date());
  if (now === state.today) return;
  if (state.selected === state.today) state.selected = now;
  state.today = now;
  render();
}

/** 横スワイプを検出する。onSwipe(dx, 開始時の要素) */
function bindSwipe(target, onSwipe) {
  let start = null;
  target.addEventListener('touchstart', (e) => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, el: e.target } : null;
  }, { passive: true });
  target.addEventListener('touchend', (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const el = start.el;
    start = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    onSwipe(dx, el);
  }, { passive: true });
}

function closeSwipedTask() {
  const open = document.querySelector('.task.swiped');
  if (open) open.classList.remove('swiped');
  return !!open;
}

/** 一覧のスワイプ：タスク行の上なら削除ボタンの出し入れ、それ以外は日付移動 */
function onMainSwipe(dx, target) {
  const li = target.closest('.task');
  if (!li) {
    selectDate(addDays(state.selected, dx < 0 ? 1 : -1));
    return;
  }
  const wasOpen = li.classList.contains('swiped');
  closeSwipedTask();
  if (dx < 0 && !wasOpen) li.classList.add('swiped');
}

function bindEvents() {
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('addInput');
    const text = input.value.trim();
    if (!text) return;
    addTask(text);
    input.value = ''; // フォーカスは残し、続けて入力できるようにする
  });

  $('week').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (btn) selectDate(btn.dataset.date);
  });

  for (const list of [$('openList'), $('doneList')]) {
    list.addEventListener('change', (e) => {
      if (e.target.type !== 'checkbox') return;
      setCompleted(e.target.closest('.task').dataset.id, e.target.checked);
    });
    list.addEventListener('click', (e) => {
      const del = e.target.closest('.task-del');
      if (del) {
        deleteTask(del.closest('.task').dataset.id);
        return;
      }
      const body = e.target.closest('.task-body');
      if (body) openEditor(body.closest('.task').dataset.id);
    });
  }

  $('todayBtn').addEventListener('click', () => selectDate(state.today));
  $('monthLabel').addEventListener('click', openCalendar);
  $('calBtn').addEventListener('click', openCalendar);
  $('menuBtn').addEventListener('click', openMenu);

  $('calPrev').addEventListener('click', () => shiftCalendar(-1));
  $('calNext').addEventListener('click', () => shiftCalendar(1));
  $('calToday').addEventListener('click', () => {
    $('calDialog').close();
    selectDate(state.today);
  });
  $('calGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    $('calDialog').close();
    selectDate(btn.dataset.date);
  });

  $('editForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveEdit();
  });
  $('editDelete').addEventListener('click', deleteEditing);

  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });

  // ダイアログ：閉じるボタンと背景タップで閉じる
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  }

  // 削除ボタンが出ている間は、削除ボタン以外のタップで閉じるだけにする（誤操作防止）
  document.addEventListener('click', (e) => {
    if (e.target.closest('.task-del') || !document.querySelector('.task.swiped')) return;
    closeSwipedTask();
    if (e.target.closest('#main')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  bindSwipe($('main'), onMainSwipe);
  bindSwipe($('week'), (dx) => selectDate(addDays(state.selected, dx < 0 ? 7 : -7)));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDateChange();
  });
  setInterval(checkDateChange, 30000);
}

function isIdle() {
  return !$('addInput').value && !document.querySelector('dialog[open]');
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  // 新しい版が有効になったら、入力中でなければ読み直す（入力中なら次回起動時に反映）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && isIdle()) location.reload();
  });
}

bindEvents();
render();
setupServiceWorker();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
