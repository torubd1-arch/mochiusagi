"""本文とメタデータの抽出（trafilatura + 補助的な HTML 解析）。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

import trafilatura
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)


@dataclass
class Extracted:
    title: str = ""
    author: str = ""
    site_name: str = ""
    published: str = ""
    text: str = ""
    canonical: str = ""
    alternates: list[str] = field(default_factory=list)   # hreflang の別言語版 URL
    method: str = ""


def _meta(soup: BeautifulSoup, *keys: str) -> str:
    for k in keys:
        tag = soup.find("meta", attrs={"property": k}) or soup.find("meta", attrs={"name": k})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return ""


def clean_text(text: str) -> str:
    text = re.sub(r"[ \t　\xa0]+", " ", text or "")
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract(html: str, url: str) -> Extracted:
    out = Extracted()
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:  # 極端に壊れた HTML
        soup = BeautifulSoup(html, "html.parser")

    can = soup.find("link", attrs={"rel": "canonical"})
    if can and can.get("href"):
        out.canonical = urljoin(url, can["href"])
    for link in soup.find_all("link", attrs={"rel": "alternate"}):
        if link.get("hreflang") and link.get("href"):
            out.alternates.append(urljoin(url, link["href"]))

    data = {}
    try:
        raw = trafilatura.extract(
            html, url=url, output_format="json", with_metadata=True, favor_recall=True,
            include_comments=False, include_tables=True, deduplicate=True,
        )
        data = json.loads(raw) if raw else {}
    except Exception as exc:   # trafilatura 内部の例外で全体を止めない
        log.debug("trafilatura 失敗 %s: %s", url, exc)

    out.text = clean_text(data.get("text") or "")
    out.method = "trafilatura"
    if len(out.text) < 150:
        for tag in soup(["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form"]):
            tag.decompose()
        body = soup.select_one("article, main, #main, .entry-content, .article-body, #content") or soup.body or soup
        fallback = clean_text(body.get_text("\n", strip=True))
        if len(fallback) > len(out.text):
            out.text, out.method = fallback, "html_fallback"

    out.title = (data.get("title") or _meta(soup, "og:title") or (soup.title.get_text(strip=True) if soup.title else "")).strip()
    out.author = (data.get("author") or _meta(soup, "author", "article:author", "twitter:creator")).strip()
    out.site_name = (data.get("sitename") or _meta(soup, "og:site_name")).strip()
    out.published = (data.get("date") or _meta(soup, "article:published_time", "og:published_time", "pubdate")).strip()
    return out


def body_hash(text: str) -> str:
    """表記の細部に依存しない本文ハッシュ（転載・同一記事の検出用）。"""
    norm = re.sub(r"[\s\W_]+", "", text or "")[:4000]
    return hashlib.sha1(norm.encode("utf-8")).hexdigest() if len(norm) >= 200 else ""
