import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl, urlLabel, normalizeNote, importantNotes, notesInCategory, masteredNotes, needsRelease,
  saveNote, setImportant, setMastered, deleteNote, reorderCategory, buildBackup, parseBackup,
} from '../js/logic.js';
import { loadNotes, saveNotes, STORAGE_KEY, BROKEN_KEY } from '../js/store.js';

const AT = '2026-11-01T00:00:00.000Z';

function note(id, category = 'iron', extra = {}) {
  return { id, title: id, category, memo: '', urls: [], important: false, mastered: false, createdAt: AT, updatedAt: AT, ...extra };
}

function fields(extra = {}) {
  return { title: '左足に体重', category: 'driver', memo: '', urls: [], important: false, mastered: false, ...extra };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
}

const ids = (list) => list.map((n) => n.id);
const threeImportant = () => ['a', 'b', 'c'].map((id) => note(id, 'iron', { important: true }));

test('動画URLは https に整え、危険なスキームは受け付けない', () => {
  assert.equal(normalizeUrl(' https://youtu.be/abc?t=10 '), 'https://youtu.be/abc?t=10');
  assert.equal(normalizeUrl('youtu.be/abc'), 'https://youtu.be/abc');
  assert.equal(normalizeUrl('http://example.com/v'), 'https://example.com/v');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd', 'vbscript:x', 'https://user:pw@example.com/', 'https://', 'abc', 'a b.com', '', null, 1,
  ]) {
    assert.equal(normalizeUrl(bad), null, String(bad));
  }
});

test('リンクの表示名', () => {
  assert.equal(urlLabel('https://www.youtube.com/watch?v=1'), 'YouTube');
  assert.equal(urlLabel('https://m.youtube.com/watch?v=1'), 'YouTube');
  assert.equal(urlLabel('https://youtu.be/1'), 'YouTube');
  assert.equal(urlLabel('https://www.example.com/a'), 'example.com');
});

test('追加と編集。編集しても作成日時と順番は変わらない', () => {
  const added = saveNote([note('a')], fields({ title: '  追加  ', memo: ' メモ ' }));
  assert.equal(added.length, 2);
  assert.equal(added[1].title, '追加');
  assert.equal(added[1].memo, 'メモ');

  const notes = [note('a'), note('b')];
  const edited = saveNote(notes, { ...notes[0], title: '変更' }, { now: new Date('2026-12-01T00:00:00.000Z') });
  assert.deepEqual(ids(edited), ['a', 'b']);
  assert.equal(edited[0].title, '変更');
  assert.equal(edited[0].createdAt, AT);
  assert.notEqual(edited[0].updatedAt, AT);
  assert.equal(notes[0].title, 'a', '元の配列は変更しない');
});

test('カテゴリを変えると移動先の末尾に入る', () => {
  const notes = [note('a', 'iron'), note('b', 'iron'), note('c', 'putter')];
  const next = saveNote(notes, { ...notes[0], category: 'putter' });
  assert.deepEqual(ids(notesInCategory(next, 'putter')), ['c', 'a']);
  assert.deepEqual(ids(notesInCategory(next, 'iron')), ['b']);
});

test('最重要は3件まで', () => {
  const notes = [...threeImportant(), note('d')];
  assert.equal(needsRelease(notes, 'd'), true);
  assert.equal(needsRelease(notes, 'a'), false, '指定済みの本人の編集は上限に当たらない');
  assert.equal(setImportant(notes, 'd', true), null);
  assert.equal(saveNote(notes, fields({ important: true })), null);
  assert.ok(saveNote(notes, { ...notes[0], title: '変更' }), '指定済みの注意点は編集できる');
});

test('解除先を指定すると4件目を最重要にできる', () => {
  const notes = [...threeImportant(), note('d')];
  const next = setImportant(notes, 'd', true, { releaseId: 'b' });
  assert.deepEqual(ids(next.filter((n) => n.important)), ['a', 'c', 'd']);
});

test('習得済みにすると最重要が解除され、枠が空く。復帰しても最重要には戻らない', () => {
  const notes = [...threeImportant(), note('d')];
  const next = setMastered(notes, 'a', true);
  assert.equal(next[0].important, false);
  assert.deepEqual(ids(masteredNotes(next)), ['a']);
  assert.equal(needsRelease(next, 'd'), false);
  assert.ok(!ids(notesInCategory(next, 'iron')).includes('a'));

  const restored = setMastered(next, 'a', false);
  assert.equal(restored[0].mastered, false);
  assert.equal(restored[0].important, false);

  const both = saveNote([], fields({ important: true, mastered: true }));
  assert.equal(both[0].important, false);
});

test('ホームの最重要はカテゴリ順で、習得済みを含まない', () => {
  const notes = [
    note('p', 'putter', { important: true }),
    note('d', 'driver', { important: true }),
    note('m', 'iron', { important: true, mastered: true }),
  ];
  assert.deepEqual(ids(importantNotes(notes)), ['d', 'p']);
});

test('削除', () => {
  assert.deepEqual(ids(deleteNote([note('a'), note('b')], 'a')), ['b']);
});

test('並び替えは指定カテゴリの中だけで行う', () => {
  const notes = [note('a'), note('x', 'putter'), note('b'), note('m', 'iron', { mastered: true }), note('c')];
  const next = reorderCategory(notes, 'iron', ['c', 'a', 'b']);
  assert.deepEqual(ids(next), ['c', 'x', 'a', 'm', 'b']);
  assert.equal(reorderCategory(notes, 'iron', ['c', 'a']), notes, '件数が合わなければ変えない');
  assert.equal(reorderCategory(notes, 'iron', ['c', 'a', 'zzz']), notes, '知らないIDなら変えない');
});

test('バックアップを書き出して復元すると元に戻る', () => {
  const notes = [note('a', 'iron', { memo: '<b>メモ</b>', urls: ['https://youtu.be/x'], important: true }), note('b', 'other', { mastered: true })];
  assert.deepEqual(parseBackup(JSON.stringify(buildBackup(notes))), notes);
  assert.deepEqual(parseBackup(JSON.stringify(buildBackup([]))), []);
});

test('不正なバックアップは全体を受け付けない', () => {
  const backup = (notes, extra = {}) => JSON.stringify({ ...buildBackup(notes), ...extra });
  const good = note('a');
  const cases = [
    ['壊れたJSON', '{'],
    ['null', 'null'],
    ['配列', '[]'],
    ['別アプリ', backup([good], { app: 'taskkun' })],
    ['未対応の版', backup([good], { version: 2 })],
    ['notesなし', JSON.stringify({ app: 'golfmemo', version: 1 })],
    ['1件だけ不正', backup([good, { id: 'b' }])],
    ['タイトルなし', backup([note('a', 'iron', { title: '  ' })])],
    ['不明なカテゴリ', backup([note('a', 'wedge')])],
    ['危険なURL', backup([note('a', 'iron', { urls: ['javascript:alert(1)'] })])],
    ['ID重複', backup([good, good])],
    ['最重要4件', backup([...threeImportant(), note('d', 'iron', { important: true })])],
  ];
  for (const [name, text] of cases) assert.throws(() => parseBackup(text), Error, name);
});

test('検証では余計な項目を捨て、習得済みの最重要を解除する', () => {
  const n = normalizeNote({ ...note('a', 'iron', { important: true, mastered: true }), onclick: 'x' });
  assert.equal(n.important, false);
  assert.equal('onclick' in n, false);
});

test('保存と読み込み', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadNotes(storage), [], '初回は0件');
  assert.equal(saveNotes([note('a')], storage), true);
  assert.deepEqual(loadNotes(storage), [note('a')]);
  assert.equal(storage.data.has(BROKEN_KEY), false);
});

test('保存に失敗したら false を返す', () => {
  const storage = { setItem() { throw new Error('quota'); } };
  assert.equal(saveNotes([], storage), false);
});

test('読めないデータは消さずに退避する', () => {
  const broken = memoryStorage({ [STORAGE_KEY]: '{壊れた' });
  assert.deepEqual(loadNotes(broken), []);
  assert.equal(broken.data.get(BROKEN_KEY), '{壊れた');

  const raw = JSON.stringify({ version: 1, notes: [note('a'), { id: 'bad' }] });
  const partial = memoryStorage({ [STORAGE_KEY]: raw });
  assert.deepEqual(ids(loadNotes(partial)), ['a']);
  assert.equal(partial.data.get(BROKEN_KEY), raw);
});
