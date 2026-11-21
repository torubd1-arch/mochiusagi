"""SQLite への蓄積。

記事本文はローカル分析用途に限定する（このデータベースは外部へ再配布しない）。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    aliases     TEXT NOT NULL DEFAULT '[]',
    source      TEXT,
    updated_at  TEXT
);

-- 記事（URL 単位。表記揺れは url_key と article_aliases で統合）
CREATE TABLE IF NOT EXISTS articles (
    id              INTEGER PRIMARY KEY,
    url_key         TEXT NOT NULL UNIQUE,
    url             TEXT NOT NULL,
    final_url       TEXT,
    canonical_url   TEXT,
    title           TEXT,
    author          TEXT,
    site_name       TEXT,
    published_at    TEXT,
    fetched_at      TEXT,
    first_seen_at   TEXT NOT NULL,
    body            TEXT,
    body_hash       TEXT,
    fetch_status    TEXT NOT NULL DEFAULT 'pending',  -- pending/ok/snippet_only/short/blocked/robots_disallowed/http_XXX/...
    fetch_error     TEXT,
    fetch_attempts  INTEGER NOT NULL DEFAULT 0,
    source_type     TEXT,      -- blog/note/x/news/forum/web
    duplicate_of    INTEGER REFERENCES articles(id)
);
CREATE INDEX IF NOT EXISTS idx_articles_hash ON articles(body_hash);

CREATE TABLE IF NOT EXISTS article_aliases (
    alias_key   TEXT PRIMARY KEY,
    article_id  INTEGER NOT NULL REFERENCES articles(id)
);

-- 記事と銘柄の対応（関連度は銘柄ごとに判定）
CREATE TABLE IF NOT EXISTS article_stocks (
    article_id      INTEGER NOT NULL REFERENCES articles(id),
    code            TEXT NOT NULL,
    relevance       TEXT,      -- 主題/言及/スニペットのみ/無関係/未判定
    mention_count   INTEGER,
    relevance_note  TEXT,
    content_kind    TEXT,      -- 個人の見解/ニュース・株価情報/掲示板/X等/その他
    thesis_score    INTEGER,   -- 投資仮説らしさ（並び順用。正しさの評価ではない）
    holding         TEXT,      -- 保有・購入の明言/売却の明言/監視/記載なし
    perspectives    TEXT,      -- 抜粋が見つかった観点
    first_seen_at   TEXT NOT NULL,
    PRIMARY KEY (article_id, code)
);

-- 発見元（どの経路・検索語で見つけたか）
CREATE TABLE IF NOT EXISTS discoveries (
    id          INTEGER PRIMARY KEY,
    article_id  INTEGER NOT NULL REFERENCES articles(id),
    code        TEXT NOT NULL,
    channel     TEXT NOT NULL,   -- web/hatena/realtime/rss/blogsearch/bloglist
    engine      TEXT,
    query       TEXT,
    rank        INTEGER,
    title       TEXT,
    snippet     TEXT,
    run_id      INTEGER,
    discovered_at TEXT NOT NULL,
    UNIQUE (article_id, code, channel, engine, query)
);

-- 検索・巡回の実行記録（成功・失敗・0件を区別）
CREATE TABLE IF NOT EXISTS search_log (
    id          INTEGER PRIMARY KEY,
    run_id      INTEGER,
    code        TEXT,
    channel     TEXT NOT NULL,
    engine      TEXT,
    query       TEXT,
    status      TEXT NOT NULL,   -- ok/empty/failed/blocked/skipped/cached
    result_count INTEGER DEFAULT 0,
    new_count   INTEGER DEFAULT 0,
    error       TEXT,
    elapsed     REAL,
    executed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_log_q ON search_log(channel, engine, query, executed_at);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    stats       TEXT
);

-- 巡回対象ブログ（登録 / 自動発見）
CREATE TABLE IF NOT EXISTS blogs (
    root_url    TEXT PRIMARY KEY,
    name        TEXT,
    platform    TEXT,
    feed_url    TEXT,
    search_url  TEXT,
    list_url    TEXT,
    link_pattern TEXT,
    origin      TEXT NOT NULL,   -- registered/auto
    enabled     INTEGER NOT NULL DEFAULT 1,
    added_at    TEXT NOT NULL,
    last_crawled_at TEXT,
    last_status TEXT
);

-- 本文を含む一覧ビュー（ローカル分析用）
CREATE VIEW IF NOT EXISTS v_articles AS
SELECT a.id, s.code, c.name AS company_name, a.title, a.url, a.author, a.site_name,
       a.published_at, a.fetched_at, a.fetch_status, a.source_type, s.relevance,
       (SELECT group_concat(DISTINCT d.channel || ':' || coalesce(d.engine,'') ) FROM discoveries d
         WHERE d.article_id = a.id AND d.code = s.code) AS discovered_by,
       (SELECT group_concat(DISTINCT d.query) FROM discoveries d
         WHERE d.article_id = a.id AND d.code = s.code) AS queries,
       a.body
FROM articles a JOIN article_stocks s ON s.article_id = a.id
LEFT JOIN companies c ON c.code = s.code;
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()

    def q(self, sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, args).fetchone()

    def x(self, sql: str, args: tuple | list = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, args)

    def commit(self) -> None:
        self.conn.commit()

    # ---- companies ----
    def get_company(self, code: str) -> sqlite3.Row | None:
        return self.one("SELECT * FROM companies WHERE code=?", (code,))

    def save_company(self, code: str, name: str, aliases: list[str], source: str) -> None:
        self.x(
            "INSERT INTO companies(code,name,aliases,source,updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(code) DO UPDATE SET name=excluded.name, aliases=excluded.aliases, "
            "source=excluded.source, updated_at=excluded.updated_at",
            (code, name, json.dumps(aliases, ensure_ascii=False), source, now()),
        )
        self.commit()

    # ---- runs ----
    def start_run(self, code: str) -> int:
        cur = self.x("INSERT INTO runs(code, started_at) VALUES(?,?)", (code, now()))
        self.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, stats: dict) -> None:
        self.x("UPDATE runs SET finished_at=?, stats=? WHERE id=?",
               (now(), json.dumps(stats, ensure_ascii=False), run_id))
        self.commit()

    # ---- articles ----
    def find_article(self, key: str) -> int | None:
        row = self.one("SELECT id FROM articles WHERE url_key=?", (key,))
        if row:
            return row["id"]
        row = self.one("SELECT article_id FROM article_aliases WHERE alias_key=?", (key,))
        return row["article_id"] if row else None

    def upsert_article(self, url: str, key: str, title: str, source_type: str) -> tuple[int, bool]:
        """(記事ID, 新規か) を返す。"""
        aid = self.find_article(key)
        if aid:
            if title:
                self.x("UPDATE articles SET title=coalesce(nullif(title,''), ?) WHERE id=?", (title, aid))
            return aid, False
        cur = self.x(
            "INSERT INTO articles(url_key,url,title,first_seen_at,source_type) VALUES(?,?,?,?,?)",
            (key, url, title, now(), source_type),
        )
        return cur.lastrowid, True

    def add_alias(self, alias_key: str, article_id: int) -> int | None:
        """別名を登録。既に別の記事に紐づく場合はその記事 ID を返す（重複検出）。"""
        row = self.one("SELECT id FROM articles WHERE url_key=?", (alias_key,))
        if row and row["id"] != article_id:
            return row["id"]
        row = self.one("SELECT article_id FROM article_aliases WHERE alias_key=?", (alias_key,))
        if row and row["article_id"] != article_id:
            return row["article_id"]
        self.x("INSERT OR IGNORE INTO article_aliases(alias_key, article_id) VALUES(?,?)", (alias_key, article_id))
        return None

    def link_stock(self, article_id: int, code: str) -> bool:
        cur = self.x(
            "INSERT OR IGNORE INTO article_stocks(article_id, code, relevance, first_seen_at) VALUES(?,?,?,?)",
            (article_id, code, "未判定", now()),
        )
        return cur.rowcount > 0

    def add_discovery(self, article_id: int, code: str, channel: str, engine: str | None, query: str | None,
                      rank: int | None, title: str, snippet: str, run_id: int) -> None:
        self.x(
            "INSERT INTO discoveries(article_id,code,channel,engine,query,rank,title,snippet,run_id,discovered_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(article_id,code,channel,engine,query) DO UPDATE SET "
            "snippet=CASE WHEN length(excluded.snippet) > length(coalesce(snippet,'')) THEN excluded.snippet ELSE snippet END",
            (article_id, code, channel, engine or "", query or "", rank, title, snippet, run_id, now()),
        )

    # ---- search log ----
    def log_search(self, run_id: int, code: str, channel: str, engine: str, query: str, status: str,
                   result_count: int = 0, new_count: int = 0, error: str = "", elapsed: float = 0.0) -> None:
        self.x(
            "INSERT INTO search_log(run_id,code,channel,engine,query,status,result_count,new_count,error,elapsed,executed_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, code, channel, engine, query, status, result_count, new_count, error[:300], round(elapsed, 2), now()),
        )
        self.commit()

    def recent_search(self, channel: str, engine: str, query: str, ttl_hours: float) -> sqlite3.Row | None:
        since = (datetime.now() - timedelta(hours=ttl_hours)).isoformat(timespec="seconds")
        return self.one(
            "SELECT * FROM search_log WHERE channel=? AND engine=? AND query=? AND status IN ('ok','empty') "
            "AND executed_at >= ? ORDER BY executed_at DESC LIMIT 1",
            (channel, engine, query, since),
        )
