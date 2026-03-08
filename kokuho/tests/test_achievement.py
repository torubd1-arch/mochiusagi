"""
tests/test_achievement.py ─ 達成率計算ロジックのユニットテスト
実行: python -m pytest tests/
"""
import sqlite3
import sys
from pathlib import Path

# パスを通す
sys.path.insert(0, str(Path(__file__).parent.parent))

import db as db_module
import pytest


# ================================================================
#  フィクスチャ：インメモリDB
# ================================================================

@pytest.fixture
def mem_db(monkeypatch, tmp_path):
    """テスト用インメモリDB（ファイルを作らない）"""
    test_db = tmp_path / "test.db"
    monkeypatch.setattr(db_module, "DB_PATH", test_db)
    db_module.init_db()
    return test_db


def _insert_treasure(conn, id_, name, category, type_, prefecture):
    conn.execute(
        """INSERT INTO national_treasures
           (id, name, category, type, holder, facility, prefecture, city)
           VALUES (?, ?, ?, ?, '', '', ?, '')""",
        (id_, name, category, type_, prefecture),
    )


def _insert_log(conn, log_id, treasure_id, view_date="2024-01-01"):
    conn.execute(
        """INSERT INTO view_logs (log_id, treasure_id, view_date)
           VALUES (?, ?, ?)""",
        (log_id, treasure_id, view_date),
    )


# ================================================================
#  テスト: 基本達成率計算
# ================================================================

class TestPrefectureStats:

    def test_no_treasures_all_zero(self, mem_db):
        """国宝がない都道府県は total=0, viewed=0, rate=0"""
        stats = db_module.get_prefecture_stats()
        # 全47都道府県が返る
        assert len(stats) == 47
        for s in stats:
            assert s["total"] == 0
            assert s["viewed"] == 0
            assert s["rate"] == 0.0

    def test_single_treasure_not_viewed(self, mem_db):
        """1件登録、未観覧 → 達成率0"""
        with db_module.get_conn() as conn:
            _insert_treasure(conn, "T001", "テスト国宝", "art", "絵画", "奈良県")

        stats = db_module.get_prefecture_stats()
        nara = next(s for s in stats if s["prefecture"] == "奈良県")
        assert nara["total"] == 1
        assert nara["viewed"] == 0
        assert nara["not_viewed"] == 1
        assert nara["rate"] == 0.0

    def test_single_treasure_viewed(self, mem_db):
        """1件登録・観覧済み → 達成率100%"""
        with db_module.get_conn() as conn:
            _insert_treasure(conn, "T001", "テスト国宝", "art", "絵画", "奈良県")
            _insert_log(conn, "L001", "T001")

        stats = db_module.get_prefecture_stats()
        nara = next(s for s in stats if s["prefecture"] == "奈良県")
        assert nara["total"] == 1
        assert nara["viewed"] == 1
        assert nara["rate"] == 1.0

    def test_multiple_treasures_partial(self, mem_db):
        """4件のうち2件観覧 → 達成率50%"""
        with db_module.get_conn() as conn:
            for i in range(4):
                _insert_treasure(conn, f"T{i:03}", f"国宝{i}", "art", "絵画", "京都府")
            _insert_log(conn, "L001", "T000")
            _insert_log(conn, "L002", "T001")

        stats = db_module.get_prefecture_stats()
        kyoto = next(s for s in stats if s["prefecture"] == "京都府")
        assert kyoto["total"] == 4
        assert kyoto["viewed"] == 2
        assert kyoto["not_viewed"] == 2
        assert kyoto["rate"] == 0.5

    def test_multiple_logs_same_treasure_counts_once(self, mem_db):
        """同一国宝を複数回観覧しても +1（ユニーク件数）"""
        with db_module.get_conn() as conn:
            _insert_treasure(conn, "T001", "国宝A", "art", "彫刻", "奈良県")
            _insert_log(conn, "L001", "T001", "2024-01-01")
            _insert_log(conn, "L002", "T001", "2024-06-01")  # 同じ国宝を再観覧

        stats = db_module.get_prefecture_stats()
        nara = next(s for s in stats if s["prefecture"] == "奈良県")
        assert nara["viewed"] == 1  # 2件ログがあっても1件扱い
        assert nara["rate"] == 1.0

    def test_viewed_in_other_pref_counts_to_home_pref(self, mem_db):
        """
        所在県基準ルール：
        奈良県の国宝を東京（巡回展）で見ても、奈良県の分子に加算される。
        view_logsのvenueは集計に影響しない。
        """
        with db_module.get_conn() as conn:
            # 奈良県所在の国宝
            _insert_treasure(conn, "T001", "奈良の国宝", "art", "絵画", "奈良県")
            # 東京で観覧（venueに東京と記録）
            conn.execute(
                """INSERT INTO view_logs (log_id, treasure_id, view_date, venue)
                   VALUES ('L001', 'T001', '2024-03-15', '東京国立博物館')"""
            )

        stats = db_module.get_prefecture_stats()
        nara = next(s for s in stats if s["prefecture"] == "奈良県")
        tokyo = next(s for s in stats if s["prefecture"] == "東京都")

        assert nara["viewed"] == 1   # ★ 奈良県に加算される
        assert nara["rate"] == 1.0
        assert tokyo["viewed"] == 0  # ★ 東京都には加算されない

    def test_multi_prefecture_isolation(self, mem_db):
        """複数都道府県の達成率が互いに影響しない"""
        with db_module.get_conn() as conn:
            _insert_treasure(conn, "T001", "奈良A", "architecture", "寺院", "奈良県")
            _insert_treasure(conn, "T002", "奈良B", "art", "彫刻", "奈良県")
            _insert_treasure(conn, "T003", "京都A", "art", "絵画", "京都府")
            _insert_log(conn, "L001", "T001")  # 奈良1件のみ観覧

        stats = db_module.get_prefecture_stats()
        nara  = next(s for s in stats if s["prefecture"] == "奈良県")
        kyoto = next(s for s in stats if s["prefecture"] == "京都府")

        assert nara["total"] == 2
        assert nara["viewed"] == 1
        assert nara["rate"] == 0.5

        assert kyoto["total"] == 1
        assert kyoto["viewed"] == 0
        assert kyoto["rate"] == 0.0

    def test_sort_by_rate_desc(self, mem_db):
        """達成率降順にソートされること"""
        with db_module.get_conn() as conn:
            # 奈良: 1/2 = 50%
            _insert_treasure(conn, "T001", "奈良A", "art", "絵画", "奈良県")
            _insert_treasure(conn, "T002", "奈良B", "art", "彫刻", "奈良県")
            _insert_log(conn, "L001", "T001")
            # 京都: 2/2 = 100%
            _insert_treasure(conn, "T003", "京都A", "art", "絵画", "京都府")
            _insert_treasure(conn, "T004", "京都B", "architecture", "寺院", "京都府")
            _insert_log(conn, "L002", "T003")
            _insert_log(conn, "L003", "T004")

        stats = db_module.get_prefecture_stats()
        # 総数>0の都道府県だけ取り出す
        non_zero = [s for s in stats if s["total"] > 0]
        rates = [s["rate"] for s in non_zero]
        assert rates == sorted(rates, reverse=True)


# ================================================================
#  テスト: 全体達成率
# ================================================================

class TestOverallStats:

    def test_empty(self, mem_db):
        s = db_module.get_overall_stats()
        assert s["total"] == 0
        assert s["viewed"] == 0
        assert s["rate"] == 0.0

    def test_partial(self, mem_db):
        with db_module.get_conn() as conn:
            for i in range(5):
                _insert_treasure(conn, f"T{i}", f"国宝{i}", "art", "絵画", "奈良県")
            _insert_log(conn, "L1", "T0")
            _insert_log(conn, "L2", "T1")

        s = db_module.get_overall_stats()
        assert s["total"] == 5
        assert s["viewed"] == 2
        assert s["not_viewed"] == 3
        assert s["rate"] == pytest.approx(0.4)


# ================================================================
#  テスト: カテゴリ別
# ================================================================

class TestCategoryStats:

    def test_category_split(self, mem_db):
        with db_module.get_conn() as conn:
            _insert_treasure(conn, "T1", "美工1", "art", "絵画", "東京都")
            _insert_treasure(conn, "T2", "美工2", "art", "彫刻", "東京都")
            _insert_treasure(conn, "T3", "建造1", "architecture", "寺院", "奈良県")
            _insert_log(conn, "L1", "T1")

        stats = db_module.get_category_stats()
        art_s = next(s for s in stats if s["category"] == "art")
        arc_s = next(s for s in stats if s["category"] == "architecture")

        assert art_s["total"] == 2
        assert art_s["viewed"] == 1
        assert arc_s["total"] == 1
        assert arc_s["viewed"] == 0
