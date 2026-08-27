# プロ野球 試合結果・速報ビューア

NPB一軍公式戦（セ・パ両リーグ）の当日速報と、指定日の試合結果を、新聞の野球結果欄のように
一覧できるローカルWebアプリ。ビルド不要（ES modulesも不使用）で、`index.html` を開くだけで動く。

## 使い方

`npb/index.html` をブラウザで直接開くか、簡易サーバーで配信する。

```sh
cd npb
python3 -m http.server 8000
# http://localhost:8000/ を開く
```

日付は `?date=YYYY-MM-DD` で指定できる（例: `?date=2026-08-27`）。省略時は当日。

## 現在の状態: モックデータで全機能を確認できる MVP

このリポジトリのサンドボックス環境からは `npb.jp` への外部アクセスがネットワークegress
プロキシでブロックされており（`robots.txt` すら取得できなかった）、実データ取得元の実装・検証を
この場で行うことができなかった。そのため、まずは **`MockProvider`（オフラインのサンプルデータ）**
で仕様書のPhase 1〜7（打者・投手成績、HR白丸/黒丸、複数試合、日付ナビ、疑似ライブ更新、
レスポンシブ）を一通り動作確認できる状態にしてある。

`src/providers/NpbProvider.js` は `BaseballDataProvider` インターフェースを満たすスタブとして
用意済み。実データ接続時は、このファイルの中身を実装し、`src/app.js` の

```js
const provider = new NPB.MockProvider();
```

を `new NPB.NpbProvider()` に差し替えるだけでよい。UI層・services層は一切変更不要。

## データ取得元の調査結果（現時点でわかっていること）

- **NPB公式 (`npb.jp`)**: `https://npb.jp/bis/{年度}/stats/` に月別成績・打撃成績・投手成績ページが
  存在することは Web検索で確認できたが、`robots.txt` の内容とページの実HTML構造は
  このサンドボックスの outbound 制限のため未検証。実装前に必ず人手で確認すること。
- **スポーツナビ (`baseball.yahoo.co.jp/npb/...`)**: 日程・結果ページが存在するのを確認。
  利用規約・スクレイピング可否は未確認。
- **企業/研究機関向けデータ基盤**: 「プロ野球データプラットフォーム」等、法人・研究機関向けの
  契約ベースAPIが存在する模様。個人利用のローカルアプリ用途には過剰、または契約が必要。
- 過去日時点の打率・OPS・累計HR（section 30 の要件）を外部から直接取得できない場合は、
  `cacheService.js` の仕組みを拡張し、日ごとのシーズン成績スナップショットをアプリ側の
  localStorage（またはファイル）に自前で蓄積して再現する方式が必要になる可能性が高い。

**実装前に必ず行うこと**: 選定した取得元の利用規約・`robots.txt`・アクセス頻度・二次利用条件を
人手で確認し、規約の範囲内の頻度でアクセスすること。個人利用のローカルアプリである前提を崩さない。

## アーキテクチャ

```
npb/
  index.html          エントリーHTML（ビルド不要、<script src> を順に読み込むだけ）
  style.css            新聞＋現代的なWeb UI。白背景・黒文字・薄い罫線。
  src/
    data/
      sampleData.js           MockProvider用の固定データ（日付ごとの試合・打撃・投手・シーズン成績）
    providers/
      BaseballDataProvider.js  Provider インターフェースの型定義（JSDoc）
      MockProvider.js          オフラインのサンプルデータを返す実装（既定）
      NpbProvider.js           実データ用スタブ（未接続）
    services/
      gameService.js           providerの生データを結合し、画面用の GameViewModel[] を組み立てる
      statsService.js          打率/OPS/防御率のフォーマット、playerId結合ロジック
      cacheService.js          localStorageキャッシュ、次回ポーリング間隔の決定
    components/
      DateSelector.js   日付ナビゲーション（＜ 今日 ＞、カレンダー、最終更新、手動更新）
      GameCard.js       1試合分のカード（スコア・試合状態・両チーム）
      TeamSection.js    1チーム分（打者＋投手）
      BattingTable.js   打者成績テーブル
      PitchingTable.js  投手成績テーブル
      HomeRunBadge.js   本塁打バッジ（白丸/黒丸）— このアプリの最重要UI
  README.md
```

画面(components)はデータ取得方法を一切知らない。`gameService.getGamesForDate(provider, date)` が
返す `GameViewModel[]` だけを受け取って描画する。データ提供元を差し替えるときは `providers/` に
新しい実装を1つ追加し、`app.js` の生成箇所を差し替えるだけでよい。

## 表示ルールの要点

- HR欄の丸の中身は、常に「表示中の日付時点のシーズン累計本塁打数」。その試合のHR数ではない。
- 表示中の試合でHRを打っていなければ **白丸**、1本でも打っていれば **黒丸＋白文字**。
  Unicode丸数字（①②③…）は使わず、CSSで円を描画している（`.hr-badge`）。
- 過去日を表示した場合、現在の打率/OPS/HRではなく、**その日終了時点の値**を表示する
  （`sampleData.js` の `seasonSnapshots` が日付ごとに別の値を持っているのはこのため）。
- 取得できない数値は `0` にせず `-` を表示する（`statsService.formatAvgOrOps` / `formatCount`）。
- 途中出場選手（代打・代走・守備交代）は打順欄を空にし、少しインデントして表示する。

## 既知の制約 / 今後やること

- 実データ取得元が未接続（上記参照）。
- 過去日のシーズン成績スナップショットの永続化方法（自前でスナップショットを貯めるか、
  外部から都度再構成できるか）は取得元が決まってから設計を詰める必要がある。
- カレンダーはブラウザのネイティブ `<input type="date">` を使用している（独自UIは未実装）。
