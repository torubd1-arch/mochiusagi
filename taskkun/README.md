# タスクくん

iPhone での利用を前提にした、シンプルな個人用 ToDo。サーバー・ログイン不要で、データは端末の localStorage に保存します。

## 構成

- `index.html` / `css/style.css` … 画面
- `js/logic.js` … 日付・表示判定の純粋ロジック（テスト対象）
- `js/store.js` … localStorage の読み書き
- `js/app.js` … 描画と操作
- `sw.js` / `manifest.webmanifest` / `icons/` … ホーム画面追加・オフライン用

## 繰り越しの考え方

タスクは1件のデータのまま、「登録日〜最終日」の範囲の日に表示します（日ごとに複製しません）。

- 未完了：登録日から今日まで表示（アプリを開かなかった日があっても同じ）
- 完了済み：登録日から完了日まで表示（完了日より後は出ない）
- 将来の日付：その日に登録したタスクだけを表示（繰り越しの予測はしない）

## データ形式

```json
{ "id": "…", "text": "牛乳を買う", "date": "2026-10-30", "createdAt": "2026-10-30T00:12:00.000Z", "completedAt": null }
```

`date` は端末のローカル日付（YYYY-MM-DD）。完了日は `completedAt` をローカル日付に直して求めます。

## 開発

```sh
npm test        # ロジックのテスト（Node 20 以上）
npm run serve   # http://localhost:8080 で確認
```

配信ファイルを変更したら `sw.js` の `CACHE_VERSION` を上げてください（上げないと端末に反映されません）。
