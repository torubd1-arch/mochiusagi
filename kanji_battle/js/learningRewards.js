// js/learningRewards.js
// よみかたモード・かんじをえらぶモードの両方で共通のモンスター取得/進化/レベルアップ
// 判定と、セッション終了時のまとめ演出再生。読み方向に依存する処理は一切含まない
// (targetKanjiとセッション状態だけを見る)ため、main.js/storage.js/evolutions.jsの
// 既存関数を両モードから安全に共有できる。

// 正解時に呼ぶ。モンスター取得/進化/レベルアップを判定し、セッション終了時に
// まとめて演出するため sessionState.pendingReveals に積む。
// Storage.saveResult/checkEvolutionUnlock 自体は既存の冪等な実装をそのまま呼ぶだけ
// なので、同じ漢字を(同一問題内でも、別の問題からでも)何度正解しても二重付与にはならない。
function queueLearningReward(sessionState, targetKanji, isFirstAttemptThisSession) {
  const kData = KANJI_DATA.find(k => k.char === targetKanji);
  if (!kData) return;

  const isNew = !Storage.isCleared(targetKanji);
  const stars = isFirstAttemptThisSession ? 3 : 2;
  const prevLevel = Storage.getLevel();
  Storage.saveResult(targetKanji, stars);
  const newLevel = Storage.getLevel();

  if (isNew && !sessionState.capturedThisSession.has(targetKanji)) {
    sessionState.capturedThisSession.add(targetKanji);
    sessionState.pendingReveals.push({ type: 'capture', kData, stars });
  }

  const unlockedChain = checkEvolutionUnlock(targetKanji);
  if (unlockedChain && !sessionState.evolvedThisSession.has(unlockedChain.id)) {
    sessionState.evolvedThisSession.add(unlockedChain.id);
    const showCompleteEffect = !Storage.hasSeenChainEffect(unlockedChain.id);
    if (showCompleteEffect) {
      Storage.markChainComplete(unlockedChain.id);
      Storage.markChainEffectSeen(unlockedChain.id);
    }
    sessionState.pendingReveals.push({ type: 'evolution', chain: unlockedChain, showCompleteEffect });
  }

  if (newLevel > prevLevel) {
    sessionState.pendingReveals.push({ type: 'levelup', level: newLevel });
  }
}

// セッション終了時、pendingRevealsを順番にawaitしながら再生する。
// isCancelledFn() はループの毎回チェックする — 演出の待機中に「もどる」等で
// セッションが中断された場合、残りの演出を出さずに即座に打ち切るため。
async function playPendingReveals(sessionState, isCancelledFn) {
  for (const reveal of sessionState.pendingReveals) {
    if (isCancelledFn()) return false;
    if (reveal.type === 'capture') {
      await showCaptureOverlay(reveal.kData, reveal.stars);
    } else if (reveal.type === 'evolution') {
      await showEvolutionOverlay(reveal.chain);
      if (reveal.showCompleteEffect) await triggerChainCompleteEffect(reveal.chain);
    } else if (reveal.type === 'levelup') {
      await showLevelUpOverlay(reveal.level);
    }
  }
  return !isCancelledFn();
}
