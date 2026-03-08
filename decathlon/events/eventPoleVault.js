// Event 7: 棒高跳び
window.EventPoleVault = (function () {
  const START_HEIGHT = 10;
  const HEIGHT_STEP = 2;

  return {
    id: 'pole_vault',
    name: '棒高跳び',

    getDescription() {
      return [
        '🎪 棒を使ってバーを跳び越えるよ！',
        '使うダイスの数を1〜8個から選んで振るよ。6が1個でも出たら失敗！',
        '6が出ずに合計がバーの高さ以上なら成功！3回失敗したら終わり',
        'パスすると次の高さへスキップできるよ（失敗回数は変わらないよ）',
      ];
    },

    init() {
      return {
        height: START_HEIGHT,
        failsAtHeight: 0,
        bestHeight: 0,
        numDice: 4,
        dice: null,
        phase: 'choosing', // 'choosing' | 'rolled' | 'done'
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (!s.dice) return [];
      const hasSix = s.dice.includes(6);
      const total = s.dice.reduce((a, b) => a + b, 0);
      const success = !hasSix && total >= s.height;
      return s.dice.map(v => ({
        value: v,
        kept: success,
        clickable: false,
        foulDie: v === 6,
      }));
    },

    getStatusText(s) {
      if (s.phase === 'done') return `競技終了 ／ 最高: ${s.bestHeight}cm`;
      const remaining = 3 - s.failsAtHeight;
      return `バーの高さ: ${s.height}cm ／ 残り挑戦: ${remaining}回 ／ ダイス: ${s.numDice}個 ／ 現在最高: ${s.bestHeight}cm`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (s.phase === 'choosing') {
        return [
          { id: 'SELECT_DICE', label: 'ダイス数選択', enabled: true, value: s.numDice },
          { id: 'ROLL', label: `🎲 ${s.numDice}個で挑戦！（${s.height}cm）`, enabled: true },
          { id: 'PASS', label: `⏭️ ${s.height}cmをパスして次へ`, enabled: true },
          { id: 'END', label: '🏁 競技を終わりにする', enabled: true },
        ];
      }
      if (s.phase === 'rolled') {
        const hasSix = s.dice.includes(6);
        const total = s.dice.reduce((a, b) => a + b, 0);
        const success = !hasSix && total >= s.height;
        if (success) {
          return [{ id: 'NEXT_HEIGHT', label: `✨ 成功！次の高さ（${s.height + HEIGHT_STEP}cm）へ`, enabled: true }];
        } else {
          const more = s.failsAtHeight < 3;
          const reason = hasSix ? '6が出た！' : `合計${total}が${s.height}cm未満`;
          return [
            { id: 'RETRY', label: `🔄 もう一回！（残${3 - s.failsAtHeight}回）${more ? '' : ' ※ラスト'}`, enabled: more },
            { id: 'END', label: '🏁 競技を終わりにする', enabled: true },
          ];
        }
      }
      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'SELECT_DICE') {
        s.numDice = Math.max(1, Math.min(8, action.value));
      } else if (type === 'ROLL') {
        s.dice = rollDice(s.numDice);
        const hasSix = s.dice.includes(6);
        const total = s.dice.reduce((a, b) => a + b, 0);
        const success = !hasSix && total >= s.height;
        s.phase = 'rolled';
        const result = success ? '成功！🎉' : hasSix ? '失敗（6が出た！）' : `失敗（${total} < ${s.height}cm）`;
        s.log.push(`高さ${s.height}cm [${s.numDice}個]: [${s.dice.join(', ')}] = ${total} → ${result}`);
        if (!success) {
          s.failsAtHeight++;
          if (s.failsAtHeight >= 3) {
            s.phase = 'done';
            s.log.push(`3回失敗 → 競技終了。最高: ${s.bestHeight}cm`);
          }
        } else {
          s.bestHeight = s.height;
        }
      } else if (type === 'NEXT_HEIGHT') {
        s.height += HEIGHT_STEP;
        s.failsAtHeight = 0;
        s.dice = null;
        s.phase = 'choosing';
        s.log.push(`→ 次の高さ: ${s.height}cm`);
      } else if (type === 'PASS') {
        // PASSは失敗回数を変えない（持ち越し）
        s.log.push(`高さ${s.height}cmをパス → ${s.height + HEIGHT_STEP}cmへ（失敗回数: ${s.failsAtHeight}回 持ち越し）`);
        s.height += HEIGHT_STEP;
        s.dice = null;
        s.phase = 'choosing';
      } else if (type === 'RETRY') {
        s.dice = null;
        s.phase = 'choosing';
      } else if (type === 'END') {
        s.phase = 'done';
        s.log.push(`競技終了。最高: ${s.bestHeight}cm`);
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      return { points: s.bestHeight, details: `最高高さ: ${s.bestHeight}cm` };
    },
  };
})();
