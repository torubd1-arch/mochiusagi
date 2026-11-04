import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateKey, addDays, isDateKey, weekStart, monthMatrix, tasksForDate, createTask, completedDateOf,
  parseBackup, buildBackup,
} from '../js/logic.js';
import { loadTasks, saveTasks } from '../js/store.js';

const TODAY = '2026-10-30';

// ローカル時刻で完了日時を作る
function at(key, hour = 12) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
}

function task(id, date, completedOn = null) {
  return { id, text: id, date, createdAt: at(date, 9), completedAt: completedOn ? at(completedOn) : null };
}

const ids = (list) => list.map((t) => t.id);

test('日付キーはローカル日付で、月末・年末をまたいで加算できる', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(toDateKey(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.ok(isDateKey('2028-02-29'));
  assert.ok(!isDateKey('2026-02-30'));
  assert.ok(!isDateKey('2026/10/30'));
});

test('週は日曜始まり、月間カレンダーは週単位で埋まる', () => {
  assert.equal(weekStart('2026-10-30'), '2026-10-25');
  assert.equal(weekStart('2026-10-25'), '2026-10-25');
  const m = monthMatrix(2026, 9); // 2026年10月（1日は木曜）
  assert.equal(m.length, 35);
  assert.equal(m[0], '2026-09-27');
  assert.equal(m[4], '2026-10-01');
  assert.equal(m.at(-1), '2026-10-31');
});

test('当日に登録した未完了タスクが表示される', () => {
  const r = tasksForDate([task('a', TODAY)], TODAY, TODAY);
  assert.deepEqual(ids(r.open), ['a']);
  assert.deepEqual(r.done, []);
});

test('未完了タスクは起動しなかった日も含めて今日まで繰り越され、複製されない', () => {
  const tasks = [task('old', '2026-10-27')];
  for (const day of ['2026-10-27', '2026-10-28', '2026-10-29', TODAY]) {
    assert.deepEqual(ids(tasksForDate(tasks, day, TODAY).open), ['old'], day);
  }
  assert.deepEqual(ids(tasksForDate(tasks, '2026-10-26', TODAY).open), []);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].date, '2026-10-27'); // 登録日は書き換わらない
});

test('日付が変わると、前日の未完了タスクが新しい今日に出る', () => {
  const tasks = [task('x', TODAY)];
  const tomorrow = addDays(TODAY, 1);
  assert.deepEqual(ids(tasksForDate(tasks, tomorrow, TODAY).open), []); // 今日の時点では明日の予測は出さない
  assert.deepEqual(ids(tasksForDate(tasks, tomorrow, tomorrow).open), ['x']); // 翌日になれば繰り越し
  assert.deepEqual(ids(tasksForDate(tasks, addDays(TODAY, 5), addDays(TODAY, 5)).open), ['x']);
});

test('将来の日付には、その日に登録したタスクだけを出す', () => {
  const tasks = [task('carry', '2026-10-20'), task('future', '2026-11-03'), task('other', '2026-11-04')];
  assert.deepEqual(ids(tasksForDate(tasks, '2026-11-03', TODAY).open), ['future']);
  assert.deepEqual(ids(tasksForDate(tasks, TODAY, TODAY).open), ['carry']);
});

test('完了タスクは完了日まで表示され、翌日以降は出ない', () => {
  const tasks = [task('d', '2026-10-27', '2026-10-29')];
  assert.equal(completedDateOf(tasks[0]), '2026-10-29');
  assert.deepEqual(ids(tasksForDate(tasks, '2026-10-29', TODAY).done), ['d']);
  assert.deepEqual(ids(tasksForDate(tasks, '2026-10-28', TODAY).done), ['d']);
  assert.deepEqual(tasksForDate(tasks, TODAY, TODAY).done, []);
  assert.deepEqual(tasksForDate(tasks, TODAY, TODAY).open, []);
});

test('将来の予定を前倒しで完了した場合は、その予定日に完了として出る', () => {
  const tasks = [task('early', '2026-11-02', TODAY)];
  assert.deepEqual(ids(tasksForDate(tasks, '2026-11-02', TODAY).done), ['early']);
  assert.deepEqual(tasksForDate(tasks, TODAY, TODAY).done, []);
});

test('チェックを外すと未完了に戻り、再び繰り越される', () => {
  const t = task('u', '2026-10-27', '2026-10-28');
  t.completedAt = null;
  assert.deepEqual(ids(tasksForDate([t], TODAY, TODAY).open), ['u']);
});

test('未完了は登録日順、完了は完了日時順に並ぶ', () => {
  const tasks = [task('b', TODAY), task('a', '2026-10-28'), task('z', TODAY, TODAY), task('y', '2026-10-29', TODAY)];
  tasks[2].completedAt = at(TODAY, 15);
  tasks[3].completedAt = at(TODAY, 10);
  const r = tasksForDate(tasks, TODAY, TODAY);
  assert.deepEqual(ids(r.open), ['a', 'b']);
  assert.deepEqual(ids(r.done), ['y', 'z']);
});

test('createTask は必要な項目を持つ', () => {
  const t = createTask('牛乳を買う', TODAY, new Date(2026, 9, 30, 8));
  assert.equal(typeof t.id, 'string');
  assert.equal(t.text, '牛乳を買う');
  assert.equal(t.date, TODAY);
  assert.equal(t.completedAt, null);
  assert.ok(!Number.isNaN(Date.parse(t.createdAt)));
});

test('バックアップを書き出して復元すると同じ内容に戻る', () => {
  const tasks = [task('a', TODAY), task('b', '2026-10-01', '2026-10-02')];
  const json = JSON.stringify(buildBackup(tasks));
  assert.deepEqual(parseBackup(json), tasks);
});

test('不正なバックアップは日本語のエラーになり、壊れた行・重複は除外される', () => {
  assert.throws(() => parseBackup('not json'), /JSON/);
  assert.throws(() => parseBackup('{"foo":1}'), /見つかりません/);
  assert.throws(() => parseBackup('{"tasks":[{"id":1}]}'), /読み込めるタスク/);
  const good = task('a', TODAY);
  const r = parseBackup(JSON.stringify({ tasks: [good, good, { ...good, id: 'bad', date: '2026-13-01' }] }));
  assert.deepEqual(ids(r), ['a']);
  assert.deepEqual(parseBackup('{"tasks":[]}'), []);
});

test('localStorage に保存したデータを読み戻せる', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const tasks = [task('a', TODAY)];
  assert.ok(saveTasks(tasks, storage));
  assert.deepEqual(loadTasks(storage), tasks);
  assert.deepEqual(loadTasks({ getItem: () => '{broken' }), []);
  assert.equal(saveTasks(tasks, { setItem() { throw new Error('QuotaExceeded'); } }), false);
});
