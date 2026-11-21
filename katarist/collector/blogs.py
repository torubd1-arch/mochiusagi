"""登録ブログ・自動発見ブログの巡回（RSS / ブログ内検索 / 一覧ページ）。

- config/blogs.json に登録したブログ（origin=registered）
- 過去の実行で投資仮説を含む記事が見つかった個人ブログ（origin=auto）
を対象に、RSS で新着を確認し、ブログ内検索がある場合は銘柄名で検索する。
すべて robots.txt を確認してからアクセスする。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

from bs4 import BeautifulSoup

from .company import Company, nfkc
from .db import Database, now
from .discovery import Hit, parse_feed
from .http import HttpClient
from .urlnorm import host_of, site_root

log = logging.getLogger(__name__)


@dataclass
class BlogTemplate:
    platform: str
    feed_url: str | None
    search_url: str | None


def detect_platform(root: str) -> BlogTemplate:
    """ブログのトップ URL から、RSS とブログ内検索の URL を推定する。"""
    host = host_of(root)
    p = urlsplit(root)
    user = [x for x in p.path.split("/") if x][:1]
    if re.search(r"(hatenablog\.(com|jp)|hateblo\.jp|hatenadiary\.(com|jp|org))$", host):
        return BlogTemplate("hatena", root + "rss", root + "search?q={q}")
    if host == "note.com" and user:
        return BlogTemplate("note", f"https://note.com/{user[0]}/rss", None)
    if host == "ameblo.jp" and user:
        # rssblog.ameba.jp は robots.txt で禁止されているため RSS は使わない（アメーバ検索で発見する）
        return BlogTemplate("ameblo", None, None)
    if host == "blog.livedoor.jp" or re.search(r"(livedoor\.blog|blog\.jp|doorblog\.jp)$", host):
        return BlogTemplate("livedoor", root + "index.rdf", root + "search?q={q}")
    if re.search(r"blog\.fc2\.com$|fc2\.net$", host):
        return BlogTemplate("fc2", root + "?xml", root + "?q={q}")
    if host.endswith("seesaa.net"):
        return BlogTemplate("seesaa", root + "index.rdf", None)
    return BlogTemplate("unknown", None, None)


# ブログ内検索結果ページから記事リンクを拾うためのセレクタ（上から順に試す）
RESULT_SELECTORS = [
    ".archive-entry .entry-title a", "a.entry-title-link",          # はてな
    ".article-title a", ".article-header h1 a",                      # livedoor
    "h2.entry-title a", "h1.entry-title a", "a[rel=bookmark]",       # WordPress
    ".entry_title a", ".entry-header a",                             # FC2 等
]
ENTRY_PATH_RE = re.compile(r"/entry[/-]|/archives/|/blog-entry-|/n/n[0-9a-f]+|[?&]p=\d+|/\d{4}/\d{2}/|/entry-\d+")
NO_RESULT_RE = re.compile(r"見つかりませんでした|該当する記事はありません|ありませんでした|0件|一致する(記事|情報)は見つかりません")


def load_registered(db: Database, path: Path) -> int:
    """config/blogs.json の内容を DB に反映する。"""
    if not path.exists():
        return 0
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        log.error("%s の JSON が不正です: %s", path, exc)
        return 0
    n = 0
    for b in cfg.get("blogs", []):
        url = (b.get("url") or "").strip()
        if not url:
            continue
        root = url if url.endswith("/") else url + "/"
        tpl = detect_platform(root)
        db.x(
            "INSERT INTO blogs(root_url,name,platform,feed_url,search_url,list_url,link_pattern,origin,enabled,added_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(root_url) DO UPDATE SET name=excluded.name, "
            "platform=excluded.platform, feed_url=excluded.feed_url, search_url=excluded.search_url, "
            "list_url=excluded.list_url, link_pattern=excluded.link_pattern, origin='registered', enabled=excluded.enabled",
            (root, b.get("name"), tpl.platform, b.get("feed") or tpl.feed_url, b.get("search") or tpl.search_url,
             b.get("list_url"), b.get("link_pattern"), "registered", 0 if b.get("enabled") is False else 1, now()),
        )
        n += 1
    db.commit()
    return n


def register_auto_blog(db: Database, article_url: str, site_name: str | None) -> bool:
    """投資仮説を含む個人ブログ記事が見つかったら、そのブログを自動巡回対象に加える。"""
    root = site_root(article_url)
    if db.one("SELECT 1 FROM blogs WHERE root_url=?", (root,)):
        return False
    tpl = detect_platform(root)
    db.x(
        "INSERT INTO blogs(root_url,name,platform,feed_url,search_url,origin,added_at) VALUES(?,?,?,?,?,?,?)",
        (root, site_name, tpl.platform, tpl.feed_url, tpl.search_url, "auto", now()),
    )
    return True


def blogs_to_crawl(db: Database, limit: int) -> list:
    # 登録ブログを優先し、自動発見ブログは投資仮説記事の多い順
    return db.q(
        """
        SELECT b.*, (
            SELECT count(*) FROM articles a JOIN article_stocks s ON s.article_id=a.id
            WHERE a.url LIKE b.root_url || '%' AND s.thesis_score >= 3
        ) AS hits
        FROM blogs b WHERE b.enabled=1
        ORDER BY (b.origin='registered') DESC, hits DESC, b.added_at
        LIMIT ?
        """,
        (limit,),
    )


def _mentions(text: str, company: Company) -> bool:
    t = nfkc(text)
    return any(n in t for n in company.match_names) or bool(
        re.search(rf"(?<![0-9]){company.code}(?![0-9])", t))


def _autodiscover_feed(http: HttpClient, root: str) -> str | None:
    res = http.get(root)
    if not res.ok:
        return None
    soup = BeautifulSoup(res.text, "lxml")
    for link in soup.find_all("link", attrs={"rel": "alternate"}):
        if "rss" in (link.get("type") or "") or "atom" in (link.get("type") or ""):
            return urljoin(root, link.get("href"))
    gen = soup.find("meta", attrs={"name": "generator"})
    if gen and "wordpress" in (gen.get("content") or "").lower():
        return root + "feed/"
    return None


def crawl_feed(http: HttpClient, feed_url: str, company: Company) -> tuple[str, list[Hit], int]:
    """(status, 該当エントリ, 全エントリ数)"""
    res = http.get(feed_url)
    if not res.ok:
        return res.status, [], 0
    entries = parse_feed(res.text)
    if not entries:
        return "parse_error", [], 0
    hits = [e for e in entries if _mentions(f"{e.title} {e.snippet}", company)]
    return "ok", hits, len(entries)


def crawl_search(http: HttpClient, search_tmpl: str, root: str, company: Company, max_links: int = 15) -> tuple[str, list[Hit]]:
    url = search_tmpl.replace("{q}", quote(company.name))
    res = http.get(url)
    if not res.ok:
        return res.status, []
    soup = BeautifulSoup(res.text, "lxml")
    main = soup.select_one("main, #main, .main, #content, .content, #main-inner, .archive-entries") or soup
    if NO_RESULT_RE.search(main.get_text(" ", strip=True)[:3000]) and not main.select(", ".join(RESULT_SELECTORS)):
        return "ok", []
    anchors = []
    for sel in RESULT_SELECTORS:
        anchors = main.select(sel)
        if anchors:
            break
    if not anchors:
        anchors = [a for a in main.find_all("a", href=True) if ENTRY_PATH_RE.search(a["href"])]
    root_host = host_of(root)
    hits, seen = [], set()
    for a in anchors:
        href = urljoin(url, a.get("href", ""))
        if host_of(href) != root_host or not href.startswith(root.rstrip("/")) or href in seen:
            continue
        seen.add(href)
        hits.append(Hit(href, a.get_text(" ", strip=True)))
        if len(hits) >= max_links:
            break
    return "ok", hits


def crawl_list(http: HttpClient, list_url: str, pattern: str | None, company: Company) -> tuple[str, list[Hit]]:
    """RSS のないブログ: 記事一覧ページのリンク文字列に銘柄名・コードを含むものを拾う。"""
    res = http.get(list_url)
    if not res.ok:
        return res.status, []
    soup = BeautifulSoup(res.text, "lxml")
    rx = re.compile(pattern) if pattern else None
    hits = []
    for a in soup.find_all("a", href=True):
        href = urljoin(list_url, a["href"])
        if rx and not rx.search(href):
            continue
        text = a.get_text(" ", strip=True)
        if _mentions(text, company):
            hits.append(Hit(href, text))
    return "ok", hits


def ensure_feed(db: Database, http: HttpClient, blog) -> str | None:
    if blog["feed_url"]:
        return blog["feed_url"]
    if blog["platform"] in ("ameblo", "note"):
        return None
    feed = _autodiscover_feed(http, blog["root_url"])
    if feed:
        db.x("UPDATE blogs SET feed_url=? WHERE root_url=?", (feed, blog["root_url"]))
        if feed.endswith("/feed/") and not blog["search_url"]:
            db.x("UPDATE blogs SET search_url=?, platform='wordpress' WHERE root_url=?",
                 (blog["root_url"] + "?s={q}", blog["root_url"]))
        db.commit()
    return feed
