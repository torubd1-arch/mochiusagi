"""
tools/build_master_snapshot.py

文化庁「国指定文化財等データベース」から国宝マスタを生成する。
  - 対象: 国宝・重要文化財（建造物）→ 国宝のみ
          国宝・重要文化財（美術工芸品）→ 国宝のみ
  - 画像は取得しない
  - 詳細ページをキャッシュするため2回目以降は高速

使い方:
    python tools/build_master_snapshot.py            # 通常実行
    python tools/build_master_snapshot.py --clear-cache  # キャッシュ削除して再取得
    python tools/build_master_snapshot.py --test         # 各カテゴリ1ページだけ試行
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path

# Windows環境でcp932にない漢字を含む国宝名をprintするとクラッシュするため
# 標準出力をUTF-8に設定する
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from bs4 import BeautifulSoup

# ================================================================
# 設定
# ================================================================
BASE_URL    = "https://kunishitei.bunka.go.jp"
CACHE_DIR   = Path(__file__).parent.parent / "data" / "cache"
OUTPUT_JSON = Path(__file__).parent.parent / "data" / "master_snapshot.json"

RATE_LIMIT     = 1.2   # リクエスト間隔（秒）
RETRY_LIMIT    = 3     # リトライ回数
RETRY_WAIT     = 4.0   # リトライ待機（秒）
ITEMS_PER_PAGE = 20    # 文化庁DBのデフォルト表示件数

# 取得対象: register_sub_id / 国宝フィルタキー / カテゴリ名
TARGETS = [
    {
        "register_sub_id": "102",
        "nation_div_key":  "nation_div_102",
        "category":        "architecture",
        "label":           "建造物",
    },
    {
        "register_sub_id": "201",
        "nation_div_key":  "nation_div_201",
        "category":        "art",
        "label":           "美術工芸品",
    },
]


# ================================================================
# HTTPセッション
# ================================================================
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; kokuho-checklist/1.0; personal-research)",
    })
    return s


def get_csrf(s: requests.Session) -> str:
    """初回GETでCSRFトークンを取得する"""
    r = s.get(f"{BASE_URL}/bsys/searchlist", timeout=20)
    inp = BeautifulSoup(r.text, "html.parser").find("input", {"name": "_csrfToken"})
    return inp["value"] if inp else ""


# ================================================================
# キャッシュ（詳細ページのみキャッシュ）
# ================================================================
def _cache_path(url_path: str) -> Path:
    safe = url_path.strip("/").replace("/", "_")
    return CACHE_DIR / f"{safe}.html"


def load_cache(url_path: str) -> str | None:
    p = _cache_path(url_path)
    return p.read_text(encoding="utf-8") if p.exists() else None


def save_cache(url_path: str, html: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(url_path).write_text(html, encoding="utf-8")


# ================================================================
# レート制限付きGET（リトライあり）
# ================================================================
_last_req: float = 0.0


def fetch_url(s: requests.Session, url: str) -> str:
    global _last_req
    elapsed = time.time() - _last_req
    if elapsed < RATE_LIMIT:
        time.sleep(RATE_LIMIT - elapsed)

    for attempt in range(1, RETRY_LIMIT + 1):
        try:
            r = s.get(url, timeout=20)
            r.raise_for_status()
            _last_req = time.time()
            return r.text
        except Exception as e:
            print(f"\n  [警告] リトライ {attempt}/{RETRY_LIMIT}: {e}")
            time.sleep(RETRY_WAIT)

    raise RuntimeError(f"取得失敗（{RETRY_LIMIT}回）: {url}")


# ================================================================
# 一覧ページから詳細ページURLを収集
# ================================================================
def collect_detail_urls(
    s: requests.Session,
    csrf: str,
    target: dict,
    test_mode: bool = False,
) -> list[str]:
    """
    一覧ページを全ページ走査して詳細ページURLを収集する。
    pageNumber パラメータでページを指定する。
    """
    rsid     = target["register_sub_id"]
    nd_key   = target["nation_div_key"]
    label    = target["label"]

    base_params = {
        "_method":        "POST",
        "_csrfToken":     csrf,
        "register_sub_id": rsid,
        nd_key:           "国宝",
        "page_no":        "1",
        "sortTarget":     "area",
        "sortType":       "asc",
    }

    # 1ページ目を取得して総件数を確認
    r1 = s.post(f"{BASE_URL}/bsys/searchlist",
                data={**base_params, "pageNumber": "1"}, timeout=20)
    time.sleep(RATE_LIMIT)
    soup1 = BeautifulSoup(r1.text, "html.parser")

    m = re.search(r"([\d,]+)\s*件中", soup1.get_text())
    total = int(m.group(1).replace(",", "")) if m else 0
    total_pages = math.ceil(total / ITEMS_PER_PAGE)
    if test_mode:
        total_pages = min(total_pages, 1)  # テスト時は1ページのみ

    print(f"  {label}: 合計 {total}件, {total_pages}ページ{'（テスト: 1ページ）' if test_mode else ''}")

    all_urls: list[str] = []
    seen: set[str] = set()

    for page_no in range(1, total_pages + 1):
        print(f"  　一覧p{page_no}/{total_pages}...", end="", flush=True)
        r = s.post(f"{BASE_URL}/bsys/searchlist",
                   data={**base_params, "pageNumber": str(page_no)}, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")

        # 詳細ページリンクを収集（同一URLの重複を除去）
        added = 0
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/heritage/detail/" in href and href not in seen:
                seen.add(href)
                all_urls.append(href)
                added += 1

        print(f" +{added}件 (累計 {len(all_urls)})")
        time.sleep(RATE_LIMIT)

    return all_urls


# ================================================================
# 詳細ページのパース
# ================================================================
def parse_detail(soup: BeautifulSoup, url_path: str, category: str) -> dict | None:
    """
    詳細ページの「ラベル ｜ ： ｜ 値」の3列テーブルを解析する。
    パース失敗時は None を返す。
    """
    fields: dict[str, str] = {}

    for tbl in soup.find_all("table"):
        for tr in tbl.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            if len(tds) >= 3:
                label = tds[0].get_text(strip=True)
                sep   = tds[1].get_text(strip=True)
                value = tds[2].get_text(strip=True)
                if sep == "：" and label and label not in fields:
                    fields[label] = value

    # 名称（必須）
    name = fields.get("名称", "").strip()
    if not name:
        return None

    # 国宝かどうか確認（重要文化財が混入していないか防御チェック）
    div = fields.get("国宝・重文区分", "")
    if div and "国宝" not in div:
        return None  # 重要文化財のみの場合はスキップ

    # 種別
    raw_type = fields.get("種別", "").strip()
    type_val = _normalize_type(raw_type, category)

    # 所在都道府県
    prefecture = _normalize_prefecture(fields.get("所在都道府県", ""))

    # 所在地 → 市区町村
    address = fields.get("所在地", "").strip()
    city = _extract_city(address, prefecture)

    # 所有者
    holder = fields.get("所有者名", "").strip()

    # 施設
    facility = fields.get("保管施設の名称", "").strip()

    # 安定ID（詳細URLのパスから生成）
    m = re.search(r"/heritage/detail/(\d+)/(\w+)$", url_path)
    if not m:
        return None
    reg_type  = m.group(1)
    item_code = m.group(2)
    prefix = "ARCH" if category == "architecture" else "ART"
    id_ = f"{prefix}-{reg_type}-{item_code}"

    return {
        "id":           id_,
        "name":         name,
        "category":     category,
        "type":         type_val,
        "prefecture":   prefecture,
        "city":         city,
        "holder":       holder,
        "facility":     facility,
        "source_url":   f"{BASE_URL}{url_path}",
        "notes_master": "",
    }


def _normalize_type(raw: str, category: str) -> str:
    """
    建造物: 「近世以前／寺院」→「寺院」（スラッシュ以降を取る）
    美術工芸品: そのまま返す
    """
    if not raw:
        return ""
    if category == "architecture":
        # 全角スラッシュ（／）と半角スラッシュ（/）両方に対応
        for sep in ("／", "/"):
            if sep in raw:
                return raw.split(sep)[-1].strip()
    return raw.strip()


_PREF_ALIASES: dict[str, str] = {
    # 文化庁DBで「京都府」でなく「京都」と記載されているケース
    "京都": "京都府",
}


def _normalize_prefecture(raw: str) -> str:
    """「岩手県」「東京都」「京都府」「北海道」などを正規化する"""
    raw = raw.strip()
    if not raw:
        return ""
    # 「都道府県」で終わる最短マッチを取り出す
    m = re.match(r"^(.+?[都道府県])", raw)
    result = m.group(1) if m else raw
    # エイリアスで正規化（例: 「京都」→「京都府」）
    return _PREF_ALIASES.get(result, result)


def _extract_city(address: str, prefecture: str) -> str:
    """
    所在地「岩手県西磐井郡平泉町平泉」から市区町村部分を抽出する。
    都道府県プレフィックスを除いた後、最初の市区町村名を取り出す。
    """
    if not address:
        return ""
    # 都道府県部分を除去
    if prefecture and address.startswith(prefecture):
        rest = address[len(prefecture):]
    else:
        rest = re.sub(r"^.+?[都道府県]", "", address)
    if not rest:
        return ""
    # 市区町村を取り出す（郡+町村 も含む）
    m = re.match(
        r"^((?:[^0-9０-９\d]+?)"  # 地名文字列
        r"(?:市|区|町|村|"          # 市区町村
        r"郡[^\d０-９]+?[市区町村]" # 郡+市区町村
        r"))",
        rest,
    )
    return m.group(1).strip() if m else rest[:20].strip()


# ================================================================
# メイン処理
# ================================================================
def build_master(clear_cache: bool = False, test_mode: bool = False) -> None:
    if clear_cache and CACHE_DIR.exists():
        import shutil
        shutil.rmtree(CACHE_DIR)
        print("キャッシュをクリアしました")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    s    = make_session()
    csrf = get_csrf(s)
    if not csrf:
        raise RuntimeError("CSRFトークンの取得に失敗しました")
    print(f"CSRFトークン取得完了")
    time.sleep(RATE_LIMIT)

    all_records: list[dict] = []

    for target in TARGETS:
        label    = target["label"]
        category = target["category"]
        print(f"\n{'='*50}")
        print(f"【{label}】一覧ページを収集中...")

        # フェーズ1: 詳細URLの収集
        detail_urls = collect_detail_urls(s, csrf, target, test_mode=test_mode)
        print(f"  → 詳細URL {len(detail_urls)}件を収集")

        # フェーズ2: 詳細ページのパース
        print(f"  詳細ページを取得・パース中...")
        ok_count = ng_count = cache_hit = 0

        for i, url_path in enumerate(detail_urls, 1):
            # キャッシュ確認
            html = load_cache(url_path)
            cached = html is not None
            if not cached:
                html = fetch_url(s, f"{BASE_URL}{url_path}")
                save_cache(url_path, html)

            soup   = BeautifulSoup(html, "html.parser")
            record = parse_detail(soup, url_path, category)

            cache_mark = "[C]" if cached else "   "
            if record:
                all_records.append(record)
                ok_count += 1
                if cached:
                    cache_hit += 1
                print(
                    f"  {cache_mark} {i:4d}/{len(detail_urls)}"
                    f" {record['name'][:25]:<25s}"
                    f" [{record['prefecture'] or '都道府県なし'}]"
                )
            else:
                ng_count += 1
                print(f"  {cache_mark} {i:4d}/{len(detail_urls)} ★パース失敗: {url_path}")

        print(f"\n  {label}: 成功 {ok_count}件 / 失敗 {ng_count}件 (キャッシュヒット {cache_hit}件)")

    # ================================================================
    # JSON保存
    # ================================================================
    OUTPUT_JSON.write_text(
        json.dumps(all_records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 品質チェック
    print(f"\n{'='*50}")
    print(f"生成完了: {len(all_records)}件 → {OUTPUT_JSON}")

    no_name   = [r for r in all_records if not r["name"]]
    no_pref   = [r for r in all_records if not r["prefecture"]]
    no_holder = [r for r in all_records if not r["holder"]]
    no_url    = [r for r in all_records if not r["source_url"]]

    print(f"  名称なし    : {len(no_name)}件")
    print(f"  都道府県なし: {len(no_pref)}件")
    print(f"  所有者なし  : {len(no_holder)}件")
    print(f"  source_urlなし: {len(no_url)}件")

    # カテゴリ別集計
    from collections import Counter
    pref_counts = Counter(r["prefecture"] for r in all_records)
    cat_counts  = Counter(r["category"]   for r in all_records)
    print(f"\n  カテゴリ別:")
    for cat, cnt in sorted(cat_counts.items()):
        print(f"    {cat}: {cnt}件")
    print(f"\n  都道府県別（上位10）:")
    for pref, cnt in pref_counts.most_common(10):
        print(f"    {pref}: {cnt}件")


# ================================================================
# CLI
# ================================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="文化庁DBから国宝マスタを生成する",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  python tools/build_master_snapshot.py           # 全件取得
  python tools/build_master_snapshot.py --test    # 1ページずつ試行
  python tools/build_master_snapshot.py --clear-cache  # キャッシュ削除して再取得
        """,
    )
    parser.add_argument(
        "--clear-cache", action="store_true",
        help="キャッシュを削除して全ページを再取得する",
    )
    parser.add_argument(
        "--test", action="store_true",
        help="各カテゴリ1ページのみ取得して動作確認する",
    )
    args = parser.parse_args()
    build_master(clear_cache=args.clear_cache, test_mode=args.test)
