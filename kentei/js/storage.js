// 端末内保存（localStorage）。保存できない環境でも例外を外へ出さない。
import { parseStore, emptyStore } from './logic.js';

const KEY = 'kawanishi-molkky-kentei';

/** 保存データを読む。{ store } / { store, error }（壊れている）/ { store, unavailable }（保存不可）のいずれか */
export function load() {
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return { store: emptyStore(), unavailable: true };
  }
  if (raw === null) return { store: emptyStore() };
  const r = parseStore(raw);
  if (r.error) return { store: emptyStore(), error: r.error };
  return { store: r.store };
}

/** 保存できたら true */
export function save(store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function clear() {
  try {
    window.localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
