#!/usr/bin/env python3
"""バリュー投資家の投資仮説収集システム。

使い方（PowerShell）:
    python research.py 6505
    python research.py 6505 4222 4628 8061
    python research.py 6505 --report-only        # ネットに接続せず、蓄積済みデータから Markdown だけ再生成
    python research.py --add-blog https://example.hatenablog.com/
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

from collector.company import resolve_company
from collector.db import Database
from collector.http import HttpClient
from collector.pipeline import Pipeline, RunOptions
from collector.report import diagnose, write_report
from collector.settings import Settings


def setup_logging(settings: Settings, verbose: bool) -> Path:
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    path = settings.log_dir / f"katarist_{datetime.now():%Y%m%d}.log"
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    fh = logging.FileHandler(path, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    ch = logging.StreamHandler(sys.stderr)
    ch.setLevel(logging.DEBUG if verbose else logging.INFO)
    ch.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(fh)
    root.addHandler(ch)
    for noisy in ("urllib3", "trafilatura", "htmldate", "charset_normalizer", "primp", "ddgs", "httpx", "h2", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return path


def add_blog(settings: Settings, url: str, name: str | None) -> None:
    path = settings.blogs_file
    cfg = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"blogs": []}
    if any(b.get("url", "").rstrip("/") == url.rstrip("/") for b in cfg["blogs"]):
        print(f"登録済みです: {url}")
        return
    cfg["blogs"].append({"url": url, **({"name": name} if name else {})})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"登録しました: {url}（{path}）")


def print_summary(stats: dict, report: Path) -> None:
    an = stats.get("analysis", {})
    rel = an.get("relevant", 0)
    news = an.get("kind:ニュース・株価情報", 0)
    unrelated = an.get("relevance:無関係", 0)
    judged = rel + unrelated
    print("")
    print(f"■ {stats['name']}（{stats['code']}） 処理時間 {stats['elapsed_sec']} 秒")
    print(f"  関連記事 {rel} 件（今回新規発見 {stats['new_articles']} 件、重複統合 {an.get('duplicates_merged', 0)} 件）")
    print(f"  投資理由の記載あり〔判定〕 {an.get('has_reason', 0)} 件 ／ カタリスト候補あり {an.get('has_catalyst', 0)} 件"
          f"（うち個人の見解 {an.get('has_catalyst_personal', 0)} 件） ／ 保有・購入の明言 {an.get('holding_explicit', 0)} 件")
    if rel:
        print(f"  ニュース・株価情報の比率 {news / rel:.0%} ／ 無関係と判定 {unrelated}/{judged} 件")
    for line in diagnose(stats):
        print(f"  診断: {re.sub(r'[*]', '', line)}")
    print(f"  出力: {report}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="指定銘柄について、個人投資家の投資仮説を収集し ChatGPT 用 Markdown を出力します。")
    p.add_argument("codes", nargs="*", help="証券コード（複数可）。例: 6505 4222")
    p.add_argument("--name", help="会社名を手動指定（銘柄1つのときのみ）")
    p.add_argument("--alias", action="append", default=[], help="照合用の別名（例: 略称）。複数指定可。銘柄1つのときのみ")
    p.add_argument("--query", action="append", default=[], help='追加の Web 検索クエリ。{name} {code} を使用可')
    p.add_argument("--engines", help="Web 検索エンジン（カンマ区切り）。既定: brave_api,google_cse,ddgs_yahoo,bing_html")
    p.add_argument("--no-web", action="store_true", help="Web 検索を行わない")
    p.add_argument("--no-hatena", action="store_true", help="はてなブックマーク検索を行わない")
    p.add_argument("--no-realtime", action="store_true", help="Yahoo!リアルタイム検索（X投稿）を行わない")
    p.add_argument("--no-ameba", action="store_true", help="アメーバ検索を行わない")
    p.add_argument("--no-note", action="store_true", help="note のハッシュタグ RSS を確認しない")
    p.add_argument("--no-antenna", action="store_true", help="株ライン ブログアンテナを確認しない")
    p.add_argument("--no-blogs", action="store_true", help="登録・自動発見ブログの巡回を行わない")
    p.add_argument("--refresh-search", action="store_true", help="24時間以内に実行済みの検索も再実行する")
    p.add_argument("--max-fetch", type=int, help="1回の実行で本文を取得する最大件数（既定 300）")
    p.add_argument("--report-only", action="store_true", help="ネット接続せず蓄積データから Markdown を再生成する")
    p.add_argument("--add-blog", metavar="URL", help="巡回対象ブログを config/blogs.json に登録する")
    p.add_argument("--blog-name", help="--add-blog と一緒に使うブログ名")
    p.add_argument("--db", help="SQLite ファイルのパス")
    p.add_argument("--output-dir", help="Markdown の出力先")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    # 絵文字など cp932 で表示できない文字で止まらないようにする
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass

    settings = Settings()
    if args.db:
        settings.db_path = Path(args.db)
    if args.output_dir:
        settings.output_dir = Path(args.output_dir)
    if args.engines:
        settings.web_engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    if args.max_fetch:
        settings.max_fetch_per_run = args.max_fetch

    if args.add_blog:
        add_blog(settings, args.add_blog, args.blog_name)
        if not args.codes:
            return 0
    if not args.codes:
        p.print_help()
        return 2
    bad = [c for c in args.codes if not re.fullmatch(r"\d{3}[0-9A-Z]", c.upper())]
    if bad:
        print(f"エラー: 証券コードの形式が不正です: {', '.join(bad)}", file=sys.stderr)
        return 2
    if (args.name or args.alias) and len(args.codes) > 1:
        print("エラー: --name / --alias は銘柄を1つだけ指定したときに使えます。", file=sys.stderr)
        return 2

    log_path = setup_logging(settings, args.verbose)
    db = Database(settings.db_path)
    http = HttpClient(settings)
    pipeline = Pipeline(settings, db, http)
    opts = RunOptions(web=not args.no_web, hatena=not args.no_hatena, realtime=not args.no_realtime,
                      ameba=not args.no_ameba, note=not args.no_note, antenna=not args.no_antenna, blogs=not args.no_blogs, refresh_search=args.refresh_search, extra_queries=args.query)
    rc = 0
    try:
        for code in [c.upper() for c in args.codes]:   # 複数銘柄は順次実行
            try:
                if args.report_only:
                    company = resolve_company(code, db, http, args.name, args.alias)
                    last = db.one("SELECT stats FROM runs WHERE code=? AND stats IS NOT NULL ORDER BY id DESC LIMIT 1", (code,))
                    path = write_report(db, company, json.loads(last["stats"]) if last else None, settings.output_dir)
                    print(f"出力: {path}")
                    continue
                stats = pipeline.run(code, opts, args.name, args.alias)
                company = pipeline.company
                path = write_report(db, company, stats, settings.output_dir)
                print_summary(stats, path)
            except RuntimeError as exc:
                logging.error("エラー（%s）: %s", code, exc)
                rc = 1
            except KeyboardInterrupt:
                raise
            except Exception:
                logging.exception("想定外のエラー（%s）。次の銘柄に進みます。", code)
                rc = 1
    except KeyboardInterrupt:
        print("\n中断しました。取得済みのデータは保存されています。", file=sys.stderr)
        rc = 130
    finally:
        db.close()
    print(f"ログ: {log_path}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
