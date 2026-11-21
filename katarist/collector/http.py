"""HTTP 取得の共通処理。

- 接続・読み取りタイムアウト
- 接続エラー・5xx のみ少数回リトライ（段階的に待機時間を延ばす）
- 403/429/CAPTCHA は「アクセス制限」として扱い、再試行せずそのホストを当該実行中は停止
- robots.txt の確認（検索エンジンの検索結果ページは呼び出し側で明示的に除外）
- 同一ホストへの最小アクセス間隔
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field
from urllib import robotparser
from urllib.parse import urlsplit

import requests

from .settings import Settings

log = logging.getLogger(__name__)

BLOCK_PATTERNS = re.compile(
    r"captcha|cf-chl-|challenge-platform|unusual traffic|Just a moment\.\.\.|"
    r"Access Denied|アクセスが制限|不正なアクセス|ロボットではありません",
    re.I,
)


@dataclass
class HttpResult:
    url: str
    status: str                 # ok / blocked / robots_disallowed / http_XXX / timeout / conn_error / ssl_error / host_blocked / error
    http_status: int | None = None
    text: str = ""
    final_url: str = ""
    content_type: str = ""
    error: str = ""
    elapsed: float = 0.0
    headers: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "ok"


class HttpClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": settings.user_agent,
            "Accept-Language": "ja,en-US;q=0.7,en;q=0.5",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })
        self._host_locks: dict[str, threading.Lock] = {}
        self._host_last: dict[str, float] = {}
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self._lock = threading.Lock()
        self.blocked_hosts: dict[str, str] = {}   # host -> 理由

    # ---- 礼儀正しいアクセス ----
    def _host_lock(self, host: str) -> threading.Lock:
        with self._lock:
            return self._host_locks.setdefault(host, threading.Lock())

    def _wait_host(self, host: str, interval: float) -> None:
        last = self._host_last.get(host, 0.0)
        wait = last + interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._host_last[host] = time.monotonic()

    def robots_allowed(self, url: str) -> bool:
        p = urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        with self._host_lock(p.netloc.lower() + "#robots"):
            if base not in self._robots:
                rp: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
                try:
                    r = self.session.get(base + "/robots.txt", timeout=(self.s.connect_timeout, 10))
                    if r.status_code in (401, 403):
                        rp.disallow_all = True
                    elif r.status_code >= 400:
                        rp.allow_all = True
                    else:
                        rp.parse(r.text.splitlines())
                except requests.RequestException:
                    rp = None   # robots.txt 自体が取れない場合は本体の取得結果に任せる
                self._robots[base] = rp
        rp = self._robots[base]
        if rp is None:
            return True
        return rp.can_fetch("*", url)

    # ---- 取得 ----
    def get(
        self,
        url: str,
        *,
        params: dict | None = None,
        headers: dict | None = None,
        check_robots: bool = True,
        interval: float | None = None,
        timeout: tuple[float, float] | None = None,
    ) -> HttpResult:
        host = urlsplit(url).netloc.lower()
        if host in self.blocked_hosts:
            return HttpResult(url, "host_blocked", error=self.blocked_hosts[host])
        if check_robots and not self.robots_allowed(url):
            return HttpResult(url, "robots_disallowed")

        timeout = timeout or (self.s.connect_timeout, self.s.read_timeout)
        interval = self.s.per_host_interval if interval is None else interval
        attempt = 0
        t0 = time.monotonic()
        while True:
            with self._host_lock(host):
                self._wait_host(host, interval)
                try:
                    r = self.session.get(url, params=params, headers=headers, timeout=timeout, allow_redirects=True)
                    err = None
                except requests.exceptions.SSLError as exc:
                    return HttpResult(url, "ssl_error", error=str(exc)[:200], elapsed=time.monotonic() - t0)
                except requests.Timeout as exc:
                    err = ("timeout", str(exc)[:200])
                except requests.ConnectionError as exc:
                    err = ("conn_error", str(exc)[:200])
                except requests.RequestException as exc:
                    return HttpResult(url, "error", error=f"{type(exc).__name__}: {exc}"[:200], elapsed=time.monotonic() - t0)

            if err is None:
                code = r.status_code
                if code < 500 or attempt >= self.s.max_retries or BLOCK_PATTERNS.search(r.text[:20000]):
                    break
                err = (f"http_{code}", "")
            if attempt >= self.s.max_retries:
                return HttpResult(url, err[0], error=err[1], elapsed=time.monotonic() - t0)
            attempt += 1
            wait = self.s.backoff_base * (2 ** (attempt - 1))
            log.info("再試行 %s/%s (%s) %.0f秒後: %s", attempt, self.s.max_retries, err[0], wait, url)
            time.sleep(wait)

        elapsed = time.monotonic() - t0
        ctype = (r.headers.get("content-type") or "").lower()
        if not r.encoding or r.encoding.lower() in ("iso-8859-1", "ascii"):
            if "html" in ctype or "xml" in ctype or not ctype:
                r.encoding = r.apparent_encoding
        text = r.text if ("text" in ctype or "xml" in ctype or "json" in ctype or not ctype) else ""
        res = HttpResult(url, "ok", r.status_code, text, r.url, ctype, elapsed=elapsed, headers=dict(r.headers))

        if r.status_code == 429 or (r.status_code in (403, 503) and BLOCK_PATTERNS.search(text[:20000])):
            res.status = "blocked"
            reason = f"HTTP {r.status_code}（アクセス制限の可能性）"
            self.blocked_hosts[host] = reason
            log.warning("アクセス制限を検知したため %s へのアクセスを停止: %s", host, reason)
        elif r.status_code >= 400:
            res.status = f"http_{r.status_code}"
        return res
