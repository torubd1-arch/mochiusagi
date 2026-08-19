// js/readingData.js
// よみかたモードの問題データを組み立てる。js/parser.js が KANJI_DATA を
// 組み立てるのと同じ役割 (集約 + 検証済み配列のエクスポート)。

const READING_QUESTIONS = validateReadingQuestions([
  ...READING_QUESTIONS_GENERAL,
  ...READING_QUESTIONS_TEXTBOOK,
]);
