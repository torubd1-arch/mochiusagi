"""1銘柄分の処理: 発見 → 本文取得 → 関連度判定・仮説抽出 → Markdown 出力。"""

from __future__ import annotations

import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import blogs as blogmod
from .analysis import assess_relevance, content_kind, extract_thesis
from .company import Company, resolve_company
from .db import Database, now
from .discovery import (AMEBA_QUERY_TEMPLATES, HATENA_QUERY_TEMPLATES, NOTE_TAG_TEMPLATES, REALTIME_QUERY_TEMPLATES,
                        WEB_QUERY_TEMPLATES, AmebaEngine, Engine, HatenaEngine, Hit, KabulineEngine,
                        NoteTagEngine, RealtimeEngine, SearchError, build_queries, make_engines)
from .extract import body_hash, extract
from .http import HttpClient
from .settings import Settings
from .sources import source_type
from .urlnorm import fetch_url, host_of, url_key

log = logging.getLogger(__name__)

# 検索エンジン自身のページなど、記事として扱わない URL
SKIP_HOSTS = ("bing.com", "search.yahoo.co.jp", "search.yahoo.com", "b.hatena.ne.jp", "google.com",
              "duckduckgo.com", "translate.goog", "t.co")
SKIP_EXT = (".pdf", ".xls", ".xlsx", ".zip", ".doc", ".docx", ".ppt", ".pptx", ".jpg", ".png", ".mp4")
FAILED_STATUSES = ("timeout", "conn_error", "error", "ssl_error", "host_blocked", "short")


@dataclass
class RunOptions:
    web: bool = True
    hatena: bool = True
    realtime: bool = True
    ameba: bool = True
    note: bool = True
    antenna: bool = True
    blogs: bool = True
    refresh_search: bool = False
    extra_queries: list[str] = field(default_factory=list)


def interleave_by_host(rows: list) -> list:
    """ホストごとに1件ずつ順に並べる（同一ホストへのアクセス間隔待ちで並列取得が止まるのを防ぐ）。"""
    buckets: dict[str, list] = {}
    for r in rows:
        buckets.setdefault(host_of(r["url"]), []).append(r)
    out = []
    while buckets:
        for h in list(buckets):
            out.append(buckets[h].pop(0))
            if not buckets[h]:
                del buckets[h]
    return out


class Pipeline:
    def __init__(self, settings: Settings, db: Database, http: HttpClient):
        self.s = settings
        self.db = db
        self.http = http
        self.engines: list[Engine] = make_engines(settings, http, settings.web_engines)
        self.hatena = HatenaEngine(settings, http)
        self.realtime = RealtimeEngine(settings, http)
        self.ameba = AmebaEngine(settings, http)
        self.kabuline = KabulineEngine(settings, http)
        self.note_tag = NoteTagEngine(settings, http)

    # ------------------------------------------------------------------
    def run(self, code: str, opts: RunOptions, name: str | None = None, aliases: list[str] | None = None) -> dict:
        t0 = time.monotonic()
        company = resolve_company(code, self.db, self.http, name, aliases)
        log.info("=== %s（%s）の収集を開始 ===", company.name, company.code)
        run_id = self.db.start_run(code)
        self.run_id = run_id
        self.company = company
        self.new_articles = 0
        self.skipped_urls = Counter()

        timings = {}
        t = time.monotonic()
        if opts.web:
            self._discover_web(build_queries(WEB_QUERY_TEMPLATES, company, opts.extra_queries), opts.refresh_search)
        timings["web"] = time.monotonic() - t
        t = time.monotonic()
        if opts.hatena:
            self._discover_hatena(build_queries(HATENA_QUERY_TEMPLATES, company), opts.refresh_search)
        timings["hatena"] = time.monotonic() - t
        t = time.monotonic()
        if opts.realtime:
            self._discover_realtime(build_queries(REALTIME_QUERY_TEMPLATES, company), opts.refresh_search)
        timings["realtime"] = time.monotonic() - t
        t = time.monotonic()
        if opts.ameba:
            for q in build_queries(AMEBA_QUERY_TEMPLATES, company):
                self._run_query(self.ameba, "ameba", q, opts.refresh_search, lambda q=q: self.ameba.search(q))
        if opts.note:
            for tag in build_queries(NOTE_TAG_TEMPLATES, company):
                self._run_query(self.note_tag, "note_tag", tag, opts.refresh_search, lambda t=tag: self.note_tag.search(t))
        if opts.antenna:
            self._run_query(self.kabuline, "antenna", code, opts.refresh_search, lambda: self.kabuline.search(code))
        timings["ameba_antenna"] = time.monotonic() - t
        t = time.monotonic()
        if opts.blogs:
            self._discover_blogs(opts.refresh_search)
        timings["blogs"] = time.monotonic() - t
        t = time.monotonic()
        fetch_stats = self._fetch_pending()
        timings["fetch"] = time.monotonic() - t
        t = time.monotonic()
        analysis_stats = self.analyze(company)
        timings["analyze"] = time.monotonic() - t

        stats = {
            "code": code, "name": company.name, "run_id": run_id,
            "new_articles": self.new_articles,
            "skipped_urls": dict(self.skipped_urls),
            "search": self.search_stats(run_id),
            "fetch": fetch_stats,
            "analysis": analysis_stats,
            "timings_sec": {k: round(v, 1) for k, v in timings.items()},
            "elapsed_sec": round(time.monotonic() - t0, 1),
            "blocked_hosts": dict(self.http.blocked_hosts),
        }
        self.db.finish_run(run_id, stats)
        return stats

    # ------------------------------------------------------------------
    # 発見
    # ------------------------------------------------------------------
    def _register(self, hit: Hit, channel: str, engine: str, query: str, rank: int) -> bool:
        url = fetch_url(hit.url or "")
        if not url.startswith(("http://", "https://")):
            self.skipped_urls["URL不正"] += 1
            return False
        host = host_of(url)
        if any(host == h or host.endswith("." + h) for h in SKIP_HOSTS):
            self.skipped_urls["検索エンジン内ページ"] += 1
            return False
        if url.lower().split("?")[0].endswith(SKIP_EXT):
            self.skipped_urls["PDF等の非HTML"] += 1
            return False
        key = url_key(url)
        aid, new = self.db.upsert_article(url, key, hit.title, source_type(url))
        self.db.link_stock(aid, self.company.code)
        self.db.add_discovery(aid, self.company.code, channel, engine, query, rank, hit.title,
                              (hit.snippet or "")[:3000], self.run_id)
        if hit.body:
            # X 投稿など、発見時点で本文を持つもの
            self.db.x(
                "UPDATE articles SET body=?, author=coalesce(nullif(?,''),author), published_at=coalesce(nullif(?,''),published_at), "
                "fetched_at=?, fetch_status='snippet_only', title=coalesce(nullif(title,''),?) WHERE id=? AND fetch_status!='ok'",
                (hit.body, hit.author, hit.published, now(), hit.title, aid),
            )
        elif new and (hit.author or hit.published):
            self.db.x("UPDATE articles SET author=?, published_at=? WHERE id=?", (hit.author or None, hit.published or None, aid))
        if new:
            self.new_articles += 1
        return new

    def _run_query(self, engine: Engine, channel: str, query: str, refresh: bool, call, engine_name: str | None = None) -> list[Hit] | None:
        ename = engine_name or engine.name
        if not refresh and self.db.recent_search(channel, ename, query, self.s.search_ttl_hours):
            self.db.log_search(self.run_id, self.company.code, channel, ename, query, "cached")
            return None
        if engine.disabled_reason:
            self.db.log_search(self.run_id, self.company.code, channel, ename, query, "skipped", error=engine.disabled_reason)
            return None
        engine.pace()
        t = time.monotonic()
        try:
            hits = call()
        except SearchError as exc:
            engine.consecutive_failures += 1
            self.db.log_search(self.run_id, self.company.code, channel, ename, query, exc.status,
                               error=str(exc), elapsed=time.monotonic() - t)
            log.warning("  %s 失敗（%s）: %s", ename, exc.status, str(exc)[:120])
            if exc.status == "blocked":
                engine.disabled_reason = f"アクセス制限を検知: {exc}"
            elif engine.consecutive_failures >= self.s.engine_failure_limit:
                engine.disabled_reason = f"{engine.consecutive_failures}回連続で失敗"
            if engine.disabled_reason:
                log.warning("  %s はこの実行中は停止します（%s）", ename, engine.disabled_reason)
            return None
        engine.consecutive_failures = 0
        new = sum(self._register(h, channel, ename, query, i + 1) for i, h in enumerate(hits))
        self.db.log_search(self.run_id, self.company.code, channel, ename, query, "ok" if hits else "empty",
                           len(hits), new, elapsed=time.monotonic() - t)
        self.db.commit()
        log.info("  [%s] %s: %d件（新規 %d）", ename, query, len(hits), new)
        return hits

    def _discover_web(self, queries: list[str], refresh: bool) -> None:
        active = []
        for e in self.engines:
            reason = e.available()
            if reason:
                self.db.log_search(self.run_id, self.company.code, "web", e.name, "", "skipped", error=reason)
                log.info("検索エンジン %s は使用しません（%s）", e.name, reason)
            else:
                active.append(e)
        log.info("Web検索: %d クエリ × %d エンジン（%s）", len(queries), len(active), ", ".join(e.name for e in active))
        for q in queries:
            for e in active:
                self._run_query(e, "web", q, refresh, lambda e=e, q=q: e.search(q))

    def _discover_hatena(self, queries: list[str], refresh: bool) -> None:
        log.info("はてなブックマーク検索: %d クエリ", len(queries))
        for i, q in enumerate(queries):
            hits = self._run_query(self.hatena, "hatena", q, refresh, lambda q=q: self.hatena.search(q))
            pages = self.s.hatena_pages if i == 0 else 1
            for page in range(2, pages + 1):
                if hits is None or len(hits) < 40:
                    break
                hits = self._run_query(self.hatena, "hatena", f"{q} [page {page}]", refresh,
                                       lambda q=q, p=page: self.hatena.search(q, p))

    def _discover_realtime(self, queries: list[str], refresh: bool) -> None:
        log.info("Yahoo!リアルタイム検索（X投稿）: %d クエリ", len(queries))
        for q in queries:
            self._run_query(self.realtime, "realtime", q, refresh, lambda q=q: self.realtime.search(q))

    def _discover_blogs(self, refresh: bool) -> None:
        n = blogmod.load_registered(self.db, self.s.blogs_file)
        targets = blogmod.blogs_to_crawl(self.db, self.s.max_blogs_per_run)
        log.info("ブログ巡回: %d 件（登録 %d 件を含む）", len(targets), n)
        company = self.company

        class _BlogEngine(Engine):
            name = "blog"

        eng = _BlogEngine(self.s, self.http)
        eng.s = Settings(**{**self.s.__dict__, "search_interval": 0})   # 待機はホスト単位の間隔に任せる
        for b in targets:
            root = b["root_url"]
            feed = blogmod.ensure_feed(self.db, self.http, b)
            b = self.db.one("SELECT * FROM blogs WHERE root_url=?", (root,))
            statuses = []

            def _wrap(fn):
                def inner():
                    status, hits = fn()
                    statuses.append(status)
                    if status in ("blocked", "robots_disallowed", "host_blocked"):
                        raise SearchError("blocked", status)
                    if status != "ok":
                        raise SearchError("failed", status)
                    return hits
                return inner

            if feed:
                self._run_query(eng, "rss", f"{feed} :: {company.code}", refresh,
                                _wrap(lambda: blogmod.crawl_feed(self.http, feed, company)[:2]), engine_name=root)
            if b["search_url"]:
                self._run_query(eng, "blogsearch", f"{b['search_url']} :: {company.name}", refresh,
                                _wrap(lambda: blogmod.crawl_search(self.http, b["search_url"], root, company)),
                                engine_name=root)
            if b["list_url"]:
                self._run_query(eng, "bloglist", f"{b['list_url']} :: {company.code}", refresh,
                                _wrap(lambda: blogmod.crawl_list(self.http, b["list_url"], b["link_pattern"], company)),
                                engine_name=root)
            eng.disabled_reason = ""
            eng.consecutive_failures = 0
            self.db.x("UPDATE blogs SET last_crawled_at=?, last_status=? WHERE root_url=?",
                      (now(), ",".join(statuses) or ("no_feed" if not feed else "cached"), root))
        self.db.commit()

    # ------------------------------------------------------------------
    # 本文取得
    # ------------------------------------------------------------------
    def _fetch_pending(self) -> dict:
        code = self.company.code
        retry_before = (datetime.now() - timedelta(days=self.s.refetch_failed_after_days)).isoformat(timespec="seconds")
        rows = self.db.q(
            f"""
            SELECT a.id, a.url, a.source_type FROM articles a JOIN article_stocks s ON s.article_id=a.id
            WHERE s.code=? AND a.duplicate_of IS NULL AND (
                a.fetch_status='pending'
                OR (a.fetch_status IN ({','.join('?' * len(FAILED_STATUSES))}) OR a.fetch_status LIKE 'http_5%')
                   AND a.fetch_attempts < ? AND coalesce(a.fetched_at,'') < ?
            )
            ORDER BY CASE a.source_type WHEN 'blog' THEN 0 WHEN 'note' THEN 0 WHEN 'web' THEN 1
                     WHEN 'forum' THEN 2 WHEN 'news' THEN 3 ELSE 4 END, a.first_seen_at
            """,
            (code, *FAILED_STATUSES, self.s.max_fetch_attempts, retry_before),
        )
        stats = Counter()
        stats["deferred_over_limit"] = max(0, len(rows) - self.s.max_fetch_per_run)
        rows = rows[: self.s.max_fetch_per_run]

        # x.com は robots.txt で禁止されているため本文取得せず、検索スニペットを本文として扱う
        todo = []
        for r in rows:
            if r["source_type"] == "sns":
                snip = self._best_snippet(r["id"])
                self.db.x("UPDATE articles SET body=?, fetch_status='snippet_only', fetched_at=? WHERE id=?",
                          (snip, now(), r["id"]))
                stats["snippet_only"] += 1
            else:
                todo.append(r)
        self.db.commit()
        todo = interleave_by_host(todo)
        log.info("本文取得: %d 件（上限超過で次回に回す %d 件）", len(todo), stats["deferred_over_limit"])

        def work(row):
            res = self.http.get(row["url"])
            ex = None
            if res.ok and ("html" in res.content_type or not res.content_type) and res.text:
                try:
                    ex = extract(res.text, res.final_url or row["url"])
                except Exception as exc:  # 抽出失敗で全体を止めない
                    res.status, res.error = "extract_error", f"{type(exc).__name__}: {exc}"
            elif res.ok:
                res.status = "non_html"
            return row, res, ex

        done = 0
        with ThreadPoolExecutor(max_workers=self.s.fetch_workers) as pool:
            futures = [pool.submit(work, r) for r in todo]
            for fut in as_completed(futures):
                row, res, ex = fut.result()
                status = self._save_fetch(row, res, ex)
                stats[status] += 1
                done += 1
                if done % 20 == 0:
                    log.info("  本文取得 %d/%d", done, len(todo))
                    self.db.commit()
        self.db.commit()
        return dict(stats)

    def _best_snippet(self, article_id: int) -> str:
        rows = self.db.q("SELECT snippet FROM discoveries WHERE article_id=? AND code=? ORDER BY length(snippet) DESC",
                         (article_id, self.company.code))
        return rows[0]["snippet"] if rows else ""

    def _save_fetch(self, row, res, ex) -> str:
        aid = row["id"]
        self.db.x("UPDATE articles SET fetch_attempts=fetch_attempts+1, fetched_at=? WHERE id=?", (now(), aid))
        if ex is None:
            self.db.x("UPDATE articles SET fetch_status=?, fetch_error=? WHERE id=?", (res.status, res.error[:300], aid))
            return res.status

        # 正規 URL・別言語版・リダイレクト先で重複を統合
        dup = None
        for alias in [res.final_url, ex.canonical, *ex.alternates]:
            if alias and alias.startswith("http"):
                other = self.db.add_alias(url_key(alias), aid)
                dup = dup or other
        h = body_hash(ex.text)
        if not dup and h:
            r = self.db.one("SELECT id FROM articles WHERE body_hash=? AND id!=? AND duplicate_of IS NULL", (h, aid))
            dup = r["id"] if r else None
        status = "ok" if len(ex.text) >= self.s.min_body_chars else "short"
        if dup:
            status = "duplicate"
            # 発見情報を元記事に引き継ぐ
            self.db.x("INSERT OR IGNORE INTO article_stocks(article_id, code, relevance, first_seen_at) "
                      "SELECT ?, code, '未判定', first_seen_at FROM article_stocks WHERE article_id=?", (dup, aid))
            self.db.x("UPDATE OR IGNORE discoveries SET article_id=? WHERE article_id=?", (dup, aid))
        self.db.x(
            "UPDATE articles SET final_url=?, canonical_url=?, title=coalesce(nullif(?,''), title), author=coalesce(nullif(?,''), author), "
            "site_name=?, published_at=coalesce(nullif(?,''), published_at), body=?, body_hash=?, fetch_status=?, fetch_error=NULL, "
            "duplicate_of=? WHERE id=?",
            (res.final_url, ex.canonical, ex.title, ex.author, ex.site_name, ex.published, ex.text,
             h or None, status, dup, aid),
        )
        return status

    # ------------------------------------------------------------------
    # 分析（関連度・仮説）
    # ------------------------------------------------------------------
    def analyze(self, company: Company) -> dict:
        rows = self.db.q(
            "SELECT a.*, s.relevance FROM articles a JOIN article_stocks s ON s.article_id=a.id "
            "WHERE s.code=? AND a.duplicate_of IS NULL", (company.code,))
        st = Counter()
        for a in rows:
            snippets = " ".join(r["snippet"] or "" for r in self.db.q(
                "SELECT snippet FROM discoveries WHERE article_id=? AND code=?", (a["id"], company.code)))
            body = a["body"] if a["fetch_status"] in ("ok", "short", "snippet_only") else ""
            rel = assess_relevance(company, a["title"] or "", body or "", snippets)
            kind = content_kind(a["source_type"] or "web", a["title"] or "", body or snippets)
            text_for_thesis = body or (snippets if rel.level == "スニペットのみ" else "")
            th = extract_thesis(company, text_for_thesis, "主題" if rel.level == "スニペットのみ" else rel.level, kind)
            self.db.x(
                "UPDATE article_stocks SET relevance=?, mention_count=?, relevance_note=?, content_kind=?, "
                "thesis_score=?, holding=?, perspectives=? WHERE article_id=? AND code=?",
                (rel.level, rel.mention_count, rel.note, kind, th.score, th.holding, ",".join(th.perspectives),
                 a["id"], company.code),
            )
            st[f"relevance:{rel.level}"] += 1
            if rel.level in ("主題", "言及", "スニペットのみ"):
                st[f"kind:{kind}"] += 1
                st["relevant"] += 1
                st["has_reason"] += th.has_reason
                st["has_catalyst"] += th.has_catalyst
                st["has_catalyst_personal"] += th.has_catalyst and kind in ("個人の見解", "X等", "掲示板")
                st["holding_explicit"] += th.holding in ("保有・購入を明言", "購入・売却の両方に言及")
            # 投資仮説を含む個人ブログは、次回以降の巡回対象に自動登録する
            if (a["source_type"] in ("blog", "note") and kind == "個人の見解" and rel.level in ("主題", "言及")
                    and th.has_reason and a["fetch_status"] == "ok"):
                if blogmod.register_auto_blog(self.db, a["final_url"] or a["url"], a["site_name"]):
                    st["auto_blogs_added"] += 1
        self.db.commit()
        dup = self.db.one("SELECT count(*) n FROM articles a JOIN article_stocks s ON s.article_id=a.id "
                          "WHERE s.code=? AND a.duplicate_of IS NOT NULL", (company.code,))["n"]
        st["duplicates_merged"] = dup
        st["total"] = len(rows)
        return dict(st)

    def search_stats(self, run_id: int) -> dict:
        out: dict[str, dict] = {}
        for r in self.db.q("SELECT channel, CASE WHEN channel IN ('rss','blogsearch','bloglist') THEN channel ELSE engine END AS eng, "
                           "status, count(*) n, sum(result_count) hits, sum(new_count) new FROM search_log "
                           "WHERE run_id=? GROUP BY 1,2,3", (run_id,)):
            d = out.setdefault(f"{r['channel']}:{r['eng']}", {"hits": 0, "new": 0})
            d[r["status"]] = r["n"]
            d["hits"] += r["hits"] or 0
            d["new"] += r["new"] or 0
        return out
