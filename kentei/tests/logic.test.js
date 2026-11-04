import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { GRADES, getGrade } from '../js/grades.js';

const O = true;
const X = false;

function idGen() {
  let n = 0;
  return () => `p${++n}`;
}

/** 名前 = ID（A, B, C…）で開始し、取り消し付きの store を返す */
function start(names, grade = 12) {
  const ids = [...names];
  const session = L.createSession({ grade, names }, () => ids.shift());
  return L.startNew(L.emptyStore(), session);
}

const cur = (store) => store.session.currentPlayerId;
const player = (store, id) => store.session.players.find((p) => p.id === id);
const expectOf = (store) => {
  const p = L.currentPlayer(store.session);
  return { playerId: p.id, count: p.throws.length };
};
const hit = (store, v) => L.apply(store, (s) => L.recordThrow(s, v, expectOf(store)));
const end = (store) => L.apply(store, (s) => L.endEarly(s, expectOf(store)));
/** 結果を順に入力する */
const play = (store, results) => results.reduce(hit, store);

test('お題データ：12級〜1級がそろい、級と名称・距離が資料どおり', () => {
  assert.deepEqual(GRADES.map((g) => g.grade), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const t = Object.fromEntries(GRADES.map((g) => [g.grade, g.title]));
  assert.deepEqual(t, {
    12: '4m 通常', 11: '4m 後ろ', 10: '4m 真ん中', 9: '4m 飛ばし', 8: '4m 手前', 7: '6m 後ろ',
    6: '6m 真ん中', 5: '8m 遠投', 4: '6m 飛ばし', 3: '6m 手前', 2: '10m 遠投', 1: '12m 遠投',
  });
  assert.match(getGrade(9).condition, /8mラインより遠く/);
  assert.match(getGrade(4).condition, /10mラインより遠く/);
  // 元資料の並び（左から 12-11-10 / 9-8-7 / 6-5-4 / 3-2-1 の列）に合った切り出し位置
  const col = (g) => Math.floor(getGrade(g).crop[0] / 270);
  const row = (g) => Math.floor((getGrade(g).crop[1] - 700) / 290);
  for (const [g, c, r] of [[12, 0, 0], [11, 0, 1], [10, 0, 2], [9, 1, 0], [8, 1, 1], [7, 1, 2], [6, 2, 0], [5, 2, 1], [4, 2, 2], [3, 3, 0], [2, 3, 1], [1, 3, 2]]) {
    assert.equal(col(g), c, `${g}級の列`);
    assert.equal(row(g), r, `${g}級の行`);
  }
});

test('開始：1〜4人。空欄は「プレイヤーN」、同名も可、20文字で切る', () => {
  for (let n = 1; n <= 4; n++) {
    const s = L.createSession({ grade: 5, names: Array(n).fill('') }, idGen());
    assert.equal(s.players.length, n);
    assert.equal(s.grade, 5);
    assert.equal(s.players[n - 1].name, `プレイヤー${n}`);
  }
  const s = L.createSession({ grade: 1, names: ['  たろう ', 'たろう', 'あ'.repeat(30)] }, idGen());
  assert.deepEqual(s.players.map((p) => p.name), ['たろう', 'たろう', 'あ'.repeat(20)]);
  assert.notEqual(s.players[0].id, s.players[1].id);
  assert.throws(() => L.createSession({ grade: 1, names: [] }, idGen()));
  assert.throws(() => L.createSession({ grade: 1, names: ['a', 'b', 'c', 'd', 'e'] }, idGen()));
  assert.throws(() => L.createSession({ grade: 13, names: ['a'] }, idGen()));
});

test('No.3 3人で A→B→C→A と1投ずつ進み、本人の投球数だけが増える', () => {
  let st = start(['A', 'B', 'C']);
  const order = [];
  for (let i = 0; i < 6; i++) {
    order.push(cur(st));
    st = hit(st, O);
  }
  assert.deepEqual(order, ['A', 'B', 'C', 'A', 'B', 'C']);
  assert.deepEqual(st.session.players.map((p) => p.throws.length), [2, 2, 2]);
});

test('No.4 成功6回では不合格、7回で合格。合格後も記録できる', () => {
  let st = start(['A']);
  st = play(st, [O, O, O, O, O, O]);
  assert.equal(L.isPassed(player(st, 'A')), false);
  assert.equal(L.remainingToPass(player(st, 'A')), 1);
  st = hit(st, O);
  assert.equal(L.isPassed(player(st, 'A')), true);
  st = hit(st, X);
  assert.deepEqual(player(st, 'A').throws, [O, O, O, O, O, O, O, X]);
  assert.equal(st.session.screen, 'playing');
});

test('No.5 Bが7回目の成功を入れた直後のCの手番には終了ボタンが出ず、次のBの手番でだけ出る', () => {
  let st = start(['A', 'B', 'C']);
  for (let i = 0; i < 7; i++) st = play(st, [X, O, X]); // Bだけ成功
  assert.equal(L.successCount(player(st, 'B')), 7);
  assert.equal(cur(st), 'A');
  assert.equal(L.canEndEarly(st.session), false);
  st = hit(st, X); // A
  assert.equal(cur(st), 'B');
  assert.equal(L.canEndEarly(st.session), true);
  st = hit(st, O); // B は続行
  assert.equal(cur(st), 'C');
  assert.equal(L.canEndEarly(st.session), false);
  // Bの7回目直後（Cの手番）を個別に確認
  let st2 = start(['A', 'B', 'C']);
  for (let i = 0; i < 6; i++) st2 = play(st2, [X, O, X]);
  st2 = play(st2, [X, O]);
  assert.equal(cur(st2), 'C');
  assert.equal(L.canEndEarly(st2.session), false);
  assert.equal(L.apply(st2, (s) => L.endEarly(s, expectOf(st2))), st2, 'Cは終了できない');
});

test('No.6 Bが終了すると実投球数は変わらず、以後AとCだけで進み、Aの完了後はCだけになる', () => {
  let st = start(['A', 'B', 'C']);
  for (let i = 0; i < 7; i++) st = play(st, [X, O, X]);
  st = hit(st, X); // A 8投目
  st = end(st); // B 終了
  assert.equal(player(st, 'B').endedEarly, true);
  assert.equal(player(st, 'B').throws.length, 7);
  assert.equal(L.playerResult(player(st, 'B')).reason, '途中終了');
  assert.equal(cur(st), 'C');
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push(cur(st));
    st = hit(st, X);
  }
  assert.deepEqual(order, ['C', 'A', 'C', 'A']);
  // A を先に12投へ（C を1投減らした状態を作る）
  let st3 = start(['A', 'B', 'C']);
  for (let i = 0; i < 7; i++) st3 = play(st3, [X, O, X]);
  st3 = hit(st3, X); // A 8
  st3 = end(st3); // B 終了 → C
  st3 = play(st3, [X, X, X, X, X, X, X, X]); // C8,A9,C9,A10,C10,A11,C11,A12
  assert.equal(player(st3, 'A').throws.length, 12);
  assert.equal(cur(st3), 'C');
  st3 = hit(st3, X); // C 12
  assert.equal(st3.session.screen, 'results');
  assert.equal(st3.session.currentPlayerId, null);
});

test('No.7 成功7回のまま12投を終えたら自動完了し、終了操作を求めない', () => {
  let st = start(['A']);
  st = play(st, [O, O, O, O, O, O, O, X, X, X, X, X]);
  assert.equal(st.session.screen, 'results');
  assert.equal(L.canEndEarly(st.session), false);
  const r = L.playerResult(player(st, 'A'));
  assert.deepEqual(r, { passed: true, success: 7, thrown: 12, reason: '12投完了' });
});

test('No.8 1人プレイの個別終了、最後の1人、全員個別終了がいずれも完了する', () => {
  // 1人：7回成功の次の本人の手番で終了できる
  let st = start(['A']);
  st = play(st, [O, O, O, O, O, O, O]);
  assert.equal(cur(st), 'A');
  assert.equal(L.canEndEarly(st.session), true);
  st = end(st);
  assert.equal(st.session.screen, 'results');
  assert.deepEqual(L.playerResult(player(st, 'A')), { passed: true, success: 7, thrown: 7, reason: '途中終了' });

  // 最後の1人だけが残る：本人へ戻り続ける
  let st2 = start(['A', 'B']);
  for (let i = 0; i < 7; i++) st2 = play(st2, [O, X]);
  st2 = end(st2); // A 終了
  assert.equal(cur(st2), 'B');
  st2 = hit(st2, X);
  assert.equal(cur(st2), 'B');
  st2 = play(st2, [X, X, X]);
  assert.equal(cur(st2), 'B');
  st2 = hit(st2, X);
  assert.equal(player(st2, 'B').throws.length, 12);
  assert.equal(st2.session.screen, 'results');

  // 全員が個別終了：最後の終了操作で結果へ
  let st3 = start(['A', 'B', 'C']);
  for (let i = 0; i < 7; i++) st3 = play(st3, [O, O, O]);
  st3 = end(st3);
  st3 = end(st3);
  assert.equal(st3.session.screen, 'playing');
  st3 = end(st3);
  assert.equal(st3.session.screen, 'results');
  assert.ok(st3.session.players.every((p) => p.endedEarly && p.throws.length === 7));
});

test('No.9 12投中6回成功は不合格。6連続失敗でも途中退場しない', () => {
  let st = start(['A']);
  st = play(st, [X, X, X, X, X, X]);
  assert.equal(st.session.screen, 'playing');
  assert.equal(cur(st), 'A');
  st = play(st, [O, O, O, O, O, O]);
  assert.deepEqual(L.playerResult(player(st, 'A')), { passed: false, success: 6, thrown: 12, reason: '12投完了' });
  assert.equal(st.session.screen, 'results');
});

test('No.10 「ひとつ戻す」：投球は直前の手番へ、個別終了は本人の手番へ戻る', () => {
  let st = start(['A', 'B']);
  st = hit(st, O);
  assert.equal(cur(st), 'B');
  st = L.undo(st);
  assert.equal(cur(st), 'A');
  assert.equal(player(st, 'A').throws.length, 0);
  assert.equal(L.canUndo(st), false);

  for (let i = 0; i < 7; i++) st = play(st, [X, O]);
  st = hit(st, X); // A
  st = end(st); // B 終了
  assert.equal(cur(st), 'A');
  st = L.undo(st);
  assert.equal(cur(st), 'B');
  assert.equal(player(st, 'B').endedEarly, false);
  assert.equal(L.canEndEarly(st.session), true);
  st = hit(st, O); // 終了せず投球もできる
  assert.equal(player(st, 'B').throws.length, 8);

  // 結果画面に入る操作も戻せる
  let st2 = start(['A']);
  st2 = play(st2, Array(12).fill(X));
  assert.equal(st2.session.screen, 'results');
  st2 = L.undo(st2);
  assert.equal(st2.session.screen, 'playing');
  assert.equal(player(st2, 'A').throws.length, 11);
});

test('No.11 過去の訂正で合否が更新され、投球数・手番は変わらない。訂正も戻せる', () => {
  let st = start(['A', 'B']);
  st = play(st, [O, X, O, X, O, X, O, X, O, X, O, X, X, X]); // A: O×6 + X
  assert.equal(L.successCount(player(st, 'A')), 6);
  const before = cur(st);
  st = L.apply(st, (s) => L.correctThrow(s, 'A', 6, O));
  assert.equal(L.isPassed(player(st, 'A')), true);
  assert.equal(player(st, 'A').throws.length, 7);
  assert.equal(cur(st), before);
  st = L.undo(st);
  assert.equal(L.successCount(player(st, 'A')), 6);
  // 同じ値・範囲外は無効
  assert.equal(L.correctThrow(st.session, 'A', 0, O), null);
  assert.equal(L.correctThrow(st.session, 'A', 7, O), null);
});

test('No.11 個別終了者の成功が7未満になったら終了解除。記録中は手番を変えずに巡回へ戻る', () => {
  let st = start(['A', 'B', 'C']);
  for (let i = 0; i < 7; i++) st = play(st, [X, O, X]);
  st = hit(st, X);
  st = end(st); // B 終了
  st = play(st, [X, X]); // C, A
  assert.equal(cur(st), 'C');
  st = L.apply(st, (s) => L.correctThrow(s, 'B', 0, X));
  assert.equal(player(st, 'B').endedEarly, false);
  assert.equal(player(st, 'B').throws.length, 7);
  assert.equal(cur(st), 'C');
  st = hit(st, X); // C → A
  st = hit(st, X); // A → B（巡回に復帰）
  assert.equal(cur(st), 'B');
  assert.equal(player(st, 'B').throws.length, 7);
  assert.equal(player(st, 'A').throws.length, 10, '他の人の記録は保持');
});

test('No.11 結果画面での訂正で終了解除されたら、記録画面のその本人の次の投球から再開', () => {
  let st = start(['A', 'B']);
  for (let i = 0; i < 7; i++) st = play(st, [O, X]);
  st = end(st); // A 終了 → B
  st = play(st, [X, X, X, X, X]); // B 12投
  assert.equal(st.session.screen, 'results');
  st = L.apply(st, (s) => L.correctThrow(s, 'A', 3, X));
  assert.equal(st.session.screen, 'playing');
  assert.equal(cur(st), 'A');
  assert.equal(player(st, 'A').endedEarly, false);
  assert.equal(player(st, 'B').throws.length, 12);
  st = hit(st, O);
  assert.equal(player(st, 'A').throws.length, 8);
  assert.equal(cur(st), 'A', 'Bは完了済みなのでAだけが続ける');
  // 結果画面で12投完了者の訂正は結果画面のまま
  let st2 = start(['A']);
  st2 = play(st2, Array(12).fill(X));
  st2 = L.apply(st2, (s) => L.correctThrow(s, 'A', 0, O));
  assert.equal(st2.session.screen, 'results');
});

test('No.13 画面表示時と手番が食い違う入力（連打・二重送信）は無視される', () => {
  let st = start(['A', 'B']);
  const shown = expectOf(st); // Aの画面
  st = L.apply(st, (s) => L.recordThrow(s, O, shown));
  const again = L.apply(st, (s) => L.recordThrow(s, O, shown)); // 同じ画面からもう一度
  assert.equal(again, st);
  assert.equal(player(st, 'B').throws.length, 0);
  // 結果画面では入力できない
  let st2 = start(['A']);
  st2 = play(st2, Array(12).fill(O));
  assert.equal(L.recordThrow(st2.session, O), null);
});

test('No.12 保存データの復元と検証', () => {
  let st = start(['A', 'B']);
  for (let i = 0; i < 7; i++) st = play(st, [O, X]);
  st = end(st);
  st = { ...st, draft: { count: 2, names: ['A', 'B', '', ''], grade: 12 } };
  const back = L.parseStore(JSON.stringify(st));
  assert.deepEqual(back.store, st);
  assert.equal(L.canUndo(back.store), true);

  assert.ok(L.parseStore('{壊れた').error);
  assert.ok(L.parseStore(JSON.stringify({ ...st, schemaVersion: 99 })).error);
  const bad = (mut) => {
    const c = structuredClone(st);
    mut(c.session);
    return L.parseStore(JSON.stringify(c)).error;
  };
  assert.ok(bad((s) => { s.grade = 0; }));
  assert.ok(bad((s) => { s.players.push({ ...s.players[0], id: 'Z' }, { ...s.players[0], id: 'Y' }, { ...s.players[0], id: 'W' }); }));
  assert.ok(bad((s) => { s.players[1].throws = Array(13).fill(false); }));
  assert.ok(bad((s) => { s.players[1].throws[0] = 1; }));
  assert.ok(bad((s) => { s.players[0].throws = [false]; })); // 成功7未満で個別終了
  assert.ok(bad((s) => { s.currentPlayerId = 'A'; })); // 終了済みの人が手番
  assert.ok(bad((s) => { s.screen = 'results'; }));
  // 取り消し履歴だけが壊れている場合は履歴を捨てて読み込む
  const c = structuredClone(st);
  c.undo[0] = { broken: true };
  const r = L.parseStore(JSON.stringify(c));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.store.undo, []);
  // 記録なし（設定だけ）
  assert.deepEqual(L.parseStore(JSON.stringify(L.emptyStore())).store, L.emptyStore());
});
