// js/evolutions.js - 進化チェーン定義 + 解放チェック
// チェーンデータは別ファイル管理 (evolutionData.js の役割を兼ねる)

const EVOLUTION_CHAINS = [
  // ===== きのなかま =====
  {
    id: 'tree',
    label: 'きのなかま',
    chars: ['木', '林', '森'],
    rewardName: 'もりのだいまおう',
    rewardVariant: 4,
    rewardColor: '#1a7a30',
    desc: 'き・はやし・もりを ぜんぶクリア！',
  },

  // ===== すうじ ①②③ =====
  {
    id: 'num_low',
    label: 'すうじ ①',
    chars: ['一', '二', '三'],
    rewardName: 'さんくのおに',
    rewardVariant: 0,
    rewardColor: '#e74c3c',
    desc: 'いち・に・さんを ぜんぶクリア！',
  },
  {
    id: 'num_mid',
    label: 'すうじ ②',
    chars: ['五', '六', '七'],
    rewardName: 'なないろバット',
    rewardVariant: 1,
    rewardColor: '#9b59b6',
    desc: 'ご・ろく・しちを ぜんぶクリア！',
  },
  {
    id: 'num_high',
    label: 'すうじ ③',
    chars: ['八', '九', '十'],
    rewardName: 'じゅうじのきんぐ',
    rewardVariant: 2,
    rewardColor: '#d4ac0d',
    desc: 'はち・く・じゅうを ぜんぶクリア！',
  },

  // ===== そらのなかま =====
  {
    id: 'sky',
    label: 'そらのなかま',
    chars: ['日', '月', '空'],
    rewardName: 'てんくうりゅうおう',
    rewardVariant: 4,
    rewardColor: '#5dade2',
    desc: 'にち・つき・そらを ぜんぶクリア！',
  },

  // ===== てんきのせいれい =====
  {
    id: 'weather',
    label: 'てんきのせいれい',
    chars: ['雨', '天', '気'],
    rewardName: 'あらしのぬし',
    rewardVariant: 3,
    rewardColor: '#2980b9',
    desc: 'あめ・てん・きを ぜんぶクリア！',
  },

  // ===== みずのなかま =====
  {
    id: 'water',
    label: 'みずのなかま',
    chars: ['水', '川'],
    rewardName: 'うみのりゅうおう',
    rewardVariant: 4,
    rewardColor: '#1a5276',
    desc: 'みず・かわを ぜんぶクリア！',
  },

  // ===== だいちのせかい =====
  {
    id: 'land',
    label: 'だいちのせかい',
    chars: ['土', '山', '田', '村'],
    rewardName: 'だいちのぬし',
    rewardVariant: 2,
    rewardColor: '#7f8c8d',
    desc: 'つち・やま・た・むらを ぜんぶクリア！',
  },

  // ===== しぜんのなかま =====
  {
    id: 'nature',
    label: 'しぜんのなかま',
    chars: ['花', '草', '竹'],
    rewardName: 'しぜんのもりのぬし',
    rewardVariant: 4,
    rewardColor: '#1e8449',
    desc: 'はな・くさ・たけを ぜんぶクリア！',
  },

  // ===== たからのなかま =====
  {
    id: 'gem',
    label: 'たからのなかま',
    chars: ['石', '玉', '金'],
    rewardName: 'おうごんのりゅう',
    rewardVariant: 4,
    rewardColor: '#d4ac0d',
    desc: 'いし・たま・きんを ぜんぶクリア！',
  },

  // ===== いきものたち =====
  {
    id: 'life',
    label: 'いきものたち',
    chars: ['虫', '貝', '犬'],
    rewardName: 'ぬしのけもの',
    rewardVariant: 1,
    rewardColor: '#8e5c2a',
    desc: 'むし・かい・いぬを ぜんぶクリア！',
  },

  // ===== ひとのちから =====
  {
    id: 'person',
    label: 'ひとのちから',
    chars: ['人', '大', '力'],
    rewardName: 'ちからのおうさま',
    rewardVariant: 2,
    rewardColor: '#c0392b',
    desc: 'ひと・だい・ちからを ぜんぶクリア！',
  },
];

// charをクリアしたとき、それによって進化チェーンが解放されるか確認する。
// 解放された場合は chain オブジェクトを返す (Storage.saveEvolution も実行)。
// 解放なし → null
function checkEvolutionUnlock(char) {
  for (const chain of EVOLUTION_CHAINS) {
    if (!chain.chars.includes(char)) continue;
    if (Storage.isEvolutionUnlocked(chain.id)) continue;
    if (chain.chars.every(c => Storage.isCleared(c))) {
      Storage.saveEvolution(chain.id);
      return chain;
    }
  }
  return null;
}
