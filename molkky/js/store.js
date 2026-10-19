// 保存層。IndexedDB版とメモリ版（テスト・IndexedDB非対応時の代替）が同じインターフェースを持つ。
//
// commit(changes, guard?)
//   changes: { sessions?, games?, throws?, deleteSessions?, deleteGames?, deleteThrows? }
//   guard:   { store, id, field, equals } … 書き込み前に同一トランザクション内で検証する条件
//   削除→追加・更新の順で、すべて1トランザクションで原子的に反映する。

export class ConflictError extends Error {
  constructor(message = '保存データが他の操作で更新されています') {
    super(message);
    this.name = 'ConflictError';
  }
}

const STORES = ['sessions', 'games', 'throws'];

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export class MemoryStore {
  constructor() {
    this.data = { sessions: new Map(), games: new Map(), throws: new Map() };
    /** テスト用：次回のcommitを失敗させる */
    this.failNextCommit = null;
  }

  async listSessions() {
    return [...this.data.sessions.values()].map(clone);
  }

  async getSession(id) {
    return clone(this.data.sessions.get(id));
  }

  async getGame(id) {
    return clone(this.data.games.get(id));
  }

  async listGames(sessionId) {
    return [...this.data.games.values()].filter((g) => g.sessionId === sessionId).map(clone);
  }

  async listThrows(gameId) {
    return [...this.data.throws.values()]
      .filter((t) => t.gameId === gameId)
      .sort((a, b) => a.sequence - b.sequence)
      .map(clone);
  }

  async getThrow(id) {
    return clone(this.data.throws.get(id));
  }

  async getAll() {
    return {
      sessions: [...this.data.sessions.values()].map(clone),
      games: [...this.data.games.values()].map(clone),
      throws: [...this.data.throws.values()].map(clone),
    };
  }

  async commit(changes, guard) {
    if (this.failNextCommit) {
      const err = this.failNextCommit;
      this.failNextCommit = null;
      throw err;
    }
    if (guard) {
      const rec = this.data[guard.store].get(guard.id);
      if (!rec || rec[guard.field] !== guard.equals) throw new ConflictError();
    }
    const d = this.data;
    for (const id of changes.deleteSessions ?? []) d.sessions.delete(id);
    for (const id of changes.deleteGames ?? []) d.games.delete(id);
    for (const id of changes.deleteThrows ?? []) d.throws.delete(id);
    for (const name of STORES) {
      for (const v of changes[name] ?? []) d[name].set(v.id, clone(v));
    }
  }
}

const DB_NAME = 'molkky-score';
const DB_VERSION = 1;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbStore {
  static async open() {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDBを利用できません');
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('throws')) {
        db.createObjectStore('throws', { keyPath: 'id' }).createIndex('gameId', 'gameId');
      }
    };
    const db = await promisify(req);
    return new IdbStore(db);
  }

  constructor(db) {
    this.db = db;
  }

  _read(storeName, fn) {
    const tx = this.db.transaction(storeName, 'readonly');
    return promisify(fn(tx.objectStore(storeName)));
  }

  listSessions() {
    return this._read('sessions', (s) => s.getAll());
  }

  getSession(id) {
    return this._read('sessions', (s) => s.get(id));
  }

  getGame(id) {
    return this._read('games', (s) => s.get(id));
  }

  listGames(sessionId) {
    return this._read('games', (s) => s.index('sessionId').getAll(sessionId));
  }

  async listThrows(gameId) {
    const list = await this._read('throws', (s) => s.index('gameId').getAll(gameId));
    return list.sort((a, b) => a.sequence - b.sequence);
  }

  getThrow(id) {
    return this._read('throws', (s) => s.get(id));
  }

  getAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORES, 'readonly');
      const out = {};
      for (const name of STORES) {
        tx.objectStore(name).getAll().onsuccess = (e) => {
          out[name] = e.target.result;
        };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  commit(changes, guard) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.db.transaction(STORES, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      let failure = null;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure || tx.error || new Error('保存が中断されました'));
      tx.onerror = (e) => {
        // 失敗はonabortで処理する
        e.preventDefault?.();
        if (!failure) failure = e.target?.error || tx.error;
      };

      const write = () => {
        try {
          for (const id of changes.deleteSessions ?? []) tx.objectStore('sessions').delete(id);
          for (const id of changes.deleteGames ?? []) tx.objectStore('games').delete(id);
          for (const id of changes.deleteThrows ?? []) tx.objectStore('throws').delete(id);
          for (const name of STORES) {
            for (const v of changes[name] ?? []) tx.objectStore(name).put(v);
          }
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };

      if (!guard) {
        write();
        return;
      }
      const req = tx.objectStore(guard.store).get(guard.id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec || rec[guard.field] !== guard.equals) {
          failure = new ConflictError();
          tx.abort();
          return;
        }
        write();
      };
    });
  }
}

/** 保存エラーを利用者向けの文に変換する */
export function describeStorageError(err) {
  const name = err && err.name;
  if (name === 'QuotaExceededError') return '端末の保存容量が不足しています。不要な記録を削除するか、空き容量を確保してください。';
  if (name === 'ConflictError') return '保存データが別の画面などで更新されています。画面を開き直してください。';
  return `保存できませんでした（${(err && err.message) || '不明なエラー'}）。`;
}
