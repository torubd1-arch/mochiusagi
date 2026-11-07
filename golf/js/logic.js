// 注意点データの純粋ロジック（DOM に依存しない。tests/ から直接テストする）
// 更新系の関数は元の配列を変更せず、新しい配列を返す（保存に失敗したら画面の状態を変えないため）。
// 配列の並びがそのままカテゴリ内の表示順になる。

export const APP_ID = 'golfmemo';
export const DATA_VERSION = 1;
export const MAX_IMPORTANT = 3;

export const CATEGORIES = [
  { id: 'driver', label: 'ドライバー' },
  { id: 'fw-ut', label: 'FW・UT' },
  { id: 'iron', label: 'アイアン' },
  { id: 'approach', label: 'アプローチ' },
  { id: 'putter', label: 'パター' },
  { id: 'other', label: '共通・その他' },
];

/** 注意点の背景色。先頭が既定値 */
export const COLORS = [
  { id: 'white', label: '白' },
  { id: 'red', label: '赤' },
  { id: 'orange', label: 'オレンジ' },
  { id: 'yellow', label: '黄' },
  { id: 'green', label: '緑' },
  { id: 'blue', label: '青' },
  { id: 'purple', label: '紫' },
];
export const DEFAULT_COLOR = COLORS[0].id;

const categoryIndex = (id) => CATEGORIES.findIndex((c) => c.id === id);

export function categoryLabel(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.label : '';
}

/**
 * 入力された URL を安全な https の URL に整える。使えなければ null。
 * javascript: や data: などは href に渡さないよう、ここで必ず弾く。
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`; // youtu.be/xxx のような省略形
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname.includes('.')) return null;
  url.protocol = 'https:';
  return url.href;
}

/** リンクの表示名 */
export function urlLabel(url) {
  const host = new URL(url).hostname.replace(/^(www|m)\./, '');
  return host === 'youtube.com' || host === 'youtu.be' ? 'YouTube' : host;
}

function isDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** 保存データ・バックアップの1件を検証して整形する。不正なら null */
export function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, title, category, memo, urls, important, mastered, createdAt, updatedAt } = raw;
  const color = raw.color ?? DEFAULT_COLOR; // 色を追加する前のデータは既定色にする
  if (typeof id !== 'string' || !id) return null;
  if (!COLORS.some((c) => c.id === color)) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (categoryIndex(category) < 0 || typeof memo !== 'string' || !Array.isArray(urls)) return null;
  if (typeof important !== 'boolean' || typeof mastered !== 'boolean') return null;
  if (!isDateTime(createdAt) || !isDateTime(updatedAt)) return null;
  const cleanUrls = urls.map(normalizeUrl);
  if (cleanUrls.includes(null)) return null;
  return { id, title, category, memo, urls: cleanUrls, color, important: important && !mastered, mastered, createdAt, updatedAt };
}

/** ホームに出す最重要ポイント（カテゴリ順） */
export function importantNotes(notes) {
  return notes
    .filter((n) => n.important && !n.mastered)
    .sort((a, b) => categoryIndex(a.category) - categoryIndex(b.category))
    .slice(0, MAX_IMPORTANT);
}

export function notesInCategory(notes, category) {
  return notes.filter((n) => n.category === category && !n.mastered);
}

export function masteredNotes(notes) {
  return notes.filter((n) => n.mastered);
}

/** id の注意点を最重要にするとき、先に解除が必要なら true */
export function needsRelease(notes, id) {
  return notes.filter((n) => n.important && !n.mastered && n.id !== id).length >= MAX_IMPORTANT;
}

function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 追加・更新。fields.id があれば更新。releaseId は同時に最重要を解除する注意点。
 * 習得済みは最重要にしない。カテゴリを変えた注意点は移動先の末尾に置く。
 * 最重要が上限を超えるなら null を返す。
 */
export function saveNote(notes, fields, { releaseId = null, now = new Date() } = {}) {
  const current = fields.id ? notes.find((n) => n.id === fields.id) : null;
  const stamp = now.toISOString();
  const note = {
    id: current ? current.id : newId(),
    title: fields.title.trim(),
    category: fields.category,
    memo: fields.memo.trim(),
    urls: fields.urls,
    color: fields.color || DEFAULT_COLOR,
    important: fields.important && !fields.mastered,
    mastered: fields.mastered,
    createdAt: current ? current.createdAt : stamp,
    updatedAt: stamp,
  };
  const released = notes.map((n) => (n.id === releaseId ? { ...n, important: false } : n));
  if (note.important && needsRelease(released, note.id)) return null;
  if (!current) return [...released, note];
  if (current.category !== note.category) return [...released.filter((n) => n.id !== note.id), note];
  return released.map((n) => (n.id === note.id ? note : n));
}

export function setImportant(notes, id, important, options) {
  const note = notes.find((n) => n.id === id);
  return note ? saveNote(notes, { ...note, important }, options) : notes;
}

export function setMastered(notes, id, mastered, options) {
  const note = notes.find((n) => n.id === id);
  return note ? saveNote(notes, { ...note, mastered }, options) : notes;
}

export function deleteNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}

/** カテゴリ内の表示順を orderedIds の順に変える。他のカテゴリの位置は動かさない */
export function reorderCategory(notes, category, orderedIds) {
  const current = notesInCategory(notes, category);
  const queue = orderedIds.map((id) => current.find((n) => n.id === id));
  if (queue.length !== current.length || queue.includes(undefined)) return notes;
  return notes.map((n) => (n.category === category && !n.mastered ? queue.shift() : n));
}

export function buildBackup(notes, now = new Date()) {
  return { app: APP_ID, version: DATA_VERSION, exportedAt: now.toISOString(), notes };
}

/**
 * バックアップ JSON を読み込む。問題があれば日本語メッセージの Error を投げる。
 * 復元は現在のデータを置き換えるので、1件でも不正なら全体を受け付けない。
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON ファイルとして読み込めませんでした。');
  }
  if (!data || data.app !== APP_ID) throw new Error('ゴルフメモのバックアップファイルではありません。');
  if (data.version !== DATA_VERSION) throw new Error(`対応していないデータ版です（version: ${data.version}）。`);
  if (!Array.isArray(data.notes)) throw new Error('注意点のデータが見つかりませんでした。');
  const seen = new Set();
  const notes = data.notes.map((raw, i) => {
    const note = normalizeNote(raw);
    if (!note) throw new Error(`${i + 1} 件目のデータが正しくありません。`);
    if (seen.has(note.id)) throw new Error(`${i + 1} 件目の ID が重複しています。`);
    seen.add(note.id);
    return note;
  });
  if (notes.filter((n) => n.important).length > MAX_IMPORTANT) {
    throw new Error(`最重要ポイントが ${MAX_IMPORTANT} 件を超えています。`);
  }
  return notes;
}
