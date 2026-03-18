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

  // ===== 2年生チェーン =====

  // しき (四季)
  {
    id: 'seasons',
    label: 'しき',
    chars: ['春', '夏', '秋', '冬'],
    rewardName: 'しきのぬし',
    rewardVariant: 4,
    rewardColor: '#ff8f00',
    desc: 'はる・なつ・あき・ふゆを ぜんぶクリア！',
  },

  // いちにち
  {
    id: 'time_day',
    label: 'いちにち',
    chars: ['朝', '昼', '夜'],
    rewardName: 'じかんのりゅうおう',
    rewardVariant: 4,
    rewardColor: '#1a237e',
    desc: 'あさ・ひる・よるを ぜんぶクリア！',
  },

  // かぞく
  {
    id: 'family',
    label: 'かぞく',
    chars: ['父', '母', '親'],
    rewardName: 'かぞくのぬし',
    rewardVariant: 3,
    rewardColor: '#f48fb1',
    desc: 'ちち・はは・おやを ぜんぶクリア！',
  },

  // きょうだい
  {
    id: 'siblings',
    label: 'きょうだい',
    chars: ['兄', '弟', '姉', '妹'],
    rewardName: 'きょうだいのおに',
    rewardVariant: 2,
    rewardColor: '#80cbc4',
    desc: 'あに・おとうと・あね・いもうとを ぜんぶクリア！',
  },

  // ほうがく (方角)
  {
    id: 'directions',
    label: 'ほうがく',
    chars: ['東', '西', '南', '北'],
    rewardName: 'しほうのりゅう',
    rewardVariant: 4,
    rewardColor: '#7986cb',
    desc: 'ひがし・にし・みなみ・きたを ぜんぶクリア！',
  },

  // どうぶつ2
  {
    id: 'animals2',
    label: 'どうぶつ②',
    chars: ['牛', '馬', '鳥', '魚'],
    rewardName: 'どうぶつのおうさま',
    rewardVariant: 4,
    rewardColor: '#8d6e63',
    desc: 'うし・うま・とり・さかなを ぜんぶクリア！',
  },

  // くもとてんき
  {
    id: 'sky_clouds',
    label: 'くもとてんき',
    chars: ['雲', '星', '晴', '雪'],
    rewardName: 'そらのぬし',
    rewardVariant: 3,
    rewardColor: '#b3e5fc',
    desc: 'くも・ほし・はれ・ゆきを ぜんぶクリア！',
  },

  // みずとうみ
  {
    id: 'ocean',
    label: 'みずとうみ',
    chars: ['池', '海', '船'],
    rewardName: 'かいていのりゅうおう',
    rewardVariant: 4,
    rewardColor: '#1565c0',
    desc: 'いけ・うみ・ふねを ぜんぶクリア！',
  },

  // まなび
  {
    id: 'learning',
    label: 'まなび',
    chars: ['学', '校', '教', '書'],
    rewardName: 'がくもんのかみ',
    rewardVariant: 3,
    rewardColor: '#5c6bc0',
    desc: 'がく・こう・おしえる・かくを ぜんぶクリア！',
  },

  // ことば
  {
    id: 'language',
    label: 'ことば',
    chars: ['字', '言', '語', '話'],
    rewardName: 'げんごのりゅう',
    rewardVariant: 4,
    rewardColor: '#9575cd',
    desc: 'じ・いう・かたる・はなすを ぜんぶクリア！',
  },

  // からだ2
  {
    id: 'body2',
    label: 'からだ②',
    chars: ['手', '足', '体', '頭'],
    rewardName: 'からだのおうさま',
    rewardVariant: 2,
    rewardColor: '#6d4c41',
    desc: 'て・あし・からだ・あたまを ぜんぶクリア！',
  },

  // おおきなかず
  {
    id: 'big_nums',
    label: 'おおきなかず',
    chars: ['百', '千', '万'],
    rewardName: 'まんのりゅう',
    rewardVariant: 4,
    rewardColor: '#ffd54f',
    desc: 'ひゃく・せん・まんを ぜんぶクリア！',
  },

  // しょくひん
  {
    id: 'food_grain',
    label: 'しょくひん',
    chars: ['米', '麦', '茶', '食'],
    rewardName: 'しょくのぬし',
    rewardVariant: 0,
    rewardColor: '#a5d6a7',
    desc: 'こめ・むぎ・ちゃ・たべるを ぜんぶクリア！',
  },

  // ひかり
  {
    id: 'fire_light',
    label: 'ひかり',
    chars: ['火', '光', '明', '電'],
    rewardName: 'らいこうのりゅう',
    rewardVariant: 4,
    rewardColor: '#fdd835',
    desc: 'ひ・ひかり・あかるい・でんきを ぜんぶクリア！',
  },

  // のはら
  {
    id: 'field_nature',
    label: 'のはら',
    chars: ['田', '野', '原', '谷'],
    rewardName: 'のはらのぬし',
    rewardVariant: 2,
    rewardColor: '#558b2f',
    desc: 'た・の・はら・たにを ぜんぶクリア！',
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
