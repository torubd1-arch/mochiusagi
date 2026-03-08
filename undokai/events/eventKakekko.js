// 競技1: かけっこ（Decathlonの100m走を流用）
window.EventKakekko = (function () {
  return {
    id: 'kakekko',
    name: 'かけっこ',

    getDescription() {
      return [
        '🏃 よーい、ドン！ダイス8個を前半4個・後半4個に分けて振るよ',
        '気に入らなかったら振り直せるよ（合計5回まで）',
        '得点：8個の合計（でも6が出ると-6点！転んじゃったイメージ）',
      ];
    },

    init() {
      return {
        phase: 'first', // 'first' | 'second' | 'done'
        firstDice: null,
        secondDice: null,
        rerollsLeft: 5,
        log: [],
      };
    },

    getDiceDisplay(s) {
      const dice = [];
      if (s.phase === 'first') {
        const fd = s.firstDice || [null, null, null, null];
        fd.forEach(v => dice.push({ value: v, kept: false, clickable: false }));
      } else if (s.phase === 'second') {
        (s.firstDice || []).forEach(v => dice.push({ value: v, kept: true, clickable: false }));
        const sd = s.secondDice || [null, null, null, null];
        sd.forEach(v => dice.push({ value: v, kept: false, clickable: false }));
      } else {
        (s.firstDice || []).forEach(v => dice.push({ value: v, kept: true, clickable: false }));
        (s.secondDice || []).forEach(v => dice.push({ value: v, kept: true, clickable: false }));
      }
      return dice;
    },

    getStatusText(s) {
      const ph = s.phase === 'first' ? '前半（1〜4個目）' : s.phase === 'second' ? '後半（5〜8個目）' : '完了';
      return `フェーズ: ${ph} ／ 振り直し残り: ${s.rerollsLeft}回`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (s.phase === 'first') {
        if (!s.firstDice) return [{ id: 'ROLL', label: '🎲 ロール（前半）', enabled: true }];
        return [
          { id: 'REROLL', label: `♻️ 振り直し（残${s.rerollsLeft}）`, enabled: s.rerollsLeft > 0 },
          { id: 'CONFIRM', label: '✅ 前半確定 → 後半へ', enabled: true },
        ];
      }
      if (s.phase === 'second') {
        if (!s.secondDice) return [{ id: 'ROLL', label: '🎲 ロール（後半）', enabled: true }];
        return [
          { id: 'REROLL', label: `♻️ 振り直し（残${s.rerollsLeft}）`, enabled: s.rerollsLeft > 0 },
          { id: 'CONFIRM', label: '🏁 後半確定・ゴール！', enabled: true },
        ];
      }
      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        if (s.phase === 'first') {
          s.firstDice = rollDice(4);
          s.log.push(`[前半] ロール: [${s.firstDice.join(', ')}]`);
        } else if (s.phase === 'second') {
          s.secondDice = rollDice(4);
          s.log.push(`[後半] ロール: [${s.secondDice.join(', ')}]`);
        }
      } else if (type === 'REROLL') {
        s.rerollsLeft--;
        if (s.phase === 'first') {
          s.firstDice = rollDice(4);
          s.log.push(`[前半] 振り直し: [${s.firstDice.join(', ')}] (残${s.rerollsLeft})`);
        } else if (s.phase === 'second') {
          s.secondDice = rollDice(4);
          s.log.push(`[後半] 振り直し: [${s.secondDice.join(', ')}] (残${s.rerollsLeft})`);
        }
      } else if (type === 'CONFIRM') {
        if (s.phase === 'first') {
          s.phase = 'second';
          s.log.push(`[前半] 確定: [${s.firstDice.join(', ')}]`);
        } else if (s.phase === 'second') {
          s.phase = 'done';
          const all = [...s.firstDice, ...s.secondDice];
          s.log.push(`[後半] 確定: [${s.secondDice.join(', ')}]`);
          s.log.push(`全8個: [${all.join(', ')}] → ${scoreMinusSix(all)}点`);
        }
      }
      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      if (!s.firstDice || !s.secondDice) return { points: 0, details: '未完了' };
      const all = [...s.firstDice, ...s.secondDice];
      const pts = scoreMinusSix(all);
      return { points: pts, details: `[${all.join(', ')}] → ${pts}点（6は-6扱い）` };
    },
  };
})();
