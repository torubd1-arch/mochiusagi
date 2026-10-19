import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import * as Setup from '../js/setup.js';
import { makeGame, play, S, MISS, FF } from './helpers.js';

let seq = 0;
const idGen = () => `id${++seq}`;

/** 2チーム戦で、Bは常に1点を取る（Aの状態だけを動かしたいとき用） */
function vsB(aInputs, bInput = S(1)) {
  const out = [];
  for (const a of aInputs) out.push(a, bInput);
  return out;
}

test('No.1 初期設定は2チーム・各選手欄1つ', () => {
  const d = Setup.createDraft(idGen);
  assert.equal(d.teams.length, 2);
  for (const t of d.teams) assert.equal(t.members.length, 1);
});

test('No.2 選手は4人・チームは4つで停止し、最小数以下へは削除できない', () => {
  let d = Setup.createDraft(idGen);
  const teamId = d.teams[0].id;
  for (let i = 0; i < 10; i++) d = Setup.addMember(d, teamId, idGen);
  assert.equal(d.teams[0].members.length, 4);
  assert.equal(Setup.canAddMember(d.teams[0]), false);
  for (let i = 0; i < 10; i++) d = Setup.addTeam(d, idGen);
  assert.equal(d.teams.length, 4);
  assert.equal(Setup.canAddTeam(d), false);

  // 1人目は削除不可
  const first = d.teams[0].members[0].id;
  d = Setup.removeMember(d, teamId, first);
  assert.equal(d.teams[0].members[0].id, first);
  assert.equal(Setup.canRemoveMember(d.teams[0], 0), false);
  for (const m of [...d.teams[0].members].slice(1)) d = Setup.removeMember(d, teamId, m.id);
  assert.equal(d.teams[0].members.length, 1);

  for (const t of [...d.teams]) d = Setup.removeTeam(d, t.id);
  assert.equal(d.teams.length, 2);
  assert.equal(Setup.canRemoveTeam(d), false);
});

test('名前の補完：空欄はチームA・選手1、1人チームは選手名をチーム名に、20文字で切る', () => {
  const teams = L.finalizeTeams([
    { id: 't1', name: '  ', members: [{ id: 'm1', name: ' 太郎 ' }] },
    { id: 't2', name: '', members: [{ id: 'm2', name: '' }, { id: 'm3', name: '' }] },
    { id: 't3', name: 'あ'.repeat(25), members: [{ id: 'm4', name: '花子' }] },
  ]);
  assert.equal(teams[0].name, '太郎');
  assert.equal(teams[0].members[0].name, '太郎');
  assert.equal(teams[1].name, 'チームB');
  assert.deepEqual(teams[1].members.map((m) => m.name), ['選手1', '選手2']);
  assert.equal(teams[2].name, 'あ'.repeat(20));
  assert.equal(teams[2].members[0].entered, undefined);
});

test('No.3〜5 ピンの得点：1本は番号、複数は本数', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  assert.equal(play(g, [S(12)]).state.teams.A.score, 12);
  assert.equal(play(g, [S(7, 9, 12)]).state.teams.A.score, 3);
  assert.equal(play(g, [S(...L.PIN_NUMBERS)]).state.teams.A.score, 12);
});

test('No.6〜7 不正な選択（空・重複）は得点として確定できない', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  assert.throws(() => play(g, [S()]), L.LogicError);
  assert.throws(() => play(g, [S(3, 3)]), L.LogicError);
  assert.throws(() => play(g, [S(13)]), L.LogicError);
});

test('No.8 43点で7番 → 50点で即終了', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  // A: 12+12+12+7 = 43、続いて7番で50
  const r = play(g, [...vsB([S(12), S(12), S(12), S(7)]), S(7)]);
  assert.equal(r.records.at(-1).scoreBefore, 43);
  assert.equal(r.state.teams.A.score, 50);
  assert.equal(r.state.finished, true);
  assert.equal(r.state.winnerTeamId, 'A');
  assert.equal(r.state.endReason, 'reached50');
  assert.throws(() => L.evaluateThrow(g, r.state, S(1)), L.LogicError);
});

test('No.9 43点で12番 → 25点で継続、連続ミス0', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, [...vsB([S(12), S(12), S(12), S(7), MISS]), S(12)]);
  assert.equal(r.records.at(-1).scoreBefore, 43);
  assert.equal(r.state.teams.A.score, 25);
  assert.equal(r.state.teams.A.misses, 0);
  assert.equal(r.state.finished, false);
  assert.equal(r.outcome.overshoot, true);
});

test('No.10 ミス→相手→ミス→相手→ミスで失格・記録点0', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'], C: ['C1'] });
  const r = play(g, [S(5), S(1), S(1), MISS, S(1), S(1), MISS, S(1), S(1), MISS]);
  assert.equal(r.state.teams.A.eliminated, true);
  assert.equal(r.state.teams.A.score, 0);
  assert.equal(r.records.at(-1).eliminatedAfter, true);
});

test('No.11 同チーム内で別選手が3連続ミス → チームとして失格', () => {
  const g = makeGame({ A: ['A1', 'A2', 'A3'], B: ['B1'], C: ['C1'] });
  const r = play(g, [MISS, S(1), S(1), MISS, S(1), S(1), MISS]);
  assert.deepEqual(r.records.filter((x) => x.teamId === 'A').map((x) => x.scheduledMemberId), ['A1', 'A2', 'A3']);
  assert.equal(r.state.teams.A.eliminated, true);
});

test('No.12 ミス→ミス→有効得点→ミスで連続ミスは1', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, vsB([MISS, MISS, S(4), MISS]).slice(0, -1));
  assert.equal(r.state.teams.A.misses, 1);
});

test('No.13 ミス→ミス→50点超過は25点で継続し、失格にならない', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, vsB([S(12), S(12), S(12), S(7), MISS, MISS, S(12)]).slice(0, -1));
  assert.equal(r.state.teams.A.score, 25);
  assert.equal(r.state.teams.A.misses, 0);
  assert.equal(r.state.teams.A.eliminated, false);
});

function teamAAt(score) {
  // Aを指定得点にする（Bは1点ずつ）。12点・残りの順で入れる
  const a = [];
  let left = score;
  while (left > 12) {
    a.push(S(12));
    left -= 12;
  }
  if (left > 0) a.push(S(left));
  return vsB(a);
}

test('No.14 40点で通常ミス → 40点のまま、ミス+1', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, [...teamAAt(40), MISS]);
  assert.equal(r.state.teams.A.score, 40);
  assert.equal(r.state.teams.A.misses, 1);
});

test('No.15〜17 踏み越え：40点・37点は25点へ、36点は維持', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  for (const [before, after] of [[40, 25], [37, 25], [36, 36]]) {
    const r = play(g, [...teamAAt(before), FF]);
    assert.equal(r.records.at(-1).scoreBefore, before);
    assert.equal(r.state.teams.A.score, after, `${before}点で踏み越え`);
    assert.equal(r.state.teams.A.misses, 1);
    assert.equal(r.records.at(-1).type, 'footFault');
  }
});

test('No.18 40点・2連続ミスから踏み越え → 失格・0点を優先', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'], C: ['C1'] });
  const base = [];
  for (const a of [S(12), S(12), S(12), S(4), MISS, MISS]) base.push(a, S(1), S(1));
  const r = play(g, [...base, FF]);
  assert.equal(r.records.at(-1).scoreBefore, 40);
  assert.equal(r.state.teams.A.eliminated, true);
  assert.equal(r.state.teams.A.score, 0);
  assert.equal(r.outcome.footFaultReset, false);
});

test('No.19 3チーム中1チーム失格 → 残る2チームで続行（失格チームはスキップ）', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'], C: ['C1'] });
  const r = play(g, [MISS, S(1), S(1), MISS, S(1), S(1), MISS]);
  assert.equal(r.state.finished, false);
  assert.equal(L.currentTurn(g, r.state).teamId, 'B');
  const r2 = play(g, [MISS, S(1), S(1), MISS, S(1), S(1), MISS, S(2), S(2)]);
  assert.equal(L.currentTurn(g, r2.state).teamId, 'B');
});

test('No.20 最後の相手が失格 → 生存チームの記録点50、終了理由を区別', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, [S(10), MISS, S(1), MISS, S(1), MISS]);
  assert.equal(r.state.finished, true);
  assert.equal(r.state.winnerTeamId, 'A');
  assert.equal(r.state.endReason, 'lastSurvivor');
  const results = L.computeResults(g, r.state);
  const a = results.find((x) => x.teamId === 'A');
  const b = results.find((x) => x.teamId === 'B');
  assert.deepEqual(a, { teamId: 'A', scoreAtLastThrow: 12, finalRecordedScore: 50, eliminated: false, isWinner: true });
  assert.deepEqual(b, { teamId: 'B', scoreAtLastThrow: 0, finalRecordedScore: 0, eliminated: true, isWinner: false });
  // 架空の投擲は追加しない
  assert.equal(r.records.length, 6);
});

test('No.21 A2人・B1人・C3人の手番循環', () => {
  const g = makeGame({ A: ['A1', 'A2'], B: ['B1'], C: ['C1', 'C2', 'C3'] });
  const r = play(g, Array(9).fill(S(1)));
  assert.deepEqual(
    r.records.map((x) => x.scheduledMemberId),
    ['A1', 'B1', 'C1', 'A2', 'B1', 'C2', 'A1', 'B1', 'C3'],
  );
  assert.deepEqual(r.records.map((x) => x.teamTurnNumber), [1, 1, 1, 2, 2, 2, 3, 3, 3]);
});

test('ミスも1投として選手順を進め、失格チームをスキップしても他チームの選手順は崩れない', () => {
  const g = makeGame({ A: ['A1', 'A2'], B: ['B1', 'B2'], C: ['C1'] });
  const r = play(g, [MISS, S(1), S(1), MISS, S(1), S(1), MISS, S(1), S(1), S(1), S(1)]);
  assert.deepEqual(
    r.records.map((x) => x.scheduledMemberId),
    ['A1', 'B1', 'C1', 'A2', 'B2', 'C1', 'A1', 'B1', 'C1', 'B2', 'C1'],
  );
});

test('勝利投擲で即終了し、残りのチームの投擲を補充しない', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'], C: ['C1'] });
  const inputs = [];
  for (let i = 0; i < 4; i++) inputs.push(S(12), S(1), S(1));
  inputs.push(S(2));
  const r = play(g, inputs);
  assert.equal(r.state.finished, true);
  assert.equal(r.records.length, 13);
  assert.equal(L.currentTurn(g, r.state), null);
});

test('No.30 21投以上のゲームも制限なく継続', () => {
  const g = makeGame({ A: ['A1'], B: ['B1'] });
  const r = play(g, Array(60).fill(S(1)));
  assert.equal(r.records.length, 60);
  assert.equal(r.state.teams.A.score, 30);
  assert.deepEqual(L.replay(g, r.records.map((x, i) => ({ ...x, id: `t${i}` }))), r.state);
});

test('集計：完了ゲームの記録点のみを合計し、未完了・中断は含めない', () => {
  const session = { teams: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }] };
  const games = [
    { status: 'completed', results: [
      { teamId: 'A', finalRecordedScore: 50, isWinner: true },
      { teamId: 'B', finalRecordedScore: 31, isWinner: false },
    ] },
    { status: 'completed', results: [
      { teamId: 'A', finalRecordedScore: 0, isWinner: false },
      { teamId: 'B', finalRecordedScore: 50, isWinner: true },
    ] },
    { status: 'abandoned', results: null },
    { status: 'inProgress', results: null },
  ];
  const rows = L.summarizeSession(session, games);
  assert.deepEqual(rows.map((r) => [r.wins, r.totalPoints, r.completedGames]), [[1, 50, 2], [1, 81, 2]]);
});

test('順番の移動と検証', () => {
  assert.deepEqual(L.moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(L.moveItem(['a', 'b'], 0, -1), ['a', 'b']);
  const g = makeGame({ A: ['A1', 'A2'], B: ['B1'] });
  assert.equal(L.isValidOrder(g.rosterSnapshot, g), true);
  assert.equal(L.isValidOrder(g.rosterSnapshot, { ...g, teamOrder: ['A', 'A'] }), false);
});
