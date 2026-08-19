// js/data/readingQuestionsTextbook.js
// よみかたモード - 教科書問題データ (sourceType: "textbook")
//
// 実際の教科書での掲載単元・語彙が確認できたものだけをここに追加してください。
// 教科書名・学年・単元・掲載語が未確認の段階で、推測により問題を追加しては
// いけません（js/readingValidator.js は sourceType:"textbook" であっても
// 内容の出典確認までは行わないため、登録前の確認はデータ提供者側の責任です）。
//
// 現時点では確認済みの教科書語彙がないため、意図的に空にしています。
// 追加する際は js/data/readingQuestionsGeneral.js と同じ形式で、
// textbookUnit に単元名、sourceName に教科書名・出版社等を明記してください。

const READING_QUESTIONS_TEXTBOOK = [];
