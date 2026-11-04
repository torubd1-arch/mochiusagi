// 最小限の ZIP 書き出し・読み込み（外部ライブラリなし。オフラインで動かすため）
// 書き出しは無圧縮（写真は JPEG で圧縮済みのため）。読み込みは無圧縮と deflate に対応する。
// ZIP64 には対応しないので、合計 4GB 未満まで。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const LIMIT = 0xffffffff;

/**
 * files: [{ name, data: Uint8Array }] から ZIP のバイト列（Uint8Array の配列）を作る。
 * そのまま new Blob(parts) にできる。
 */
export function createZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const { data } = file;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // ファイル名は UTF-8
    lv.setUint16(8, 0, true); // 無圧縮
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
    if (offset >= LIMIT) throw new Error('バックアップが大きすぎます（4GB 以上）');
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  if (files.length > 0xffff || offset + cdSize >= LIMIT) throw new Error('バックアップが大きすぎます');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('この端末では圧縮された ZIP を読み込めません');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ZIP のバイト列を読み、名前 → 中身を返す関数の入った Map を作る。
 * 中身は read(name) を呼んだときに取り出す（大きな ZIP でも一度に展開しない）。
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP ファイルではないか、壊れています');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP ファイルが壊れています');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, crc, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function read(name) {
    const e = entries.get(name);
    if (!e) throw new Error(`ZIP に ${name} がありません`);
    const lo = e.localOffset;
    if (lo + 30 > bytes.length || view.getUint32(lo, true) !== 0x04034b50) throw new Error('ZIP ファイルが壊れています');
    const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
    if (start + e.compSize > bytes.length) throw new Error('ZIP ファイルが途中で切れています');
    const raw = bytes.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflateRaw(raw);
    else throw new Error('対応していない圧縮形式の ZIP です');
    if (data.length !== e.size || crc32(data) !== e.crc) throw new Error(`${name} が壊れています`);
    return data;
  }

  return { names: [...entries.keys()], has: (name) => entries.has(name), read };
}
