# クラブ距離表

クラブごとのキャリー（CARRY）とトータル（TOTAL）の飛距離を、ゴルフ場でさっと確認するための個人用 Web アプリ。サーバー・ログイン不要で、データは端末の localStorage（キー `golfClubDistances.v1`）に保存します。

## 起動方法

Service Worker を使うため、`index.html` を直接開かず、HTTP サーバー経由で開きます。

```sh
cd distance
npx --yes http-server . -p 8080 -c-1   # http://localhost:8080 で確認
```

## iPhone のホーム画面に追加

1. Safari で `https://torubd1-arch.github.io/mochiusagi/distance/` を開く
2. 共有ボタン →「ホーム画面に追加」

- Safari とホーム画面のアプリでは保存先が別です。最初からホーム画面のアプリで入力してください
- ホーム画面のアプリを削除するとデータも消えます

配信ファイルを変更したら `sw.js` の `CACHE_VERSION` を上げてください（上げないと端末に反映されません）。

## 構成

- `index.html` / `styles.css` / `app.js` … 画面と操作
- `sw.js` / `manifest.webmanifest` / `icons/` … ホーム画面追加・オフライン用
