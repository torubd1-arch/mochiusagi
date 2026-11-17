import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createSession, recordShot, undoShot, completeSession, abortSession, summarize, overallShots } from '../js/logic.js';
import {
  KEYS, SCHEMA_VERSION, brokenKey, loadAll, loadSettings, loadHistory, loadActive,
  saveSettings, saveActive, saveHistory, archiveSession,
} from '../js/store.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

/** setItem / removeItem が例外を投げるストレージ（容量超過・プライベートモードの再現） */
function failingStorage(initial = {}, { failRemove = false, failKeys = null } = {}) {
  const s = memoryStorage(initial);
  return {
    ...s,
    setItem: (k, v) => {
      if (!failKeys || failKeys.includes(k)) throw new Error('QuotaExceededError');
      s.data.set(k, v);
    },
    removeItem: (k) => {
      if (failRemove) throw new Error('fail');
      s.data.delete(k);
    },
  };
}

let seed = 1;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const NOW = new Date('2026-11-17T10:00:00.000Z');

test('練習設定（モード・球数・距離・クラブ）を保存して復元できる', () => {
  const storage = memoryStorage();
  const s = { mode: 'fixed', totalShots: 20, club: 'PW', randomDistances: [6, 9, 18], fixedDistance: 11 };
  assert.equal(saveSettings(s, storage).ok, true);
  assert.equal(JSON.parse(storage.data.get(KEYS.settings)).version, SCHEMA_VERSION);
  assert.deepEqual(loadSettings(storage).value, s);
  // 未保存なら初期値
  assert.deepEqual(loadSettings(memoryStorage()).value, { ...DEFAULT_SETTINGS });
});

test('再読み込みしても練習状態（球数・出題順・記録済み結果）を復元できる', () => {
  const storage = memoryStorage();
  let s = createSession({ ...DEFAULT_SETTINGS }, { rng, now: NOW, id: 'a' });
  for (const [r, m] of [['success', null], ['near', 'over'], ['failure', 'top']]) {
    s = recordShot(s, r, m);
    assert.equal(saveActive(s, storage).ok, true); // 1球ごとに保存
  }
  const restored = loadAll(storage).active;
  assert.deepEqual(restored, s);
  assert.equal(restored.shots.length, 3);
  assert.deepEqual(restored.distanceSequence, s.distanceSequence);
  // 戻した状態も保存・復元できる
  saveActive(undoShot(restored), storage);
  assert.equal(loadAll(storage).active.shots.length, 2);
});

test('セッション終了後に履歴が残り、再起動後も読める。練習中データは消える', () => {
  const storage = memoryStorage();
  let s = createSession({ ...DEFAULT_SETTINGS, totalShots: 10 }, { rng, now: NOW, id: 'b' });
  for (let i = 0; i < 10; i++) s = recordShot(s, 'success');
  saveActive(s, storage);
  const r = archiveSession(completeSession(s), [], storage);
  assert.equal(r.ok, true);
  assert.equal(storage.data.has(KEYS.active), false);
  const loaded = loadAll(storage);
  assert.equal(loaded.active, null);
  assert.equal(loaded.history.length, 1);
  assert.equal(loaded.history[0].status, 'completed');
  assert.equal(summarize(overallShots(loaded.history)).successRate, 100);
});

test('途中終了は履歴に残すが全体集計には入らない', () => {
  const storage = memoryStorage();
  const s = recordShot(createSession({ ...DEFAULT_SETTINGS }, { rng, now: NOW, id: 'c' }), 'failure', 'top');
  archiveSession(abortSession(s), [], storage);
  const { history } = loadAll(storage);
  assert.equal(history[0].status, 'aborted');
  assert.equal(history[0].shots.length, 1);
  assert.equal(summarize(overallShots(history)).total, 0);
});

test('履歴の削除は保存され、再読み込み後の集計に反映される', () => {
  const storage = memoryStorage();
  const mk = (id, r, m) => {
    let s = createSession({ ...DEFAULT_SETTINGS, totalShots: 10 }, { rng, now: NOW, id });
    for (let i = 0; i < 10; i++) s = recordShot(s, r, m);
    return completeSession(s);
  };
  saveHistory([mk('x', 'success', null), mk('y', 'failure', 'top')], storage);
  assert.equal(summarize(overallShots(loadAll(storage).history)).topRate, 50);
  saveHistory(loadAll(storage).history.filter((s) => s.id !== 'y'), storage);
  assert.equal(summarize(overallShots(loadAll(storage).history)).topRate, 0);
});

test('保存に失敗したら ok:false を返す（エラーを隠さない）', () => {
  const storage = failingStorage();
  const s = createSession({ ...DEFAULT_SETTINGS }, { rng, id: 'd' });
  assert.equal(saveSettings(DEFAULT_SETTINGS, storage).ok, false);
  assert.equal(saveActive(s, storage).ok, false);
  assert.ok(saveHistory([], storage).error);
  // 履歴へ移せなかったら練習中データは残す
  const st2 = failingStorage({}, { failKeys: [KEYS.history] });
  saveActive(s, st2);
  const r = archiveSession(completeSession(s), [], st2);
  assert.equal(r.ok, false);
  assert.equal(st2.data.has(KEYS.active), true);
});

test('履歴保存後に練習中データの削除に失敗しても、同じ練習を再開しない', () => {
  const storage = failingStorage({}, { failRemove: true, failKeys: [] });
  let s = createSession({ ...DEFAULT_SETTINGS, totalShots: 10 }, { rng, id: 'e' });
  for (let i = 0; i < 10; i++) s = recordShot(s, 'success');
  saveActive(s, storage);
  const r = archiveSession(completeSession(s), [], storage);
  assert.equal(r.ok, true);
  assert.ok(r.clearError);
  const loaded = loadAll(storage);
  assert.equal(loaded.active, null);
  assert.equal(loaded.history.length, 1);
});

test('読めないデータはエラーを返し、元の文字列を別キーに残す', () => {
  const storage = memoryStorage({
    [KEYS.history]: '{壊れたJSON',
    [KEYS.active]: JSON.stringify({ version: SCHEMA_VERSION, data: { id: 'z' } }),
    [KEYS.settings]: JSON.stringify({ version: 999, data: {} }),
  });
  const loaded = loadAll(storage);
  assert.equal(loaded.errors.length, 3);
  assert.deepEqual(loaded.history, []);
  assert.equal(loaded.active, null);
  assert.equal(loaded.settings.totalShots, 30);
  assert.equal(storage.data.get(brokenKey(KEYS.history)), '{壊れたJSON');
  assert.ok(storage.data.has(brokenKey(KEYS.active)));
});

test('一部だけ壊れた履歴は、読める分を残してエラーを返す', () => {
  const good = completeSession(recordShot(createSession({ ...DEFAULT_SETTINGS }, { rng, id: 'g' }), 'success'));
  const storage = memoryStorage({ [KEYS.history]: JSON.stringify({ version: SCHEMA_VERSION, data: [good, { id: 'bad' }] }) });
  const r = loadHistory(storage);
  assert.equal(r.value.length, 1);
  assert.ok(r.error);
  assert.ok(storage.data.has(brokenKey(KEYS.history)));
  assert.equal(loadActive(memoryStorage()).value, null);
});
