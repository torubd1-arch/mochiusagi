// Event 4: 走り高跳び
window.EventHighJump = (function () {
  const START_HEIGHT = 10;
  const HEIGHT_STEP = 2;

  return {
    id: 'high_jump',
    name: '走り高跳び',

    getDescription() {
      return [
        '🏔️ バーをどこまで高く跳び越えられるか競うよ！',
        '5個のダイスを振って、合計がバーの高さ以上なら成功！',
        '同じ高さで最大3回まで挑戦できるよ。3回失敗したら終わり',
        'パスすると次の高さへスキップできるよ（失敗回数は変わらないよ）',
      ];
    },

    init() {
      return {
        height: START_HEIGHT,
        failsAtHeight: 0,
        bestHeight: 0,
        dice: null,
        phase: 'idle', // 'idle' | 'rolled' | 'done'
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (!s.dice) return Array(5).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
      const success = sumDice(s.dice) >= s.height;
      return s.dice.map(v => ({ value: v, kept: success, clickable: false }));
    },

    getStatusText(s) {
      if (s.phase === 'done') return `競技終了 ／ 最高: ${s.bestHeight}cm`;
      const remaining = 3 - s.failsAtHeight;
      return `バーの高さ: ${s.height}cm ／ 残り挑戦: ${remaining}回 ／ 現在最高: ${s.bestHeight}cm`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];
      if (s.phase === 'idle') {
        return [
          { id: 'ROLL', label: `🎲 ${s.height}cmに挑戦！`, enabled: true },
          { id: 'PASS', label: `⏭️ ${s.height}cmをパスして次へ`, enabled: true },
          { id: 'END', label: '🏁 競技を終わりにする', enabled: true },
        ];
      }
      if (s.phase === 'rolled') {
        const success = sumDice(s.dice) >= s.height;
        if (success) {
          return [{ id: 'NEXT_HEIGHT', label: `✨ 成功！次の高さ（${s.height + HEIGHT_STEP}cm）へ`, enabled: true }];
        } else {
          const more = s.failsAtHeight < 3;
          return [
            { id: 'RETRY', label: `🔄 もう一回！（残${3 - s.failsAtHeight}回）`, enabled: more },
            { id: 'END', label: '🏁 競技を終わりにする', enabled: true },
          ];
        }
      }
      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        s.dice = rollDice(5);
        const total = sumDice(s.dice);
        const success = total >= s.height;
        s.phase = 'rolled';
        s.log.push(`高さ${s.height}cm: [${s.dice.join(', ')}] = ${total} → ${success ? '成功！🎉' : `失敗（あと${s.height - total}足りない）`}`);
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
        s.phase = 'idle';
        s.log.push(`→ 次の高さ: ${s.height}cm`);
      } else if (type === 'PASS') {
        // PASSは失敗回数を変えない（持ち越し）
        s.log.push(`高さ${s.height}cmをパス → ${s.height + HEIGHT_STEP}cmへ（失敗回数: ${s.failsAtHeight}回 持ち越し）`);
        s.height += HEIGHT_STEP;
        s.dice = null;
        s.phase = 'idle';
      } else if (type === 'RETRY') {
        s.dice = null;
        s.phase = 'idle';
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
