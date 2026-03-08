// Event 3: 砲丸投げ
window.EventShotPut = (function () {

  function newAttemptState() {
    return {
      phase: 'rolling', // 'rolling' | 'foul' | 'stopped'
      rolledDice: [],   // all dice rolled so far this attempt
      currentSum: 0,
      foul: false,
    };
  }

  return {
    id: 'shot_put',
    name: '砲丸投げ',

    getDescription() {
      return [
        '🏋️ 重い球を投げるよ！3回挑戦して一番いい記録が得点！',
        'ダイスを1個ずつ転がしていくよ（最大8個まで）',
        '6が出たらファウル（その試技は0点）。6が出る前にSTOPすれば安全！',
      ];
    },

    init() {
      return {
        attempt: 1,
        attempts: [],
        betweenAttempt: false,
        ...newAttemptState(),
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (s.betweenAttempt) return s.rolledDice.map(v => ({ value: v, kept: !s.foul, clickable: false, foulDie: v === 6 }));
      return s.rolledDice.map(v => ({ value: v, kept: true, clickable: false, foulDie: v === 6 }));
    },

    getStatusText(s) {
      if (s.betweenAttempt) {
        const last = s.attempts[s.attempts.length - 1];
        return `試技${s.attempt - 1}回目: ${last.foul ? 'ファウル（0点）' : last.score + '点'}`;
      }
      return `試技${s.attempt}/3 ／ ${s.rolledDice.length}個目 ／ 現在合計: ${s.currentSum}`;
    },

    getAvailableActions(s) {
      if (s.betweenAttempt) {
        const label = s.attempt > 3 ? '結果へ' : `次の試技（${s.attempt}/3）`;
        return [{ id: 'NEXT_ATTEMPT', label, enabled: true }];
      }
      if (s.phase === 'foul') {
        return [{ id: 'NEXT_ATTEMPT', label: s.attempt > 3 ? '結果へ' : '次の試技', enabled: true }];
      }
      if (s.phase === 'rolling') {
        const canRoll = s.rolledDice.length < 8;
        return [
          { id: 'ROLL', label: `次のダイス（${s.rolledDice.length + 1}個目）`, enabled: canRoll },
          { id: 'STOP', label: `STOP（${s.currentSum}点確定）`, enabled: s.rolledDice.length > 0 },
        ];
      }
      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'NEXT_ATTEMPT') {
        s.betweenAttempt = false;
        if (s.attempts.length >= 3) {
          s.phase = 'done';
        } else {
          Object.assign(s, newAttemptState());
        }
        return s;
      }

      if (type === 'ROLL' && s.phase === 'rolling') {
        const die = rollDie();
        s.rolledDice.push(die);
        if (die === 6) {
          s.foul = true;
          s.phase = 'foul';
          s.log.push(`[試技${s.attempt}] ${s.rolledDice.length}個目: ${die} → ファウル！`);
          s.attempts.push({ score: 0, foul: true });
          s.attempt++;
          s.betweenAttempt = true;
        } else {
          s.currentSum += die;
          s.log.push(`[試技${s.attempt}] ${s.rolledDice.length}個目: ${die} (合計${s.currentSum})`);
          if (s.rolledDice.length >= 8) {
            // Auto-stop at 8 dice
            s.log.push(`[試技${s.attempt}] 8個達成 → STOP自動: ${s.currentSum}点`);
            s.attempts.push({ score: s.currentSum, foul: false });
            s.attempt++;
            s.betweenAttempt = true;
            s.phase = 'stopped';
          }
        }
      } else if (type === 'STOP' && s.phase === 'rolling') {
        s.phase = 'stopped';
        s.log.push(`[試技${s.attempt}] STOP → ${s.currentSum}点`);
        s.attempts.push({ score: s.currentSum, foul: false });
        s.attempt++;
        s.betweenAttempt = true;
      }

      return s;
    },

    isFinished(s) {
      return s.phase === 'done';
    },

    getResult(s) {
      if (s.attempts.length === 0) return { points: 0, details: '未完了' };
      const best = Math.max(...s.attempts.map(a => a.score));
      const detail = s.attempts.map((a, i) => `試技${i + 1}: ${a.foul ? 'ファウル' : a.score + '点'}`).join(' ／ ');
      return { points: best, details: `${detail} → 最高: ${best}点` };
    },
  };
})();
