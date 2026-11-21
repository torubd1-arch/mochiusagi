"""URL の正規化と重複判定用キーの生成。

- fetch_url(): 実際にアクセスする URL（追跡パラメータ等を除去）
- url_key():   重複判定用のキー（スキーム・www・言語パラメータ・AMP 等の表記揺れを吸収）
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

# 追跡・計測用パラメータ（取得 URL からも除去する）
TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "gclid", "fbclid", "yclid", "msclkid", "dclid", "igshid", "mc_cid", "mc_eid",
    "ref", "ref_src", "ref_url", "frm", "frm_id", "frm_src", "from", "via",
    "_ga", "_gl", "spm", "cmpid", "n_cid", "rt", "s_cid", "amp_js_v", "usqp",
    "adxarea", "device_id", "position", "timestamp", "share", "sharetype",
}
# 言語・表示切替パラメータ（重複判定キーからのみ除去する）
LANG_PARAMS = {"hl", "lang", "language", "locale", "lng", "setlang", "ln", "amp", "outputtype", "output"}
LANG_PATH_RE = re.compile(r"^/(?:ja|jp|en|en-us|en-gb|ja-jp|zh|zh-cn|zh-tw|ko|english|japanese)(?=/)", re.I)
MOBILE_HOST_RE = re.compile(r"^(?:www|m|sp|mobile|amp|s)\.")


def _clean_query(query: str, drop: set[str]) -> str:
    kept = [
        (k, v) for k, v in parse_qsl(query, keep_blank_values=True)
        if k.lower() not in drop and not k.lower().startswith("utm_")
    ]
    kept.sort()
    return urlencode(kept, doseq=True)


def _norm_path(path: str) -> str:
    path = quote(unquote(path), safe="/%:@!$&'()*+,;=-._~")
    path = re.sub(r"/{2,}", "/", path)
    return path or "/"


def fetch_url(url: str) -> str:
    """アクセス用 URL。フラグメントと追跡パラメータを除去する。"""
    try:
        p = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    if p.scheme not in ("http", "https"):
        return url.strip()
    host = p.netloc.lower()
    if host in ("twitter.com", "mobile.twitter.com", "www.twitter.com", "www.x.com", "mobile.x.com"):
        host = "x.com"
    # 言語指定（例: note の ?hl=en は機械翻訳版）を外し、原文の言語で取得する
    drop = TRACKING_PARAMS | {"hl", "lang", "language", "locale", "lng", "setlang"}
    query = "" if host == "note.com" else _clean_query(p.query, drop)
    return urlunsplit((p.scheme.lower(), host, _norm_path(p.path), query, ""))


def url_key(url: str) -> str:
    """重複判定用キー（スキームなし）。"""
    try:
        p = urlsplit(fetch_url(url))
    except ValueError:
        return url.strip().lower()
    host = p.netloc.lower().split(":")[0]
    host = MOBILE_HOST_RE.sub("", host)
    path = p.path

    # X / Twitter はユーザー名に依存しない投稿 ID をキーにする
    if host in ("x.com", "twitter.com"):
        m = re.search(r"/status(?:es)?/(\d+)", path)
        if m:
            return f"x.com/i/status/{m.group(1)}"

    # note は記事キーだけで一意（クエリは全て不要）
    if host == "note.com":
        m = re.search(r"/n/(n[0-9a-f]+)", path)
        if m:
            return f"note.com/n/{m.group(1)}"

    # 言語パス・AMP・index ファイル・末尾スラッシュの揺れを吸収
    path = LANG_PATH_RE.sub("", path)
    path = re.sub(r"/amp/?$", "", path)
    path = re.sub(r"\.amp(\.html?)?$", r"\1", path)
    path = re.sub(r"/index\.(?:html?|php)$", "", path)
    path = path.rstrip("/")
    query = _clean_query(p.query, TRACKING_PARAMS | LANG_PARAMS)
    return host + (path or "") + (("?" + query) if query else "")


def host_of(url: str) -> str:
    try:
        return urlsplit(url).netloc.lower().split(":")[0]
    except ValueError:
        return ""


def site_root(url: str) -> str:
    """ブログのトップ URL を推定する（note・アメブロ・livedoor 等のユーザー単位サービスに対応）。"""
    p = urlsplit(url)
    host = p.netloc.lower()
    parts = [x for x in p.path.split("/") if x]
    if host in ("note.com", "ameblo.jp", "blog.livedoor.jp", "plaza.rakuten.co.jp", "blog.goo.ne.jp") and parts:
        return f"{p.scheme}://{host}/{parts[0]}/"
    return f"{p.scheme}://{host}/"
