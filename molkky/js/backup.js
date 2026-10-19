// 全データのJSONエクスポート・インポート（構造検証つき、一括成功または全件失敗）
import * as L from './logic.js';

export const APP_ID = 'molkky-score';

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

export function buildExport({ sessions, games, throws }) {
  return {
    app: APP_ID,
    schemaVersion: L.SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    games,
    throws,
  };
}

const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0;
const isInt = (v) => Number.isInteger(v);
const isOptStr = (v) => v === null || v === undefined || typeof v === 'string';

function fail(msg) {
  throw new ImportError(msg);
}

function checkTeams(teams, where) {
  if (!Array.isArray(teams) || teams.length < L.MIN_TEAMS || teams.length > L.MAX_TEAMS) fail(`${where}：チーム数が不正です`);
  const ids = new Set();
  for (const t of teams) {
    if (!t || !isNonEmptyStr(t.id) || !isStr(t.name)) fail(`${where}：チーム情報が不正です`);
    if (!Array.isArray(t.members) || t.members.length < L.MIN_MEMBERS || t.members.length > L.MAX_MEMBERS) fail(`${where}：選手数が不正です`);
    for (const m of t.members) {
      if (!m || !isNonEmptyStr(m.id) || !isStr(m.name)) fail(`${where}：選手情報が不正です`);
      if (ids.has(m.id)) fail(`${where}：IDが重複しています`);
      ids.add(m.id);
    }
    if (ids.has(t.id)) fail(`${where}：IDが重複しています`);
    ids.add(t.id);
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueIds(list, label) {
  const ids = new Set();
  for (const x of list) {
    if (!x || !isNonEmptyStr(x.id)) fail(`${label}のIDが不正です`);
    if (ids.has(x.id)) fail(`${label}のIDが重複しています`);
    ids.add(x.id);
  }
}

/** JSON文字列を解析し、構造と内容の整合性を検証する。問題があればImportError */
export function parseAndValidate(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail('JSONとして読み込めません。ファイルが壊れている可能性があります。');
  }
  validateData(data);
  return data;
}

export function validateData(data) {
  if (!data || typeof data !== 'object') fail('データ形式が不正です');
  if (data.app !== APP_ID) fail('このアプリのバックアップファイルではありません');
  if (data.schemaVersion !== L.SCHEMA_VERSION) fail(`対応していないデータ版です（schemaVersion: ${data.schemaVersion}）`);
  const { sessions, games, throws } = data;
  if (!Array.isArray(sessions) || !Array.isArray(games) || !Array.isArray(throws)) fail('データ構造が不正です');
  uniqueIds(sessions, '対戦');
  uniqueIds(games, 'ゲーム');
  uniqueIds(throws, '投擲');

  const gamesById = new Map(games.map((g) => [g.id, g]));
  const throwsByGame = new Map(games.map((g) => [g.id, []]));
  for (const t of throws) {
    if (!throwsByGame.has(t.gameId)) fail('対応するゲームがない投擲があります');
    throwsByGame.get(t.gameId).push(t);
  }

  let activeCount = 0;
  for (const s of sessions) {
    const where = `対戦「${s.name}」`;
    if (!isStr(s.name) || !isNonEmptyStr(s.createdAt) || !isOptStr(s.endedAt)) fail(`${where}：基本情報が不正です`);
    if (!L.SESSION_STATUSES.includes(s.status)) fail(`${where}：状態が不正です`);
    if (s.schemaVersion !== L.SCHEMA_VERSION) fail(`${where}：データ版が不正です`);
    if (s.status === 'inProgress') activeCount += 1;
    checkTeams(s.teams, where);
    if (!Array.isArray(s.gameIds)) fail(`${where}：ゲーム一覧が不正です`);
    const owned = games.filter((g) => g.sessionId === s.id);
    if (owned.length !== s.gameIds.length || !s.gameIds.every((id) => gamesById.get(id)?.sessionId === s.id)) {
      fail(`${where}：ゲーム一覧が一致しません`);
    }
    s.gameIds.forEach((id, i) => {
      const g = gamesById.get(id);
      if (g.gameNumber !== i + 1) fail(`${where}：ゲーム番号が不正です`);
      const isLast = i === s.gameIds.length - 1;
      if (!isLast && g.status !== 'completed') fail(`${where}：途中のゲームが未完了です`);
      if (g.status === 'inProgress' && s.status !== 'inProgress') fail(`${where}：終了した対戦に進行中ゲームがあります`);
      validateGame(g, throwsByGame.get(g.id), `${where} 第${g.gameNumber}ゲーム`);
    });
  }
  if (activeCount > 1) fail('進行中の対戦が複数含まれています');
  for (const g of games) {
    if (!sessions.some((s) => s.id === g.sessionId)) fail('対応する対戦がないゲームがあります');
  }
}

function validateGame(g, throws, where) {
  if (!L.GAME_STATUSES.includes(g.status)) fail(`${where}：状態が不正です`);
  if (!isNonEmptyStr(g.startedAt) || !isOptStr(g.endedAt)) fail(`${where}：日時が不正です`);
  checkTeams(g.rosterSnapshot, where);
  if (!L.isValidOrder(g.rosterSnapshot, g)) fail(`${where}：順番が不正です`);
  if (!isInt(g.throwCount) || g.throwCount !== throws.length) fail(`${where}：投擲数が一致しません`);
  const sorted = [...throws].sort((a, b) => a.sequence - b.sequence);
  sorted.forEach((t, i) => {
    if (t.sequence !== i + 1) fail(`${where}：投擲番号が連続していません`);
    if (!L.THROW_TYPES.includes(t.type)) fail(`${where}：投擲の種別が不正です`);
    if (!Array.isArray(t.selectedPins)) fail(`${where}：ピンの記録が不正です`);
    if (t.type === 'score' ? !L.isValidPins(t.selectedPins) : t.selectedPins.length !== 0) fail(`${where}：ピンの記録が不正です`);
  });

  // 投擲履歴を再計算し、記録された値と一致するか確認する
  let state = L.createInitialState(g);
  for (const t of sorted) {
    let r;
    try {
      r = L.evaluateThrow(g, state, { type: t.type, pins: t.selectedPins });
    } catch {
      fail(`${where}：投擲履歴を再現できません`);
    }
    const rec = r.record;
    const keys = ['teamTurnNumber', 'teamId', 'scheduledMemberId', 'earnedPoints', 'scoreBefore', 'scoreAfter', 'missesAfter', 'eliminatedAfter'];
    if (!keys.every((k) => rec[k] === t[k])) fail(`${where}：第${t.sequence}投の記録が計算と一致しません`);
    state = r.state;
  }
  if (g.status === 'completed') {
    if (!state.finished || g.winnerTeamId !== state.winnerTeamId || g.endReason !== state.endReason) fail(`${where}：勝敗が計算と一致しません`);
    if (!sameJson(g.results, L.computeResults(g, state))) fail(`${where}：結果が計算と一致しません`);
  } else {
    if (state.finished) fail(`${where}：終了済みのはずのゲームが未完了になっています`);
    if (g.results !== null || g.winnerTeamId !== null) fail(`${where}：未完了ゲームに結果があります`);
  }
}

/** 取り込み前の衝突確認。既存と同じIDの対戦一覧を返す */
export function findConflicts(existing, data) {
  const ids = new Set(existing.sessions.map((s) => s.id));
  return data.sessions.filter((s) => ids.has(s.id));
}

/**
 * 検証済みデータを取り込む。同一IDの対戦はconfirmOverwriteで承認された場合のみ置き換える。
 * 全件を1トランザクションで保存する。
 */
export async function importData(store, data, { confirmOverwrite } = {}) {
  validateData(data);
  const existing = await store.getAll();
  const conflicts = findConflicts(existing, data);
  const replaced = new Set(conflicts.map((s) => s.id));

  // 置き換え対象外の既存ゲーム・投擲とID衝突がないか
  const keptGames = existing.games.filter((g) => !replaced.has(g.sessionId));
  const keptGameIds = new Set(keptGames.map((g) => g.id));
  const keptThrowIds = new Set(existing.throws.filter((t) => keptGameIds.has(t.gameId)).map((t) => t.id));
  if (data.games.some((g) => keptGameIds.has(g.id)) || data.throws.some((t) => keptThrowIds.has(t.id))) {
    throw new ImportError('既存の別の対戦とIDが重複しているため取り込めません');
  }

  const localActive = existing.sessions.filter((s) => s.status === 'inProgress' && !replaced.has(s.id));
  const importActive = data.sessions.filter((s) => s.status === 'inProgress');
  if (localActive.length + importActive.length > 1) {
    throw new ImportError('進行中の対戦が2つになるため取り込めません。先に端末の進行中の対戦を終了してください。');
  }

  if (conflicts.length > 0) {
    const ok = confirmOverwrite ? await confirmOverwrite(conflicts) : false;
    if (!ok) return { status: 'cancelled' };
  }

  const removedGames = existing.games.filter((g) => replaced.has(g.sessionId)).map((g) => g.id);
  const removedGameSet = new Set(removedGames);
  await store.commit({
    deleteSessions: [...replaced],
    deleteGames: removedGames,
    deleteThrows: existing.throws.filter((t) => removedGameSet.has(t.gameId)).map((t) => t.id),
    sessions: data.sessions,
    games: data.games,
    throws: data.throws,
  });
  return { status: 'imported', sessions: data.sessions.length, replaced: conflicts.length };
}
