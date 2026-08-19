// js/supporterSelector.js - おうえんキャラクターの抽選・イベント判定
// DOMに触れない純粋関数群。乱数はrandomFn引数として差し替え可能にしてあるので、
// テスト時は固定乱数を渡せる。

const SUPPORTER_EVENT_WEIGHTS = {
  normalCorrect:   { bear: 25, penguin: 25, ponta: 25, salamander: 25 },
  incorrect:       { bear: 35, penguin: 15, ponta: 15, salamander: 35 },
  retrySuccess:    { bear: 25, penguin: 25, ponta: 25, salamander: 25 },
  streakCorrect:   { bear: 15, penguin: 35, ponta: 35, salamander: 15 },
  sessionComplete: { bear: 25, penguin: 25, ponta: 25, salamander: 25 },
};

const SUPPORTER_RECENT_CHARACTER_LIMIT = 2; // 直前2回と同じなら次は除外
const SUPPORTER_RECENT_MESSAGE_LIMIT = 10;  // 直近10件と同じセリフは避ける

// イベント種別を判定する。優先順位: retrySuccess > streakCorrect > normalCorrect。
function resolveSupportEvent({ isCorrect, wasPreviouslyWrong, correctStreak }) {
  if (!isCorrect) return 'incorrect';
  if (wasPreviouslyWrong) return 'retrySuccess';
  if (correctStreak >= 3) return 'streakCorrect';
  return 'normalCorrect';
}

// 応援キャラクターの抽選・セリフ選択に使う可変状態を作る
function createSupporterState() {
  return {
    recentCharacterIds: [],
    recentMessageKeys: [],
    currentCharacterId: null,
    currentMessage: '',
  };
}

function defaultRandom() {
  return Math.random();
}

// 重み付き抽選。除外候補が全体を占める場合は除外を無視して選び直す。
function weightedPick(weights, excludeIds, randomFn) {
  const ids = Object.keys(weights);
  let candidates = ids.filter(id => !excludeIds.includes(id));
  if (candidates.length === 0) candidates = ids;

  const total = candidates.reduce((sum, id) => sum + (weights[id] || 0), 0);
  if (total <= 0) return candidates[0];

  let r = randomFn() * total;
  for (const id of candidates) {
    r -= weights[id] || 0;
    if (r <= 0) return id;
  }
  return candidates[candidates.length - 1];
}

// eventTypeに応じたセリフ配列を取得する。空ならnormalCorrectへ、それも空なら共通セリフへ。
function getMessagesForEvent(character, eventType) {
  const messages = character.messages || {};
  if (Array.isArray(messages[eventType]) && messages[eventType].length > 0) {
    return messages[eventType];
  }
  if (Array.isArray(messages.normalCorrect) && messages.normalCorrect.length > 0) {
    return messages.normalCorrect;
  }
  return [SUPPORTER_FALLBACK_MESSAGE];
}

// 直近と重ならないセリフを選ぶ。候補が尽きたら最も古く使ったものから再利用する。
function pickMessage(characterId, eventType, lines, state, randomFn) {
  const candidates = lines.map((text, index) => ({
    text,
    key: `${characterId}:${eventType}:${index}`,
  }));

  const fresh = candidates.filter(c => !state.recentMessageKeys.includes(c.key));
  const pool = fresh.length > 0 ? fresh : candidates;

  const picked = pool[Math.floor(randomFn() * pool.length) % pool.length];

  state.recentMessageKeys.push(picked.key);
  if (state.recentMessageKeys.length > SUPPORTER_RECENT_MESSAGE_LIMIT) {
    state.recentMessageKeys.shift();
  }

  return picked;
}

// 直前2回が同一キャラクターの場合のみ、そのキャラクターを候補から一時除外する。
// (「3回連続で同じキャラクターにしない」ための除外。直前2回が別々のキャラクター
// なら誰も除外しない)
function getExcludedCharacterIds(state) {
  const recent = state.recentCharacterIds;
  if (recent.length === SUPPORTER_RECENT_CHARACTER_LIMIT && recent.every(id => id === recent[0])) {
    return [recent[0]];
  }
  return [];
}

// イベント種別とstateから、表示すべき応援リアクションを1件選ぶ。
// 戻り値: { characterId, displayName, image, alt, message, messageKey }
function selectSupportReaction(eventType, state, opts = {}) {
  const randomFn = opts.randomFn || defaultRandom;
  const weights = SUPPORTER_EVENT_WEIGHTS[eventType] || SUPPORTER_EVENT_WEIGHTS.normalCorrect;

  const characterId = weightedPick(weights, getExcludedCharacterIds(state), randomFn);
  const character = SUPPORTERS[characterId];

  const lines = getMessagesForEvent(character, eventType);
  const { text, key } = pickMessage(characterId, eventType, lines, state, randomFn);

  state.recentCharacterIds.push(characterId);
  if (state.recentCharacterIds.length > SUPPORTER_RECENT_CHARACTER_LIMIT) {
    state.recentCharacterIds.shift();
  }
  state.currentCharacterId = characterId;
  state.currentMessage = text;

  return {
    characterId,
    displayName: character.displayName,
    image: character.image,
    alt: character.alt,
    message: text,
    messageKey: key,
  };
}
