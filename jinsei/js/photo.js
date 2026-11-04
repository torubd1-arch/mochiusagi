// 写真の縮小・圧縮（端末内だけで処理する。サーバーには送らない）
import { newId } from './logic.js';

export const FULL_SIZE = 1600; // 長辺の最大ピクセル
export const THUMB_SIZE = 480;
const FULL_QUALITY = 0.82;
const THUMB_QUALITY = 0.72;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('この写真は読み込めませんでした'));
    };
    img.src = url;
  });
}

async function encode(img, maxSide, quality) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 透過 PNG を JPEG にしたとき黒くならないように
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  const { width, height } = canvas;
  // iOS は canvas のメモリ上限が小さいので、すぐ解放する
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('写真の変換に失敗しました');
  return { data: await blob.arrayBuffer(), width, height };
}

/** 選んだ写真を縮小し、保存用の写真データ（itemId は保存時に入れる）を作る */
export async function processPhoto(file) {
  const img = await loadImage(file);
  const full = await encode(img, FULL_SIZE, FULL_QUALITY);
  const thumb = await encode(img, THUMB_SIZE, THUMB_QUALITY);
  return {
    id: newId(),
    itemId: '',
    type: 'image/jpeg',
    width: full.width,
    height: full.height,
    data: full.data,
    thumbType: 'image/jpeg',
    thumb: thumb.data,
  };
}
