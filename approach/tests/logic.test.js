import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, ALL_DISTANCES, normalizeSettings, toggleDistance, validateSettings, buildSequence, distributeCounts,
  createSession, currentShot, recordShot, undoShot, isFinished, completeSession, abortSession, isValidJudgement,
  summarize, summarizeByDistance, summarizeByClub, overallShots, recentTrend, sortHistory, deleteSession,
  formatRate, createTapGuard, normalizeSession,
} from '../js/logic.js';

/** 再現できる乱数（mulberry32） */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date('2026-11-17T10:00:00.000Z');
const settings = (extra = {}) => ({ ...DEFAULT_SETTINGS, randomDistances: [...DEFAULT_SETTINGS.randomDistances], ...extra });

/** 判定の並びからセッションを作って記録する。例：['s', 'n:duff', 'f:top'] */
function play(session, marks) {
  const map = { s: 'success', n: 'near', f: 'failure' };
  return marks.reduce((acc, m) => {
    const [r, miss] = m.split(':');
    return recordShot(acc, map[r], miss ?? null);
  }, session);
}

function countBy(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

// ---- 練習設定 ----

test('初期設定は 30球・SW・ランダム（10/15/20yd）、固定は15yd', () => {
  assert.deepEqual(normalizeSettings(undefined), {
    mode: 'random', totalShots: 30, club: 'SW', randomDistances: [10, 15, 20], fixedDistance: 15,
  });
});

test('ランダムと固定を切り替えられ、球数とクラブの選択が保持される', () => {
  const s = normalizeSettings({ mode: 'fixed', totalShots: 20, club: 'AW', fixedDistance: 40, randomDistances: [5, 50] });
  assert.deepEqual(s, { mode: 'fixed', totalShots: 20, club: 'AW', randomDistances: [5, 50], fixedDistance: 40 });
  assert.equal(normalizeSettings({ ...s, mode: 'random' }).mode, 'random');
  // 不正な値は初期値に戻す
  const bad = normalizeSettings({ mode: 'x', totalShots: 25, club: 'DR', fixedDistance: 21, randomDistances: [3, 60] });
  assert.deepEqual(bad, normalizeSettings(undefined));
});

test('選択肢（5・10・15・20・25・30・40・50yd）以外は指定できない', () => {
  assert.deepEqual(ALL_DISTANCES, [5, 10, 15, 20, 25, 30, 40, 50]);
  for (const bad of [4, 7, 12, 24, 60, 70, 12.5, '10']) {
    assert.deepEqual(toggleDistance([10, 15], bad), [10, 15], String(bad));
    assert.match(validateSettings(settings({ mode: 'fixed', fixedDistance: bad })), /選んでください/, String(bad));
  }
  assert.match(validateSettings(settings({ randomDistances: [10, 60] })), /5・10・15・20・25・30・40・50yd/);
  assert.throws(() => createSession(settings({ mode: 'fixed', fixedDistance: 7 })));
  // 古い設定に選択肢外の距離が残っていても読み込み時に外す
  assert.deepEqual(normalizeSettings({ randomDistances: [7, 10, 25, 60], fixedDistance: 60 }).randomDistances, [10, 25]);
  assert.equal(normalizeSettings({ fixedDistance: 60 }).fixedDistance, 15);
});

test('固定距離はすべての選択肢を指定できる', () => {
  for (const d of ALL_DISTANCES) {
    assert.equal(validateSettings(settings({ mode: 'fixed', fixedDistance: d })), null);
  }
});

test('ランダムは複数距離を選べ、1種類では開始できない', () => {
  let list = toggleDistance([], 50);
  list = toggleDistance(list, 5);
  list = toggleDistance(list, 30);
  assert.deepEqual(list, [5, 30, 50]);
  assert.deepEqual(toggleDistance(list, 30), [5, 50]); // もう一度押すと外れる
  assert.equal(validateSettings(settings({ randomDistances: [5, 50] })), null);
  assert.match(validateSettings(settings({ randomDistances: [40] })), /2つ以上/);
  assert.match(validateSettings(settings({ randomDistances: [] })), /2つ以上/);
  assert.match(validateSettings(settings({ randomDistances: [40, 40] })), /2つ以上/);
  assert.throws(() => createSession(settings({ randomDistances: [40] })), /2つ以上/);
});

// ---- 出題 ----

test('ランダム出題：10・15・20yd × 30球は各10回', () => {
  const seq = buildSequence([10, 15, 20], 30, seeded(1));
  assert.equal(seq.length, 30);
  assert.deepEqual([...countBy(seq).entries()].sort((a, b) => a[0] - b[0]), [[10, 10], [15, 10], [20, 10]]);
});

test('ランダム出題：割り切れない場合も回数の差は最大1回、同じ距離は連続しない', () => {
  const cases = [
    [[10, 15, 20], 20], [[10, 15, 20], 10], [[5, 50], 10], [[5, 50], 30], [[25, 30, 40, 50], 30],
    [ALL_DISTANCES, 10], [ALL_DISTANCES, 20], [ALL_DISTANCES, 30], [[5, 15, 25, 40, 50], 20], [[5, 10, 20, 25, 30, 40, 50], 30],
  ];
  for (let seed = 1; seed <= 300; seed++) {
    for (const [ds, total] of cases) {
      const seq = buildSequence(ds, total, seeded(seed));
      assert.equal(seq.length, total);
      assert.ok(seq.every((d) => ds.includes(d)));
      const counts = ds.map((d) => countBy(seq).get(d) ?? 0);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${ds} ${total} seed=${seed}: ${counts}`);
      for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `連続: ${seq} seed=${seed}`);
    }
  }
});

test('ランダム出題：端数を受け持つ距離は偏らない（毎回同じ距離が多くならない）', () => {
  const extra = new Map();
  for (let seed = 1; seed <= 300; seed++) {
    const counts = distributeCounts([10, 15, 20], 20, seeded(seed));
    for (const [d, c] of counts) if (c === 7) extra.set(d, (extra.get(d) ?? 0) + 1);
  }
  for (const d of [10, 15, 20]) assert.ok(extra.get(d) > 120, `${d}: ${extra.get(d)}`);
});

test('ランダム出題：毎回同じ並びにはならない', () => {
  const a = buildSequence([10, 15, 20], 30, seeded(1)).join();
  const b = buildSequence([10, 15, 20], 30, seeded(2)).join();
  assert.notEqual(a, b);
});

test('セッション開始時に全出題順を確定する', () => {
  const s = createSession(settings({ totalShots: 20 }), { now: NOW, rng: seeded(5), id: 'a' });
  assert.equal(s.status, 'active');
  assert.equal(s.mode, 'random');
  assert.equal(s.club, 'SW');
  assert.deepEqual(s.selectedDistances, [10, 15, 20]);
  assert.equal(s.distanceSequence.length, 20);
  assert.deepEqual(s.shots, []);
  assert.equal(s.startedAt, NOW.toISOString());
});

test('固定距離モードは全球同じ距離・同じクラブ', () => {
  let s = createSession(settings({ mode: 'fixed', fixedDistance: 15, club: 'AW', totalShots: 20 }), { now: NOW, id: 'f' });
  assert.deepEqual(s.selectedDistances, [15]);
  assert.deepEqual(s.distanceSequence, Array(20).fill(15));
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(currentShot(s), { shotNumber: i + 1, targetDistance: 15, club: 'AW' });
    s = recordShot(s, i % 2 ? 'success' : 'failure', i % 2 ? null : 'top');
  }
  assert.ok(s.shots.every((x) => x.targetDistance === 15 && x.club === 'AW' && x.mode === 'fixed'));
  assert.equal(currentShot(s), null);
  assert.ok(isFinished(s));
});

// ---- 練習中（判定） ----

test('表示する距離・クラブは出題順どおり', () => {
  let s = createSession(settings({ club: '7I', totalShots: 10 }), { rng: seeded(3), id: 'x' });
  for (let i = 0; i < 10; i++) {
    const cur = currentShot(s);
    assert.equal(cur.shotNumber, i + 1);
    assert.equal(cur.targetDistance, s.distanceSequence[i]);
    assert.equal(cur.club, '7I');
    s = recordShot(s, 'success');
  }
});

test('○ はミス原因なしで記録し、次の球へ進む', () => {
  const s0 = createSession(settings(), { rng: seeded(1), id: 'x' });
  const s1 = recordShot(s0, 'success');
  assert.equal(s1.shots.length, 1);
  assert.deepEqual(s1.shots[0], { shotNumber: 1, targetDistance: s0.distanceSequence[0], club: 'SW', mode: 'random', result: 'success', missType: null });
  assert.equal(currentShot(s1).shotNumber, 2);
  assert.equal(s0.shots.length, 0); // 元のセッションは変えない
  assert.throws(() => recordShot(s0, 'success', 'duff'));
});

test('△× はミス原因が必須（1つだけ）', () => {
  const s0 = createSession(settings(), { rng: seeded(1), id: 'x' });
  assert.throws(() => recordShot(s0, 'near'));
  assert.throws(() => recordShot(s0, 'failure', null));
  assert.throws(() => recordShot(s0, 'failure', 'slice'));
  assert.equal(recordShot(s0, 'near', 'duff').shots[0].missType, 'duff');
  for (const t of ['top', 'duff', 'short', 'over', 'other']) assert.equal(recordShot(s0, 'failure', t).shots[0].missType, t);
});

test('トップは × でしか記録できない', () => {
  const s0 = createSession(settings(), { rng: seeded(1), id: 'x' });
  assert.throws(() => recordShot(s0, 'near', 'top'));
  assert.throws(() => recordShot(s0, 'success', 'top'));
  assert.equal(isValidJudgement('near', 'top'), false);
  assert.equal(isValidJudgement('success', 'top'), false);
  assert.equal(isValidJudgement('failure', 'top'), true);
});

test('全球入力後や練習中でないセッションには記録できない', () => {
  let s = createSession(settings({ totalShots: 10 }), { rng: seeded(1), id: 'x' });
  for (let i = 0; i < 10; i++) s = recordShot(s, 'success');
  assert.throws(() => recordShot(s, 'success'), /全球/);
  assert.throws(() => recordShot(completeSession(s), 'success'));
});

test('二重タップは1回分しか受け付けない', () => {
  let t = 1000;
  const guard = createTapGuard(450, () => t);
  let s = createSession(settings(), { rng: seeded(1), id: 'x' });
  const tap = () => { if (guard.tryAcquire()) s = recordShot(s, 'success'); };
  tap();
  t += 80; tap(); // 80ms 後の2回目は無視
  assert.equal(s.shots.length, 1);
  t += 500; tap(); // 十分に間をあければ次の球として受け付ける
  assert.equal(s.shots.length, 2);
});

test('1球戻ると直前の結果だけ取り消し、出題順は変わらない', () => {
  const s0 = createSession(settings(), { rng: seeded(9), id: 'x' });
  const seq = [...s0.distanceSequence];
  const s3 = play(s0, ['s', 'n:short', 'f:top']);
  const back = undoShot(s3);
  assert.equal(back.shots.length, 2);
  assert.deepEqual(back.shots, s3.shots.slice(0, 2));
  assert.deepEqual(back.distanceSequence, seq);
  assert.deepEqual(currentShot(back), { shotNumber: 3, targetDistance: seq[2], club: 'SW' });
  // 再入力できる
  const again = recordShot(back, 'success');
  assert.equal(again.shots[2].result, 'success');
  assert.equal(again.shots[2].targetDistance, seq[2]);
  // 記録がないときは何もしない
  assert.equal(undoShot(s0), s0);
});

test('完了・途中終了で状態と終了日時が入る', () => {
  const s = play(createSession(settings(), { rng: seeded(1), id: 'x' }), ['s']);
  const end = new Date('2026-11-17T10:20:00.000Z');
  assert.deepEqual([completeSession(s, end).status, completeSession(s, end).endedAt], ['completed', end.toISOString()]);
  assert.deepEqual([abortSession(s, end).status, abortSession(s, end).shots.length], ['aborted', 1]);
});

// ---- 集計 ----

/** 距離・クラブ・判定を指定して完了セッションを作る */
function sessionOf(id, { mode = 'random', club = 'SW', status = 'completed', startedAt = NOW.toISOString(), shots }) {
  const total = shots.length <= 10 ? 10 : shots.length <= 20 ? 20 : 30;
  const seq = [...shots.map((x) => x[0])];
  while (seq.length < total) seq.push(10);
  const map = { s: 'success', n: 'near', f: 'failure' };
  return {
    id, startedAt, endedAt: startedAt, status, mode, club, totalShots: total,
    selectedDistances: [...new Set(seq)].sort((a, b) => a - b), distanceSequence: seq,
    shots: shots.map(([d, m], i) => {
      const [r, miss] = m.split(':');
      return { shotNumber: i + 1, targetDistance: d, club, mode, result: map[r], missType: miss ?? null };
    }),
  };
}

test('成功率・トップ率・その他ミス率', () => {
  // 10球：○7 △1(ダフリ) ×2(トップ1・オーバー1)
  const marks = ['s', 's', 's', 's', 's', 's', 's', 'n:duff', 'f:top', 'f:over'];
  const sum = summarize(play(createSession(settings({ totalShots: 10 }), { rng: seeded(1), id: 'x' }), marks).shots);
  assert.deepEqual(
    [sum.total, sum.success, sum.near, sum.failure, sum.top, sum.otherMiss],
    [10, 7, 1, 2, 1, 2],
  );
  assert.equal(sum.successRate, 70); // △は分子に含めない
  assert.equal(sum.topRate, 10);
  assert.equal(sum.otherMissRate, 20); // △のダフリも含む
  assert.equal(formatRate(sum.successRate), '70.0%');
});

test('割合は小数第1位まで、打球0は「—」', () => {
  const sum = summarize([
    { result: 'success', missType: null }, { result: 'failure', missType: 'top' }, { result: 'failure', missType: 'top' },
  ]);
  assert.equal(formatRate(sum.successRate), '33.3%');
  assert.equal(formatRate(sum.topRate), '66.7%');
  const empty = summarize([]);
  assert.equal(empty.successRate, null);
  assert.equal(formatRate(empty.successRate), '—');
  assert.equal(formatRate(empty.topRate), '—');
});

test('距離別集計', () => {
  const s = sessionOf('a', {
    shots: [[10, 's'], [15, 'f:top'], [20, 's'], [10, 'n:short'], [15, 's'], [20, 'f:over'], [10, 's'], [15, 's'], [20, 'f:top'], [10, 's']],
  });
  const rows = summarizeByDistance(s.shots);
  assert.deepEqual(rows.map((r) => [r.distance, r.total, r.success, r.near, r.failure, r.top]), [
    [10, 4, 3, 1, 0, 0],
    [15, 3, 2, 0, 1, 1],
    [20, 3, 1, 0, 2, 1],
  ]);
  assert.equal(rows[0].successRate, 75);
  assert.equal(formatRate(rows[1].topRate), '33.3%');
});

test('クラブ別集計（固定距離モードのクラブも含む・打球0のクラブは「—」）', () => {
  const history = [
    sessionOf('a', { mode: 'random', club: 'SW', shots: [[10, 's'], [15, 'f:top'], [20, 's'], [10, 's']] }),
    sessionOf('b', { mode: 'fixed', club: 'AW', shots: [[15, 's'], [15, 'f:top'], [15, 'n:duff'], [15, 's'], [15, 's']] }),
  ];
  const rows = summarizeByClub(overallShots(history));
  assert.deepEqual(rows.map((r) => [r.club, r.total, r.success, r.top]), [['7I', 0, 0, 0], ['PW', 0, 0, 0], ['AW', 5, 3, 1], ['SW', 4, 3, 1]]);
  assert.equal(rows[2].successRate, 60);
  assert.equal(rows[2].topRate, 20);
  assert.equal(formatRate(rows[0].successRate), '—');
});

test('固定距離モードの球もクラブ付きで記録され、全体集計に入る', () => {
  let s = createSession(settings({ mode: 'fixed', fixedDistance: 15, club: 'AW', totalShots: 10 }), { id: 'f', now: NOW });
  for (let i = 0; i < 10; i++) s = recordShot(s, 'success');
  const history = [completeSession(s)];
  const aw = summarizeByClub(overallShots(history)).find((r) => r.club === 'AW');
  assert.equal(aw.total, 10);
  assert.equal(aw.successRate, 100);
  assert.deepEqual(summarizeByDistance(overallShots(history)).map((r) => r.distance), [15]);
});

test('途中終了は通常集計に含めない', () => {
  const history = [
    sessionOf('a', { shots: [[10, 's'], [10, 's']] }),
    sessionOf('b', { status: 'aborted', shots: [[10, 'f:top'], [10, 'f:top'], [10, 'f:top']] }),
  ];
  const all = summarize(overallShots(history));
  assert.equal(all.total, 2);
  assert.equal(all.topRate, 0);
  assert.equal(recentTrend(history).length, 1);
  // 途中終了は打球済み分の参考成績として計算できる
  assert.equal(summarize(history[1].shots).topRate, 100);
});

test('履歴は新しい順、成績推移は直近10回', () => {
  const history = Array.from({ length: 12 }, (_, i) => sessionOf(`s${i}`, {
    startedAt: new Date(NOW.getTime() + i * 86400000).toISOString(),
    shots: [[10, i % 2 ? 's' : 'f:top']],
  }));
  assert.deepEqual(sortHistory(history).slice(0, 3).map((s) => s.id), ['s11', 's10', 's9']);
  const trend = recentTrend(history, 10);
  assert.equal(trend.length, 10);
  assert.deepEqual(trend.map((t) => t.id).slice(0, 2), ['s11', 's10']);
  assert.equal(trend[0].successRate, 100);
  assert.equal(trend[1].topRate, 100);
});

test('履歴を削除すると集計結果が変わる', () => {
  const history = [
    sessionOf('a', { shots: [[10, 's'], [10, 's']] }),
    sessionOf('b', { shots: [[10, 'f:top'], [10, 's']] }),
  ];
  assert.equal(summarize(overallShots(history)).successRate, 75);
  const next = deleteSession(history, 'b');
  assert.deepEqual(next.map((s) => s.id), ['a']);
  assert.equal(summarize(overallShots(next)).successRate, 100);
  assert.equal(summarize(overallShots(next)).topRate, 0);
});

// ---- 保存データの検証 ----

test('保存データの検証：正しいセッションは通し、不正なものは null', () => {
  const s = play(createSession(settings(), { rng: seeded(1), id: 'x', now: NOW }), ['s', 'f:top']);
  assert.deepEqual(normalizeSession(JSON.parse(JSON.stringify(s))), s);
  const broken = (patch) => normalizeSession({ ...JSON.parse(JSON.stringify(s)), ...patch });
  assert.equal(broken({ club: 'DR' }), null);
  assert.equal(broken({ totalShots: 25 }), null);
  assert.equal(broken({ distanceSequence: s.distanceSequence.slice(1) }), null);
  assert.equal(broken({ shots: [{ ...s.shots[0], result: 'near', missType: 'top' }] }), null);
  assert.equal(broken({ shots: [{ ...s.shots[0], targetDistance: 99 }] }), null);
  assert.equal(normalizeSession(null), null);
});
