// Event 6: 1500m走
window.Event1500m = (function () {
  return {
    id: '1500m',
    name: '1500m走',

    getDescription() {
      return [
        '🕐 長い距離を走るよ！ダイス8個を1個ずつ振っていくよ',
        '気に入らなかったら振り直せるよ（合計5回まで）。確保ボタンで次へ！',
        '得点：8個の合計（6が出ると-6点になっちゃうよ！）',
      ];
    },

    init() {
      return {
        diceIndex: 0,       // 0..7 current die position
        confirmedDice: [],  // confirmed die values [0..7]
        currentDie: null,   // current die value (null = not rolled yet)
        rerollsLeft: 5,
        phase: 'rolling',   // 'rolling' | 'done'
        log: [],
      };
    },

    getDiceDisplay(s) {
      const dice = [];
      s.confirmedDice.forEach(v => dice.push({ value: v, kept: true, clickable: false }));
      if (s.diceIndex < 8) {
        dice.push({ value: s.currentDie, kept: false, clickable: false });
        for (let i = s.diceIndex + 1; i < 8; i++) {
          dice.push({ value: null, kept: false, clickable: false });
        }
      }
      return dice;
    },

    getStatusText(s) {
      if (s.phase === 'done') {
        const all = s.confirmedDice;
        return `完了 ／ 合計: ${scoreMinusSix(all)}点`;
      }
      const score = scoreMinusSix(s.confirmedDice);
      return `${s.diceIndex + 1}個目/8 ／ 振り直し残り: ${s.rerollsLeft}回 ／ 確定済合計: ${score}`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (!s.currentDie) {
        return [{ id: 'ROLL', label: `ロール（${s.diceIndex + 1}個目）`, enabled: true }];
      }
      return [
        { id: 'REROLL', label: `振り直し（残${s.rerollsLeft}）`, enabled: s.rerollsLeft > 0 },
        { id: 'CONFIRM', label: `${s.currentDie} を確保`, enabled: true },
      ];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        s.currentDie = rollDie();
        s.log.push(`[${s.diceIndex + 1}個目] ロール: ${s.currentDie}`);
      } else if (type === 'REROLL') {
        s.rerollsLeft--;
        s.currentDie = rollDie();
        s.log.push(`[${s.diceIndex + 1}個目] 振り直し: ${s.currentDie} (残${s.rerollsLeft})`);
      } else if (type === 'CONFIRM') {
        s.confirmedDice.push(s.currentDie);
        s.log.push(`[${s.diceIndex + 1}個目] 確保: ${s.currentDie}`);
        s.diceIndex++;
        s.currentDie = null;
        if (s.diceIndex >= 8) {
          s.phase = 'done';
          s.log.push(`全8個: [${s.confirmedDice.join(', ')}] → ${scoreMinusSix(s.confirmedDice)}点`);
        }
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      if (s.confirmedDice.length < 8) return { points: 0, details: '未完了' };
      const pts = scoreMinusSix(s.confirmedDice);
      return { points: pts, details: `[${s.confirmedDice.join(', ')}] → ${pts}点（6は-6扱い）` };
    },
  };
})();
