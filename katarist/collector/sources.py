"""発見元の種別判定（個人投資家 / ニュース・株価情報 / 掲示板 など）。

この判定は記事の並び順と統計に使うだけで、記事の除外には使わない。
"""

from __future__ import annotations

from .urlnorm import host_of

BLOG_HOSTS = (
    "hatenablog.com", "hatenablog.jp", "hateblo.jp", "hatenadiary.com", "hatenadiary.jp", "hatenadiary.org",
    "ameblo.jp", "livedoor.blog", "livedoor.jp", "blog.jp", "doorblog.jp", "fc2.com", "seesaa.net",
    "muragon.com", "cocolog-nifty.com", "goo.ne.jp", "jugem.jp", "exblog.jp", "blogspot.com",
    "wordpress.com", "plaza.rakuten.co.jp", "blogos.com", "sakura.ne.jp", "xsrv.jp", "naturum.ne.jp",
    "blog.so-net.ne.jp", "ssblog.jp", "shinobi.jp", "kabu.click", "zenn.dev", "qiita.com",
)
NOTE_HOSTS = ("note.com", "note.mu")
SNS_HOSTS = ("x.com", "twitter.com", "threads.net", "bsky.app", "stocktwits.com")
FORUM_HOSTS = ("5ch.net", "2ch.sc", "kabudragon.com", "kabuline.com")
FORUM_PATH_HINTS = ("/bbs", "/forum", "/board", "/comment", "/threads/")
NEWS_HOSTS = (
    "kabutan.jp", "minkabu.jp", "finance.yahoo.co.jp", "nikkei.com", "bloomberg.co.jp", "bloomberg.com",
    "reuters.com", "jp.reuters.com", "toyokeizai.net", "shikiho.toyokeizai.net", "diamond.jp", "zai.diamond.jp",
    "president.jp", "sbisec.co.jp", "monex.co.jp", "rakuten-sec.co.jp", "matsui.co.jp", "traders.co.jp",
    "fisco.jp", "ifis.co.jp", "irbank.net", "kabuyoho.jp", "kabuyoho.ifis.co.jp", "moomoo.com",
    "stockweather.co.jp", "kabushiki.jp", "edinetdb.jp", "buffett-code.com", "media-ir.com",
    "kabuka.jp.net", "nikkei225jp.com", "jpx.co.jp", "release.tdnet.info", "kabumap.com",
    "kabu.com", "tradingview.com", "investing.com", "marketscreener.com", "msn.com", "yahoo.com",
    "nikkan.co.jp", "newswitch.jp", "sankei.com", "asahi.com", "yomiuri.co.jp", "mainichi.jp",
    "itmedia.co.jp", "prtimes.jp", "kabutan.com", "stocks.finance.yahoo.co.jp", "moneyworld.jp",
    "kabuoji3.com", "ullet.com", "valuation-matrix.com", "kabuline.com", "kabu-sokuhou.com",
    "jp.investing.com", "finance.logmi.jp", "logmi.jp", "money.minkabu.jp", "trkd-asia.com",
    "tetsudo.com", "response.jp", "wikipedia.org", "ja.wikipedia.org",
)


def _match(host: str, suffixes: tuple[str, ...]) -> bool:
    return any(host == s or host.endswith("." + s) for s in suffixes)


def source_type(url: str) -> str:
    """blog / note / sns / forum / news / web"""
    host = host_of(url)
    host = host[4:] if host.startswith("www.") else host
    low = url.lower()
    if _match(host, SNS_HOSTS):
        return "sns"
    if _match(host, NOTE_HOSTS):
        return "note"
    if _match(host, FORUM_HOSTS) or (
        _match(host, ("minkabu.jp", "finance.yahoo.co.jp", "kabutan.jp")) and any(h in low for h in FORUM_PATH_HINTS)
    ):
        return "forum"
    if _match(host, NEWS_HOSTS):
        return "news"
    if _match(host, BLOG_HOSTS) or "blog" in host:
        return "blog"
    return "web"


SOURCE_LABEL = {
    "blog": "ブログ", "note": "note", "sns": "X等", "forum": "掲示板",
    "news": "ニュース・株価情報", "web": "その他Web",
}
