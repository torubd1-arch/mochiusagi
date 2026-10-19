// モルックの得点計算・手番・失格・集計の純粋ロジック（UI・保存処理から独立）

export const SCHEMA_VERSION = 1;
export const TARGET_SCORE = 50;
export const OVER_RESET_SCORE = 25;
export const FOOT_FAULT_LINE = 37;
export const MISS_LIMIT = 3;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const MIN_MEMBERS = 1;
export const MAX_MEMBERS = 4;
export const NAME_MAX = 20;
export const PIN_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const THROW_TYPES = ['score', 'miss', 'footFault'];
export const GAME_STATUSES = ['ready', 'inProgress', 'completed', 'abandoned'];
export const SESSION_STATUSES = ['inProgress', 'completed'];
export const END_REASONS = ['reached50', 'lastSurvivor'];

export class LogicError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LogicError';
  }
}

/** 重複なしの1〜12の整数配列で、1本以上か */
export function isValidPins(pins) {
  if (!Array.isArray(pins) || pins.length === 0 || pins.length > 12) return false;
  const seen = new Set();
  for (const p of pins) {
    if (!Number.isInteger(p) || p < 1 || p > 12 || seen.has(p)) return false;
    seen.add(p);
  }
  return true;
}

/** 1本なら番号、2本以上なら本数 */
export function pointsForPins(pins) {
  return pins.length === 1 ? pins[0] : pins.length;
}

export function createInitialState(game) {
  const teams = {};
  for (const id of game.teamOrder) {
    teams[id] = { score: 0, misses: 0, eliminated: false, throwsMade: 0 };
  }
  return { teams, currentPos: 0, sequence: 0, finished: false, winnerTeamId: null, endReason: null };
}

function cloneState(s) {
  const teams = {};
  for (const [k, v] of Object.entries(s.teams)) teams[k] = { ...v };
  return { ...s, teams };
}

/** 現在の手番（チーム・予定選手・そのチームの何投目か） */
export function currentTurn(game, state) {
  if (state.finished) return null;
  const teamId = game.teamOrder[state.currentPos];
  const t = state.teams[teamId];
  const members = game.memberOrders[teamId];
  return {
    teamId,
    memberId: members[t.throwsMade % members.length],
    teamTurnNumber: t.throwsMade + 1,
    sequence: state.sequence + 1,
  };
}

/**
 * 1投を評価する（仕様6.2の優先順）。状態は変更せず、新しい状態と投擲記録を返す。
 * input: { type: 'score'|'miss'|'footFault', pins?: number[] }
 */
export function evaluateThrow(game, state, input) {
  if (state.finished) throw new LogicError('ゲームはすでに終了しています');
  const turn = currentTurn(game, state);
  if (!turn || state.teams[turn.teamId].eliminated) throw new LogicError('現在のチームは投擲できません');
  const before = state.teams[turn.teamId];
  const type = input && input.type;

  let pins = [];
  let earned = 0;
  let misses;
  let scoreAfter;
  let overshoot = false;
  let footFaultReset = false;

  if (type === 'score') {
    if (!isValidPins(input.pins)) throw new LogicError('ピンの選択が不正です');
    pins = [...input.pins].sort((a, b) => a - b);
    earned = pointsForPins(pins);
    misses = 0;
    const sum = before.score + earned;
    overshoot = sum > TARGET_SCORE;
    scoreAfter = overshoot ? OVER_RESET_SCORE : sum;
  } else if (type === 'miss' || type === 'footFault') {
    misses = before.misses + 1;
    scoreAfter = before.score;
    if (type === 'footFault' && before.score >= FOOT_FAULT_LINE) {
      scoreAfter = OVER_RESET_SCORE;
      footFaultReset = true;
    }
  } else {
    throw new LogicError('投擲の種別が不正です');
  }

  const eliminated = misses >= MISS_LIMIT;
  if (eliminated) {
    // 失格の0点を37点ルールより優先する
    scoreAfter = 0;
    footFaultReset = false;
  }

  const next = cloneState(state);
  const nt = next.teams[turn.teamId];
  nt.score = scoreAfter;
  nt.misses = misses;
  nt.eliminated = eliminated;
  nt.throwsMade += 1;
  next.sequence += 1;

  if (!eliminated && scoreAfter === TARGET_SCORE) {
    next.finished = true;
    next.winnerTeamId = turn.teamId;
    next.endReason = 'reached50';
  } else {
    const active = game.teamOrder.filter((id) => !next.teams[id].eliminated);
    if (active.length === 1) {
      next.finished = true;
      next.winnerTeamId = active[0];
      next.endReason = 'lastSurvivor';
    } else {
      const n = game.teamOrder.length;
      let pos = state.currentPos;
      do {
        pos = (pos + 1) % n;
      } while (next.teams[game.teamOrder[pos]].eliminated);
      next.currentPos = pos;
    }
  }

  const record = {
    sequence: turn.sequence,
    teamTurnNumber: turn.teamTurnNumber,
    teamId: turn.teamId,
    scheduledMemberId: turn.memberId,
    type,
    selectedPins: pins,
    earnedPoints: earned,
    scoreBefore: before.score,
    scoreAfter,
    missesAfter: misses,
    eliminatedAfter: eliminated,
  };
  const outcome = {
    overshoot,
    footFaultReset,
    eliminated,
    win: next.finished && next.winnerTeamId === turn.teamId && next.endReason === 'reached50',
    finished: next.finished,
    endReason: next.endReason,
    winnerTeamId: next.winnerTeamId,
  };
  return { record, state: next, outcome };
}

/** 投擲履歴からゲーム状態を再計算する */
export function replay(game, throws) {
  let state = createInitialState(game);
  const sorted = [...throws].sort((a, b) => a.sequence - b.sequence);
  for (const t of sorted) {
    const { record, state: next } = evaluateThrow(game, state, { type: t.type, pins: t.selectedPins });
    if (record.sequence !== t.sequence || record.teamId !== t.teamId) {
      throw new LogicError('投擲履歴の順番が一致しません');
    }
    state = next;
  }
  return state;
}

/** ゲーム終了時の各チーム結果（未終了ならnull） */
export function computeResults(game, state) {
  if (!state.finished) return null;
  return game.teamOrder.map((teamId) => {
    const t = state.teams[teamId];
    const isWinner = teamId === state.winnerTeamId;
    let finalRecordedScore = t.score;
    if (t.eliminated) finalRecordedScore = 0;
    else if (isWinner) finalRecordedScore = TARGET_SCORE;
    return {
      teamId,
      scoreAtLastThrow: t.score,
      finalRecordedScore,
      eliminated: t.eliminated,
      isWinner,
    };
  });
}

/** 完了ゲームのみを使った対戦集計（勝利数・記録点合計・完了ゲーム数） */
export function summarizeSession(session, games) {
  const completed = games.filter((g) => g.status === 'completed' && Array.isArray(g.results));
  return session.teams.map((team) => {
    let wins = 0;
    let totalPoints = 0;
    for (const g of completed) {
      const r = g.results.find((x) => x.teamId === team.id);
      if (!r) continue;
      if (r.isWinner) wins += 1;
      totalPoints += r.finalRecordedScore;
    }
    return { teamId: team.id, name: team.name, wins, totalPoints, completedGames: completed.length };
  });
}

/** 前後空白を除去し最大20文字 */
export function normalizeName(raw) {
  const s = String(raw ?? '').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

export function defaultTeamName(index) {
  return `チーム${'ABCD'[index] ?? index + 1}`;
}

export function defaultMemberName(index) {
  return `選手${index + 1}`;
}

/** 入力中のチーム情報を確定形に変換（名前の補完を含む） */
export function finalizeTeams(draftTeams) {
  return draftTeams.map((team, i) => {
    const members = team.members.map((m, j) => {
      const name = normalizeName(m.name);
      return { id: m.id, name: name || defaultMemberName(j), entered: !!name };
    });
    let name = normalizeName(team.name);
    if (!name) {
      name = members.length === 1 && members[0].entered ? members[0].name : defaultTeamName(i);
    }
    return { id: team.id, name, members: members.map(({ id, name: n }) => ({ id, name: n })) };
  });
}

/** ゲーム開始時点の順番（前ゲームがあればその順、なければ登録順） */
export function defaultOrder(teams, prevGame) {
  if (prevGame) {
    return {
      teamOrder: [...prevGame.teamOrder],
      memberOrders: Object.fromEntries(Object.entries(prevGame.memberOrders).map(([k, v]) => [k, [...v]])),
    };
  }
  return {
    teamOrder: teams.map((t) => t.id),
    memberOrders: Object.fromEntries(teams.map((t) => [t.id, t.members.map((m) => m.id)])),
  };
}

/** 配列内の要素を上下に移動した新しい配列 */
export function moveItem(arr, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/** 順番の妥当性（全チーム・全選手を過不足なく含むか） */
export function isValidOrder(teams, order) {
  const ids = teams.map((t) => t.id);
  if (!Array.isArray(order.teamOrder) || order.teamOrder.length !== ids.length) return false;
  if (new Set(order.teamOrder).size !== ids.length || !ids.every((id) => order.teamOrder.includes(id))) return false;
  return teams.every((t) => {
    const mo = order.memberOrders && order.memberOrders[t.id];
    const mids = t.members.map((m) => m.id);
    return Array.isArray(mo) && mo.length === mids.length && new Set(mo).size === mids.length && mids.every((id) => mo.includes(id));
  });
}
