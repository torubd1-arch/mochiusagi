// Event 10: 400m走
window.Event400m = (function () {
  return {
    id: '400m',
    name: '400m走',

    getDescription() {
      return [
        '⏱️ 400mを走るよ！ダイス8個を2個×4グループに分けて振るよ',
        '各グループは振り直せるよ（合計5回まで）。確定ボタンで次のグループへ！',
        '得点：8個の合計（6が出ると-6点になっちゃうよ！）',
      ];
    },

    init() {
      return {
        groupIndex: 0,        // 0..3
        confirmedGroups: [],  // confirmed pairs [[v1,v2], ...]
        currentDice: null,    // [2] current group roll
        rerollsLeft: 5,
        phase: 'rolling',     // 'rolling' | 'done'
        log: [],
      };
    },

    getDiceDisplay(s) {
      const dice = [];
      s.confirmedGroups.forEach((pair, gi) => {
        pair.forEach(v => dice.push({ value: v, kept: true, clickable: false }));
      });
      if (s.groupIndex < 4) {
        const pair = s.currentDice || [null, null];
        pair.forEach(v => dice.push({ value: v, kept: false, clickable: false }));
        for (let g = s.groupIndex + 1; g < 4; g++) {
          dice.push({ value: null, kept: false, clickable: false });
          dice.push({ value: null, kept: false, clickable: false });
        }
      }
      return dice;
    },

    getStatusText(s) {
      if (s.phase === 'done') {
        const all = s.confirmedGroups.flat();
        return `完了 ／ 合計: ${scoreMinusSix(all)}点`;
      }
      const confirmed = scoreMinusSix(s.confirmedGroups.flat());
      return `組 ${s.groupIndex + 1}/4 ／ 振り直し残り: ${s.rerollsLeft}回 ／ 確定済合計: ${confirmed}`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (!s.currentDice) {
        return [{ id: 'ROLL', label: `ロール（第${s.groupIndex + 1}組）`, enabled: true }];
      }
      return [
        { id: 'REROLL', label: `振り直し（残${s.rerollsLeft}）`, enabled: s.rerollsLeft > 0 },
        { id: 'CONFIRM', label: `[${s.currentDice.join(', ')}] を確定`, enabled: true },
      ];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        s.currentDice = rollDice(2);
        s.log.push(`[第${s.groupIndex + 1}組] ロール: [${s.currentDice.join(', ')}]`);
      } else if (type === 'REROLL') {
        s.rerollsLeft--;
        s.currentDice = rollDice(2);
        s.log.push(`[第${s.groupIndex + 1}組] 振り直し: [${s.currentDice.join(', ')}] (残${s.rerollsLeft})`);
      } else if (type === 'CONFIRM') {
        s.confirmedGroups.push([...s.currentDice]);
        s.log.push(`[第${s.groupIndex + 1}組] 確定: [${s.currentDice.join(', ')}]`);
        s.groupIndex++;
        s.currentDice = null;
        if (s.groupIndex >= 4) {
          s.phase = 'done';
          const all = s.confirmedGroups.flat();
          s.log.push(`全8個: [${all.join(', ')}] → ${scoreMinusSix(all)}点`);
        }
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      if (s.confirmedGroups.length < 4) return { points: 0, details: '未完了' };
      const all = s.confirmedGroups.flat();
      const pts = scoreMinusSix(all);
      return { points: pts, details: `[${all.join(', ')}] → ${pts}点（6は-6扱い）` };
    },
  };
})();
