#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
バリュー投資家の「なぜ買ったのか」をWebから収集するためのリサーチ補助スクリプト。

目的:
- 指定銘柄について、個人投資家のブログ / note / X検索結果等を広く探索
- 「買った理由」「割安性」「下値余地」「財務安全性」「株主還元」
  「資本配分」「カタリスト」「リスク」に関する記述を抽出
- URL・検索クエリ・短い原文抜粋を残し、後から人間/LLMが検証できる形で出力

注意:
- 投資判断を自動化するものではありません。
- ログイン、ペイウォール回避、CAPTCHA回避は行いません。
- 全文保存ではなく、検証用の短い抜粋を保存します。
"""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS
from trafilatura import extract


# -----------------------------
# 設定
# -----------------------------

DEFAULT_QUERIES = [
    '"{name}" 株 "買いました"',
    '"{name}" 株 "購入しました"',
    '"{name}" 株 "買い増し"',
    '"{name}" 株 "投資理由"',
    '"{name}" 株 "保有理由"',
    '"{name}" 株 "割安"',
    '"{name}" 株 "カタリスト"',
    '"{name}" "バリュー投資"',
    '"{code}" 株 ブログ',
    'site:note.com "{name}" 株',
    'site:ameblo.jp "{name}" 株',
    'site:blog.fc2.com "{name}" 株',
    'site:hatenablog.com "{name}" 株',
    'site:x.com "{name}" 株 投資',
]

CATEGORY_TERMS = {
    "買い理由": [
        "買いました", "購入しました", "新規買い", "打診買い", "買い増し",
        "仕込み", "保有しています", "保有中", "投資理由", "保有理由",
        "投資妙味", "エントリー", "買い候補", "注目銘柄"
    ],
    "割安性": [
        "割安", "PER", "PBR", "EV/EBITDA", "時価総額", "ネットキャッシュ",
        "ネットネット", "解散価値", "資産価値", "含み資産", "現預金",
        "低PER", "低PBR", "バリュー", "益回り"
    ],
    "下値・財務": [
        "下値", "財務", "無借金", "自己資本比率", "ネットキャッシュ",
        "現金", "キャッシュ", "有利子負債", "倒産", "安全性",
        "配当利回り", "資産バリュー"
    ],
    "株主還元": [
        "増配", "配当", "DOE", "配当性向", "自社株買い", "自己株式",
        "株主還元", "消却", "総還元性向"
    ],
    "経営・資本配分": [
        "資本配分", "経営陣", "経営者", "創業家", "オーナー",
        "持株比率", "IR", "ROE", "ROIC", "資本効率", "政策保有株",
        "事業売却", "選択と集中"
    ],
    "カタリスト": [
        "カタリスト", "上方修正", "増配", "自社株買い", "TOB", "MBO",
        "M&A", "買収", "事業売却", "政策保有株", "アクティビスト",
        "値上げ", "価格改定", "構造改革", "不採算", "撤退", "新工場",
        "増産", "シェア", "中期経営計画", "中計", "資本コスト",
        "東証", "PBR1倍", "親子上場", "上場廃止", "優待", "スピンオフ",
        "負ののれん", "統合", "再編"
    ],
    "業績変化": [
        "増収", "増益", "営業利益率", "利益率", "粗利", "値上げ",
        "数量", "稼働率", "受注", "受注残", "ストック", "リカーリング",
        "黒字化", "赤字縮小", "固定費", "原価", "原材料"
    ],
    "リスク・反対材料": [
        "リスク", "懸念", "割安な理由", "バリュートラップ", "減益",
        "赤字", "シクリカル", "景気敏感", "市況", "原材料高", "希薄化",
        "増資", "減配", "下方修正", "競争激化", "一過性"
    ],
}

CATEGORY_WEIGHTS = {
    "買い理由": 4,
    "割安性": 2,
    "下値・財務": 2,
    "株主還元": 2,
    "経営・資本配分": 2,
    "カタリスト": 3,
    "業績変化": 1,
    "リスク・反対材料": 1,
}

ACTUAL_BUY_TERMS = [
    "買いました", "購入しました", "新規買い", "打診買い",
    "買い増し", "仕込みました", "保有しています", "保有中"
]

MARKET_MEDIA_DOMAINS = (
    "kabutan.jp",
    "minkabu.jp",
    "finance.yahoo.co.jp",
    "nikkei.com",
    "bloomberg.co.jp",
    "reuters.com",
    "shikiho.toyokeizai.net",
    "irbank.net",
)

BLOG_HOST_HINTS = (
    "blog.fc2.com",
    "ameblo.jp",
    "hatenablog.com",
    "hatenablog.jp",
    "livedoor.blog",
    "muragon.com",
    "cocolog-nifty.com",
    "seesaa.net",
    "blog.jp",
)

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "yclid", "ref", "ref_src"
}

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/157.0 Safari/537.36"
)


@dataclass
class Candidate:
    rank: int
    score: int
    source_type: str
    domain: str
    title: str
    url: str
    matched_categories: str
    matched_terms: str
    actual_buy_signal: str
    evidence_excerpt: str
    search_snippet: str
    search_queries: str
    fetch_status: str
    search_engines: str = ""
    relevance: str = ""
    evidence_level: str = ""


def normalize_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        kept = [
            (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in TRACKING_PARAMS
        ]
        path = parts.path.rstrip("/") or "/"
        return urlunsplit((
            parts.scheme.lower(),
            parts.netloc.lower(),
            path,
            urlencode(kept, doseq=True),
            ""
        ))
    except Exception:
        return url


def source_type(url: str) -> tuple[str, str]:
    host = urlsplit(url).netloc.lower().removeprefix("www.")
    if host in ("x.com", "twitter.com") or host.endswith(".x.com"):
        return "X", host
    if host == "note.com" or host.endswith(".note.com"):
        return "note", host
    if any(host == d or host.endswith("." + d) for d in MARKET_MEDIA_DOMAINS):
        return "市場情報/メディア", host
    if any(h in host for h in BLOG_HOST_HINTS):
        return "ブログ", host
    if "blog" in host:
        return "ブログ", host
    return "Web", host


def build_queries(name: str, code: str, extras: list[str]) -> list[str]:
    queries = [q.format(name=name, code=code) for q in DEFAULT_QUERIES]
    queries.extend(
        q.format(name=name, code=code)
        for q in extras
    )
    # 順序を保った重複除去
    return list(dict.fromkeys(q.strip() for q in queries if q.strip()))


SEARCH_BACKENDS = ("google", "bing", "duckduckgo")


def search_web(
    queries: list[str],
    max_results_per_query: int,
    region: str,
    backend: str,
    search_delay: float = 1.2,
) -> dict[str, dict]:
    """各検索語を複数エンジンで検索。失敗したエンジンは他の結果に影響させない。"""
    found: dict[str, dict] = {}
    engines = list(SEARCH_BACKENDS) if backend == "auto" else [e.strip() for e in backend.split(",") if e.strip()]
    for i, query in enumerate(queries, 1):
        print(f"[検索 {i}/{len(queries)}] {query}", file=sys.stderr)
        for engine in engines:
            try:
                # エンジンごとに別インスタンスを作り、失敗状態を引き継がない
                results = list(DDGS(timeout=12).text(
                    query, region=region, safesearch="off",
                    max_results=max_results_per_query, backend=engine,
                ) or [])
            except Exception as exc:
                print(f"  {engine}: 失敗 ({type(exc).__name__}: {exc})", file=sys.stderr)
                time.sleep(search_delay)
                continue
            print(f"  {engine}: {len(results)}件", file=sys.stderr)
            for r in results:
                url = r.get("href") or r.get("url") or ""
                if not url.startswith(("http://", "https://")):
                    continue
                key = normalize_url(url)
                entry = found.setdefault(key, {
                    "url": key, "title": (r.get("title") or "").strip(),
                    "snippets": [], "queries": [], "engines": [],
                })
                if not entry["title"]:
                    entry["title"] = (r.get("title") or "").strip()
                body = (r.get("body") or r.get("snippet") or "").strip()
                if body and body not in entry["snippets"]:
                    entry["snippets"].append(body)
                if query not in entry["queries"]:
                    entry["queries"].append(query)
                if engine not in entry["engines"]:
                    entry["engines"].append(engine)
            time.sleep(search_delay)
    return found


def identify_relevance(title: str, snippet: str, text: str, name: str, code: str) -> str:
    """確実に別銘柄の記事を除外し、本文のみ言及のページは低優先度とする。"""
    heading = f"{title} {snippet[:450]}"
    target = bool(name in heading or re.search(rf"(?<![0-9A-Za-z]){re.escape(code)}(?![0-9A-Za-z])", heading))
    if target:
        return "対象銘柄"
    # タイトルの他の証券コードは誤混入の強い手がかり
    other_codes = re.findall(r"(?<![0-9A-Za-z])(?:[1-9][0-9]{3})(?![0-9A-Za-z])", title)
    if any(c != code for c in other_codes):
        return "対象外"
    if name in text or re.search(rf"(?<![0-9A-Za-z]){re.escape(code)}(?![0-9A-Za-z])", text[:10000]):
        return "本文のみ言及"
    return "対象外"


def relevant_passages(text: str, snippet: str, name: str, code: str) -> str:
    """巨大な掲示板等で他銘柄やサイトメニューから誤検出しないための近傍抽出。"""
    sentences = split_sentences(text)
    target_indices = [i for i, s in enumerate(sentences) if name in s or re.search(
        rf"(?<![0-9A-Za-z]){re.escape(code)}(?![0-9A-Za-z])", s)]
    if not target_indices:
        return (snippet + "\n" + text[:1200])[:8000]
    selected = set()
    for i in target_indices[:35]:
        selected.update(range(max(0, i-1), min(len(sentences), i+3)))
    return "\n".join(sentences[i] for i in sorted(selected))[:15000]


def evidence_level(excerpt: str, actual_buy: bool) -> str:
    # 「保有している」だけでは、理由のある買い判断とはみなさない
    reason = re.search(r"(?:ため|から|ので|理由|狙い|期待|見込|注目|判断|評価|余地|考え|妙味|着目|割安|改善|上昇|解消)", excerpt)
    metrics = re.search(r"(?:PER|PBR|ROE|利益率|受注|現金|値上げ|還元|資産|配当|増益|利益|M&A|再編|自社株買い)", excerpt, re.I)
    if actual_buy and reason and metrics:
        return "買い理由の記述あり（要確認）"
    if reason and metrics:
        return "投資仮説あり（購入未確認）"
    if actual_buy:
        return "売買言及のみ"
    return "参考情報"


def fetch_page_text(url: str, delay: float) -> tuple[str, str]:
    """
    公開ページを通常のHTTP GETで取得。
    ログイン・ペイウォール・CAPTCHA回避はしない。
    """
    stype, _ = source_type(url)

    # Xは本文取得が不安定なので検索スニペットを主に使う
    if stype == "X":
        return "", "snippet_only"

    try:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
        }
        r = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        time.sleep(delay)

        if r.status_code != 200:
            return "", f"http_{r.status_code}"

        ctype = (r.headers.get("content-type") or "").lower()
        if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
            return "", "non_html"

        # 日本語サイトの文字化け対策
        if not r.encoding or r.encoding.lower() in ("iso-8859-1", "ascii"):
            r.encoding = r.apparent_encoding

        html = r.text

        text = extract(
            html,
            include_comments=True,
            include_tables=False,
            favor_recall=True,
            output_format="txt",
        ) or ""

        if len(text.strip()) < 80:
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "noscript", "svg"]):
                tag.decompose()
            text = soup.get_text("\n", strip=True)

        text = html_lib.unescape(text)
        text = re.sub(r"[ \t\u3000]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip(), "ok" if text.strip() else "empty"

    except requests.Timeout:
        return "", "timeout"
    except requests.RequestException as exc:
        return "", f"request_error:{type(exc).__name__}"
    except Exception as exc:
        return "", f"extract_error:{type(exc).__name__}"


def split_sentences(text: str) -> list[str]:
    text = text.replace("\r", "\n")
    parts = re.split(r"(?<=[。！？!?])\s*|\n+", text)
    out = []
    for p in parts:
        p = p.strip(" ・\t")
        if 12 <= len(p) <= 700:
            out.append(p)
    return out


def term_matches(text: str) -> dict[str, list[str]]:
    low = text.lower()
    hits: dict[str, list[str]] = {}
    for category, terms in CATEGORY_TERMS.items():
        matched = []
        for term in terms:
            if term.lower() in low:
                matched.append(term)
        if matched:
            hits[category] = list(dict.fromkeys(matched))
    return hits


def sentence_score(sentence: str, name: str, code: str) -> int:
    hits = term_matches(sentence)
    score = sum(CATEGORY_WEIGHTS[c] for c in hits)
    if name and name in sentence:
        score += 3
    if code and re.search(rf"(?<!\d){re.escape(code)}(?!\d)", sentence):
        score += 2
    if any(t in sentence for t in ACTUAL_BUY_TERMS):
        score += 5
    return score


def make_excerpt(
    text: str,
    snippet: str,
    name: str,
    code: str,
    max_sentences: int = 5,
    max_chars: int = 900,
) -> str:
    base = text if text else snippet
    if not base:
        return ""

    sentences = split_sentences(base)
    ranked = sorted(
        ((sentence_score(s, name, code), idx, s) for idx, s in enumerate(sentences)),
        key=lambda x: (-x[0], x[1]),
    )

    selected = []
    seen = set()

    # 高スコア文を優先
    for sc, _, s in ranked:
        if sc <= 0:
            break
        key = re.sub(r"\s+", "", s)
        if key in seen:
            continue
        selected.append(s)
        seen.add(key)
        if len(selected) >= max_sentences:
            break

    # 何も取れなければ検索スニペットを使用
    if not selected and snippet:
        selected = [snippet.strip()]

    excerpt = " / ".join(selected)
    if len(excerpt) > max_chars:
        excerpt = excerpt[:max_chars].rstrip() + "…"
    return excerpt


def score_candidate(
    text: str,
    snippet: str,
    name: str,
    code: str,
    stype: str,
) -> tuple[int, dict[str, list[str]], bool]:
    base = f"{snippet}\n{text[:120000]}"
    hits = term_matches(base)

    score = 0
    for category in hits:
        score += CATEGORY_WEIGHTS[category]

    actual_buy = any(t in base for t in ACTUAL_BUY_TERMS)
    if actual_buy:
        score += 6

    # 銘柄そのものへの言及が本文/スニペットにあるか
    name_hit = bool(name and name in base)
    code_hit = bool(code and re.search(rf"(?<!\d){re.escape(code)}(?!\d)", base))
    if name_hit:
        score += 4
    if code_hit:
        score += 2
    if not name_hit and not code_hit:
        score -= 5

    # 個人投資家の見解を優先
    if stype in ("ブログ", "note"):
        score += 4
    elif stype == "X":
        score += 2
    elif stype == "市場情報/メディア":
        score -= 3

    # 「買い理由」と「カタリスト」の両方があるページを強く優先
    if "買い理由" in hits and "カタリスト" in hits:
        score += 4
    if "割安性" in hits and "下値・財務" in hits:
        score += 2

    return max(score, 0), hits, actual_buy


def collect(
    name: str,
    code: str,
    max_results_per_query: int,
    top: int,
    region: str,
    backend: str,
    delay: float,
    extra_queries: list[str],
    search_delay: float = 1.2,
) -> tuple[list[Candidate], list[Candidate]]:
    queries = build_queries(name, code, extra_queries)
    search_results = search_web(
        queries, max_results_per_query=max_results_per_query,
        region=region, backend=backend, search_delay=search_delay,
    )
    print(f"\n重複統合後の候補URL: {len(search_results)}", file=sys.stderr)
    candidates = []
    for idx, item in enumerate(search_results.values(), 1):
        url = item["url"]
        title = item["title"]
        snippet = " ".join(item["snippets"])[:1500]
        stype, domain = source_type(url)
        print(f"[本文 {idx}/{len(search_results)}] {domain}: {title[:50]}", file=sys.stderr)
        text, fetch_status = fetch_page_text(url, delay=delay)
        relevance = identify_relevance(title, snippet, text, name, code)
        local_text = relevant_passages(text, snippet, name, code)
        score, hits, actual_buy = score_candidate(
            text=local_text, snippet=snippet, name=name, code=code, stype=stype,
        )
        excerpt = make_excerpt(local_text, snippet, name, code)
        level = evidence_level(excerpt, actual_buy)
        # キーワードの多いニュース/掲示板より、根拠ある個人の仮説を優先
        if level.startswith("買い理由"):
            score += 22
        elif level.startswith("投資仮説"):
            score += 16
        elif level == "売買言及のみ":
            score -= 8
        if stype in ("ブログ", "note"):
            score += 5
        if stype == "市場情報/メディア":
            score -= 12
        if any(x in url for x in ("/forum", "/post", "/stock/", "/quote/")):
            score -= 12
        if relevance == "本文のみ言及":
            score -= 14
        if relevance == "対象外":
            score = 0
        matched_terms = [
            f"{category}:{term}"
            for category, terms in hits.items() for term in terms[:5]
        ]
        candidates.append({
            "score": max(score, 0), "source_type": stype, "domain": domain,
            "title": title, "url": url,
            "matched_categories": " / ".join(hits.keys()),
            "matched_terms": " / ".join(matched_terms[:25]),
            "actual_buy_signal": "YES" if actual_buy else "",
            "evidence_excerpt": excerpt, "search_snippet": snippet,
            "search_queries": " || ".join(item["queries"]),
            "fetch_status": fetch_status,
            "search_engines": ", ".join(item["engines"]),
            "relevance": relevance, "evidence_level": level,
        })
    candidates.sort(key=lambda x: (
        x["relevance"] == "対象外", -x["score"],
        x["evidence_level"] == "参考情報", x["domain"],
    ))
    all_rows = [Candidate(rank=i, **c) for i, c in enumerate(candidates, 1)]
    # 対象外はデータを残すが、通常のレポートからは除く
    shortlist = [r for r in all_rows if r.relevance != "対象外"][:top]
    shortlist = [Candidate(**{**asdict(r), "rank": i}) for i, r in enumerate(shortlist, 1)]
    return shortlist, all_rows


def write_csv(rows: list[Candidate], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8-sig")
        return

    fieldnames = list(asdict(rows[0]).keys())
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def md_escape(s: str) -> str:
    return (s or "").replace("|", r"\|").replace("\n", " ").strip()


def write_markdown(
    rows: list[Candidate],
    path: Path,
    name: str,
    code: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# {name}（{code}） 投資家の買い理由・カタリスト候補",
        "",
        f"- 生成日時: {now}",
        f"- 掲載件数: {len(rows)}",
        "- スコアは重要度の目安であり、事実性・正しさを保証しません。",
        "- 原文抜粋とURLを確認してから投資判断に使用してください。",
        "",
    ]

    for r in rows:
        lines.extend([
            f"## {r.rank}. {r.title or '(タイトルなし)'}",
            "",
            f"- **スコア**: {r.score}",
            f"- **発見した検索エンジン**: {r.search_engines}",
            f"- **対象確認**: {r.relevance}",
            f"- **見解の種類**: {r.evidence_level}",
            f"- **媒体**: {r.source_type} / {r.domain}",
            f"- **実際の買い表現**: {r.actual_buy_signal or '未検出'}",
            f"- **論点**: {r.matched_categories or '未分類'}",
            f"- **URL**: {r.url}",
            f"- **取得状態**: {r.fetch_status}",
            "",
            f"> {r.evidence_excerpt or r.search_snippet or '抜粋なし'}",
            "",
            "<details><summary>検索に使われたクエリ</summary>",
            "",
            r.search_queries,
            "",
            "</details>",
            "",
        ])

    path.write_text("\n".join(lines), encoding="utf-8")


def resolve_company_name(code: str) -> str:
    """株探の公開銘柄ページから社名を取得。取得できなければ明示的に失敗する。"""
    url = f"https://s.kabutan.jp/stocks/{code}/"
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "ja,en-US;q=0.8"}
    try:
        response = requests.get(url, headers=headers, timeout=12)
        response.raise_for_status()
        if not response.encoding or response.encoding.lower() == "iso-8859-1":
            response.encoding = response.apparent_encoding
        soup = BeautifulSoup(response.text, "html.parser")
        candidates = []
        og = soup.find("meta", attrs={"property": "og:title"})
        if og and og.get("content"):
            candidates.append(og["content"])
        if soup.title:
            candidates.append(soup.title.get_text(" ", strip=True))
        for raw in candidates:
            # 例: 「児玉化学工業【4222】の株価・基本情報 - 株探」
            match = re.search(rf"^\s*(.+?)\s*[【\[（(]\s*{re.escape(code)}\s*[】\]）)]", raw)
            if match:
                name = match.group(1).strip()
                if name and len(name) <= 90:
                    return name
    except (requests.RequestException, ValueError) as exc:
        print(f"社名取得の通信エラー: {exc}", file=sys.stderr)
    raise RuntimeError(
        f"証券コード {code} の会社名を自動取得できませんでした。"
        f" ネット接続を確認するか、--name で会社名を指定してください。"
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="指定銘柄について、個人投資家の買い理由・カタリスト候補をWebから収集します。"
    )
    p.add_argument("--name", help="会社名（省略時は証券コードから自動取得）")
    p.add_argument("--code", required=True, help="証券コード。例: 4628")
    p.add_argument(
        "--max-results-per-query",
        type=int,
        default=6,
        help="1検索語×1エンジンあたりの最大結果数（既定: 6）"
    )
    p.add_argument(
        "--top",
        type=int,
        default=40,
        help="最終的に出力する上位件数（既定: 40）"
    )
    p.add_argument(
        "--region",
        default="jp-jp",
        help="検索リージョン（既定: jp-jp）"
    )
    p.add_argument(
        "--backend",
        default="auto",
        help="auto=google,bing,duckduckgoをすべて検索。カンマ区切りで指定可（例: bing,brave）"
    )
    p.add_argument("--search-delay", type=float, default=1.2, help="検索エンジン呼び出し間隔（秒）")
    p.add_argument(
        "--delay",
        type=float,
        default=0.7,
        help="ページ取得間隔（秒、既定: 0.7）"
    )
    p.add_argument(
        "--extra-query",
        action="append",
        default=[],
        help='追加検索クエリ。{name} と {code} が使用可能。複数指定可。'
    )
    p.add_argument(
        "--output-dir",
        default="output",
        help="出力先ディレクトリ（既定: output）"
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not re.fullmatch(r"[0-9A-Za-z]{4,5}", args.code):
        print("エラー: 証券コードは4〜5桁の英数字で指定してください。", file=sys.stderr)
        return 2
    try:
        args.name = args.name or resolve_company_name(args.code)
    except RuntimeError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 2
    print(f"会社名: {args.name}", file=sys.stderr)

    print(
        f"対象: {args.name} ({args.code})\n"
        "検索→ページ抽出→投資論点スコアリングを開始します。\n",
        file=sys.stderr
    )

    rows, all_rows = collect(
        name=args.name,
        code=args.code,
        max_results_per_query=args.max_results_per_query,
        top=args.top,
        region=args.region,
        backend=args.backend,
        delay=max(args.delay, 0.0),
        extra_queries=args.extra_query,
        search_delay=max(args.search_delay, 0.0),
    )

    safe_name = re.sub(r'[\\/:*?"<>|]+', "_", f"{args.code}_{args.name}")
    out_dir = Path(args.output_dir)
    csv_path = out_dir / f"{safe_name}_investor_views.csv"
    md_path = out_dir / f"{safe_name}_investor_views.md"

    write_csv(rows, csv_path)
    raw_path = out_dir / f"{safe_name}_all_candidates.csv"
    write_csv(all_rows, raw_path)
    write_markdown(rows, md_path, args.name, args.code)

    print("\n完了", file=sys.stderr)
    print(f"CSV: {csv_path.resolve()}", file=sys.stderr)
    print(f"全候補CSV（除外候補も保存）: {raw_path.resolve()}", file=sys.stderr)
    print(f"Markdown: {md_path.resolve()}", file=sys.stderr)

    if rows:
        print("\n上位候補:", file=sys.stderr)
        for r in rows[:10]:
            print(
                f"{r.rank:2d}. score={r.score:2d} "
                f"[{r.source_type}] {r.title[:70]}",
                file=sys.stderr
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
