// 項目データの純粋ロジック（DOM・IndexedDB に依存しない。tests/ から直接テストする）
// 更新系の関数は元のオブジェクトを変更せず、新しいオブジェクトを返す（保存に失敗したら画面の状態を変えないため）。

export const APP_ID = 'jinsei-collection';
export const DATA_VERSION = 1;

export const CATEGORIES = [
  { id: 'travel', label: '旅行・おでかけ', emoji: '✈️' },
  { id: 'food', label: 'グルメ', emoji: '🍜' },
  { id: 'experience', label: '体験・挑戦', emoji: '🎢' },
  { id: 'nature', label: '自然・アウトドア', emoji: '🏔️' },
  { id: 'sports', label: 'スポーツ・健康', emoji: '🏃' },
  { id: 'culture', label: '芸術・エンタメ', emoji: '🎨' },
  { id: 'learning', label: '学び・資格', emoji: '📚' },
  { id: 'hobby', label: '趣味・ものづくり', emoji: '🧶' },
  { id: 'people', label: '家族・人', emoji: '👨‍👩‍👧' },
  { id: 'work', label: '仕事・お金', emoji: '💼' },
  { id: 'life', label: '暮らし・買い物', emoji: '🏠' },
  { id: 'other', label: 'その他', emoji: '✨' },
];

/** カテゴリなしのときの代替アイコン */
export const DEFAULT_EMOJI = '🌱';

export function findCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function categoryEmoji(id) {
  const c = findCategory(id);
  return c ? c.emoji : DEFAULT_EMOJI;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- 曖昧な日付 ----
// 文字列で持つ: '2024-05-03'（年月日） / '2024-05'（年月） / '2024'（年） / '1990s'（年代） / ''（なし）

export const PRECISIONS = [
  { id: 'none', label: 'なし' },
  { id: 'decade', label: '年代' },
  { id: 'year', label: '年' },
  { id: 'month', label: '年月' },
  { id: 'day', label: '年月日' },
];

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

const pad2 = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 日付文字列を分解する。不正なら null（空文字は precision: 'none'） */
export function parseFuzzyDate(text) {
  if (text === '') return { precision: 'none' };
  if (typeof text !== 'string') return null;
  let m = /^(\d{4})s$/.exec(text);
  if (m) {
    const year = Number(m[1]);
    if (year % 10 !== 0 || year < MIN_YEAR || year > MAX_YEAR) return null;
    return { precision: 'decade', year };
  }
  m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (m[2] === undefined) return { precision: 'year', year };
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] === undefined) return { precision: 'month', year, month };
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { precision: 'day', year, month, day };
}

/** 入力欄の値から日付文字列を作る。足りない・不正なら null */
export function buildFuzzyDate({ precision, year, month, day }) {
  let text;
  if (precision === 'none') return '';
  if (precision === 'decade') text = `${Math.floor(Number(year) / 10) * 10}s`;
  else if (precision === 'year') text = `${year}`;
  else if (precision === 'month') text = `${year}-${pad2(month)}`;
  else if (precision === 'day') text = `${year}-${pad2(month)}-${pad2(day)}`;
  else return null;
  if (!/^\d{4}/.test(text)) return null;
  return parseFuzzyDate(text) ? text : null;
}

export function formatFuzzyDate(text) {
  const d = parseFuzzyDate(text);
  if (!d) return '';
  switch (d.precision) {
    case 'decade': return `${d.year}年代`;
    case 'year': return `${d.year}年`;
    case 'month': return `${d.year}年${d.month}月`;
    case 'day': return `${d.year}年${d.month}月${d.day}日`;
    default: return '';
  }
}

/** 並べ替え用のキー。曖昧な日付は期間の先頭として扱う。日付なしは '' */
export function dateSortKey(text) {
  const d = parseFuzzyDate(text);
  if (!d || d.precision === 'none') return '';
  return `${d.year}-${pad2(d.month || 1)}-${pad2(d.day || 1)}:${PRECISIONS.findIndex((p) => p.id === d.precision)}`;
}

export function todayFuzzy(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// ---- 項目 ----

function isDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * 保存データ・バックアップの1件を検証して整形する。不正なら null
 * kind: 'wish'（これからやりたい） / 'done'（経験した）
 * photoIds: 写真の並び順。先頭が代表写真。
 */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, title, kind, category, favorite, archived, note, date, photoIds, createdAt, updatedAt } = raw;
  if (typeof id !== 'string' || !id) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (kind !== 'wish' && kind !== 'done') return null;
  if (category !== '' && !findCategory(category)) return null;
  if (typeof favorite !== 'boolean' || typeof archived !== 'boolean') return null;
  if (typeof note !== 'string' || !parseFuzzyDate(date)) return null;
  if (!Array.isArray(photoIds) || !photoIds.every((p) => typeof p === 'string' && p)) return null;
  if (new Set(photoIds).size !== photoIds.length) return null;
  if (!isDateTime(createdAt) || !isDateTime(updatedAt)) return null;
  return { id, title, kind, category, favorite, archived, note, date, photoIds: [...photoIds], createdAt, updatedAt };
}

/** フォームの入力から項目を作る（新規は base なし）。タイトルが空なら null */
export function buildItem(fields, base = null, now = new Date().toISOString()) {
  const title = String(fields.title ?? '').trim();
  if (!title) return null;
  const item = {
    id: base ? base.id : newId(),
    title,
    kind: fields.kind === 'done' ? 'done' : 'wish',
    category: findCategory(fields.category) ? fields.category : '',
    favorite: Boolean(fields.favorite),
    archived: base ? base.archived : false,
    note: String(fields.note ?? '').trim(),
    date: parseFuzzyDate(fields.date ?? '') ? fields.date ?? '' : '',
    photoIds: [...(fields.photoIds ?? (base ? base.photoIds : []))],
    createdAt: base ? base.createdAt : now,
    updatedAt: now,
  };
  return item;
}

export function updateItem(item, patch, now = new Date().toISOString()) {
  return { ...item, ...patch, updatedAt: now };
}

/** 達成した項目を、もう一度やりたいこととして新しく登録する */
export function againItem(item, now = new Date().toISOString()) {
  return buildItem({ title: item.title, kind: 'wish', category: item.category, favorite: false, note: '', photoIds: [] }, null, now);
}

// ---- 一覧 ----

/** 検索用に揃える（全角英数→半角、カタカナ→ひらがな、小文字化） */
export function foldText(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function matchesQuery(item, query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const c = findCategory(item.category);
  const hay = foldText(`${item.title}\n${item.note}\n${c ? c.label : ''}\n${formatFuzzyDate(item.date)}`);
  return words.every((w) => hay.includes(w));
}

/**
 * 一覧に出す項目を絞り込む
 * status: 'wish' | 'done' | 'archived' | 'all'（all は保管中も含む）
 * category: '' ならすべて、'none' ならカテゴリなし
 */
export function filterItems(items, { status = 'all', category = '', query = '', favoriteOnly = false } = {}) {
  return items.filter((it) => {
    if (status === 'archived' && !it.archived) return false;
    if ((status === 'wish' || status === 'done') && (it.archived || it.kind !== status)) return false;
    if (category === 'none' ? it.category !== '' : category && it.category !== category) return false;
    if (favoriteOnly && !it.favorite) return false;
    return matchesQuery(it, query);
  });
}

const byCreatedDesc = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** やりたいことは新しく登録した順 */
export function sortWishes(items) {
  return [...items].sort(byCreatedDesc);
}

/** 思い出は日付の新しい順。日付なしは最後に（その中は登録の新しい順） */
export function sortMemories(items) {
  return [...items].sort((a, b) => {
    const ka = dateSortKey(a.date);
    const kb = dateSortKey(b.date);
    if (ka !== kb) {
      if (!ka) return 1;
      if (!kb) return -1;
      return ka < kb ? 1 : -1;
    }
    return byCreatedDesc(a, b);
  });
}

/** 年表用に年ごとにまとめる。年代だけの項目は「1990年代」、日付なしは「日付なし」 */
export function groupTimeline(items) {
  const groups = [];
  let current = null;
  for (const it of sortMemories(items)) {
    const d = parseFuzzyDate(it.date);
    let label;
    if (!d || d.precision === 'none') label = '日付なし';
    else if (d.precision === 'decade') label = `${d.year}年代`;
    else label = `${d.year}年`;
    if (!current || current.label !== label) {
      current = { label, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
}

export function countItems(items) {
  let wish = 0;
  let done = 0;
  let archived = 0;
  for (const it of items) {
    if (it.archived) archived += 1;
    else if (it.kind === 'wish') wish += 1;
    else done += 1;
  }
  return { wish, done, archived };
}

/** ガチャ。直前に出た項目はなるべく避ける */
export function pickRandom(items, previousId = null, random = Math.random) {
  if (!items.length) return null;
  const pool = items.length > 1 ? items.filter((it) => it.id !== previousId) : items;
  return pool[Math.floor(random() * pool.length)];
}

// ---- バックアップ ----

export const BACKUP_FILE = 'data.json';
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function photoPath(id, type, thumb = false) {
  return `${thumb ? 'thumbs' : 'photos'}/${id}.${PHOTO_TYPES[type] || 'jpg'}`;
}

/** ZIP に入れる data.json の中身。写真本体は photos/・thumbs/ に別ファイルで入れる */
export function buildManifest(items, photos, now = new Date().toISOString()) {
  return {
    app: APP_ID,
    version: DATA_VERSION,
    exportedAt: now,
    items,
    photos: photos.map((p) => ({
      id: p.id,
      itemId: p.itemId,
      type: p.type,
      width: p.width,
      height: p.height,
      file: photoPath(p.id, p.type),
      thumb: photoPath(p.id, p.thumbType, true),
      thumbType: p.thumbType,
    })),
  };
}

/**
 * バックアップの data.json を検証する。1件でも不正があれば例外（ファイル全体を拒否する）
 * hasFile(path) で ZIP 内に写真ファイルがあるかを確かめる
 */
export function parseManifest(json, hasFile) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('バックアップの data.json が読み取れません');
  }
  if (!data || data.app !== APP_ID) throw new Error('人生コレクションのバックアップではありません');
  if (data.version !== DATA_VERSION) throw new Error('対応していないバージョンのバックアップです');
  if (!Array.isArray(data.items) || !Array.isArray(data.photos)) throw new Error('バックアップの形式が正しくありません');

  const items = data.items.map(normalizeItem);
  if (items.includes(null)) throw new Error('バックアップに読み取れない項目があります');
  const itemIds = new Set(items.map((it) => it.id));
  if (itemIds.size !== items.length) throw new Error('バックアップに重複した項目があります');

  const photos = [];
  const photoIds = new Set();
  for (const p of data.photos) {
    const ok = p && typeof p.id === 'string' && p.id && !photoIds.has(p.id)
      && itemIds.has(p.itemId) && PHOTO_TYPES[p.type] && PHOTO_TYPES[p.thumbType]
      && Number.isFinite(p.width) && Number.isFinite(p.height)
      && p.file === photoPath(p.id, p.type) && p.thumb === photoPath(p.id, p.thumbType, true)
      && hasFile(p.file) && hasFile(p.thumb);
    if (!ok) throw new Error('バックアップの写真が欠けているか、形式が正しくありません');
    photoIds.add(p.id);
    photos.push({ id: p.id, itemId: p.itemId, type: p.type, thumbType: p.thumbType, width: p.width, height: p.height, file: p.file, thumb: p.thumb });
  }
  // 項目が指す写真と、写真が指す項目が一致しているか
  for (const it of items) {
    for (const pid of it.photoIds) {
      const p = photos.find((x) => x.id === pid);
      if (!p || p.itemId !== it.id) throw new Error('バックアップの写真と項目の対応が正しくありません');
    }
  }
  const used = new Set(items.flatMap((it) => it.photoIds));
  return { items, photos: photos.filter((p) => used.has(p.id)), exportedAt: isDateTime(data.exportedAt) ? data.exportedAt : null };
}

/**
 * 「統合」で復元するときの方針を決める。同じ項目は更新日時が新しい方を残す。
 * 戻り値: 書き込む項目・写真、消す写真（置き換えられる項目の古い写真）
 */
export function planMerge(localItems, backupItems, backupPhotos) {
  const local = new Map(localItems.map((it) => [it.id, it]));
  const putItems = [];
  const deletePhotoIds = [];
  for (const it of backupItems) {
    const cur = local.get(it.id);
    if (cur && cur.updatedAt >= it.updatedAt) continue;
    putItems.push(it);
    if (cur) deletePhotoIds.push(...cur.photoIds.filter((pid) => !it.photoIds.includes(pid)));
  }
  const putIds = new Set(putItems.map((it) => it.id));
  return { putItems, putPhotos: backupPhotos.filter((p) => putIds.has(p.itemId)), deletePhotoIds };
}

/** バックアップを促すか。最後のバックアップから30日以上、または未実施で5件以上 */
export const BACKUP_REMIND_DAYS = 30;
export function needsBackupReminder({ lastBackupAt, lastChangeAt, itemCount }, now = Date.now()) {
  if (!itemCount) return false;
  if (!lastBackupAt) return itemCount >= 5;
  if (!lastChangeAt || lastChangeAt <= lastBackupAt) return false;
  return now - Date.parse(lastBackupAt) >= BACKUP_REMIND_DAYS * 24 * 60 * 60 * 1000;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
