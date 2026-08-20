// js/validator.js
// KANJIデータの整合性検証 + grade別audit

// ========== マッピング監査関数群 ==========

// 指定漢字のKanjiVGデータを完全一致のみで取得 (部分一致・フォールバック禁止)
function resolveStrokeDataForKanji(char) {
  if (typeof KANJIVG_DATA !== 'undefined' && KANJIVG_DATA[char]) {
    return { source: 'grade1', data: KANJIVG_DATA[char] };
  }
  if (typeof KANJIVG_DATA_GRADE2 !== 'undefined' && KANJIVG_DATA_GRADE2[char]) {
    return { source: 'grade2', data: KANJIVG_DATA_GRADE2[char] };
  }
  if (typeof KANJIVG_DATA_GRADE3 !== 'undefined' && KANJIVG_DATA_GRADE3[char]) {
    return { source: 'grade3', data: KANJIVG_DATA_GRADE3[char] };
  }
  if (typeof KANJIVG_DATA_GRADE4 !== 'undefined' && KANJIVG_DATA_GRADE4[char]) {
    return { source: 'grade4', data: KANJIVG_DATA_GRADE4[char] };
  }
  if (typeof KANJIVG_DATA_GRADE5 !== 'undefined' && KANJIVG_DATA_GRADE5[char]) {
    return { source: 'grade5', data: KANJIVG_DATA_GRADE5[char] };
  }
  return null;
}

// KanjiVGデータのunicodeフィールドと実際の漢字文字コードポイントが一致するか検証
function validateStrokeDataMapping() {
  let errors = 0;
  const sources = [];
  if (typeof KANJIVG_DATA !== 'undefined')       sources.push(['grade1', KANJIVG_DATA]);
  if (typeof KANJIVG_DATA_GRADE2 !== 'undefined') sources.push(['grade2', KANJIVG_DATA_GRADE2]);
  if (typeof KANJIVG_DATA_GRADE3 !== 'undefined') sources.push(['grade3', KANJIVG_DATA_GRADE3]);
  if (typeof KANJIVG_DATA_GRADE4 !== 'undefined') sources.push(['grade4', KANJIVG_DATA_GRADE4]);
  if (typeof KANJIVG_DATA_GRADE5 !== 'undefined') sources.push(['grade5', KANJIVG_DATA_GRADE5]);

  sources.forEach(([grade, data]) => {
    Object.entries(data).forEach(([char, entry]) => {
      const expected = char.codePointAt(0).toString(16).padStart(5, '0');
      const actual   = (entry.unicode || '').toLowerCase();
      if (expected !== actual) {
        console.warn(`[validateMapping] ${grade} '${char}': expected=${expected}, got=${actual} ← ${actual ? String.fromCodePoint(parseInt(actual, 16)) : 'なし'}`);
        errors++;
      }
    });
  });
  if (errors === 0) {
    console.log('[validateMapping] ✅ 全エントリのunicodeフィールド一致確認OK');
  } else {
    console.warn(`[validateMapping] ❌ ${errors}件の不一致があります`);
  }
  return errors;
}

// 全KANJI_DATAのマッピングを監査して console.table に出力
function auditAllKanjiMappings() {
  if (typeof KANJI_DATA === 'undefined') {
    console.error('[auditAllKanjiMappings] KANJI_DATA が未定義です');
    return [];
  }
  const results = KANJI_DATA.map(k => {
    const resolved = resolveStrokeDataForKanji(k.char);
    if (!resolved) {
      return { requested: k.char, loaded: 'MISSING', source: 'none', strokeCount: 0, ok: false };
    }
    const expectedUnicode = k.char.codePointAt(0).toString(16).padStart(5, '0');
    const actualUnicode   = (resolved.data.unicode || '').toLowerCase();
    const unicodeOk = expectedUnicode === actualUnicode;
    const strokeOk  = resolved.data.strokes.length === k.strokeCount;
    const loadedChar = (unicodeOk || !actualUnicode)
      ? k.char
      : String.fromCodePoint(parseInt(actualUnicode, 16));
    return {
      requested:   k.char,
      loaded:      loadedChar,
      source:      resolved.source,
      strokeCount: resolved.data.strokes.length,
      ok:          unicodeOk && strokeOk,
    };
  });

  console.table(results);
  const badEntries = results.filter(r => !r.ok);
  if (badEntries.length === 0) {
    console.log('[auditAllKanjiMappings] ✅ 全漢字マッピング確認OK');
  } else {
    console.warn('[auditAllKanjiMappings] ❌ 以下の漢字にマッピング問題があります:');
    console.table(badEntries);
  }
  return results;
}

// ========== 既存の検証関数 ==========
function validateKanjiData() {
  // 全漢字のストローク数チェック
  let hasError = false;
  KANJI_DATA.forEach(k => {
    if (!k || !k.strokes || k.strokes.length === 0) {
      console.warn(`[validator] "${k ? k.char : '?'}" strokes配列が空です`);
      hasError = true;
      return;
    }
    if (k.strokes.length !== k.strokeCount) {
      console.warn(`[validator] "${k.char}" strokeCount(${k.strokeCount}) と strokes.length(${k.strokes.length}) が一致しません`);
      hasError = true;
    }
  });

  // grade別カウント
  const g1 = KANJI_DATA.filter(k => k.grade === 1);
  const g2 = KANJI_DATA.filter(k => k.grade === 2);
  const g3 = KANJI_DATA.filter(k => k.grade === 3);
  const g4 = KANJI_DATA.filter(k => k.grade === 4);
  const g5 = KANJI_DATA.filter(k => k.grade === 5);
  const missing = [
    ...GRADE1_KANJI, ...GRADE2_KANJI,
    ...(typeof GRADE3_KANJI !== 'undefined' ? GRADE3_KANJI : []),
    ...(typeof GRADE4_KANJI !== 'undefined' ? GRADE4_KANJI : []),
    ...(typeof GRADE5_KANJI !== 'undefined' ? GRADE5_KANJI : []),
  ].filter(c => !KANJI_DATA.find(k => k.char === c));
  console.log(`[KanjiLoadAudit] grade1=${g1.length}/80 grade2=${g2.length}/${GRADE2_KANJI.length} grade3=${g3.length}/${typeof GRADE3_KANJI !== 'undefined' ? GRADE3_KANJI.length : 0} grade4=${g4.length}/${typeof GRADE4_KANJI !== 'undefined' ? GRADE4_KANJI.length : 0} grade5=${g5.length}/${typeof GRADE5_KANJI !== 'undefined' ? GRADE5_KANJI.length : 0} total=${KANJI_DATA.length}`);
  if (missing.length > 0) {
    console.warn(`[KanjiLoadAudit] missing=${JSON.stringify(missing)}`);
  }

  // 「小」の1画目検証
  const sho = KANJI_DATA.find(k => k.char === '小');
  if (sho) {
    console.group('[validator] 「小」の筆順確認');
    sho.strokes.forEach((s, i) => {
      const pathPreview = s.path.substring(0, 20) + '...';
      console.log(`  ${i + 1}画目: ${s.label} (path: ${pathPreview})`);
    });
    const firstStroke = sho.strokes[0];
    if (firstStroke && firstStroke.label === 'たて') {
      console.log('  ✅ 1画目 = たて (中央縦画) 確認済み');
    } else {
      console.warn(`  ❌ 1画目 = ${firstStroke ? firstStroke.label : '不明'} (中央縦画ではありません)`);
      hasError = true;
    }
    console.groupEnd();
  } else {
    console.warn('[validator] 「小」がKANJI_DATAに見つかりません');
    hasError = true;
  }

  if (!hasError) {
    console.log(`[validator] ✅ 全${KANJI_DATA.length}字のデータ検証OK`);
  }
}
