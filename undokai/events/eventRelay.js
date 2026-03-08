// 競技6: リレー（新規）
window.EventRelay = (function () {
  const RUNNER_DICE = [1, 2, 3, 5]; // 各走者のダイス数
  const RUNNER_NAMES = ['第1走者', '第2走者', '第3走者', '第4走者（アンカー）'];
  const MAX_ROLLS = 3;
  const RUNNER_PHASES = ['runner1', 'runner2', 'runner3', 'runner4'];

  function runnerIndex(s) {
    return RUNNER_PHASES.indexOf(s.phase);
  }

  return {
    id: 'relay',
    name: 'リレー',

    getDescription() {
      return [
        '🏁 4人でバトンをつなごう！',
        '第1走者: 1個、第2走者: 2個、第3走者: 3個、第4走者: 5個のダイスを振るよ',
        '各走者は最大3回まで振れるよ（3回目は自動採用）',
        '各走者の得点は合計（6が出ると-6点！）。4走者の合計が最終得点！',
      ];
    },

    init() {
      return {
        phase: 'runner1', // 'runner1' | 'runner2' | 'runner3' | 'runner4' | 'done'
        runnerPhase: 'pre_roll', // 'pre_roll' | 'rolled'
        currentDice: null,
        rollCount: 0,
        runnerScores: [], // 完了した走者の得点
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (s.phase === 'done') return [];
      const idx = runnerIndex(s);
      if (!s.currentDice) {
        const n = RUNNER_DICE[idx];
        return Array(n).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
      }
      return s.currentDice.map(v => ({
        value: v,
        kept: false,
        clickable: false,
        dim: v === 6, // 6はマイナスなのでdim
      }));
    },

    getStatusText(s) {
      if (s.phase === 'done') {
        const total = s.runnerScores.reduce((a, b) => a + b, 0);
        const detail = s.runnerScores.map((sc, i) => `${RUNNER_NAMES[i]}: ${sc}点`).join(' ／ ');
        return `完了 ／ ${detail} ／ 合計: ${total}点`;
      }
      const idx = runnerIndex(s);
      const currentScore = s.currentDice ? scoreMinusSix(s.currentDice) : '-';
      const prevScores = s.runnerScores.map((sc, i) => `${RUNNER_NAMES[i]}: ${sc}点`).join(' ／ ');
      const prevPart = prevScores ? `前走者: ${prevScores} ／ ` : '';
      return `${prevPart}${RUNNER_NAMES[idx]} ／ ロール${s.rollCount}/${MAX_ROLLS}回 ／ 現在: ${currentScore}点`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      const idx = runnerIndex(s);
      const name = RUNNER_NAMES[idx];

      if (s.runnerPhase === 'pre_roll') {
        return [{ id: 'ROLL', label: `🎲 ${name}、スタート！`, enabled: true }];
      }

      if (s.runnerPhase === 'rolled') {
        const isAutoKept = s.rollCount >= MAX_ROLLS;
        const isLastRunner = idx === 3;
        const nextLabel = isLastRunner ? '🏆 ゴール！（確定）' : '🔄 次の走者へバトン！';
        const keepLabel = isAutoKept ? `✅ ${nextLabel}（自動採用）` : `✅ KEEP（${scoreMinusSix(s.currentDice)}点）`;
        return [
          { id: 'KEEP', label: keepLabel, enabled: true },
          { id: 'REROLL', label: `♻️ 振り直し（残${MAX_ROLLS - s.rollCount}回）`, enabled: !isAutoKept },
        ];
      }

      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;
      const idx = runnerIndex(s);

      if (type === 'ROLL') {
        const n = RUNNER_DICE[idx];
        s.currentDice = rollDice(n);
        s.rollCount++;
        const score = scoreMinusSix(s.currentDice);
        s.log.push(`[${RUNNER_NAMES[idx]}] ロール${s.rollCount}: [${s.currentDice.join(', ')}] = ${score}点`);
        s.runnerPhase = 'rolled';
        return s;
      }

      if (type === 'REROLL') {
        if (s.rollCount >= MAX_ROLLS) return s;
        const n = RUNNER_DICE[idx];
        s.currentDice = rollDice(n);
        s.rollCount++;
        const score = scoreMinusSix(s.currentDice);
        s.log.push(`[${RUNNER_NAMES[idx]}] 振り直し${s.rollCount}: [${s.currentDice.join(', ')}] = ${score}点`);
        if (s.rollCount >= MAX_ROLLS) {
          s.log.push(`[${RUNNER_NAMES[idx]}] 3回目 → 自動採用`);
        }
        return s;
      }

      if (type === 'KEEP') {
        const score = scoreMinusSix(s.currentDice);
        s.runnerScores.push(score);
        const nextName = idx < 3 ? RUNNER_NAMES[idx + 1] : 'ゴール！';
        s.log.push(`[${RUNNER_NAMES[idx]}] 確定: ${score}点 → ${nextName}`);

        if (idx === 3) {
          // 最終走者、ゲーム終了
          s.phase = 'done';
        } else {
          // 次の走者へ
          s.phase = RUNNER_PHASES[idx + 1];
          s.runnerPhase = 'pre_roll';
          s.currentDice = null;
          s.rollCount = 0;
        }
        return s;
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      if (s.runnerScores.length === 0) return { points: 0, details: '未完了' };
      const total = s.runnerScores.reduce((a, b) => a + b, 0);
      const detail = s.runnerScores.map((sc, i) => `${RUNNER_NAMES[i]}: ${sc}点`).join(' ／ ');
      return { points: total, details: `${detail} → 合計: ${total}点` };
    },
  };
})();
