// 検定の進行・合否・個別終了・訂正・取り消し（UIから独立した純粋関数）。
// 状態は変更せず、常に新しいオブジェクトを返す。

export const SCHEMA_VERSION = 1;
export const MAX_THROWS = 12;
export const PASS_COUNT = 7;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const NAME_MAX = 20;
export const UNDO_LIMIT = 200;

// ───────────── 参加者の集計 ─────────────

export const successCount = (p) => p.throws.filter(Boolean).length;
export const throwCount = (p) => p.throws.length;
export const isPassed = (p) => successCount(p) >= PASS_COUNT;
/** まだ手番が回ってくる参加者か */
export const isActive = (p) => p.throws.length < MAX_THROWS && !p.endedEarly;
export const remainingToPass = (p) => Math.max(0, PASS_COUNT - successCount(p));

/** 結果表示用の合否と終了理由 */
export function playerResult(p) {
  const passed = isPassed(p);
  let reason = '挑戦中';
  if (p.endedEarly) reason = '途中終了';
  else if (p.throws.length >= MAX_THROWS) reason = '12投完了';
  return { passed, success: successCount(p), thrown: throwCount(p), reason };
}

// ───────────── 開始 ─────────────

/** 名前の前後空白を除き、最大文字数で切り、空欄は「プレイヤーN」にする */
export function normalizeName(name, index) {
  const s = Array.from(String(name ?? '').trim()).slice(0, NAME_MAX).join('');
  return s || `プレイヤー${index + 1}`;
}

export function createSession({ grade, names }, idGen) {
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) throw new Error('級が不正です');
  if (!Array.isArray(names) || names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) throw new Error('人数が不正です');
  const players = names.map((n, i) => ({ id: idGen(), name: normalizeName(n, i), throws: [], endedEarly: false }));
  return {
    schemaVersion: SCHEMA_VERSION,
    grade,
    players,
    currentPlayerId: players[0].id,
    screen: 'playing',
  };
}

// ───────────── 手番 ─────────────

export function currentPlayer(session) {
  return session.players.find((p) => p.id === session.currentPlayerId) || null;
}

/** fromId の次から登録順に循環して、手番対象の参加者IDを探す（本人も最後に候補）。いなければ null */
export function nextActiveId(players, fromId) {
  const n = players.length;
  const start = players.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= n; k++) {
    const p = players[(start + k + n) % n];
    if (isActive(p)) return p.id;
  }
  return null;
}

function advance(session, fromId) {
  const next = nextActiveId(session.players, fromId);
  if (next === null) return { ...session, currentPlayerId: null, screen: 'results' };
  return { ...session, currentPlayerId: next, screen: 'playing' };
}

function updatePlayer(session, id, fn) {
  return { ...session, players: session.players.map((p) => (p.id === id ? fn(p) : p)) };
}

/** 現在の手番が expect（画面に表示していた本人と投球数）と一致するか。連打・二重送信の防止に使う */
function matches(session, expect) {
  const p = currentPlayer(session);
  if (!p || session.screen !== 'playing' || !isActive(p)) return null;
  if (expect && (expect.playerId !== p.id || expect.count !== p.throws.length)) return null;
  return p;
}

/** 終了ボタンを出す条件：手番の本人が成功7回以上・12投未満・個別終了していない */
export function canEndEarly(session) {
  const p = currentPlayer(session);
  return !!p && session.screen === 'playing' && isActive(p) && isPassed(p);
}

/** 投球を記録して次の参加者へ進める。手番が expect と食い違う場合は null（何もしない） */
export function recordThrow(session, success, expect) {
  const p = matches(session, expect);
  if (!p) return null;
  const s = updatePlayer(session, p.id, (q) => ({ ...q, throws: [...q.throws, !!success] }));
  return advance(s, p.id);
}

/** 手番の本人だけを個別終了にして次の参加者へ進める。条件外なら null */
export function endEarly(session, expect) {
  const p = matches(session, expect);
  if (!p || !isPassed(p)) return null;
  const s = updatePlayer(session, p.id, (q) => ({ ...q, endedEarly: true }));
  return advance(s, p.id);
}

/**
 * 記録済みの投球を訂正する。投球数・通常の手番は変えない。
 * 個別終了者の成功数が7未満になったら終了を解除し、結果画面からはその本人の手番で記録に戻る。
 */
export function correctThrow(session, playerId, index, success) {
  const p = session.players.find((q) => q.id === playerId);
  if (!p || !Number.isInteger(index) || index < 0 || index >= p.throws.length) return null;
  if (p.throws[index] === !!success) return null;
  const throws = p.throws.slice();
  throws[index] = !!success;
  const fixed = { ...p, throws };
  if (fixed.endedEarly && !isPassed(fixed)) fixed.endedEarly = false;
  let s = updatePlayer(session, playerId, () => fixed);
  if (s.screen === 'results' && isActive(fixed)) {
    s = { ...s, screen: 'playing', currentPlayerId: playerId };
  }
  return s;
}

// ───────────── 取り消し付きの保存状態 ─────────────
// store = { schemaVersion, session, undo: Session[], draft }

export function emptyStore(draft = null) {
  return { schemaVersion: SCHEMA_VERSION, session: null, undo: [], draft };
}

/** 操作を適用し、変更前の状態を取り消し用に積む。操作が無効（null）なら store をそのまま返す */
export function apply(store, op) {
  if (!store.session) return store;
  const next = op(store.session);
  if (!next) return store;
  return { ...store, session: next, undo: [...store.undo, store.session].slice(-UNDO_LIMIT) };
}

export const canUndo = (store) => store.undo.length > 0;

export function undo(store) {
  if (!canUndo(store)) return store;
  return { ...store, session: store.undo[store.undo.length - 1], undo: store.undo.slice(0, -1) };
}

/** 新しい挑戦で直近の記録を置き換える（取り消し履歴も消える） */
export function startNew(store, session) {
  return { ...store, session, undo: [] };
}

// ───────────── 読み込み時の検証 ─────────────

/** 正しいセッションなら null、問題があればその理由を返す */
export function sessionProblem(s) {
  if (!s || typeof s !== 'object') return 'データがありません';
  if (s.schemaVersion !== SCHEMA_VERSION) return '保存形式の版が違います';
  if (!Number.isInteger(s.grade) || s.grade < 1 || s.grade > 12) return '級が不正です';
  if (!Array.isArray(s.players) || s.players.length < MIN_PLAYERS || s.players.length > MAX_PLAYERS) return '人数が不正です';
  const ids = new Set();
  for (const p of s.players) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id)) return '参加者IDが不正です';
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name) return '名前が不正です';
    if (!Array.isArray(p.throws) || p.throws.length > MAX_THROWS || !p.throws.every((t) => typeof t === 'boolean')) return '投球記録が不正です';
    if (typeof p.endedEarly !== 'boolean') return '終了状態が不正です';
    if (p.endedEarly && !isPassed(p)) return '終了状態が不正です';
  }
  if (s.screen === 'playing') {
    const cur = s.players.find((p) => p.id === s.currentPlayerId);
    if (!cur || !isActive(cur)) return '現在の手番が不正です';
  } else if (s.screen === 'results') {
    if (s.currentPlayerId !== null || s.players.some(isActive)) return '結果画面の状態が不正です';
  } else {
    return '画面の状態が不正です';
  }
  return null;
}

function draftProblem(d) {
  if (d === null) return null;
  if (!d || typeof d !== 'object') return '設定が不正です';
  if (!Number.isInteger(d.count) || d.count < MIN_PLAYERS || d.count > MAX_PLAYERS) return '設定の人数が不正です';
  if (!Array.isArray(d.names) || d.names.length !== MAX_PLAYERS || !d.names.every((n) => typeof n === 'string')) return '設定の名前が不正です';
  if (!Number.isInteger(d.grade) || d.grade < 1 || d.grade > 12) return '設定の級が不正です';
  return null;
}

/** 保存データを検証して store を返す。壊れていれば { error } を返す。取り消し履歴だけが壊れていれば履歴を捨てる */
export function parseStore(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { error: '保存データを読み取れません' };
  }
  if (!obj || typeof obj !== 'object' || obj.schemaVersion !== SCHEMA_VERSION) return { error: '保存形式の版が違います' };
  const dp = draftProblem(obj.draft ?? null);
  if (dp) return { error: dp };
  if (obj.session !== null && obj.session !== undefined) {
    const sp = sessionProblem(obj.session);
    if (sp) return { error: sp };
  }
  const undoList = Array.isArray(obj.undo) && obj.undo.every((u) => sessionProblem(u) === null) ? obj.undo : [];
  return { store: { schemaVersion: SCHEMA_VERSION, session: obj.session ?? null, undo: obj.session ? undoList : [], draft: obj.draft ?? null } };
}
