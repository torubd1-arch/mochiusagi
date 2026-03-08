# 🇯🇵 国宝チェックリストアプリ

文化資産の攻略台帳。日本の国宝を都道府県別に管理し、観覧達成率を可視化する。

## セットアップ

```bash
pip install -r requirements.txt
python kokuho.py init
```

## 基本的な使い方

```bash
# DB初期化 & マスタ投入
python kokuho.py init

# レポート生成 → report.html を開く
python kokuho.py generate_report

# 観覧記録を追加（キーワード検索）
python kokuho.py add-view --search 阿修羅

# 観覧記録を追加（ID直接指定）
python kokuho.py add-view --id NT-0026 --date 2025-03-15 --venue 興福寺国宝館

# 現在の達成状況を確認
python kokuho.py status

# CSVエクスポート
python kokuho.py export-csv

# マスタデータ更新
python kokuho.py update-master
```

## 集計ロジック（重要）

**都道府県別達成率 = 所在県基準**

- 分母：その都道府県に所在する国宝総数
- 分子：そのうち view_logs が1件以上あるユニーク件数
- 巡回展で他県で見ても、所在県の達成率に加算される
- 同じ国宝を複数回見ても +1（重複なし）

## ファイル構成

```
kokuho/
├── kokuho.py          # CLI エントリーポイント
├── db.py              # SQLite データベース操作
├── report.py          # HTML レポート生成
├── templates/
│   └── report.html.j2 # Jinja2 テンプレート
├── data/
│   └── master_snapshot.json  # 国宝マスタ（138件収録）
└── tests/
    └── test_achievement.py   # 達成率計算ユニットテスト
```

## テスト実行

```bash
python -m pytest tests/ -v
```

## マスタデータについて

`data/master_snapshot.json` には代表的な国宝138件を収録（25都道府県分）。
完全データ（約1,100件）は文化庁「国指定文化財等データベース」から取得可能。

```bash
# 独自JSONを用意して更新
python kokuho.py update-master --json /path/to/your_data.json
```
