# ゴルフメモ

練習で気づいたことやスイングの注意点をためておき、練習前・ラウンド前に短時間で見返す個人用 Web アプリ。サーバー・ログイン不要で、データは端末の localStorage に保存します。

## 起動方法

ES モジュールと Service Worker を使うため、`index.html` を直接開かず、HTTP サーバー経由で開きます。

```sh
cd golf
npm run serve   # http://localhost:8080 で確認
npm test        # ロジックのテスト（Node 20 以上）
```

## GitHub Pages での公開

1. リポジトリを GitHub に push する
2. リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を公開するブランチの `/ (root)` にする
3. `https://<ユーザー名>.github.io/<リポジトリ名>/golf/` を開く

このリポジトリは既に Pages で公開している場合、`main` へマージするだけで上記の URL に反映されます。

配信ファイルを変更したら `sw.js` の `CACHE_VERSION` を上げてください（上げないと端末に反映されません）。

## iPhone のホーム画面に追加

Safari で上記の URL を開き、共有ボタン →「ホーム画面に追加」。

- Safari とホーム画面のアプリでは保存先が別です。最初からホーム画面のアプリで使ってください
- ホーム画面のアプリを削除するとデータも消えます。機種変更に備え、設定画面からバックアップを書き出してください

## 構成

- `index.html` / `css/style.css` … 画面
- `js/logic.js` … 注意点の更新・URL 検証・バックアップ検証の純粋ロジック（テスト対象）
- `js/store.js` … localStorage の読み書き
- `js/app.js` … 描画と操作
- `sw.js` / `manifest.webmanifest` / `icons/` … ホーム画面追加・オフライン用

## データ形式

```json
{
  "id": "…",
  "title": "切り返しは下半身から",
  "category": "driver",
  "memo": "",
  "urls": ["https://youtu.be/…"],
  "color": "white",
  "important": true,
  "mastered": false,
  "createdAt": "2026-11-01T00:00:00.000Z",
  "updatedAt": "2026-11-01T00:00:00.000Z"
}
```

配列の順番がカテゴリ内の表示順です。`category` は `driver` / `fw-ut` / `iron` / `approach` / `putter` / `other`。
`color`（背景色）は `white` / `red` / `orange` / `yellow` / `green` / `blue` / `purple`。色を追加する前のデータ（`color` なし）は `white` として読み込みます。

## 安全のための決まり

- 画面への表示は `textContent` のみ（入力内容を HTML として解釈しない）
- 動画 URL は `normalizeUrl` を通した https の URL だけを保持する（`http` は `https` に変換、`javascript:` などは拒否）。バックアップや保存データの読み込み時も同じ検証を通す
- 動画の「開く」は、ホーム画面のアプリから使うと `x-safari-https://…` で Safari に渡す（iOS 17 以降）。Safari で開いているときは新しいタブで開く
- 復元は全件置き換えなので、1件でも不正があればファイル全体を拒否する
- 保存に失敗したら画面の状態を変えない
- 保存データが読めないときは、元の文字列を `golfmemo.v1.broken` に残してから起動する
