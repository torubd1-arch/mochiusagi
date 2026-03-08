// js/validator.js
// KANJIデータの整合性検証 + 「小」の筆順コンソール確認

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
    console.log(`[validator] ✅ 全${KANJI_DATA.length}字のデータ検証OK (小学1年生80字)`);
  }
}
