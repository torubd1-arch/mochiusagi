// localStorage への保存・読み込み
import { normalizeTask } from './logic.js';

export const STORAGE_KEY = 'taskkun.v1';

export function loadTasks(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter(Boolean);
  } catch {
    return [];
  }
}

/** 保存に成功したら true（容量超過やプライベートモードでは false） */
export function saveTasks(tasks, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks }));
    return true;
  } catch {
    return false;
  }
}
