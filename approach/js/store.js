// localStorage への保存・読み込み
// 練習設定・履歴（完了／途中終了）・練習中セッションを別々のキーに保存する。
// 練習中は1球ごとに練習中セッションのキーだけを書き換えるので、履歴が大きくなっても入力は軽い。
import { normalizeSettings, normalizeSession, DEFAULT_SETTINGS } from './logic.js';

/** 保存データのスキーマバージョン。形式を変えたら上げて、読み込み時に変換する */
export const SCHEMA_VERSION = 1;
export const KEYS = {
  settings: 'approach30.settings',
  history: 'approach30.history',
  active: 'approach30.active',
};
/** 読めなかったデータの退避先（次の保存で消えないように残す） */
export const brokenKey = (key) => `${key}.broken`;

function readRaw(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return { raw: null, data: undefined };
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== SCHEMA_VERSION) throw new Error('unsupported version');
  return { raw, data: parsed.data };
}

function keepBroken(storage, key, raw) {
  if (raw === null || raw === undefined) return;
  try {
    storage.setItem(brokenKey(key), raw);
  } catch {
    // 退避できなくても起動は続ける
  }
}

function write(storage, key, data) {
  try {
    storage.setItem(key, JSON.stringify({ version: SCHEMA_VERSION, data }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** 読み込み結果は { value, error }。error があれば画面に表示する */
export function loadSettings(storage = globalThis.localStorage) {
  let raw = null;
  try {
    const r = readRaw(storage, KEYS.settings);
    raw = r.raw;
    return { value: normalizeSettings(r.data), error: null };
  } catch (e) {
    keepBroken(storage, KEYS.settings, raw ?? safeGet(storage, KEYS.settings));
    return { value: normalizeSettings(DEFAULT_SETTINGS), error: e };
  }
}

export function loadHistory(storage = globalThis.localStorage) {
  let raw = null;
  try {
    const r = readRaw(storage, KEYS.history);
    raw = r.raw;
    if (r.data === undefined) return { value: [], error: null };
    if (!Array.isArray(r.data)) throw new Error('history is not an array');
    const list = r.data.map(normalizeSession).filter((s) => s && s.status !== 'active');
    if (list.length !== r.data.length) {
      keepBroken(storage, KEYS.history, raw);
      return { value: list, error: new Error('一部の履歴が読み込めませんでした') };
    }
    return { value: list, error: null };
  } catch (e) {
    keepBroken(storage, KEYS.history, raw ?? safeGet(storage, KEYS.history));
    return { value: [], error: e };
  }
}

export function loadActive(storage = globalThis.localStorage) {
  let raw = null;
  try {
    const r = readRaw(storage, KEYS.active);
    raw = r.raw;
    if (r.data === undefined || r.data === null) return { value: null, error: null };
    const session = normalizeSession(r.data);
    if (!session || session.status !== 'active') throw new Error('active session is broken');
    return { value: session, error: null };
  } catch (e) {
    keepBroken(storage, KEYS.active, raw ?? safeGet(storage, KEYS.active));
    return { value: null, error: e };
  }
}

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 保存結果は { ok, error } */
export function saveSettings(settings, storage = globalThis.localStorage) {
  return write(storage, KEYS.settings, settings);
}

export function saveHistory(history, storage = globalThis.localStorage) {
  return write(storage, KEYS.history, history);
}

export function saveActive(session, storage = globalThis.localStorage) {
  return write(storage, KEYS.active, session);
}

export function clearActive(storage = globalThis.localStorage) {
  try {
    storage.removeItem(KEYS.active);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * 起動時の読み込み。
 * 履歴への保存は済んだが練習中データの削除に失敗していた場合、同じセッションを再開しないよう練習中データを捨てる。
 */
export function loadAll(storage = globalThis.localStorage) {
  const settings = loadSettings(storage);
  const history = loadHistory(storage);
  let active = loadActive(storage);
  if (active.value && history.value.some((s) => s.id === active.value.id)) {
    clearActive(storage);
    active = { value: null, error: null };
  }
  return {
    settings: settings.value,
    history: history.value,
    active: active.value,
    errors: [settings.error, history.error, active.error].filter(Boolean),
  };
}

/** 練習中セッションを履歴へ移す（完了・途中終了のとき）。履歴の保存に失敗したら練習中データは残す */
export function archiveSession(session, history, storage = globalThis.localStorage) {
  const next = [...history.filter((s) => s.id !== session.id), session];
  const saved = saveHistory(next, storage);
  if (!saved.ok) return { ok: false, error: saved.error, history };
  const cleared = clearActive(storage);
  return { ok: true, history: next, clearError: cleared.ok ? null : cleared.error };
}
