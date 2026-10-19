import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import * as Svc from '../js/service.js';
import * as L from '../js/logic.js';
import { makeTeams, S, MISS } from './helpers.js';

async function setup(spec = { A: ['A1', 'A2'], B: ['B1'] }) {
  const store = new MemoryStore();
  const teams = makeTeams(spec);
  const { session, game } = await Svc.createSession(store, { name: 'テスト', teams, order: L.defaultOrder(teams) });
  const ctl = new Svc.GameController(store, session, game, []);
  return { store, session, game, ctl };
}

async function feed(ctl, inputs) {
  for (const i of inputs) {
    const r = await ctl.submit(i, ctl.state.sequence + 1);
    assert.equal(r.status, 'saved');
  }
}

/** リロード相当：保存内容だけから再構築 */
async function reload(store, sessionId) {
  const b = await Svc.loadSessionBundle(store, sessionId);
  const last = b.games.at(-1);
  return new Svc.GameController(store, b.session, last, b.throwsByGame[last.id]);
}

test('進行中の対戦は1つだけ', async () => {
  const { store } = await setup();
  const teams = makeTeams({ X: ['X1'], Y: ['Y1'] });
  await assert.rejects(() => Svc.createSession(store, { name: 'x', teams, order: L.defaultOrder(teams) }), Svc.ServiceError);
});

test('No.22 勝利確定投擲を取り消す → 勝利前の得点・手番に戻り、集計から勝利を除去', async () => {
  const { store, session, ctl } = await setup({ A: ['A1'], B: ['B1'] });
  await feed(ctl, [S(12), S(1), S(12), S(1), S(12), S(1), S(7), S(1), S(7)]);
  assert.equal(ctl.game.status, 'completed');
  assert.equal(L.summarizeSession(session, [ctl.game])[0].wins, 1);

  const r = await ctl.undo();
  assert.equal(r.status, 'saved');
  assert.deepEqual(r.undone.selectedPins, [7]);
  assert.equal(ctl.game.status, 'inProgress');
  assert.equal(ctl.game.winnerTeamId, null);
  assert.equal(ctl.state.teams.A.score, 43);
  assert.equal(ctl.turn.teamId, 'A');
  const saved = await store.getGame(ctl.game.id);
  assert.equal(saved.status, 'inProgress');
  assert.equal(L.summarizeSession(session, [saved])[0].wins, 0);
  assert.equal((await store.listThrows(ctl.game.id)).length, 8);
});

test('No.23 失格確定投擲を取り消す → 失格前の累計・ミス2回・手番に戻る', async () => {
  const { ctl } = await setup({ A: ['A1'], B: ['B1'], C: ['C1'] });
  await feed(ctl, [S(9), S(1), S(1), MISS, S(1), S(1), MISS, S(1), S(1), MISS]);
  assert.equal(ctl.state.teams.A.eliminated, true);
  await ctl.undo();
  assert.equal(ctl.state.teams.A.eliminated, false);
  assert.equal(ctl.state.teams.A.score, 9);
  assert.equal(ctl.state.teams.A.misses, 2);
  assert.equal(ctl.turn.teamId, 'A');
});

test('繰り返し取り消せる。投擲がなければ取り消せない', async () => {
  const { ctl } = await setup();
  await feed(ctl, [S(3), S(4)]);
  await ctl.undo();
  await ctl.undo();
  assert.equal(ctl.throws.length, 0);
  assert.equal(ctl.turn.memberId, 'A1');
  assert.equal((await ctl.undo()).status, 'ignored');
});

test('No.24〜25 次のゲーム：同じ構成で全員0点、新しい順番を適用し前ゲーム履歴は不変', async () => {
  const { store, session, ctl } = await setup({ A: ['A1', 'A2'], B: ['B1'] });
  await feed(ctl, [S(10), MISS, S(10), MISS, S(10), MISS]);
  assert.equal(ctl.game.status, 'completed');
  const before = JSON.stringify(await store.listThrows(ctl.game.id));

  const order = L.defaultOrder(session.teams, ctl.game);
  assert.deepEqual(order.teamOrder, ['A', 'B']);
  order.teamOrder = L.moveItem(order.teamOrder, 1, -1);
  order.memberOrders.A = L.moveItem(order.memberOrders.A, 1, -1);
  const next = await Svc.startNextGame(store, ctl.session, order);
  assert.equal(next.game.gameNumber, 2);
  assert.deepEqual(next.session.gameIds.length, 2);
  assert.deepEqual(next.game.rosterSnapshot, session.teams);

  const ctl2 = new Svc.GameController(store, next.session, next.game, []);
  assert.equal(ctl2.turn.teamId, 'B');
  for (const t of Object.values(ctl2.state.teams)) assert.deepEqual([t.score, t.misses, t.eliminated], [0, 0, false]);
  await feed(ctl2, [S(1), S(1)]);
  assert.equal(ctl2.throws[1].scheduledMemberId, 'A2');
  assert.equal(JSON.stringify(await store.listThrows(ctl.game.id)), before);

  // 次ゲーム開始後は前ゲームを取り消せない
  ctl.session = next.session;
  assert.equal(ctl.canUndo(), false);
});

test('前ゲームが未完了なら次のゲームは開始できない', async () => {
  const { store, session } = await setup();
  await assert.rejects(() => Svc.startNextGame(store, session, L.defaultOrder(session.teams)), Svc.ServiceError);
});

test('No.26 保存内容から最後の確定状態を復元', async () => {
  const { store, session, ctl } = await setup({ A: ['A1', 'A2'], B: ['B1'] });
  await feed(ctl, [S(5), MISS, S(3, 4)]);
  const restored = await reload(store, session.id);
  assert.deepEqual(restored.state, ctl.state);
  assert.equal(restored.turn.teamId, 'B');
  assert.equal(restored.turn.sequence, 4);
  assert.equal((await Svc.findActiveSession(store)).id, session.id);
});

test('No.27 決定を素早く2回押しても1投のみ登録', async () => {
  const { store, ctl } = await setup();
  const seqNo = ctl.state.sequence + 1;
  const [a, b] = await Promise.all([ctl.submit(S(5), seqNo), ctl.submit(S(5), seqNo)]);
  assert.deepEqual([a.status, b.status].sort(), ['ignored', 'saved']);
  // 2回目が遅れて届いても、表示していた投擲番号が古いので無視される
  assert.equal((await ctl.submit(S(5), seqNo)).status, 'ignored');
  assert.equal((await store.listThrows(ctl.game.id)).length, 1);
});

test('No.28 保存失敗：次手番へ進まず、再試行で重複しない', async () => {
  const { store, ctl } = await setup();
  store.failNextCommit = Object.assign(new Error('disk full'), { name: 'QuotaExceededError' });
  const r = await ctl.submit(S(8), 1);
  assert.equal(r.status, 'error');
  assert.equal(ctl.state.sequence, 0);
  assert.equal(ctl.turn.teamId, 'A');
  assert.equal((await ctl.submit(S(8), 1)).status, 'pending');

  const r2 = await ctl.retry();
  assert.equal(r2.status, 'saved');
  assert.equal(ctl.state.teams.A.score, 8);
  assert.equal(ctl.turn.teamId, 'B');
  assert.equal((await store.listThrows(ctl.game.id)).length, 1);
});

test('No.28 実際は保存できていたのに失敗扱いになった場合も、再試行で重複しない', async () => {
  const { store, ctl } = await setup();
  const realCommit = store.commit.bind(store);
  store.commit = async (...args) => {
    await realCommit(...args);
    store.commit = realCommit;
    throw new Error('応答なし');
  };
  assert.equal((await ctl.submit(S(8), 1)).status, 'error');
  assert.equal((await ctl.retry()).status, 'saved');
  assert.equal((await store.listThrows(ctl.game.id)).length, 1);
  assert.equal((await store.getGame(ctl.game.id)).throwCount, 1);
});

test('対戦終了：進行中ゲームは中断扱いで集計対象外', async () => {
  const { store, session, ctl } = await setup({ A: ['A1'], B: ['B1'] });
  await feed(ctl, [S(10), S(2)]);
  const ended = await Svc.endSession(store, ctl.session);
  assert.equal(ended.status, 'completed');
  const g = await store.getGame(ctl.game.id);
  assert.equal(g.status, 'abandoned');
  assert.deepEqual(L.summarizeSession(session, [g]).map((r) => r.totalPoints), [0, 0]);
  assert.equal(await Svc.findActiveSession(store), null);
});

test('対戦の削除で関連するゲーム・投擲も消える', async () => {
  const { store, session, ctl } = await setup();
  await feed(ctl, [S(1)]);
  await Svc.deleteSession(store, session.id);
  const all = await store.getAll();
  assert.deepEqual([all.sessions.length, all.games.length, all.throws.length], [0, 0, 0]);
});
