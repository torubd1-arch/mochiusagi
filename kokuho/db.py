"""
db.py ─ SQLite データベース操作層
国宝チェックリストアプリ
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path("kokuho.db")


# ================================================================
#  接続ヘルパー
# ================================================================

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ================================================================
#  スキーマ初期化
# ================================================================

DDL_NATIONAL_TREASURES = """
CREATE TABLE IF NOT EXISTS national_treasures (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL CHECK(category IN ('art', 'architecture')),
    type           TEXT,
    holder         TEXT,
    facility       TEXT,
    prefecture     TEXT NOT NULL,
    city           TEXT,
    address        TEXT,
    lat            REAL,
    lng            REAL,
    source_url     TEXT,
    notes_master   TEXT,
    created_at     TEXT DEFAULT (datetime('now', 'localtime')),
    deleted_at     TEXT DEFAULT NULL
)
"""

DDL_VIEW_LOGS = """
CREATE TABLE IF NOT EXISTS view_logs (
    log_id         TEXT PRIMARY KEY,
    treasure_id    TEXT NOT NULL REFERENCES national_treasures(id),
    view_date      TEXT NOT NULL,
    venue          TEXT,
    memo           TEXT,
    evidence       TEXT,
    created_at     TEXT DEFAULT (datetime('now', 'localtime'))
)
"""

DDL_IDX_LOGS = """
CREATE INDEX IF NOT EXISTS idx_view_logs_treasure
ON view_logs(treasure_id)
"""


def init_db() -> None:
    """DB作成・スキーマ適用（既存DBへのマイグレーション含む）"""
    with get_conn() as conn:
        conn.execute(DDL_NATIONAL_TREASURES)
        conn.execute(DDL_VIEW_LOGS)
        conn.execute(DDL_IDX_LOGS)
        # マイグレーション: deleted_at カラムが存在しない場合は追加
        try:
            conn.execute("ALTER TABLE national_treasures ADD COLUMN deleted_at TEXT DEFAULT NULL")
        except Exception:
            pass  # すでに存在する場合はスキップ


# ================================================================
#  マスタ投入
# ================================================================

def count_treasures() -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM national_treasures WHERE deleted_at IS NULL"
        ).fetchone()
        return row[0]


def upsert_master(records: list[dict[str, Any]]) -> tuple[int, int, int]:
    """
    マスタデータをupsert。戻り値: (inserted, updated, logically_deleted)
    - ID一致 → 更新（deleted_at を NULL に戻す）
    - 新規ID → 追加
    - 新JSONに存在しないID → 論理削除（deleted_at にタイムスタンプをセット）
    - view_logs は保持（物理削除しない）
    """
    inserted = updated = logically_deleted = 0
    new_ids = {r["id"] for r in records}

    with get_conn() as conn:
        # 既存の全IDを取得
        existing_ids = {
            row[0] for row in conn.execute("SELECT id FROM national_treasures").fetchall()
        }

        for r in records:
            if r["id"] in existing_ids:
                conn.execute(
                    """UPDATE national_treasures
                       SET name=?, category=?, type=?, holder=?, facility=?,
                           prefecture=?, city=?, address=?, lat=?, lng=?,
                           source_url=?, notes_master=?,
                           deleted_at=NULL
                       WHERE id=?""",
                    (
                        r.get("name"), r.get("category"), r.get("type"),
                        r.get("holder"), r.get("facility"), r.get("prefecture"),
                        r.get("city"), r.get("address"), r.get("lat"), r.get("lng"),
                        r.get("source_url"), r.get("notes_master"), r["id"],
                    ),
                )
                updated += 1
            else:
                conn.execute(
                    """INSERT INTO national_treasures
                       (id, name, category, type, holder, facility, prefecture,
                        city, address, lat, lng, source_url, notes_master)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        r["id"], r.get("name"), r.get("category"), r.get("type"),
                        r.get("holder"), r.get("facility"), r.get("prefecture"),
                        r.get("city"), r.get("address"), r.get("lat"), r.get("lng"),
                        r.get("source_url"), r.get("notes_master"),
                    ),
                )
                inserted += 1

        # 新JSONに存在しないIDを論理削除
        vanished = existing_ids - new_ids
        if vanished:
            placeholders = ",".join("?" * len(vanished))
            conn.execute(
                f"UPDATE national_treasures SET deleted_at = datetime('now','localtime')"
                f" WHERE id IN ({placeholders}) AND deleted_at IS NULL",
                list(vanished),
            )
            row = conn.execute(
                f"SELECT COUNT(*) FROM national_treasures"
                f" WHERE id IN ({placeholders}) AND deleted_at IS NOT NULL",
                list(vanished),
            ).fetchone()
            logically_deleted = row[0] if row else 0

    return inserted, updated, logically_deleted


def load_master_from_json(json_path: Path) -> list[dict]:
    with open(json_path, encoding="utf-8") as f:
        return json.load(f)


# ================================================================
#  観覧ログ操作
# ================================================================

def search_treasures(keyword: str) -> list[sqlite3.Row]:
    """名称・種別・所蔵者で部分一致検索"""
    q = f"%{keyword}%"
    with get_conn() as conn:
        return conn.execute(
            """SELECT nt.*,
                      (SELECT COUNT(*) FROM view_logs vl WHERE vl.treasure_id = nt.id) AS view_count
               FROM national_treasures nt
               WHERE (nt.name LIKE ? OR nt.type LIKE ? OR nt.holder LIKE ?)
                 AND nt.deleted_at IS NULL
               ORDER BY nt.prefecture, nt.name""",
            (q, q, q),
        ).fetchall()


def get_treasure_by_id(tid: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM national_treasures WHERE id = ?", (tid,)
        ).fetchone()


def add_view_log(
    treasure_id: str,
    view_date: str,
    venue: str = "",
    memo: str = "",
    evidence: str = "",
) -> str:
    log_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO view_logs (log_id, treasure_id, view_date, venue, memo, evidence)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (log_id, treasure_id, view_date, venue, memo, evidence),
        )
    return log_id


def get_view_logs_for_treasure(treasure_id: str) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM view_logs WHERE treasure_id = ? ORDER BY view_date DESC",
            (treasure_id,),
        ).fetchall()


# ================================================================
#  集計ロジック（最重要）
# ================================================================

ALL_PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
]


def get_prefecture_stats_filtered(
    category: str | None = None,
    type_filter: str | None = None,
) -> list[dict]:
    """
    カテゴリ・種別フィルタ付き都道府県別達成率。
    フィルタなしなら get_prefecture_stats() と同等。
    """
    params: list = []
    where: list[str] = ["nt.deleted_at IS NULL"]
    if category:
        where.append("nt.category = ?")
        params.append(category)
    if type_filter:
        where.append("nt.type = ?")
        params.append(type_filter)

    where_sql = "WHERE " + " AND ".join(where)
    sql = f"""
        SELECT
            nt.prefecture,
            COUNT(DISTINCT nt.id) AS total,
            COUNT(DISTINCT CASE WHEN vl.treasure_id IS NOT NULL THEN nt.id END) AS viewed,
            COUNT(DISTINCT CASE WHEN vl.treasure_id IS NULL  THEN nt.id END) AS not_viewed
        FROM national_treasures nt
        LEFT JOIN (SELECT DISTINCT treasure_id FROM view_logs) vl ON vl.treasure_id = nt.id
        {where_sql}
        GROUP BY nt.prefecture
    """
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    db_map = {r["prefecture"]: dict(r) for r in rows}
    result = []
    for pref in ALL_PREFECTURES:
        d = db_map.get(pref, {"prefecture": pref, "total": 0, "viewed": 0, "not_viewed": 0})
        total = d["total"]
        d["rate"] = round(d["viewed"] / total, 4) if total > 0 else 0.0
        result.append(d)
    return result


def get_prefecture_stats() -> list[dict]:
    """
    都道府県別達成率を算出。
    - 分母: その都道府県に所在する国宝総数
    - 分子: そのうち view_logs が1件以上あるユニーク件数
    - 所在都道府県基準（展覧会で他県で見ても所在県に加算）
    - 47都道府県すべて返す（0件含む）
    """
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                nt.prefecture,
                COUNT(DISTINCT nt.id)                         AS total,
                COUNT(DISTINCT CASE
                    WHEN vl.treasure_id IS NOT NULL THEN nt.id
                    END)                                       AS viewed,
                COUNT(DISTINCT CASE
                    WHEN vl.treasure_id IS NULL THEN nt.id
                    END)                                       AS not_viewed
            FROM national_treasures nt
            LEFT JOIN (
                SELECT DISTINCT treasure_id FROM view_logs
            ) vl ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            GROUP BY nt.prefecture
            """
        ).fetchall()

    # DBにある都道府県のdict
    db_map = {r["prefecture"]: dict(r) for r in rows}

    result = []
    for pref in ALL_PREFECTURES:
        if pref in db_map:
            d = db_map[pref]
        else:
            d = {"prefecture": pref, "total": 0, "viewed": 0, "not_viewed": 0}
        total = d["total"]
        d["rate"] = round(d["viewed"] / total, 4) if total > 0 else 0.0
        result.append(d)

    # 達成率降順 → 総数降順
    result.sort(key=lambda x: (-x["rate"], -x["total"]))
    return result


def get_overall_stats() -> dict:
    """全体達成率"""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(DISTINCT nt.id) AS total,
                COUNT(DISTINCT CASE WHEN vl.treasure_id IS NOT NULL THEN nt.id END) AS viewed
            FROM national_treasures nt
            LEFT JOIN (SELECT DISTINCT treasure_id FROM view_logs) vl
              ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            """
        ).fetchone()
    total = row["total"]
    viewed = row["viewed"]
    return {
        "total": total,
        "viewed": viewed,
        "not_viewed": total - viewed,
        "rate": round(viewed / total, 4) if total > 0 else 0.0,
    }


def get_category_stats() -> list[dict]:
    """カテゴリ別（art / architecture）達成率"""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                nt.category,
                COUNT(DISTINCT nt.id) AS total,
                COUNT(DISTINCT CASE WHEN vl.treasure_id IS NOT NULL THEN nt.id END) AS viewed
            FROM national_treasures nt
            LEFT JOIN (SELECT DISTINCT treasure_id FROM view_logs) vl
              ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            GROUP BY nt.category
            """
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["not_viewed"] = d["total"] - d["viewed"]
        d["rate"] = round(d["viewed"] / d["total"], 4) if d["total"] > 0 else 0.0
        result.append(d)
    return result


def get_type_stats() -> list[dict]:
    """種別別達成率"""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                nt.type,
                COUNT(DISTINCT nt.id) AS total,
                COUNT(DISTINCT CASE WHEN vl.treasure_id IS NOT NULL THEN nt.id END) AS viewed
            FROM national_treasures nt
            LEFT JOIN (SELECT DISTINCT treasure_id FROM view_logs) vl
              ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            GROUP BY nt.type
            ORDER BY total DESC
            """
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["rate"] = round(d["viewed"] / d["total"], 4) if d["total"] > 0 else 0.0
        result.append(d)
    return result


def get_not_viewed(
    prefecture: str | None = None,
    category: str | None = None,
    type_filter: str | None = None,
) -> list[sqlite3.Row]:
    """未達一覧。都道府県・カテゴリ・種別フィルタ可能（所在県基準）"""
    conditions = [
        "nt.id NOT IN (SELECT DISTINCT treasure_id FROM view_logs)",
        "nt.deleted_at IS NULL",
    ]
    params: list = []
    if prefecture:
        conditions.append("nt.prefecture = ?")
        params.append(prefecture)
    if category:
        conditions.append("nt.category = ?")
        params.append(category)
    if type_filter:
        conditions.append("nt.type = ?")
        params.append(type_filter)

    sql = (
        "SELECT nt.* FROM national_treasures nt WHERE "
        + " AND ".join(conditions)
        + " ORDER BY nt.prefecture, nt.category, nt.name"
    )
    with get_conn() as conn:
        return conn.execute(sql, params).fetchall()


def get_all_viewed() -> list[sqlite3.Row]:
    """観覧済み一覧（初見日付き）"""
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT nt.*, MIN(vl.view_date) AS first_view_date
            FROM national_treasures nt
            JOIN view_logs vl ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            GROUP BY nt.id
            ORDER BY first_view_date DESC
            """
        ).fetchall()


# ================================================================
#  CSV エクスポート用
# ================================================================

def get_all_with_status() -> list[sqlite3.Row]:
    """全件＋達成状況＋初見日"""
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT
                nt.*,
                CASE WHEN vl.treasure_id IS NOT NULL THEN 1 ELSE 0 END AS viewed,
                MIN(vl.view_date) AS first_view_date,
                COUNT(vl.log_id) AS view_count
            FROM national_treasures nt
            LEFT JOIN view_logs vl ON vl.treasure_id = nt.id
            WHERE nt.deleted_at IS NULL
            GROUP BY nt.id
            ORDER BY nt.prefecture, nt.category, nt.name
            """
        ).fetchall()


def get_recent_view_logs(limit: int = 10) -> list[sqlite3.Row]:
    """最近の閲覧ログ（国宝名・都道府県付き）"""
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT vl.*, nt.name AS treasure_name, nt.prefecture, nt.category
            FROM view_logs vl
            JOIN national_treasures nt ON nt.id = vl.treasure_id
            ORDER BY vl.view_date DESC, vl.created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()


def delete_view_log(log_id: str) -> None:
    """閲覧ログを削除"""
    with get_conn() as conn:
        conn.execute("DELETE FROM view_logs WHERE log_id = ?", (log_id,))


def update_view_log(
    log_id: str,
    view_date: str,
    venue: str,
    memo: str,
    evidence: str,
) -> None:
    """閲覧ログを更新"""
    with get_conn() as conn:
        conn.execute(
            """UPDATE view_logs
               SET view_date=?, venue=?, memo=?, evidence=?
               WHERE log_id=?""",
            (view_date, venue, memo, evidence, log_id),
        )


def get_all_view_logs() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT vl.*, nt.name AS treasure_name, nt.prefecture
            FROM view_logs vl
            JOIN national_treasures nt ON nt.id = vl.treasure_id
            ORDER BY vl.view_date DESC
            """
        ).fetchall()
