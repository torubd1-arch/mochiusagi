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

// KANJI_DATA配列を構築 (KANJIVG_DATA + GRADE1_CHARACTERS から)
const KANJI_DATA = GRADE1_CHARACTERS.map(meta => {
  const kvg = KANJIVG_DATA[meta.char];
  if (!kvg) {
    console.warn(`[parser] "${meta.char}" のKanjiVGデータが見つかりません`);
    return null;
  }
  return {
    ...meta,
    strokeCount: kvg.strokes.length,
    strokes: kvg.strokes.map((s, i) => ({
      id: i + 1,
      label: getStrokeLabel(s.type),
      path: s.d,
    })),
  };
}).filter(Boolean);
