"""
kokuho.py ─ 国宝チェックリストアプリ CLI
使い方:
  python kokuho.py init
  python kokuho.py add_view --search 風神雷神
  python kokuho.py generate_report
  python kokuho.py export_csv
  python kokuho.py update_master
"""
from __future__ import annotations

import csv
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Windows環境でcp932にない文字をprintするとクラッシュするため UTF-8 に設定
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import typer
from rich.console import Console
from rich.table import Table

import db
from report import generate_html_report

app = typer.Typer(help="国宝チェックリストアプリ")
# legacy_windows=False で cp932 レガシーレンダラーを使わず ANSI 出力にする
console = Console(legacy_windows=False)

MASTER_JSON = Path(__file__).parent / "data" / "master_snapshot.json"
REPORT_HTML = Path("report.html")
CSV_TREASURES = Path("treasures_with_status.csv")
CSV_LOGS = Path("view_logs.csv")


# ================================================================
#  init
# ================================================================

@app.command()
def init():
    """DBを初期化し、マスタデータを投入する"""
    console.print("[bold cyan]⚙  DB初期化中...[/bold cyan]")
    db.init_db()
    console.print("[green]✓ スキーマ作成完了[/green]")

    if db.count_treasures() == 0:
        if not MASTER_JSON.exists():
            console.print(f"[red]✗ マスタデータが見つかりません: {MASTER_JSON}[/red]")
            raise typer.Exit(1)
        records = db.load_master_from_json(MASTER_JSON)
        inserted, updated, logically_deleted = db.upsert_master(records)
        console.print(
            f"[green]✓ 国宝マスタ投入: {inserted}件 追加 / {updated}件 更新"
            f"{f' / {logically_deleted}件 論理削除' if logically_deleted else ''}[/green]"
        )
    else:
        cnt = db.count_treasures()
        console.print(f"[yellow]⚠ 既にデータあり ({cnt}件)。スキップ。[/yellow]")

    overall = db.get_overall_stats()
    console.print(
        f"[bold]📊 現状: 全{overall['total']}件 / 観覧済{overall['viewed']}件 "
        f"/ 達成率 {overall['rate']:.1%}[/bold]"
    )


# ================================================================
#  add_view
# ================================================================

@app.command()
def add_view(
    treasure_id: Optional[str] = typer.Option(None, "--id", help="国宝ID"),
    search: Optional[str] = typer.Option(None, "--search", "-s", help="名称キーワード検索"),
    date: str = typer.Option(
        datetime.now().strftime("%Y-%m-%d"), "--date", "-d", help="観覧日 (YYYY-MM-DD)"
    ),
    venue: str = typer.Option("", "--venue", "-v", help="見た場所"),
    memo: str = typer.Option("", "--memo", "-m", help="メモ"),
    evidence: str = typer.Option("", "--evidence", "-e", help="写真パス/URL"),
):
    """観覧ログを追加する"""
    db.init_db()

    # ── IDが直接指定された場合 ──
    if treasure_id:
        treasure = db.get_treasure_by_id(treasure_id)
        if not treasure:
            console.print(f"[red]✗ ID '{treasure_id}' が見つかりません[/red]")
            raise typer.Exit(1)
        _confirm_and_add(treasure, date, venue, memo, evidence)
        return

    # ── キーワード検索 ──
    if not search:
        console.print("[red]✗ --id または --search を指定してください[/red]")
        raise typer.Exit(1)

    results = db.search_treasures(search)
    if not results:
        console.print(f"[yellow]'{search}' に該当する国宝が見つかりません[/yellow]")
        raise typer.Exit(0)

    if len(results) == 1:
        _confirm_and_add(results[0], date, venue, memo, evidence)
        return

    # 複数ヒット → 選択
    table = Table(title=f"🔍 '{search}' の検索結果", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("ID", style="cyan", width=10)
    table.add_column("名称", style="bold")
    table.add_column("都道府県")
    table.add_column("種別")
    table.add_column("観覧数", justify="center")

    for i, r in enumerate(results, 1):
        cnt = r["view_count"]
        table.add_row(
            str(i), r["id"], r["name"], r["prefecture"],
            r["type"] or "", "✅" if cnt > 0 else "─"
        )
    console.print(table)

    choice = typer.prompt(f"番号を入力 (1-{len(results)}, 0=キャンセル)", default=0)
    try:
        idx = int(choice)
    except ValueError:
        console.print("[red]無効な入力[/red]")
        raise typer.Exit(1)

    if idx == 0:
        console.print("キャンセルしました")
        raise typer.Exit(0)
    if not 1 <= idx <= len(results):
        console.print("[red]範囲外です[/red]")
        raise typer.Exit(1)

    _confirm_and_add(results[idx - 1], date, venue, memo, evidence)


def _confirm_and_add(treasure, date, venue, memo, evidence):
    console.print(f"\n[bold]対象: {treasure['name']}[/bold] ({treasure['prefecture']})")
    console.print(f"  観覧日: {date}  場所: {venue or '(未入力)'}  メモ: {memo or '(未入力)'}")

    if not typer.confirm("この内容で記録しますか？", default=True):
        console.print("キャンセルしました")
        raise typer.Exit(0)

    log_id = db.add_view_log(treasure["id"], date, venue, memo, evidence)
    console.print(f"[green]✓ 記録しました (log_id: {log_id})[/green]")

    # 達成率表示
    overall = db.get_overall_stats()
    console.print(
        f"[bold]📊 全体達成率: {overall['viewed']}/{overall['total']} "
        f"({overall['rate']:.1%})[/bold]"
    )


# ================================================================
#  generate_report
# ================================================================

@app.command()
def generate_report(
    output: str = typer.Option(str(REPORT_HTML), "--output", "-o", help="出力ファイル"),
):
    """report.html を生成する"""
    db.init_db()
    out_path = Path(output)

    console.print("[bold cyan]📊 レポート生成中...[/bold cyan]")

    overall      = db.get_overall_stats()
    pref_stats   = db.get_prefecture_stats()
    cat_stats    = db.get_category_stats()
    type_stats   = db.get_type_stats()
    not_viewed   = db.get_not_viewed()

    html = generate_html_report(
        overall=overall,
        pref_stats=pref_stats,
        cat_stats=cat_stats,
        type_stats=type_stats,
        not_viewed=[dict(r) for r in not_viewed],
    )

    out_path.write_text(html, encoding="utf-8")
    console.print(f"[green]✓ レポートを出力しました: {out_path.resolve()}[/green]")


# ================================================================
#  export_csv
# ================================================================

@app.command()
def export_csv(
    out_dir: str = typer.Option(".", "--out", "-o", help="出力ディレクトリ"),
):
    """CSVを出力する (treasures_with_status.csv / view_logs.csv)"""
    db.init_db()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # treasures_with_status.csv
    rows = db.get_all_with_status()
    if rows:
        keys = rows[0].keys()
        p1 = out / CSV_TREASURES.name
        with open(p1, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            w.writerows([dict(r) for r in rows])
        console.print(f"[green]✓ {p1} ({len(rows)}件)[/green]")

    # view_logs.csv
    logs = db.get_all_view_logs()
    if logs:
        keys2 = logs[0].keys()
        p2 = out / CSV_LOGS.name
        with open(p2, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=keys2)
            w.writeheader()
            w.writerows([dict(r) for r in logs])
        console.print(f"[green]✓ {p2} ({len(logs)}件)[/green]")
    else:
        console.print("[yellow]観覧ログなし[/yellow]")


# ================================================================
#  update_master
# ================================================================

@app.command()
def update_master(
    json_path: str = typer.Option(str(MASTER_JSON), "--json", "-j", help="マスタJSONパス"),
):
    """マスタデータを再投入する（ログは保持）"""
    db.init_db()
    p = Path(json_path)
    if not p.exists():
        console.print(f"[red]✗ ファイルが見つかりません: {p}[/red]")
        raise typer.Exit(1)

    records = db.load_master_from_json(p)
    console.print(f"[cyan]マスタ更新中... {len(records)}件[/cyan]")
    inserted, updated, logically_deleted = db.upsert_master(records)
    console.print(f"[green]✓ 追加: {inserted}件 / 更新: {updated}件 / 論理削除: {logically_deleted}件[/green]")


# ================================================================
#  status (簡易確認)
# ================================================================

@app.command()
def status():
    """現在の達成状況を表示する"""
    db.init_db()

    overall = db.get_overall_stats()
    console.print(
        f"\n[bold]🇯🇵 全体達成率: {overall['viewed']}/{overall['total']}件 "
        f"({overall['rate']:.1%})[/bold]"
    )

    pref_stats = db.get_prefecture_stats()
    table = Table(title="都道府県別達成率 TOP10", show_lines=False)
    table.add_column("都道府県", style="bold")
    table.add_column("総数", justify="right")
    table.add_column("見た数", justify="right", style="green")
    table.add_column("未達数", justify="right", style="red")
    table.add_column("達成率", justify="right", style="cyan")

    for r in pref_stats[:10]:
        if r["total"] == 0:
            continue
        table.add_row(
            r["prefecture"],
            str(r["total"]),
            str(r["viewed"]),
            str(r["not_viewed"]),
            f"{r['rate']:.1%}",
        )
    console.print(table)


if __name__ == "__main__":
    app()
