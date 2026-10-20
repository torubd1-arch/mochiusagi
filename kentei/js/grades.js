// 各級のお題データ。出典：川西モルックの会「川西モルック検定」資料（img/kentei-source.jpg）。
// crop は元画像（1130×1600px）内の配置図の範囲 [左, 上, 右, 下]（両端を含む画素座標）。
// 配置図の細部は元画像を正とし、ここでは文字情報だけを整理している。

export const SOURCE_IMAGE = { src: 'img/kentei-source.jpg', width: 1130, height: 1600 };

export const GRADES = [
  {
    grade: 12, title: '4m 通常', distance: '4m',
    condition: '4mに並んだスキットルを1本だけ倒す。',
    notes: ['横の間隔は任意。十分に取る。'],
    crop: [56, 763, 268, 911],
  },
  {
    grade: 11, title: '4m 後ろ', distance: '4m付近',
    condition: '4m付近に前後に並んだスキットルの後ろ1本だけ倒す。',
    notes: ['前後の間隔：スキットル2本分（図中）。', 'ふわり推奨。'],
    crop: [56, 1042, 272, 1190],
  },
  {
    grade: 10, title: '4m 真ん中', distance: '4m',
    condition: '真横に並んだスキットルを真ん中1本だけ倒す。',
    notes: ['間隔：モルッカーリ1本分（図中）。', '縦投げ推奨。'],
    crop: [61, 1331, 272, 1471],
  },
  {
    grade: 9, title: '4m 飛ばし', distance: '開始4m・目標8m',
    condition: '4mにあるスキットルを8mラインより遠くに飛ばす。',
    notes: ['図中の開始線（4m）と目標線（8m）を参照。'],
    crop: [324, 763, 537, 909],
  },
  {
    grade: 8, title: '4m 手前', distance: '4m付近',
    condition: '4m付近に前後に並んだスキットルの前1本だけ倒す。',
    notes: ['前後の間隔：スキットル2本分（図中）。', '裏投げ推奨。'],
    crop: [324, 1041, 538, 1189],
  },
  {
    grade: 7, title: '6m 後ろ', distance: '6m付近',
    condition: '6m付近に前後に並んだスキットルの後ろ1本だけ倒す。',
    notes: ['前後の間隔：モルック棒1本分（図中）。', 'ふわり推奨。'],
    crop: [324, 1329, 538, 1470],
  },
  {
    grade: 6, title: '6m 真ん中', distance: '6m',
    condition: '真横に並んだスキットルを真ん中1本だけ倒す。',
    notes: ['間隔：スキットル1本分（図中）。', '縦投げ推奨。'],
    crop: [591, 763, 806, 910],
  },
  {
    grade: 5, title: '8m 遠投', distance: '8m',
    condition: '8mに並んだスキットルを1本だけ倒す。',
    notes: ['横の間隔は任意。十分に取る。'],
    crop: [593, 1040, 812, 1189],
  },
  {
    grade: 4, title: '6m 飛ばし', distance: '開始6m・目標10m',
    condition: '6mにあるスキットルを10mラインより遠くに飛ばす。',
    notes: ['図中の開始線（6m）と目標線（10m）を参照。'],
    crop: [594, 1327, 813, 1471],
  },
  {
    grade: 3, title: '6m 手前', distance: '6m付近',
    condition: '6m付近に前後に並んだスキットルの前1本だけ倒す。',
    notes: ['前後の間隔：モルック棒2本分（図中）。', '裏投げ推奨。'],
    crop: [866, 763, 1079, 909],
  },
  {
    grade: 2, title: '10m 遠投', distance: '10m',
    condition: '10mに並んだスキットルを1本だけ倒す。',
    notes: ['横の間隔は任意。十分に取る。'],
    crop: [866, 1040, 1079, 1193],
  },
  {
    grade: 1, title: '12m 遠投', distance: '12m',
    condition: '12mに並んだスキットルを1本だけ倒す。',
    notes: ['横の間隔は任意。十分に取る。'],
    crop: [866, 1325, 1079, 1472],
  },
];

export function getGrade(grade) {
  return GRADES.find((g) => g.grade === grade) || null;
}

/** 元画像から crop の範囲だけを表示する CSS（background 指定）を返す */
export function cropStyle(crop) {
  const [x0, y0, x1, y1] = crop;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const { src, width, height } = SOURCE_IMAGE;
  const px = (x0 / (width - w)) * 100;
  const py = (y0 / (height - h)) * 100;
  return `background-image:url(${src});background-size:${(width / w) * 100}% auto;`
    + `background-position:${px}% ${py}%;aspect-ratio:${w}/${h};`;
}
