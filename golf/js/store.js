// localStorage への保存・読み込み
import { normalizeNote } from './logic.js';

export const STORAGE_KEY = 'golfmemo.v1';
export const BROKEN_KEY = 'golfmemo.v1.broken';

/** 読めなかったデータが次の保存で消えないよう、元の文字列を別キーに残す */
function keepBroken(raw, storage) {
  try {
    storage.setItem(BROKEN_KEY, raw);
  } catch {
    // 退避できなくても起動は続ける
  }
}

export function loadNotes(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw).notes;
    const notes = list.map(normalizeNote).filter(Boolean);
    if (notes.length !== list.length) keepBroken(raw, storage);
    return notes;
  } catch {
    if (raw) keepBroken(raw, storage);
    return [];
  }
}

/** 保存に成功したら true（容量超過やプライベートモードでは false） */
export function saveNotes(notes, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, notes }));
    return true;
  } catch {
    return false;
  }
}
