// scripts/build-www.mjs - kanji_battle/ をアプリ用の www/ にコピーする
//
// - Web版の index.html をコピーし、BUILD_MODE の読み込みだけを
//   buildConfig.js ('web-full') → buildConfigIOSApp.js ('ios-free') に差し替える。
// - 検証用ページやドキュメントなど、アプリに不要なファイルは含めない。
// - 差し替えに失敗した場合は、web-full のままアプリ化される事故を防ぐため
//   ビルドを失敗させる。

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(appDir, '..', 'kanji_battle');
const outDir = join(appDir, 'www');

const EXCLUDE = new Set([
  'ios-preview.html',
  'test-reading.html',
  'IOS_IAP_IMPLEMENTATION_PLAN.md',
  'buildConfig.js',
  'buildConfigIOSPreview.js',
  '.DS_Store',
]);

const WEB_CONFIG_TAG = '<script src="js/config/buildConfig.js"></script>';
const APP_CONFIG_TAG = '<script src="js/config/buildConfigIOSApp.js"></script>';

rmSync(outDir, { recursive: true, force: true });
cpSync(srcDir, outDir, {
  recursive: true,
  filter: (src) => !EXCLUDE.has(basename(src)),
});

const indexPath = join(outDir, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const count = html.split(WEB_CONFIG_TAG).length - 1;
if (count !== 1) {
  throw new Error(`index.html に ${WEB_CONFIG_TAG} が ${count} 箇所あります(1箇所であるべき)`);
}
writeFileSync(indexPath, html.replace(WEB_CONFIG_TAG, APP_CONFIG_TAG));

if (!existsSync(join(outDir, 'js', 'config', 'buildConfigIOSApp.js'))) {
  throw new Error('buildConfigIOSApp.js がコピーされていません');
}

console.log(`www/ を作成しました (BUILD_MODE: ios-free)`);
