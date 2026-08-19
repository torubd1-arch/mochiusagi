// js/kanjiSelectData.js
// かんじをえらぶモードの問題データを組み立てる。
// READING_QUESTIONS(よみかたモード用に検証済み)から、enabledModes に
// "readingToKanji" を含み、kanjiDistractorsが有効で、同音異義の衝突がない
// 問題だけを抽出する。computeKanjiSelectEligibility は readingValidator.js に定義。

const KANJI_SELECT_QUESTIONS = computeKanjiSelectEligibility(READING_QUESTIONS);
