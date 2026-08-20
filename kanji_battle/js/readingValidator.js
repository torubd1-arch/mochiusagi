// js/readingValidator.js
// よみかたモード問題データの検証。
//
// js/validator.js との違い: validator.js は診断のみで KANJI_DATA を絞り込まない。
// こちらは不正な問題を実際に出題対象から除外する必要があるため
// (仕様: 不正データは別問題で補完せず出題対象から除外する)、
// validateReadingQuestions() はフィルタ済みの配列を返す。
//
// 純粋関数のみ。DOM に触れない。テスト (test-reading.html) から直接呼び出せる。

const ALLOWED_SOURCE_TYPES = ['textbook', 'general'];

// 1問分の形式検証。seenIds は id重複チェック用に呼び出し側で使い回すSet。
function validateReadingQuestionShape(q, seenIds) {
  const reasons = [];

  if (!q || typeof q !== 'object') {
    return { valid: false, reasons: ['問題オブジェクトが不正です'] };
  }

  if (!q.id || typeof q.id !== 'string') {
    reasons.push('idが未設定または不正です');
  } else if (seenIds && seenIds.has(q.id)) {
    reasons.push(`id "${q.id}" が重複しています`);
  }

  if (q.grade !== 1 && q.grade !== 2 && q.grade !== 3 && q.grade !== 4 && q.grade !== 5) {
    reasons.push(`grade(${q.grade})が対応範囲外です(1・2・3・4・5のみ)`);
  }

  if (!q.targetKanji || typeof q.targetKanji !== 'string') {
    reasons.push('targetKanjiが未設定です');
  } else if (typeof KANJI_DATA === 'undefined') {
    reasons.push('KANJI_DATAが未定義のためtargetKanjiを検証できません');
  } else {
    // 完全一致のみ。類似漢字・部分一致・フォールバックは禁止。
    const kanjiEntry = KANJI_DATA.find(k => k.char === q.targetKanji);
    if (!kanjiEntry) {
      reasons.push(`targetKanji "${q.targetKanji}" がKANJI_DATAに存在しません(完全一致なし)`);
    } else if (kanjiEntry.grade !== q.grade) {
      // 学年不一致はソフト警告に留める(語彙としてはgradeどおりでも
      // 対象漢字自体の学年が異なる正当なケースがあり得るため、除外はしない)。
      console.warn(`[readingValidator] "${q.id}": grade(${q.grade})と対象漢字「${q.targetKanji}」の学年(${kanjiEntry.grade})が一致しません(警告のみ・除外はしません)`);
    }
  }

  if (!q.targetReading || typeof q.targetReading !== 'string' || q.targetReading.trim() === '') {
    reasons.push('targetReadingが空です');
  }

  const distractors = Array.isArray(q.distractors) ? q.distractors : [];
  const cleanDistractors = distractors.filter(d => typeof d === 'string' && d.trim() !== '');
  if (cleanDistractors.length !== distractors.length) {
    reasons.push('distractorsに空文字または不正な値が含まれています');
  }
  if (q.targetReading && cleanDistractors.includes(q.targetReading)) {
    reasons.push('distractorsに正解と同じ読みが含まれています');
  }
  const uniqueDistractors = new Set(cleanDistractors);
  if (uniqueDistractors.size !== cleanDistractors.length) {
    reasons.push('distractors内に重複があります');
  }
  const usableDistractorCount = new Set(cleanDistractors.filter(d => d !== q.targetReading)).size;
  if (usableDistractorCount < 1) {
    reasons.push('有効な誤答候補が1件もありません');
  }

  if (!ALLOWED_SOURCE_TYPES.includes(q.sourceType)) {
    reasons.push(`sourceType "${q.sourceType}" が許可値ではありません`);
  }

  return { valid: reasons.length === 0, reasons };
}

// 問題配列を検証し、不正な問題を除外したものを返す。
// 除外された問題は console.warn で id と理由を報告する。
function validateReadingQuestions(list) {
  const seenIds = new Set();
  const valid = [];
  let excludedCount = 0;

  (list || []).forEach(q => {
    const result = validateReadingQuestionShape(q, seenIds);
    if (result.valid && q.enabled !== false) {
      seenIds.add(q.id);
      valid.push(q);
    } else {
      excludedCount++;
      const idLabel = q && q.id ? q.id : '(id不明)';
      if (!result.valid) {
        console.warn(`[readingValidator] 除外: "${idLabel}" - ${result.reasons.join(' / ')}`);
      } else {
        console.log(`[readingValidator] 除外: "${idLabel}" - enabled=false`);
      }
      if (q && q.id) seenIds.add(q.id); // 以降の重複検知のためidは記録しておく
    }
  });

  if (excludedCount === 0) {
    console.log(`[readingValidator] ✅ よみかた問題 全${valid.length}件 検証OK`);
  } else {
    console.warn(`[readingValidator] ❌ よみかた問題 ${excludedCount}件を除外しました (有効: ${valid.length}件)`);
  }

  return valid;
}

// ========== かんじをえらぶモード用: kanjiDistractors 検証 + 同音異義の衝突検出 ==========
// validateReadingQuestionShape/validateReadingQuestions は変更しない(追加のみ)。

// 1問分の kanjiDistractors を検証し、有効な候補だけを返す。
// (類似漢字・部分一致・フォールバックは禁止 — 完全一致のみ)
function validateKanjiDistractorsShape(q) {
  const reasons = [];
  const raw = Array.isArray(q.kanjiDistractors) ? q.kanjiDistractors : [];
  const clean = [];

  raw.forEach(char => {
    if (typeof char !== 'string' || char.trim() === '') {
      reasons.push('kanjiDistractorsに空文字または不正な値が含まれています');
      return;
    }
    if (char === q.targetKanji) {
      reasons.push('kanjiDistractorsに正解と同じ漢字が含まれています');
      return;
    }
    const entry = (typeof KANJI_DATA !== 'undefined') ? KANJI_DATA.find(k => k.char === char) : null;
    if (!entry) {
      reasons.push(`kanjiDistractors "${char}" がKANJI_DATAに存在しません(完全一致なし)`);
      return;
    }
    if (entry.grade !== q.grade) {
      reasons.push(`kanjiDistractors "${char}" の学年(${entry.grade})が問題の学年(${q.grade})と一致しません`);
      return;
    }
    if (entry.reading === q.targetReading) {
      // この漢字自体もtargetReadingで正しく読めてしまう → 誤答候補として不成立
      reasons.push(`kanjiDistractors "${char}" はtargetReading "${q.targetReading}" でも正しく読めるため誤答候補として使えません`);
      return;
    }
    clean.push(char);
  });

  const unique = Array.from(new Set(clean));
  if (unique.length !== clean.length) {
    reasons.push('kanjiDistractors内に重複があります');
  }

  return { valid: unique.length >= 1, distractors: unique, reasons };
}

// READING_QUESTIONS(検証済み配列)から、かんじをえらぶモードで安全に出題できる
// 問題だけを抽出する。元の配列・オブジェクトは変更しない。
//
// 除外条件:
//   - enabledModes に "readingToKanji" が含まれない
//   - kanjiDistractors が構造的に無効(有効な候補が1件もない)
//   - 同じ targetReading が異なる targetKanji の正解になり得る(同音異義の衝突)
//     例: 「き」→ 木/汽/記、「え」→ 画/絵、「あう」→ 会/合
//     このケースは、よみがなだけでは正解が一意に決まらないため、
//     意味を一意にする補助情報(meaningHint)を用意しない限り出題しない。
function computeKanjiSelectEligibility(questions) {
  const list = questions || [];
  const candidates = [];

  list.forEach(q => {
    if (!Array.isArray(q.enabledModes) || !q.enabledModes.includes('readingToKanji')) return;
    const result = validateKanjiDistractorsShape(q);
    if (!result.valid) {
      console.warn(`[readingValidator] かんじをえらぶ: 除外 "${q.id}" - ${result.reasons.join(' / ')}`);
      return;
    }
    if (result.reasons.length) {
      console.warn(`[readingValidator] かんじをえらぶ: "${q.id}" 一部の候補を除外 - ${result.reasons.join(' / ')}`);
    }
    candidates.push({ q, distractors: result.distractors });
  });

  // 同音異義の衝突検出: targetReading でグルーピングし、異なる targetKanji が
  // 複数存在するグループは全員を除外する。
  const byReading = {};
  candidates.forEach(c => {
    (byReading[c.q.targetReading] = byReading[c.q.targetReading] || []).push(c);
  });

  const eligible = [];
  Object.values(byReading).forEach(group => {
    const kanjiSet = new Set(group.map(c => c.q.targetKanji));
    if (kanjiSet.size > 1) {
      const label = group.map(c => `${c.q.targetKanji}(${c.q.id})`).join(', ');
      group.forEach(c => {
        console.warn(`[readingValidator] かんじをえらぶ: 除外 "${c.q.id}" - よみがな「${c.q.targetReading}」は複数の漢字[${label}]の正解になり得るため曖昧(同音異義)`);
      });
      return;
    }
    group.forEach(c => eligible.push(c.q));
  });

  console.log(`[readingValidator] かんじをえらぶ: ${list.length}件中 ${eligible.length}件が出題可能`);
  return eligible;
}
