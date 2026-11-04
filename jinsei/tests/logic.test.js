import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseFuzzyDate, buildFuzzyDate, formatFuzzyDate, todayFuzzy, normalizeItem, buildItem, updateItem, againItem,
  foldText, filterItems, sortWishes, sortMemories, groupTimeline, countItems, pickRandom,
  buildManifest, parseManifest, planMerge, needsBackupReminder, formatBytes, photoPath,
} from '../js/logic.js';
import { createZip, readZip, crc32 } from '../js/zip.js';

const AT = '2026-11-01T00:00:00.000Z';

function item(id, extra = {}) {
  return {
    id, title: id, kind: 'wish', category: '', favorite: false, archived: false, note: '', date: '', photoIds: [],
    createdAt: AT, updatedAt: AT, ...extra,
  };
}

const ids = (list) => list.map((it) => it.id);

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

test('曖昧な日付を読み書きできる', () => {
  assert.deepEqual(parseFuzzyDate(''), { precision: 'none' });
  assert.deepEqual(parseFuzzyDate('1990s'), { precision: 'decade', year: 1990 });
  assert.deepEqual(parseFuzzyDate('2024'), { precision: 'year', year: 2024 });
  assert.deepEqual(parseFuzzyDate('2024-05'), { precision: 'month', year: 2024, month: 5 });
  assert.deepEqual(parseFuzzyDate('2024-02-29'), { precision: 'day', year: 2024, month: 2, day: 29 });
  for (const bad of ['2023-02-29', '2024-13', '1995s', '1800', '24', '2024-5', 'abc', null, 2024]) {
    assert.equal(parseFuzzyDate(bad), null, String(bad));
  }
  assert.equal(formatFuzzyDate('1990s'), '1990年代');
  assert.equal(formatFuzzyDate('2024-05'), '2024年5月');
  assert.equal(formatFuzzyDate('2024-05-03'), '2024年5月3日');
  assert.equal(formatFuzzyDate(''), '');
});

test('入力欄から日付文字列を作る。足りなければ null', () => {
  assert.equal(buildFuzzyDate({ precision: 'none' }), '');
  assert.equal(buildFuzzyDate({ precision: 'decade', year: '1997' }), '1990s');
  assert.equal(buildFuzzyDate({ precision: 'year', year: '2001' }), '2001');
  assert.equal(buildFuzzyDate({ precision: 'month', year: '2001', month: '3' }), '2001-03');
  assert.equal(buildFuzzyDate({ precision: 'day', year: '2001', month: '3', day: '9' }), '2001-03-09');
  assert.equal(buildFuzzyDate({ precision: 'day', year: '2001', month: '2', day: '30' }), null);
  assert.equal(buildFuzzyDate({ precision: 'year', year: '' }), null);
  assert.equal(buildFuzzyDate({ precision: 'year', year: '99' }), null);
  assert.equal(buildFuzzyDate({ precision: 'decade', year: '' }), null);
  assert.equal(todayFuzzy(new Date(2026, 0, 5)), '2026-01-05');
});

test('項目の検証。不正なものは null', () => {
  assert.deepEqual(normalizeItem(item('a', { kind: 'done', date: '2020', photoIds: ['p1'] })), item('a', { kind: 'done', date: '2020', photoIds: ['p1'] }));
  for (const bad of [
    null, {}, item(''), item('a', { title: '  ' }), item('a', { kind: 'x' }), item('a', { category: 'nope' }),
    item('a', { favorite: 1 }), item('a', { date: '2020-99' }), item('a', { photoIds: ['p', 'p'] }),
    item('a', { photoIds: 'p' }), item('a', { createdAt: 'x' }), item('a', { note: null }),
  ]) {
    assert.equal(normalizeItem(bad), null, JSON.stringify(bad));
  }
});

test('タイトルだけで登録でき、編集しても作成日時と保管状態は変わらない', () => {
  assert.equal(buildItem({ title: '   ' }), null);
  const a = buildItem({ title: ' オーロラを見る ' }, null, AT);
  assert.equal(a.title, 'オーロラを見る');
  assert.equal(a.kind, 'wish');
  assert.equal(a.category, '');
  assert.equal(a.date, '');
  assert.deepEqual(a.photoIds, []);
  assert.ok(normalizeItem(a));

  const archived = { ...a, archived: true };
  const b = buildItem({ title: '見た', kind: 'done', category: 'travel', date: '2025-01', note: 'きれい', favorite: true }, archived, '2026-12-01T00:00:00.000Z');
  assert.equal(b.id, a.id);
  assert.equal(b.createdAt, AT);
  assert.equal(b.updatedAt, '2026-12-01T00:00:00.000Z');
  assert.equal(b.archived, true);
  assert.equal(b.category, 'travel');
  assert.equal(b.date, '2025-01');
  assert.ok(normalizeItem(b));
  // 不正なカテゴリ・日付は空にする
  const c = buildItem({ title: 'x', category: 'nope', date: '2025-99' });
  assert.equal(c.category, '');
  assert.equal(c.date, '');
});

test('更新は元のオブジェクトを変えない。もう一度やりたいは別の項目になる', () => {
  const a = item('a', { kind: 'done', category: 'food', note: 'おいしかった', photoIds: ['p'], favorite: true });
  const b = updateItem(a, { favorite: false }, '2026-12-01T00:00:00.000Z');
  assert.equal(a.favorite, true);
  assert.equal(b.favorite, false);
  const again = againItem(a, '2026-12-02T00:00:00.000Z');
  assert.notEqual(again.id, a.id);
  assert.equal(again.kind, 'wish');
  assert.equal(again.title, a.title);
  assert.equal(again.category, 'food');
  assert.equal(again.note, '');
  assert.deepEqual(again.photoIds, []);
});

test('検索はひらがな・カタカナ・全角半角を区別しない', () => {
  assert.equal(foldText('ＡＢＣ　カタカナ'), 'abc かたかな');
  const list = [
    item('a', { title: 'ハワイ旅行', category: 'travel' }),
    item('b', { title: 'ラーメン巡り', note: '博多', category: 'food' }),
    item('c', { title: 'フルマラソン' }),
  ];
  assert.deepEqual(ids(filterItems(list, { query: 'はわい' })), ['a']);
  assert.deepEqual(ids(filterItems(list, { query: '博多' })), ['b']);
  assert.deepEqual(ids(filterItems(list, { query: 'グルメ' })), ['b']); // カテゴリ名
  assert.deepEqual(ids(filterItems(list, { query: 'ラーメン 博多' })), ['b']);
  assert.deepEqual(ids(filterItems(list, { query: 'ラーメン ハワイ' })), []);
});

test('状態・カテゴリ・お気に入りで絞り込む', () => {
  const list = [
    item('w', { category: 'travel', favorite: true }),
    item('d', { kind: 'done', category: 'travel' }),
    item('x', { archived: true }),
    item('xd', { kind: 'done', archived: true }),
    item('n'),
  ];
  assert.deepEqual(ids(filterItems(list, { status: 'wish' })), ['w', 'n']);
  assert.deepEqual(ids(filterItems(list, { status: 'done' })), ['d']);
  assert.deepEqual(ids(filterItems(list, { status: 'archived' })), ['x', 'xd']);
  assert.deepEqual(ids(filterItems(list, { status: 'all' })), ['w', 'd', 'x', 'xd', 'n']);
  assert.deepEqual(ids(filterItems(list, { category: 'travel' })), ['w', 'd']);
  assert.deepEqual(ids(filterItems(list, { status: 'wish', category: 'none' })), ['n']);
  assert.deepEqual(ids(filterItems(list, { favoriteOnly: true })), ['w']);
  assert.deepEqual(countItems(list), { wish: 2, done: 1, archived: 2 });
});

test('並び順と年表', () => {
  const wishes = [item('old', { createdAt: '2026-01-01T00:00:00.000Z' }), item('new', { createdAt: '2026-02-01T00:00:00.000Z' })];
  assert.deepEqual(ids(sortWishes(wishes)), ['new', 'old']);

  const mem = [
    item('none'),
    item('d1990', { date: '1990s' }),
    item('y2020', { date: '2020' }),
    item('m2020', { date: '2020-03' }),
    item('day2020', { date: '2020-03-01' }),
    item('y1995', { date: '1995' }),
    item('y2024', { date: '2024-12-31' }),
  ];
  assert.deepEqual(ids(sortMemories(mem)), ['y2024', 'day2020', 'm2020', 'y2020', 'y1995', 'd1990', 'none']);
  const groups = groupTimeline(mem);
  assert.deepEqual(groups.map((g) => g.label), ['2024年', '2020年', '1995年', '1990年代', '日付なし']);
  assert.deepEqual(ids(groups[1].items), ['day2020', 'm2020', 'y2020']);
});

test('ガチャは直前と同じ項目をなるべく避ける', () => {
  const list = [item('a'), item('b')];
  for (let i = 0; i < 20; i += 1) assert.equal(pickRandom(list, 'a').id, 'b');
  assert.equal(pickRandom([item('a')], 'a').id, 'a');
  assert.equal(pickRandom([], null), null);
  assert.equal(pickRandom(list, null, () => 0.99).id, 'b');
});

test('ZIP の書き出しと読み込みが往復する（日本語のファイル名・空ファイルも）', async () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'data.json', data: enc.encode('{"a":"あいう"}') },
    { name: 'photos/写真.jpg', data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]) },
    { name: 'empty.txt', data: new Uint8Array(0) },
  ];
  const zip = readZip(concat(createZip(files)));
  assert.deepEqual(zip.names, files.map((f) => f.name));
  for (const f of files) assert.deepEqual(await zip.read(f.name), f.data);
  assert.equal(zip.has('nope'), false);
  await assert.rejects(zip.read('nope'));
});

test('ZIP の壊れたデータは読み込みで検出する', async () => {
  const bytes = concat(createZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]));
  bytes[30 + 5] ^= 0xff; // 中身を1バイト壊す
  await assert.rejects(readZip(bytes).read('a.txt'), /壊れています/);
  assert.throws(() => readZip(new Uint8Array(100)), /ZIP/);
});

test('deflate で圧縮された ZIP（ほかのアプリで作り直したもの）も読める', async () => {
  const text = new TextEncoder().encode('あいうえお'.repeat(50));
  const comp = deflateRawSync(text);
  const name = new TextEncoder().encode('data.json');
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(text), true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, text.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const cd = new Uint8Array(46 + name.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(text), true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, text.length, true);
  cv.setUint16(28, name.length, true);
  cd.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  const zip = readZip(concat([local, comp, cd, end]));
  assert.deepEqual(await zip.read('data.json'), text);
});

function backupFixture() {
  const items = [item('a', { kind: 'done', photoIds: ['p2', 'p1'] }), item('b')];
  const photos = [
    { id: 'p1', itemId: 'a', type: 'image/jpeg', thumbType: 'image/jpeg', width: 10, height: 20 },
    { id: 'p2', itemId: 'a', type: 'image/jpeg', thumbType: 'image/jpeg', width: 30, height: 40 },
  ];
  const manifest = buildManifest(items, photos, AT);
  const files = new Set(manifest.photos.flatMap((p) => [p.file, p.thumb]));
  return { items, manifest, files };
}

test('バックアップの data.json を検証して読み込める', () => {
  const { items, manifest, files } = backupFixture();
  assert.equal(photoPath('p1', 'image/jpeg'), 'photos/p1.jpg');
  assert.equal(photoPath('p1', 'image/jpeg', true), 'thumbs/p1.jpg');
  const r = parseManifest(JSON.stringify(manifest), (f) => files.has(f));
  assert.deepEqual(r.items, items);
  assert.deepEqual(r.photos.map((p) => p.id), ['p1', 'p2']);
  assert.equal(r.exportedAt, AT);
});

test('バックアップに1か所でも不正があれば全体を拒否する', () => {
  const { manifest, files } = backupFixture();
  const has = (f) => files.has(f);
  const broken = (mutate) => {
    const m = structuredClone(manifest);
    mutate(m);
    return JSON.stringify(m);
  };
  assert.throws(() => parseManifest('not json', has), /読み取れません/);
  assert.throws(() => parseManifest(broken((m) => { m.app = 'golfmemo'; }), has), /ではありません/);
  assert.throws(() => parseManifest(broken((m) => { m.version = 99; }), has), /バージョン/);
  assert.throws(() => parseManifest(broken((m) => { m.items[0].title = ''; }), has), /項目/);
  assert.throws(() => parseManifest(broken((m) => { m.items.push(m.items[0]); }), has), /重複/);
  assert.throws(() => parseManifest(broken((m) => { m.photos[0].file = '../evil.jpg'; }), has), /写真/);
  assert.throws(() => parseManifest(broken((m) => { m.photos[0].itemId = 'zzz'; }), has), /写真/);
  assert.throws(() => parseManifest(broken((m) => { m.items[0].photoIds.push('p9'); }), has), /対応/);
  assert.throws(() => parseManifest(broken((m) => { m.photos[1].itemId = 'b'; }), has), /対応/);
  // ZIP に写真ファイルが入っていない
  assert.throws(() => parseManifest(JSON.stringify(manifest), (f) => f !== 'photos/p1.jpg'), /欠けて/);
});

test('統合では同じ項目は更新日時が新しい方を残し、置き換えた項目の古い写真は消す', () => {
  const local = [
    item('same-newer-local', { updatedAt: '2026-12-01T00:00:00.000Z' }),
    item('same-newer-backup', { photoIds: ['old', 'keep'] }),
    item('local-only'),
  ];
  const backup = [
    item('same-newer-local', { title: '古い' }),
    item('same-newer-backup', { photoIds: ['keep', 'new'], updatedAt: '2026-12-02T00:00:00.000Z' }),
    item('backup-only', { photoIds: ['b1'] }),
  ];
  const photos = [
    { id: 'keep', itemId: 'same-newer-backup' },
    { id: 'new', itemId: 'same-newer-backup' },
    { id: 'b1', itemId: 'backup-only' },
    { id: 'x', itemId: 'same-newer-local' },
  ];
  const plan = planMerge(local, backup, photos);
  assert.deepEqual(ids(plan.putItems), ['same-newer-backup', 'backup-only']);
  assert.deepEqual(ids(plan.putPhotos), ['keep', 'new', 'b1']);
  assert.deepEqual(plan.deletePhotoIds, ['old']);
});

test('バックアップを促すタイミング', () => {
  const now = Date.parse('2026-11-04T00:00:00.000Z');
  assert.equal(needsBackupReminder({ itemCount: 0 }, now), false);
  assert.equal(needsBackupReminder({ itemCount: 4 }, now), false);
  assert.equal(needsBackupReminder({ itemCount: 5 }, now), true);
  const old = '2026-09-01T00:00:00.000Z';
  assert.equal(needsBackupReminder({ itemCount: 9, lastBackupAt: old, lastChangeAt: '2026-10-01T00:00:00.000Z' }, now), true);
  // バックアップ後に変更がなければ促さない
  assert.equal(needsBackupReminder({ itemCount: 9, lastBackupAt: old, lastChangeAt: '2026-08-01T00:00:00.000Z' }, now), false);
  assert.equal(needsBackupReminder({ itemCount: 9, lastBackupAt: '2026-10-20T00:00:00.000Z', lastChangeAt: '2026-11-01T00:00:00.000Z' }, now), false);
});

test('容量の表示', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(undefined), '-');
});
