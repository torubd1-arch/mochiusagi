// js/readingData.js
// よみかたモードの問題データを組み立てる。js/parser.js が KANJI_DATA を
// 組み立てるのと同じ役割 (集約 + 検証済み配列のエクスポート)。

// 3年生ぶんは200問を5バッチ(_g3q_batch1〜5.js)に分けて作成したため、ここでまとめる。
const READING_QUESTIONS_GRADE3 = [
  ...READING_QUESTIONS_GRADE3_BATCH1,
  ...READING_QUESTIONS_GRADE3_BATCH2,
  ...READING_QUESTIONS_GRADE3_BATCH3,
  ...READING_QUESTIONS_GRADE3_BATCH4,
  ...READING_QUESTIONS_GRADE3_BATCH5,
];

const READING_QUESTIONS = validateReadingQuestions([
  ...READING_QUESTIONS_GENERAL,
  ...READING_QUESTIONS_TEXTBOOK,
  ...READING_QUESTIONS_GRADE3,
]);
