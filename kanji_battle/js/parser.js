// js/parser.js
// KanjiVGデータからKANJI_DATA配列を構築する

// kvg:type → 日本語ラベル マッピング
// サフィックス (a, b等) と スラッシュ以降を除去してからマッピングする
const STROKE_TYPE_MAP = {
  '㇐': 'よこ',
  '㇑': 'たて',
  '㇒': 'ひだりはらい',
  '㇓': 'ひだりはらい',
  '㇏': 'みぎはらい',
  '㇔': 'てん',
  '㇚': 'たて',       // 縦画(折れ付き) — 「小」の中央縦画など
  '㇕': 'まがり',
  '㇆': 'まがり',
  '㇄': 'まがり',
  '㇗': 'まがり',
  '㇙': 'まがり',
  '㇛': 'まがり',
  '㇀': 'よこ',       // 横折れ
  '㇇': 'まがり',     // 折れ払い (水・夕・名など)
  '㇖': 'まがり',     // 横折れ折れ (子・字・学など)
  '㇁': 'まがり',     // 湾曲ゴール (子・字・学など)
  '㇈': 'まがり',     // 湾曲折れゴール (九・気など)
  '㇜': 'まがり',     // 複雑な折れ (糸など)
  '㇟': 'まがり',     // 複雑な折れゴール (見・四・花・先など)
  '㇉': 'まがり',     // 弟など (U+31C9)
  '㇂': 'まがり',     // 3年生の漢字で登場する折れ(U+31C2)
  '㇃': 'まがり',     // 3年生の漢字で登場する折れ(U+31C3)
  '㇋': 'まがり',     // 3年生の漢字で登場する折れ(U+31CB)

};

function getStrokeLabel(type) {
  // スラッシュで区切られた複合タイプ (例: "㇔/㇒") は最初の部分を使用
  const firstPart = type.split('/')[0];
  // サフィックス(a, b, c等)を除去して基本文字を取得
  // kvg:typeは通常1文字のCJK記号 + 任意の英字サフィックス
  const base = firstPart.replace(/[a-zA-Z]+$/, '');
  const label = STROKE_TYPE_MAP[base];
  if (!label) {
    console.warn(`[parser] 未知のストロークタイプ: "${type}" → fallback: "よこ"`);
    return 'よこ';
  }
  return label;
}

// 共通ビルダー関数
function buildKanjiEntries(characters, kvgData, grade) {
  return characters.map(meta => {
    const kvg = kvgData[meta.char];
    if (!kvg) {
      console.warn(`[parser] "${meta.char}" のKanjiVGデータが見つかりません (grade${grade})`);
      return null;
    }
    return {
      ...meta,
      grade,
      strokeCount: kvg.strokes.length,
      strokes: kvg.strokes.map((s, i) => ({
        id: i + 1,
        label: getStrokeLabel(s.type),
        path: s.d,
      })),
    };
  }).filter(Boolean);
}

// 3年生データは200字を5バッチ(_g3_batch1〜5.js / _g3char_batch1〜5.js)に分けて
// 取得したため、ここでひとつのオブジェクト/配列にまとめる。
const KANJIVG_DATA_GRADE3 = Object.assign(
  {},
  KANJIVG_DATA_GRADE3_BATCH1,
  KANJIVG_DATA_GRADE3_BATCH2,
  KANJIVG_DATA_GRADE3_BATCH3,
  KANJIVG_DATA_GRADE3_BATCH4,
  KANJIVG_DATA_GRADE3_BATCH5
);
const GRADE3_CHARACTERS = [].concat(
  GRADE3_CHARACTERS_BATCH1,
  GRADE3_CHARACTERS_BATCH2,
  GRADE3_CHARACTERS_BATCH3,
  GRADE3_CHARACTERS_BATCH4,
  GRADE3_CHARACTERS_BATCH5
);

// 4年生データも200字ぶんと同様に5バッチに分けて取得したため、ここでまとめる。
const KANJIVG_DATA_GRADE4 = Object.assign(
  {},
  KANJIVG_DATA_GRADE4_BATCH1,
  KANJIVG_DATA_GRADE4_BATCH2,
  KANJIVG_DATA_GRADE4_BATCH3,
  KANJIVG_DATA_GRADE4_BATCH4,
  KANJIVG_DATA_GRADE4_BATCH5
);
const GRADE4_CHARACTERS = [].concat(
  GRADE4_CHARACTERS_BATCH1,
  GRADE4_CHARACTERS_BATCH2,
  GRADE4_CHARACTERS_BATCH3,
  GRADE4_CHARACTERS_BATCH4,
  GRADE4_CHARACTERS_BATCH5
);

// KANJI_DATA配列を構築 (1年生 + 2年生 + 3年生 + 4年生)
const KANJI_DATA = [
  ...buildKanjiEntries(GRADE1_CHARACTERS, KANJIVG_DATA,        1),
  ...buildKanjiEntries(GRADE2_CHARACTERS, KANJIVG_DATA_GRADE2, 2),
  ...buildKanjiEntries(GRADE3_CHARACTERS, KANJIVG_DATA_GRADE3, 3),
  ...buildKanjiEntries(GRADE4_CHARACTERS, KANJIVG_DATA_GRADE4, 4),
];
