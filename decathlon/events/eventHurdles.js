// Event 8: 110mハードル
window.EventHurdles = (function () {
  return {
    id: 'hurdles',
    name: '110mハードル',

    getDescription() {
      return [
        '🚧 ハードルを越えながら走るよ！ダイス5個を一度に振るよ',
        '気に入らなかったら何度でも振り直せるよ（最大5回）',
        '得点：最後に振った5個の合計（6もちゃんとプラスだよ！）',
      ];
    },

    init() {
      return {
        dice: null,
        rerollsLeft: 5,
        rollCount: 0,
        phase: 'rolling', // 'rolling' | 'done'
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (!s.dice) return Array(5).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
      return s.dice.map(v => ({ value: v, kept: false, clickable: false }));
    },

    getStatusText(s) {
      if (s.phase === 'done') {
        return `完了 ／ 得点: ${s.dice ? sumDice(s.dice) : 0}点`;
      }
      return `振り直し残り: ${s.rerollsLeft}回 ／ ロール回数: ${s.rollCount}回`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (!s.dice) {
        return [{ id: 'ROLL', label: 'ロール（5個）', enabled: true }];
      }
      return [
        { id: 'REROLL', label: `振り直し（残${s.rerollsLeft}）`, enabled: s.rerollsLeft > 0 },
        { id: 'CONFIRM', label: `${sumDice(s.dice)}点で確定`, enabled: true },
      ];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        s.dice = rollDice(5);
        s.rollCount++;
        s.log.push(`ロール${s.rollCount}: [${s.dice.join(', ')}] = ${sumDice(s.dice)}`);
      } else if (type === 'REROLL') {
        s.rerollsLeft--;
        s.dice = rollDice(5);
        s.rollCount++;
        s.log.push(`振り直し${s.rollCount}: [${s.dice.join(', ')}] = ${sumDice(s.dice)} (残${s.rerollsLeft})`);
      } else if (type === 'CONFIRM') {
        const score = sumDice(s.dice);
        s.phase = 'done';
        s.log.push(`確定: ${score}点`);
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      if (!s.dice) return { points: 0, details: '未完了' };
      const pts = sumDice(s.dice);
      return { points: pts, details: `[${s.dice.join(', ')}] → ${pts}点` };
    },
  };
})();
