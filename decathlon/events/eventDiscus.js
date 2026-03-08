// Event 9: 円盤投げ
window.EventDiscus = (function () {
  const TOTAL_DICE = 5;

  function newAttemptState() {
    return {
      phase: 'rolling', // 'rolling' | 'foul' | 'stopped'
      keptDice: [],       // 確定したキープ済みの目の値
      activeDice: null,   // 現在ロール中のダイス
      selectedIndices: [], // activeDice の中で選択中のインデックス
      firstRoll: true,
      foul: false,
    };
  }

  return {
    id: 'discus',
    name: '円盤投げ',

    getDescription() {
      return [
        '🥏 3回投げて、一番遠い記録が得点！',
        '【ルール】ダイス5個を振って、偶数（2・4・6）の目だけキープできるよ',
        '奇数（1・3・5）はキープできないよ。偶数が1個も出なかったらファウル（0点）',
        'いつでもSTOPして確保した合計を得点にできるよ！',
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
      if (s.foul && s.betweenAttempt) {
        return (s.activeDice || []).map(v => ({ value: v, kept: false, clickable: false, foulDie: true }));
      }
      if (s.betweenAttempt) {
        return s.keptDice.map(v => ({ value: v, kept: true, clickable: false }));
      }
      if (!s.activeDice) {
        return Array(TOTAL_DICE).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
      }
      const display = [];
      s.keptDice.forEach(v => display.push({ value: v, kept: true, clickable: false }));
      s.activeDice.forEach((v, i) => display.push({
        value: v,
        kept: s.selectedIndices.includes(i),
        clickable: s.phase === 'rolling' && v % 2 === 0,
        dim: v % 2 === 1,
      }));
      return display;
    },

    getStatusText(s) {
      if (s.betweenAttempt) {
        const last = s.attempts[s.attempts.length - 1];
        return `試技${s.attempt - 1}回目: ${last.foul ? 'ファウル（0点）' : last.score + '点'}`;
      }
      const keptSum = s.keptDice.reduce((a, b) => a + b, 0);
      const selSum = s.selectedIndices.reduce((a, i) => a + (s.activeDice ? s.activeDice[i] : 0), 0);
      return `試技${s.attempt}/3 ／ キープ合計(偶数のみ): ${keptSum + selSum}点`;
    },

    getAvailableActions(s) {
      if (s.betweenAttempt) {
        return [{ id: 'NEXT_ATTEMPT', label: s.attempt > 3 ? '🏁 結果へ' : `次の試技へ（${s.attempt}/3）`, enabled: true }];
      }
      if (s.phase === 'foul') {
        return [{ id: 'NEXT_ATTEMPT', label: s.attempt > 3 ? '🏁 結果へ' : '次の試技へ', enabled: true }];
      }
      if (s.phase === 'rolling') {
        const hasSelected = s.selectedIndices.length > 0;
        const hasSomething = s.keptDice.length > 0 || hasSelected;
        const unkeptCount = s.activeDice ? s.activeDice.length - s.selectedIndices.length : TOTAL_DICE;
        const currentScore = s.keptDice.reduce((a, b) => a + b, 0)
          + s.selectedIndices.reduce((a, i) => a + (s.activeDice ? s.activeDice[i] : 0), 0);
        return [
          { id: 'ROLL', label: s.firstRoll ? '🎲 ロール（5個）' : `♻️ キープして振り直し（${unkeptCount}個）`, enabled: s.firstRoll || hasSelected },
          { id: 'STOP', label: `✅ STOP（${currentScore}点確定）`, enabled: hasSomething },
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
        if (s.firstRoll) {
          s.activeDice = rollDice(TOTAL_DICE);
          s.firstRoll = false;
          s.selectedIndices = [];
          s.log.push(`[試技${s.attempt}] ロール: [${s.activeDice.join(', ')}]`);
        } else {
          // 選択中のダイスをkeptDiceへ確定し、残りを振り直し
          const selectedVals = s.selectedIndices.map(i => s.activeDice[i]);
          s.keptDice.push(...selectedVals);
          const unkeptDice = s.activeDice.filter((_, i) => !s.selectedIndices.includes(i));
          s.activeDice = rollDice(unkeptDice.length);
          s.selectedIndices = [];
          s.log.push(`[試技${s.attempt}] キープ確定: [${selectedVals.join(', ')}]、振り直し: [${s.activeDice.join(', ')}]（確保合計: ${s.keptDice.reduce((a, b) => a + b, 0)}）`);
        }
        // ファウル判定：偶数が一個もなく、keptDiceも空の場合
        const hasEven = s.activeDice.some(v => v % 2 === 0);
        if (!hasEven && s.keptDice.length === 0) {
          s.foul = true;
          s.phase = 'foul';
          s.log.push(`[試技${s.attempt}] ファウル！偶数が1個も出なかった（全部奇数だよ）`);
          s.attempts.push({ score: 0, foul: true });
          s.attempt++;
          s.betweenAttempt = true;
        }
      } else if (type === 'TOGGLE') {
        const displayIndex = action.index;
        const activeIndex = displayIndex - s.keptDice.length;
        if (activeIndex < 0 || !s.activeDice || activeIndex >= s.activeDice.length) {
          return s;
        }
        const v = s.activeDice[activeIndex];
        if (v % 2 === 0) {
          // 偶数：キープ可能
          const idx = s.selectedIndices.indexOf(activeIndex);
          if (idx >= 0) {
            s.selectedIndices.splice(idx, 1);
            s.log.push(`[試技${s.attempt}] ${v} のキープを解除したよ`);
          } else {
            s.selectedIndices.push(activeIndex);
            s.log.push(`[試技${s.attempt}] ${v}（偶数）をキープ選択！`);
          }
        } else {
          // 奇数：キープ不可
          s.log.push(`[試技${s.attempt}] ${v} は奇数だからキープできないよ！偶数（2・4・6）だけキープできるよ`);
        }
      } else if (type === 'STOP' && s.phase === 'rolling') {
        const selectedVals = s.selectedIndices.map(i => s.activeDice[i]);
        s.keptDice.push(...selectedVals);
        const score = s.keptDice.reduce((a, b) => a + b, 0);
        s.log.push(`[試技${s.attempt}] STOP → ${score}点（キープ: [${s.keptDice.join(', ')}]）`);
        s.attempts.push({ score, foul: false });
        s.attempt++;
        s.betweenAttempt = true;
        s.phase = 'stopped';
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
