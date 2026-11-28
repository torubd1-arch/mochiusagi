// 日付・タスク表示の純粋ロジック（DOM に依存しない。tests/ から直接テストする）
// 日付は端末のローカル日付を 'YYYY-MM-DD' 文字列で扱う。文字列のまま大小比較できる。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return toDateKey(fromDateKey(value)) === value;
}

export function addDays(key, n) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** その週の日曜日 */
export function weekStart(key) {
  return addDays(key, -fromDateKey(key).getDay());
}

/** 月間カレンダー用の日付（日曜始まり、前後月の日を含む週単位） */
export function monthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const start = addDays(toDateKey(first), -first.getDay());
  const count = Math.ceil((first.getDay() + days) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function completedDateOf(task) {
  return task.completedAt ? toDateKey(new Date(task.completedAt)) : null;
}

/** 日付ごとの完了件数（カレンダー表示用）。実際に完了にした日で数え、着手済は含めない */
export function doneCountByDate(tasks) {
  const counts = new Map();
  for (const t of tasks) {
    const key = completedDateOf(t);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * タスクが一覧に載る最終日。
 * 未完了なら今日まで繰り越し、完了済みなら完了日まで。登録日より前にはならない。
 * 着手済（startedAt）は完了ではないので、未完了と同じく繰り越す。
 */
function lastShownDate(task, todayKey) {
  const end = task.completedAt ? completedDateOf(task) : todayKey;
  return end > task.date ? end : task.date;
}

/**
 * 指定日に表示するタスク。
 * 1件のタスクを「登録日〜最終日」の範囲で表示するだけなので、日ごとの複製は作らない。
 * 将来の日付では、その日に登録したタスクだけが該当する（繰り越しの予測はしない）。
 */
export function tasksForDate(tasks, dateKey, todayKey) {
  const open = [];
  const done = [];
  for (const t of tasks) {
    if (t.date > dateKey || lastShownDate(t, todayKey) < dateKey) continue;
    (t.completedAt ? done : open).push(t);
  }
  open.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  done.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  return { open, done };
}

function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTask(text, dateKey, now = new Date()) {
  return { id: newId(), text, date: dateKey, createdAt: now.toISOString(), startedAt: null, completedAt: null };
}

function isOptionalTime(value) {
  return value == null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

/** 保存データ・バックアップの1件を検証して整形する。不正なら null */
export function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, text, date, createdAt, startedAt, completedAt } = raw;
  if (typeof id !== 'string' || !id) return null;
  if (typeof text !== 'string' || !text.trim()) return null;
  if (!isDateKey(date)) return null;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
  if (!isOptionalTime(completedAt)) return null;
  // startedAt（着手済にした日時）は後から追加した項目。古いデータには無いので null とみなす
  if (!isOptionalTime(startedAt)) return null;
  return { id, text, date, createdAt, startedAt: startedAt ?? null, completedAt: completedAt ?? null };
}

export function buildBackup(tasks, now = new Date()) {
  return { app: 'taskkun', version: 1, exportedAt: now.toISOString(), tasks };
}

/** バックアップ JSON を読み込む。形式が違えば日本語メッセージの Error を投げる */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON ファイルとして読み込めませんでした。');
  }
  const list = Array.isArray(data) ? data : data && data.tasks;
  if (!Array.isArray(list)) throw new Error('タスクのデータが見つかりませんでした。');
  const seen = new Set();
  const tasks = [];
  for (const raw of list) {
    const t = normalizeTask(raw);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    tasks.push(t);
  }
  if (list.length > 0 && tasks.length === 0) throw new Error('読み込めるタスクがありませんでした。');
  return tasks;
}
