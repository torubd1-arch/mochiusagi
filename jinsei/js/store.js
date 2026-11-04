// IndexedDB への保存・読み込み
// items: 項目 / photos: 写真の情報とサムネイル / photoData: 写真の本体 / meta: 最終バックアップ日時など
// 一覧ではサムネイルだけ読むよう、写真の本体は別のストアに分けている（画像は ArrayBuffer で持つ）。
// 1回の操作で書き換えるものは1つのトランザクションにまとめ、途中で失敗したら何も変わらないようにする。
import { normalizeItem } from './logic.js';

const DB_NAME = 'jinsei-collection';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('この環境ではデータを保存できません（IndexedDB が使えません）'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      }
      if (!db.objectStoreNames.contains('photoData')) db.createObjectStore('photoData', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別タブで新しい版が開かれたら閉じる（古い版のまま書き込まないため）
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースを開けません。ほかのタブを閉じてから再読み込みしてください'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const reqDone = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** トランザクションを実行し、完了（コミット）まで待つ。fn の戻り値を返す */
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
    try {
      result = fn(tx);
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

/** 容量不足のエラーか */
export function isQuotaError(err) {
  return Boolean(err) && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)));
}

function touchMeta(tx, now = new Date().toISOString()) {
  tx.objectStore('meta').put({ key: 'lastChangeAt', value: now });
}

/** 全項目を読む。読めない項目は除き（DB には残す）、件数を broken で返す */
export async function loadItems() {
  const list = await run(['items'], 'readonly', (tx) => reqDone(tx.objectStore('items').getAll()));
  const items = list.map(normalizeItem).filter(Boolean);
  return { items, broken: list.length - items.length };
}

/** 写真の情報とサムネイル（{ id, itemId, type, width, height, thumbType, thumb }） */
export function getPhoto(id) {
  return run(['photos'], 'readonly', (tx) => reqDone(tx.objectStore('photos').get(id)));
}

/** 写真の本体（ArrayBuffer）。なければ null */
export async function getPhotoData(id) {
  const rec = await run(['photoData'], 'readonly', (tx) => reqDone(tx.objectStore('photoData').get(id)));
  return rec ? rec.data : null;
}

/** 写真を本体ごとまとめて読む（バックアップ用）。ids の順に返し、見つからないものは null */
export function getPhotos(ids) {
  return run(['photos', 'photoData'], 'readonly', (tx) => {
    const meta = tx.objectStore('photos');
    const data = tx.objectStore('photoData');
    return Promise.all(ids.map(async (id) => {
      const [m, d] = await Promise.all([reqDone(meta.get(id)), reqDone(data.get(id))]);
      return m && d ? { ...m, data: d.data } : null;
    }));
  });
}

/** 写真1枚を2つのストアに分けて書く */
function putPhoto(tx, photo, itemId = photo.itemId) {
  const { data, ...meta } = photo;
  tx.objectStore('photos').put({ ...meta, itemId });
  tx.objectStore('photoData').put({ id: photo.id, data });
}

function deletePhoto(tx, id) {
  tx.objectStore('photos').delete(id);
  tx.objectStore('photoData').delete(id);
}

const ALL = ['items', 'photos', 'photoData', 'meta'];

/**
 * 項目を保存する。追加・削除する写真も同じトランザクションで書く。
 * addPhotos: [{ id, itemId, type, width, height, data, thumbType, thumb }]
 */
export function saveItem(item, { addPhotos = [], deletePhotoIds = [] } = {}) {
  return run(ALL, 'readwrite', (tx) => {
    for (const p of addPhotos) putPhoto(tx, p, item.id);
    for (const id of deletePhotoIds) deletePhoto(tx, id);
    tx.objectStore('items').put(item);
    touchMeta(tx);
  });
}

/** 複数の項目をまとめて保存する（写真は変えない） */
export function saveItems(items) {
  return run(['items', 'meta'], 'readwrite', (tx) => {
    const store = tx.objectStore('items');
    for (const it of items) store.put(it);
    touchMeta(tx);
  });
}

/** 項目と、その項目の写真をすべて消す */
export function deleteItem(item) {
  return run(ALL, 'readwrite', (tx) => {
    for (const id of item.photoIds) deletePhoto(tx, id);
    // photoIds に載っていない写真（過去の不整合）も itemId で探して消す
    tx.objectStore('photos').index('itemId').openKeyCursor(IDBKeyRange.only(item.id)).onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      deletePhoto(tx, cursor.primaryKey);
      cursor.continue();
    };
    tx.objectStore('items').delete(item.id);
    touchMeta(tx);
  });
}

export async function photoCount() {
  return run(['photos'], 'readonly', (tx) => reqDone(tx.objectStore('photos').count()));
}

export async function getMeta(key) {
  const rec = await run(['meta'], 'readonly', (tx) => reqDone(tx.objectStore('meta').get(key)));
  return rec ? rec.value : null;
}

export function setMeta(key, value) {
  return run(['meta'], 'readwrite', (tx) => {
    tx.objectStore('meta').put({ key, value });
  });
}

/** 全データを置き換える（復元用）。photos は data・thumb を読み込み済みのもの */
export function replaceAll(items, photos) {
  return run(ALL, 'readwrite', (tx) => {
    const itemStore = tx.objectStore('items');
    itemStore.clear();
    tx.objectStore('photos').clear();
    tx.objectStore('photoData').clear();
    for (const p of photos) putPhoto(tx, p);
    for (const it of items) itemStore.put(it);
    touchMeta(tx);
  });
}

/** 統合して復元する（planMerge の結果を書き込む） */
export function applyMerge({ putItems, putPhotos, deletePhotoIds }) {
  return run(ALL, 'readwrite', (tx) => {
    for (const id of deletePhotoIds) deletePhoto(tx, id);
    for (const p of putPhotos) putPhoto(tx, p);
    const itemStore = tx.objectStore('items');
    for (const it of putItems) itemStore.put(it);
    touchMeta(tx);
  });
}

/** 端末のストレージ使用量（ブラウザ全体の見積もり）。取れなければ null */
export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/** ブラウザに自動削除しないよう頼む。結果（true / false / null）を返す */
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
