import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import * as Svc from '../js/service.js';
import * as L from '../js/logic.js';
import * as B from '../js/backup.js';
import { sessionToCsv, neutralizeFormula } from '../js/format.js';
import { makeTeams, S, MISS, FF } from './helpers.js';

async function sampleStore() {
  const store = new MemoryStore();
  const teams = makeTeams({ A: ['A1', 'A2'], B: ['B1'] });
  teams[0].name = '=SUM(1,2)';
  teams[1].members[0].name = '花子, "はな"\n2行目';
  const { session, game } = await Svc.createSession(store, { name: '練習会', teams, order: L.defaultOrder(teams) });
  const ctl = new Svc.GameController(store, session, game, []);
  for (const i of [S(12), MISS, S(12), MISS, S(12), MISS]) await ctl.submit(i, ctl.state.sequence + 1);
  const next = await Svc.startNextGame(store, ctl.session, L.defaultOrder(teams, ctl.game));
  const ctl2 = new Svc.GameController(store, next.session, next.game, []);
  for (const i of [S(3, 4), FF, S(11)]) await ctl2.submit(i, ctl2.state.sequence + 1);
  return { store, session: next.session, ctl2 };
}

test('No.29 JSON出力→空の端末へ取り込み：名前・順番・投擲・結果・再開位置を復元', async () => {
  const { store, session, ctl2 } = await sampleStore();
  const text = JSON.stringify(B.buildExport(await store.getAll()));

  const fresh = new MemoryStore();
  const data = B.parseAndValidate(text);
  const r = await B.importData(fresh, data);
  assert.equal(r.status, 'imported');
  assert.deepEqual(await fresh.getAll(), await store.getAll());

  const active = await Svc.findActiveSession(fresh);
  assert.equal(active.id, session.id);
  const bundle = await Svc.loadSessionBundle(fresh, active.id);
  const g = bundle.games.at(-1);
  const restored = new Svc.GameController(fresh, bundle.session, g, bundle.throwsByGame[g.id]);
  assert.deepEqual(restored.state, ctl2.state);
  assert.equal(bundle.session.teams[1].members[0].name, '花子, "はな"\n2行目');
});

test('破損・不整合なファイルは取り込まない', async () => {
  const { store } = await sampleStore();
  const good = B.buildExport(await store.getAll());
  assert.throws(() => B.parseAndValidate('{壊れた'), B.ImportError);
  assert.throws(() => B.parseAndValidate(JSON.stringify({ ...good, schemaVersion: 99 })), B.ImportError);
  assert.throws(() => B.parseAndValidate(JSON.stringify({ ...good, app: 'other' })), B.ImportError);

  const tampered = structuredClone(good);
  tampered.throws[0].scoreAfter = 49;
  assert.throws(() => B.validateData(tampered), /一致しません/);

  const orphan = structuredClone(good);
  orphan.throws.push({ ...orphan.throws[0], id: 'x', gameId: 'nope' });
  assert.throws(() => B.validateData(orphan), B.ImportError);
});

test('同一IDは確認なしに上書きしない。取り込みは全件成功か全件失敗', async () => {
  const { store } = await sampleStore();
  const data = B.buildExport(await store.getAll());
  // 既存の進行中対戦を終了しておく
  await Svc.endSession(store, (await store.listSessions())[0]);
  const snapshot = JSON.stringify(await store.getAll());

  const cancelled = await B.importData(store, structuredClone(data), { confirmOverwrite: async () => false });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(JSON.stringify(await store.getAll()), snapshot);

  store.failNextCommit = new Error('失敗');
  await assert.rejects(() => B.importData(store, structuredClone(data), { confirmOverwrite: async () => true }));
  assert.equal(JSON.stringify(await store.getAll()), snapshot);

  let asked = 0;
  const ok = await B.importData(store, structuredClone(data), { confirmOverwrite: async (c) => { asked = c.length; return true; } });
  assert.equal(ok.status, 'imported');
  assert.equal(asked, 1);
  assert.equal((await store.listSessions())[0].status, 'inProgress');
});

test('進行中の対戦が2つになる取り込みは拒否する', async () => {
  const { store } = await sampleStore();
  const data = B.buildExport(await store.getAll());
  const other = new MemoryStore();
  const teams = makeTeams({ X: ['X1'], Y: ['Y1'] });
  await Svc.createSession(other, { name: 'x', teams, order: L.defaultOrder(teams) });
  await assert.rejects(() => B.importData(other, data), /進行中の対戦が2つ/);
});

test('CSV：BOM付き、エスケープ、数式注入対策、投擲行と結果行を区別', async () => {
  const { store, session } = await sampleStore();
  const bundle = await Svc.loadSessionBundle(store, session.id);
  const csv = sessionToCsv(bundle.session, bundle.games, bundle.throwsByGame);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes("'=SUM(1,2)"));
  assert.ok(!/(^|,)=SUM/m.test(csv));
  assert.ok(csv.includes('"花子, ""はな""\n2行目"'));
  const lines = csv.slice(1).split('\r\n').filter(Boolean);
  assert.equal(lines.filter((l) => l.startsWith('throw,')).length, 9);
  assert.equal(lines.filter((l) => l.startsWith('result,')).length, 3); // 第1ゲーム2チーム＋第2ゲーム未完了1行
  assert.ok(csv.includes(',ー,'));
  assert.equal(neutralizeFormula('-1'), "'-1");
  assert.equal(neutralizeFormula('太郎'), '太郎');
});
