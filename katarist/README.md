# katarist — バリュー投資家の投資仮説収集システム

指定した日本株について、個人投資家が Web に公開している「なぜ買ったか」「なぜ割安か」「何が起きれば株価が変わるか」を幅広く集め、ChatGPT にアップロードできる Markdown を出力します。

- 投資仮説の**発見漏れを減らすこと**を最優先にしています。投資用語が少ないという理由では記事を除外しません。
- 記事の**関連度**（対象銘柄の記事か）と**投資仮説の評価**は別々に判定します。
- AI API は使いません（第3段階で追加予定）。無料で動作します。

## インストールと実行（Windows PowerShell）

```powershell
cd C:\mycode\mochiusagi\katarist
pip install -r requirements.txt

python research.py 6505                  # 単一銘柄
python research.py 6505 4222 4628 8061   # 複数銘柄（順次実行）
python research.py 6505 --report-only    # ネットに接続せず、蓄積データから Markdown だけ再生成
```

出力: `output\6505_東洋電機製造_投資仮説.md`（ChatGPT にアップロードするファイル）

再実行すると前回の記事を保持したまま新しい記事だけを追加します。24時間以内に実行済みの検索は再実行しません（`--refresh-search` で強制）。

### 主なオプション

| オプション | 内容 |
|---|---|
| `--name 会社名` | 会社名の自動取得が失敗したときに手動指定（銘柄1つのとき） |
| `--alias 別名` | 照合用の別名（略称など）。曖昧な略称は自動生成しないので必要なら指定 |
| `--query "..."` | Web 検索クエリを追加（`{name}` `{code}` 使用可） |
| `--engines a,b` | Web 検索エンジンを指定（既定: `brave_api,google_cse,ddgs_yahoo,bing_html`） |
| `--no-web` `--no-hatena` `--no-realtime` `--no-ameba` `--no-note` `--no-antenna` `--no-blogs` | 各経路を無効化 |
| `--max-fetch N` | 1回に本文を取得する上限（既定 300。超過分は次回） |
| `--add-blog URL [--blog-name 名前]` | 巡回対象ブログを `config\blogs.json` に登録 |

## 記事を探す経路

| 経路 | 内容 | 備考 |
|---|---|---|
| Web 検索 | Bing（HTML）、ddgs 経由の Yahoo!（Bing 系） | 約19クエリ。キーがあれば公式 API を優先 |
| 公式検索 API（任意） | Brave Search API（`BRAVE_API_KEY`）、Google Programmable Search（`GOOGLE_CSE_KEY`/`GOOGLE_CSE_CX`） | 環境変数を設定すると自動で使用 |
| はてなブックマーク検索 | はてブ本文検索の RSS | 個人ブログが多く、最も効率の良い経路 |
| Yahoo!リアルタイム検索 | X の公開投稿 | x.com 本体は robots.txt で禁止のため取得しない |
| アメーバ検索 | アメブロ記事 | |
| note ハッシュタグ RSS | `note.com/hashtag/{会社名・コード}/rss` | note の検索 API は robots.txt で禁止のため使わない |
| 株ライン ブログアンテナ | 銘柄コード別の個人ブログ記事 | |
| ブログ巡回 | 登録ブログ＋自動発見ブログの RSS・ブログ内検索・一覧ページ | 下記参照 |

PowerShell で API キーを設定する例: `$env:BRAVE_API_KEY = "xxxx"`

### ブログ巡回（第2段階）

- `config\blogs.json` に登録したブログを毎回巡回します。はてなブログ・livedoor・FC2・note・WordPress は RSS とブログ内検索の URL を自動判定します。
- RSS のないブログは `list_url`（記事一覧ページ）と `link_pattern`（記事 URL の正規表現）を指定すると、リンク文字列に銘柄名・コードを含む記事を拾います。
- 投資理由を含む個人ブログが見つかると、そのブログを**自動で巡回対象に追加**します（他の銘柄でもブログ内検索されます）。

```json
{
  "blogs": [
    {"url": "https://example.hatenablog.com/", "name": "例のブログ"},
    {"url": "https://example.com/", "list_url": "https://example.com/archive/", "link_pattern": "/\\d{4}/\\d{2}/"}
  ]
}
```

## 出力 Markdown の構成

1. 収集記事の一覧（種別・著者・公開日・保有の明言・抜粋のある観点）
2. 個人投資家の見解：記事ごとの抜粋（原文）と、各文が該当する観点〔①〜⑦〕
3. カタリスト候補の抜粋（全記事横断）
4. 投資仮説が崩れる条件・リスクの抜粋
5. X の公開投稿
6. ニュース・株価情報（参考）／ 銘柄名は出るが投資の話題がない記事（一覧のみ）
7. 取得できなかった情報・収集上の制約（経路別の成功・失敗、削除済み・robots.txt 等、件数不足の診断）

観点: ①買った理由 ②割安の根拠 ③財務安全性・下値 ④業績改善シナリオ ⑤株主還元・資本配分 ⑥カタリスト ⑦仮説が崩れる条件

- 引用（`>`・【原文】）は記事からの機械的な抜粋で、言い換えはしていません。
- 〔システム判定〕と書いたもの（観点・記事種別・保有判定）はキーワード規則による推測です。
- 件数が少ない理由は「検索に失敗」「抽出に失敗」「記事が実際に少ない」を区別して表示します。

## データの保存

- `data\katarist.db`（SQLite）: 記事本文・タイトル・URL・著者/ブログ名・公開日・取得日・証券コード・会社名・検索クエリ・発見元・取得ステータス。一覧はビュー `v_articles` で確認できます。
- 記事本文は**ローカル分析用途に限定**しています。`data\`・`output\`・`logs\` は `.gitignore` 済みです。DB を外部へ配布しないでください。
- URL の表記揺れ（http/https、www、追跡パラメータ、`?hl=en` 等の言語指定、`/en/` パス、AMP、canonical・hreflang の別言語版）は同一記事として統合し、本文ハッシュが一致する転載も重複として扱います。
- `logs\katarist_YYYYMMDD.log`: 全検索・取得の詳細ログ。

## アクセスの方針

- 記事本文・RSS・検索サービス（はてブ・アメーバ・Yahoo!リアルタイム・note ハッシュタグ）は robots.txt を確認してから取得します。
- Web 検索エンジン（Bing・Yahoo!）の検索結果ページは robots.txt で機械的なアクセスが禁止されています。公式 API のキーがない場合に限り、低頻度（1エンジン2.5秒間隔、24時間キャッシュ）で利用します。これを避けたい場合は `--engines brave_api,google_cse` としてください。
- HTTP 403/429・CAPTCHA を検知したらそのサイト・エンジンはその実行中は停止し、突破は試みません。接続エラーと 5xx のみ最大2回まで再試行します（2秒→4秒待機）。
- ログイン必須・有料記事・JavaScript 必須のページは取得できません。

## テスト

```powershell
python -m unittest discover -s tests
```

ネットワークに接続しない単体テストです（URL 正規化、関連度判定、仮説抽出、RSS 解析、DB の重複統合、Markdown 生成、診断）。

## 構成

```
research.py            CLI
collector/
  settings.py          設定（タイムアウト・待機・上限など）
  http.py              HTTP 取得（タイムアウト・リトライ・robots.txt・アクセス制限の検知）
  urlnorm.py           URL 正規化・重複キー
  db.py                SQLite スキーマ
  company.py           証券コード→会社名（株探 → Yahoo!ファイナンス）
  discovery.py         検索経路（Web・はてブ・リアルタイム・アメーバ・note・株ライン）
  blogs.py             ブログ巡回（RSS・ブログ内検索・一覧ページ・自動登録）
  extract.py           本文・メタデータ抽出（trafilatura）
  sources.py           媒体種別（ブログ・note・ニュース等）
  analysis.py          関連度判定・投資仮説の抽出（ルールベース）
  report.py            Markdown 出力・診断
  pipeline.py          1銘柄分の処理の流れ
config/blogs.json      巡回対象ブログ
old_pgm/               旧版（参考）
```
