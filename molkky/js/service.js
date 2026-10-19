// 対戦・ゲームの進行と保存をまとめる層。UIはこの層を通して記録を変更する。
import * as L from './logic.js';

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export class ServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceError';
  }
}

export async function findActiveSession(store) {
  const sessions = await store.listSessions();
  return sessions.find((s) => s.status === 'inProgress') ?? null;
}

/** 対戦・全ゲーム・全投擲をまとめて読み込む */
export async function loadSessionBundle(store, sessionId) {
  const session = await store.getSession(sessionId);
  if (!session) return null;
  const games = (await store.listGames(sessionId)).sort((a, b) => a.gameNumber - b.gameNumber);
  const throwsByGame = {};
  for (const g of games) throwsByGame[g.id] = await store.listThrows(g.id);
  return { session, games, throwsByGame };
}

function buildGame(session, gameNumber, order) {
  return {
    id: newId(),
    sessionId: session.id,
    gameNumber,
    status: 'inProgress',
    teamOrder: [...order.teamOrder],
    memberOrders: Object.fromEntries(order.teamOrder.map((id) => [id, [...order.memberOrders[id]]])),
    rosterSnapshot: JSON.parse(JSON.stringify(session.teams)),
    startedAt: nowIso(),
    endedAt: null,
    winnerTeamId: null,
    endReason: null,
    results: null,
    throwCount: 0,
  };
}

/** 新しい対戦と第1ゲームを同時に保存する（登録情報はここで固定） */
export async function createSession(store, { name, teams, order }) {
  if (await findActiveSession(store)) throw new ServiceError('進行中の対戦があります。先に終了してください。');
  if (teams.length < L.MIN_TEAMS || teams.length > L.MAX_TEAMS) throw new ServiceError('チーム数が不正です');
  if (!L.isValidOrder(teams, order)) throw new ServiceError('順番の指定が不正です');
  const session = {
    id: newId(),
    name,
    createdAt: nowIso(),
    endedAt: null,
    status: 'inProgress',
    teams,
    gameIds: [],
    schemaVersion: L.SCHEMA_VERSION,
  };
  const game = buildGame(session, 1, order);
  session.gameIds = [game.id];
  await store.commit({ sessions: [session], games: [game] });
  return { session, game };
}

/** 直前ゲームが完了している場合に次ゲームを開始する。以降、前ゲームは編集不可 */
export async function startNextGame(store, session, order) {
  if (session.status !== 'inProgress') throw new ServiceError('この対戦は終了しています');
  const prevId = session.gameIds[session.gameIds.length - 1];
  const prev = await store.getGame(prevId);
  if (!prev || prev.status !== 'completed') throw new ServiceError('前のゲームが終了していません');
  if (!L.isValidOrder(session.teams, order)) throw new ServiceError('順番の指定が不正です');
  const game = buildGame(session, session.gameIds.length + 1, order);
  const nextSession = { ...session, gameIds: [...session.gameIds, game.id] };
  await store.commit({ sessions: [nextSession], games: [game] }, {
    store: 'games', id: prev.id, field: 'status', equals: 'completed',
  });
  return { session: nextSession, game };
}

/** 対戦を終了する。進行中ゲームは中断扱いにする */
export async function endSession(store, session) {
  const games = [];
  const lastId = session.gameIds[session.gameIds.length - 1];
  const last = lastId ? await store.getGame(lastId) : null;
  if (last && (last.status === 'inProgress' || last.status === 'ready')) {
    games.push({ ...last, status: 'abandoned', endedAt: nowIso() });
  }
  const nextSession = { ...session, status: 'completed', endedAt: nowIso() };
  await store.commit({ sessions: [nextSession], games });
  return nextSession;
}

export async function deleteSession(store, sessionId) {
  const games = await store.listGames(sessionId);
  const throwIds = [];
  for (const g of games) for (const t of await store.listThrows(g.id)) throwIds.push(t.id);
  await store.commit({
    deleteSessions: [sessionId],
    deleteGames: games.map((g) => g.id),
    deleteThrows: throwIds,
  });
}

/**
 * 進行中（または終了直後）の1ゲームを操作する。
 * 確定は排他制御し、保存成功まで状態を進めない。失敗時はpendingを保持して同じIDで再試行する。
 */
export class GameController {
  constructor(store, session, game, throws) {
    this.store = store;
    this.session = session;
    this.game = game;
    this.throws = [...throws].sort((a, b) => a.sequence - b.sequence);
    this.state = L.replay(game, this.throws);
    this.busy = false;
    this.pending = null;
  }

  get turn() {
    return L.currentTurn(this.game, this.state);
  }

  get isLatestGame() {
    return this.session.gameIds[this.session.gameIds.length - 1] === this.game.id;
  }

  /** 入力を確定した場合の結果を計算する（保存しない） */
  preview(input) {
    try {
      return L.evaluateThrow(this.game, this.state, input);
    } catch {
      return null;
    }
  }

  canInput() {
    return !this.busy && !this.pending && this.game.status === 'inProgress' && !this.state.finished;
  }

  canUndo() {
    return (
      !this.busy &&
      !this.pending &&
      this.throws.length > 0 &&
      this.session.status === 'inProgress' &&
      this.isLatestGame &&
      (this.game.status === 'inProgress' || this.game.status === 'completed')
    );
  }

  _gameAfter(state, throwCount) {
    const finished = state.finished;
    return {
      ...this.game,
      throwCount,
      status: finished ? 'completed' : 'inProgress',
      winnerTeamId: finished ? state.winnerTeamId : null,
      endReason: finished ? state.endReason : null,
      endedAt: finished ? nowIso() : null,
      results: L.computeResults(this.game, state),
    };
  }

  /**
   * 1投を確定する。expectedSequence は入力画面が表示していた投擲番号で、
   * 二重タップなどで古い画面から送られた入力を無視するために使う。
   */
  async submit(input, expectedSequence) {
    if (this.busy) return { status: 'ignored' };
    if (this.pending) return { status: 'pending' };
    if (this.game.status !== 'inProgress') return { status: 'ignored' };
    if (expectedSequence !== undefined && expectedSequence !== this.state.sequence + 1) return { status: 'ignored' };
    this.busy = true;
    try {
      const { record, state, outcome } = L.evaluateThrow(this.game, this.state, input);
      const throwRec = { id: newId(), gameId: this.game.id, ...record, createdAt: nowIso() };
      this.pending = { throwRec, state, outcome, game: this._gameAfter(state, this.throws.length + 1), attempts: 0 };
      return await this._flush();
    } finally {
      this.busy = false;
    }
  }

  async retry() {
    if (this.busy || !this.pending) return { status: 'ignored' };
    this.busy = true;
    try {
      return await this._flush();
    } finally {
      this.busy = false;
    }
  }

  /** 保存できなかった入力を破棄する（状態は確定前のまま） */
  discardPending() {
    this.pending = null;
  }

  async _flush() {
    const p = this.pending;
    try {
      // 再試行時：前回の保存が実は成功していたら書き込まない（重複防止）
      const already = p.attempts > 0 ? await this.store.getThrow(p.throwRec.id) : null;
      p.attempts += 1;
      if (!already) {
        await this.store.commit(
          { games: [p.game], throws: [p.throwRec] },
          { store: 'games', id: this.game.id, field: 'throwCount', equals: this.throws.length },
        );
      }
      this.throws = [...this.throws, p.throwRec];
      this.game = p.game;
      this.state = p.state;
      this.pending = null;
      return { status: 'saved', record: p.throwRec, outcome: p.outcome };
    } catch (error) {
      return { status: 'error', error };
    }
  }

  /** 直前の確定投擲を1件取り消す。勝利・失格・手番・集計も履歴から再計算して戻る */
  async undo() {
    if (!this.canUndo()) return { status: 'ignored' };
    this.busy = true;
    try {
      const last = this.throws[this.throws.length - 1];
      const remaining = this.throws.slice(0, -1);
      const state = L.replay(this.game, remaining);
      const game = {
        ...this.game,
        throwCount: remaining.length,
        status: 'inProgress',
        winnerTeamId: null,
        endReason: null,
        endedAt: null,
        results: null,
      };
      await this.store.commit(
        { games: [game], deleteThrows: [last.id] },
        { store: 'games', id: this.game.id, field: 'throwCount', equals: this.throws.length },
      );
      this.throws = remaining;
      this.game = game;
      this.state = state;
      return { status: 'saved', undone: last };
    } catch (error) {
      return { status: 'error', error };
    } finally {
      this.busy = false;
    }
  }
}
