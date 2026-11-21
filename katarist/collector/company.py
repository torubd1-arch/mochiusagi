"""証券コードから会社名を取得し、照合用の別名を作る。"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

from .db import Database
from .http import HttpClient

log = logging.getLogger(__name__)


@dataclass
class Company:
    code: str
    name: str
    aliases: list[str] = field(default_factory=list)   # 照合用（name を含む）

    @property
    def match_names(self) -> list[str]:
        return [nfkc(a) for a in dict.fromkeys([self.name, *self.aliases]) if a]


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "")


def make_aliases(name: str) -> list[str]:
    """表記揺れを機械的に生成する。曖昧な略称（例: 東洋電機製造→東洋電機）は自動では作らない。"""
    base = nfkc(name)
    base = re.sub(r"^(?:株式会社|\(株\))\s*|\s*(?:株式会社|\(株\))$", "", base).strip()
    out = [base]
    if "ホールディングス" in base:
        out += [base.replace("ホールディングス", "HD"), base.replace("ホールディングス", "HLDGS")]
    if base.endswith("HD"):
        out.append(base[:-2] + "ホールディングス")
    if "グループ本社" in base:
        out.append(base.replace("グループ本社", ""))
    return [a for a in dict.fromkeys(out) if len(a) >= 2]


def _parse_kabutan(html: str, code: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")
    cands = []
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        cands.append(og["content"])
    if soup.title:
        cands.append(soup.title.get_text(" ", strip=True))
    for raw in cands:
        m = re.search(rf"^\s*(.+?)\s*[【\[（(]\s*{re.escape(code)}\s*[】\]）)]", raw)
        if m:
            return m.group(1).strip()
    return None


def _parse_yahoo_finance(html: str, code: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")
    if soup.title:
        m = re.search(rf"^\s*(.+?)(?:\(株\))?\s*【{re.escape(code)}】", soup.title.get_text(" ", strip=True))
        if m:
            return re.sub(r"\(株\)$", "", m.group(1)).strip()
    return None


SOURCES = [
    ("kabutan", "https://s.kabutan.jp/stocks/{code}/", _parse_kabutan),
    ("yahoo_finance", "https://finance.yahoo.co.jp/quote/{code}.T", _parse_yahoo_finance),
]


def resolve_company(code: str, db: Database, http: HttpClient, name_override: str | None = None,
                    extra_aliases: list[str] | None = None) -> Company:
    extra_aliases = extra_aliases or []
    if name_override:
        aliases = list(dict.fromkeys(make_aliases(name_override) + extra_aliases))
        db.save_company(code, name_override, aliases, "manual")
        return Company(code, name_override, aliases)

    row = db.get_company(code)
    if row:
        aliases = list(dict.fromkeys(json.loads(row["aliases"]) + extra_aliases))
        if extra_aliases:
            db.save_company(code, row["name"], aliases, row["source"])
        return Company(code, row["name"], aliases)

    errors = []
    for label, tmpl, parser in SOURCES:
        res = http.get(tmpl.format(code=code))
        if not res.ok:
            errors.append(f"{label}: {res.status} {res.error}")
            continue
        name = parser(res.text, code)
        if name:
            aliases = list(dict.fromkeys(make_aliases(name) + extra_aliases))
            db.save_company(code, name, aliases, label)
            log.info("会社名を取得: %s %s（%s）", code, name, label)
            return Company(code, name, aliases)
        errors.append(f"{label}: 会社名を解析できず")
    raise RuntimeError(f"証券コード {code} の会社名を取得できませんでした（{'; '.join(errors)}）。--name で指定してください。")
