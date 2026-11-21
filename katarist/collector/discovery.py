"""記事の発見（検索エンジン・はてなブックマーク・Yahoo!リアルタイム検索）。

各経路は互いに独立しており、1つが失敗しても他は継続する。
失敗・0件・アクセス制限は search_log に区別して記録する。
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import parse_qs, quote, urlsplit

from bs4 import BeautifulSoup

from .company import Company
from .http import BLOCK_PATTERNS, HttpClient
from .settings import Settings

log = logging.getLogger(__name__)


@dataclass
class Hit:
    url: str
    title: str = ""
    snippet: str = ""
    author: str = ""
    published: str = ""
    body: str = ""        # 本文をその場で持つ場合（X 投稿など。ページ本体は取得しない）


class SearchError(Exception):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status   # failed / blocked / skipped


# ---------------------------------------------------------------------------
# 検索クエリ
# ---------------------------------------------------------------------------

# 個人の見解に当たりやすい言い回しを中心にする。
# 投資用語が少ない記事を落とさないよう、銘柄名だけ・ブログ系サイト指定のクエリも必ず含める。
WEB_QUERY_TEMPLATES = [
    '"{name}" 株 ブログ',
    '"{code}" 株 ブログ',
    '"{name}" 株 "購入しました"',
    '"{name}" 株 "買い増し"',
    '"{name}" 購入 理由',
    '"{name}" 保有 株',
    '"{name}" 割安',
    '"{name}" 決算 感想',
    '"{name}" 決算 考察 {code}',
    '"{name}" PBR 株主還元',
    '"{name}" カタリスト OR 中期経営計画 OR 再編',
    '"{name}" 大量保有 OR TOB OR 資本提携 OR 株式取得',
    '"{name}" バリュー株',
    '"{name}" 株価 なぜ',
    'site:note.com "{name}" 株',
    'site:hatenablog.com "{name}"',
    'site:ameblo.jp "{name}" 株',
    'site:livedoor.blog OR site:blog.jp OR site:fc2.com "{name}"',
    'site:x.com "{name}" 株',
]

HATENA_QUERY_TEMPLATES = ["{name}", "{code} {name}", "{name} 株"]
REALTIME_QUERY_TEMPLATES = ["{name} 株", "{name} {code}", "{name} 決算"]
AMEBA_QUERY_TEMPLATES = ["{name}", "{code}"]
NOTE_TAG_TEMPLATES = ["{name}", "{code}"]


def build_queries(templates: list[str], company: Company, extra: list[str] | None = None) -> list[str]:
    qs = [t.format(name=company.name, code=company.code) for t in templates]
    # ホールディングス表記などの別名でも 1 本だけ検索する
    for alias in company.aliases[1:2]:
        if alias != company.name and templates is WEB_QUERY_TEMPLATES:
            qs.append(f'"{alias}" 株')
    qs += [t.format(name=company.name, code=company.code) for t in (extra or [])]
    return list(dict.fromkeys(q.strip() for q in qs if q.strip()))


# ---------------------------------------------------------------------------
# Web 検索エンジン
# ---------------------------------------------------------------------------

class Engine:
    name = "base"
    channel = "web"
    uses_robots = False   # 検索結果ページは robots.txt で禁止されていることが多い（README 参照）

    def __init__(self, settings: Settings, http: HttpClient):
        self.s = settings
        self.http = http
        self.consecutive_failures = 0
        self.disabled_reason = ""
        self._last_call = 0.0

    def available(self) -> str | None:
        """使えない理由（None なら使用可）。"""
        return None

    def pace(self) -> None:
        wait = self._last_call + self.s.search_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def search(self, query: str) -> list[Hit]:
        raise NotImplementedError


class DdgsEngine(Engine):
    """ddgs ライブラリ経由（API キー不要）。"""

    def __init__(self, settings: Settings, http: HttpClient, backend: str):
        super().__init__(settings, http)
        self.backend = backend
        self.name = f"ddgs_{backend}"

    def available(self) -> str | None:
        try:
            import ddgs  # noqa: F401
        except ImportError:
            return "ddgs が未インストール"
        return None

    def search(self, query: str) -> list[Hit]:
        from ddgs import DDGS
        from ddgs.exceptions import DDGSException
        try:
            rows = DDGS(timeout=int(self.s.read_timeout)).text(
                query, region="jp-jp", safesearch="off", backend=self.backend,
                max_results=self.s.max_results_per_query,
            ) or []
        except DDGSException as exc:
            msg = str(exc)
            if "No results" in msg:
                return []
            if re.search(r"ratelimit|429|403|captcha", msg, re.I):
                raise SearchError("blocked", msg[:200])
            raise SearchError("failed", msg[:200])
        except Exception as exc:   # ネットワーク系（WinError 10061 等）を含む
            raise SearchError("failed", f"{type(exc).__name__}: {exc}"[:200])
        return [Hit(r.get("href") or r.get("url") or "", (r.get("title") or "").strip(),
                    (r.get("body") or "").strip()) for r in rows]


def _unwrap_bing(href: str) -> str:
    if "bing.com/ck/a" not in href:
        return href
    u = parse_qs(urlsplit(href).query).get("u", [""])[0]
    if u.startswith("a1"):
        b = u[2:]
        try:
            return base64.urlsafe_b64decode(b + "=" * (-len(b) % 4)).decode("utf-8", "replace")
        except (ValueError, UnicodeError):
            return ""
    return ""


class BingHtmlEngine(Engine):
    name = "bing_html"

    def search(self, query: str) -> list[Hit]:
        url = f"https://www.bing.com/search?q={quote(query)}&setlang=ja&cc=JP&count={self.s.max_results_per_query}"
        res = self.http.get(url, check_robots=False, interval=0)
        if res.status == "blocked" or (res.ok and BLOCK_PATTERNS.search(res.text[:30000]) and "b_algo" not in res.text):
            raise SearchError("blocked", f"HTTP {res.http_status}")
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        soup = BeautifulSoup(res.text, "lxml")
        hits = []
        for li in soup.select("li.b_algo"):
            a = li.select_one("h2 a")
            if not a:
                continue
            href = _unwrap_bing(a.get("href", ""))
            snip = li.select_one(".b_caption p, p")
            hits.append(Hit(href, a.get_text(" ", strip=True), snip.get_text(" ", strip=True) if snip else ""))
        return hits


class BraveApiEngine(Engine):
    """Brave Search API（公式。環境変数 BRAVE_API_KEY が必要）。"""
    name = "brave_api"

    def available(self) -> str | None:
        return None if self.s.brave_api_key else "BRAVE_API_KEY 未設定"

    def search(self, query: str) -> list[Hit]:
        res = self.http.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": min(20, self.s.max_results_per_query), "country": "JP", "search_lang": "jp"},
            headers={"X-Subscription-Token": self.s.brave_api_key, "Accept": "application/json"},
            check_robots=False, interval=1.1,
        )
        if res.status in ("blocked",) or res.http_status in (401, 402, 403, 429):
            raise SearchError("blocked", f"HTTP {res.http_status} {res.text[:150]}")
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        data = json.loads(res.text)
        return [Hit(r.get("url", ""), r.get("title", ""), re.sub(r"<[^>]+>", "", r.get("description", "")),
                    published=r.get("page_age", "") or "")
                for r in (data.get("web") or {}).get("results", [])]


class GoogleCseEngine(Engine):
    """Google Programmable Search JSON API（GOOGLE_CSE_KEY / GOOGLE_CSE_CX が必要）。"""
    name = "google_cse"

    def available(self) -> str | None:
        return None if (self.s.google_cse_key and self.s.google_cse_cx) else "GOOGLE_CSE_KEY/GOOGLE_CSE_CX 未設定"

    def search(self, query: str) -> list[Hit]:
        res = self.http.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": self.s.google_cse_key, "cx": self.s.google_cse_cx, "q": query,
                    "num": min(10, self.s.max_results_per_query), "lr": "lang_ja", "gl": "jp"},
            check_robots=False, interval=0.5,
        )
        if res.http_status in (403, 429):
            raise SearchError("blocked", f"HTTP {res.http_status} {res.text[:150]}")
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error} {res.text[:150]}")
        data = json.loads(res.text)
        return [Hit(r.get("link", ""), r.get("title", ""), r.get("snippet", "")) for r in data.get("items", [])]


def make_engines(settings: Settings, http: HttpClient, names: list[str]) -> list[Engine]:
    engines: list[Engine] = []
    for n in names:
        if n == "bing_html":
            engines.append(BingHtmlEngine(settings, http))
        elif n == "brave_api":
            engines.append(BraveApiEngine(settings, http))
        elif n == "google_cse":
            engines.append(GoogleCseEngine(settings, http))
        elif n.startswith("ddgs_"):
            engines.append(DdgsEngine(settings, http, n[5:]))
        else:
            log.warning("不明な検索エンジン名を無視: %s", n)
    return engines


# ---------------------------------------------------------------------------
# はてなブックマーク検索（RSS。robots.txt で許可されている）
# ---------------------------------------------------------------------------

class HatenaEngine(Engine):
    name = "hatena_bookmark"
    channel = "hatena"
    uses_robots = True

    def search(self, query: str, page: int = 1) -> list[Hit]:
        url = (f"https://b.hatena.ne.jp/search/text?q={quote(query)}&mode=rss&users=1"
               f"&sort=recent&safe=off{'&page=' + str(page) if page > 1 else ''}")
        res = self.http.get(url, check_robots=True)
        if res.status in ("blocked", "robots_disallowed"):
            raise SearchError("blocked", res.status)
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        return parse_feed(res.text)


# ---------------------------------------------------------------------------
# Yahoo!リアルタイム検索（X の公開投稿。x.com 本体は robots.txt で禁止のため取得しない）
# ---------------------------------------------------------------------------

class RealtimeEngine(Engine):
    name = "yahoo_realtime"
    channel = "realtime"
    uses_robots = True

    def search(self, query: str) -> list[Hit]:
        res = self.http.get(f"https://search.yahoo.co.jp/realtime/search?p={quote(query)}", check_robots=True)
        if res.status in ("blocked", "robots_disallowed"):
            raise SearchError("blocked", res.status)
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', res.text, re.S)
        if not m:
            raise SearchError("failed", "ページ構造が変わった可能性（__NEXT_DATA__ なし）")
        try:
            data = json.loads(m.group(1))
            entries = data["props"]["pageProps"]["pageData"]["timeline"].get("entry") or []
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise SearchError("failed", f"解析失敗: {exc}")
        hits = []
        for e in entries:
            text = re.sub(r"\t(?:START|END)\t", "", e.get("displayText") or "").strip()
            ts = e.get("createdAt")
            published = datetime.fromtimestamp(ts).isoformat(timespec="minutes") if isinstance(ts, (int, float)) else ""
            author = f"{e.get('name', '')} (@{e.get('screenName', '')})"
            hits.append(Hit(e.get("url", ""), text[:60], text, author=author, published=published, body=text))
        return hits


# ---------------------------------------------------------------------------
# アメーバ検索（アメブロ記事。robots.txt で許可されている）
# ---------------------------------------------------------------------------

class AmebaEngine(Engine):
    name = "ameba_search"
    channel = "ameba"
    uses_robots = True

    def search(self, query: str) -> list[Hit]:
        res = self.http.get(f"https://search.ameba.jp/search/entry/{quote(query)}.html", check_robots=True)
        if res.status in ("blocked", "robots_disallowed"):
            raise SearchError("blocked", res.status)
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        soup = BeautifulSoup(res.text, "lxml")
        hits, seen = [], set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not re.search(r"ameblo\.jp/[^/]+/entry-\d+\.html", href) or href in seen:
                continue
            seen.add(href)
            text = a.get_text(" ", strip=True)
            # 表示は「タイトル 日付 ブログ名 ･･･抜粋」の形
            m = re.match(r"(.+?)\s+(\d{4}年\d{2}月\d{2}日)\s+(.*)", text)
            title, published, rest = (m.group(1), m.group(2), m.group(3)) if m else (text[:80], "", text)
            pub = re.sub(r"(\d{4})年(\d{2})月(\d{2})日", r"\1-\2-\3", published)
            hits.append(Hit(href, title, rest, published=pub))
        return hits


# ---------------------------------------------------------------------------
# note のハッシュタグ RSS（/api と /search は robots.txt で禁止のため使わない）
# ---------------------------------------------------------------------------

class NoteTagEngine(Engine):
    name = "note_hashtag"
    channel = "note_tag"
    uses_robots = True

    def search(self, tag: str) -> list[Hit]:
        res = self.http.get(f"https://note.com/hashtag/{quote(tag)}/rss", check_robots=True)
        if res.status in ("blocked", "robots_disallowed"):
            raise SearchError("blocked", res.status)
        if res.http_status == 404:
            return []
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        return parse_feed(res.text)


# ---------------------------------------------------------------------------
# 株ライン「個人投資家ブログアンテナ」（銘柄コード別に個人ブログ記事を集約。robots.txt で許可）
# ---------------------------------------------------------------------------

class KabulineEngine(Engine):
    name = "kabuline_antenna"
    channel = "antenna"
    uses_robots = True

    def search(self, code: str) -> list[Hit]:
        res = self.http.get(f"https://kabuline.com/blog/antenna/code__{code}/", check_robots=True)
        if res.status in ("blocked", "robots_disallowed"):
            raise SearchError("blocked", res.status)
        if res.http_status == 404:
            return []
        if not res.ok:
            raise SearchError("failed", f"{res.status} {res.error}")
        soup = BeautifulSoup(res.text, "lxml")
        hits = []
        for a in soup.find_all("a", href=True):
            if a.get_text(strip=True) != "続きを記事で" or not a["href"].startswith("http"):
                continue
            # 記事タイトルは同じブロック内の見出しにある
            box = a.find_parent(["li", "article", "div"])
            heading = box.find(["h2", "h3", "h4"]) if box else None
            title = heading.get_text(" ", strip=True) if heading else ""
            snippet = box.get_text(" ", strip=True)[:500] if box else ""
            hits.append(Hit(a["href"], title, snippet))
        return hits


# ---------------------------------------------------------------------------
# RSS / Atom の解析（ブログ巡回でも使用）
# ---------------------------------------------------------------------------

def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", BeautifulSoup(s or "", "lxml").get_text(" ")).strip() if s and "<" in s else (s or "").strip()


def parse_feed(xml_text: str) -> list[Hit]:
    """RSS 1.0 / 2.0 / Atom を名前空間に依存せず解析する。"""
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError:
        # 先頭の空白や不正文字で失敗することがあるため一度だけ整形して再試行
        try:
            root = ET.fromstring(re.sub(r"^[^<]+", "", xml_text).encode("utf-8"))
        except ET.ParseError:
            return []

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    hits = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        f: dict[str, str] = {}
        for ch in el:
            name = local(ch.tag)
            if name == "link":
                href = ch.get("href")
                if href and ch.get("rel", "alternate") == "alternate":
                    f.setdefault("link", href)
                elif ch.text and ch.text.strip():
                    f.setdefault("link", ch.text.strip())
            elif name in ("title", "description", "summary", "encoded", "content", "date", "pubDate",
                          "published", "updated", "creator", "author"):
                if name == "author":
                    txt = " ".join(x.text or "" for x in ch.iter() if local(x.tag) == "name") or (ch.text or "")
                else:
                    txt = ch.text or ""
                f.setdefault(name, txt)
        link = f.get("link") or el.get("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about") or ""
        if not link:
            continue
        desc = _strip_tags(f.get("encoded") or f.get("content") or f.get("description") or f.get("summary") or "")
        hits.append(Hit(
            url=link.strip(),
            title=_strip_tags(f.get("title", "")),
            snippet=desc[:3000],
            author=(f.get("creator") or f.get("author") or "").strip(),
            published=(f.get("date") or f.get("published") or f.get("pubDate") or f.get("updated") or "").strip(),
        ))
    return hits
