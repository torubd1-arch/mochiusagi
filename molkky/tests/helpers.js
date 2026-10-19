// テスト用の補助関数
import { finalizeTeams, defaultOrder, evaluateThrow, createInitialState } from '../js/logic.js';

/** spec: { A: ['A1','A2'], B: ['B1'] } のように、チームIDと選手IDを名前と同じにしたチームを作る */
export function makeTeams(spec) {
  return Object.entries(spec).map(([teamId, members]) => ({
    id: teamId,
    name: `チーム${teamId}`,
    members: members.map((m) => ({ id: m, name: m })),
  }));
}

export function makeGame(spec) {
  const teams = makeTeams(spec);
  const order = defaultOrder(teams, null);
  return { id: 'g1', sessionId: 's1', gameNumber: 1, rosterSnapshot: teams, ...order };
}

export const S = (...pins) => ({ type: 'score', pins });
export const MISS = { type: 'miss' };
export const FF = { type: 'footFault' };

/** 入力を順に適用し、状態と記録を返す */
export function play(game, inputs) {
  let state = createInitialState(game);
  const records = [];
  let last = null;
  for (const input of inputs) {
    last = evaluateThrow(game, state, input);
    records.push(last.record);
    state = last.state;
  }
  return { state, records, outcome: last && last.outcome };
}

export { finalizeTeams };
