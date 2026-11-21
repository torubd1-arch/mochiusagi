"""実行設定。値はコマンドライン引数で一部上書きできる。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    # 保存先
    db_path: Path = BASE_DIR / "data" / "katarist.db"
    output_dir: Path = BASE_DIR / "output"
    log_dir: Path = BASE_DIR / "logs"
    blogs_file: Path = BASE_DIR / "config" / "blogs.json"

    # HTTP
    connect_timeout: float = 6.0
    read_timeout: float = 15.0
    max_retries: int = 2            # 接続エラー・5xx のときだけ再試行（403/429 は再試行しない）
    backoff_base: float = 2.0       # 再試行の待機: 2秒 → 4秒
    per_host_interval: float = 1.5  # 同一ホストへの最小アクセス間隔（秒）
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 katarist/0.1"
    )

    # 検索
    search_interval: float = 2.5    # 同一検索エンジンへの呼び出し間隔（秒）
    search_ttl_hours: float = 24.0  # この時間内に実行済みの検索は再実行しない
    max_results_per_query: int = 10
    engine_failure_limit: int = 3   # 連続失敗したエンジンはその実行中は停止
    web_engines: list[str] = field(default_factory=lambda: [
        "brave_api", "google_cse", "ddgs_yahoo", "bing_html",
    ])
    hatena_pages: int = 2           # はてブ検索の取得ページ数（1ページ40件）

    # 本文取得
    fetch_workers: int = 6
    max_fetch_per_run: int = 300
    refetch_failed_after_days: float = 3.0
    max_fetch_attempts: int = 3
    min_body_chars: int = 150

    # ブログ巡回
    max_blogs_per_run: int = 40

    # 公式検索API（任意。環境変数で指定）
    brave_api_key: str | None = field(default_factory=lambda: os.environ.get("BRAVE_API_KEY"))
    google_cse_key: str | None = field(default_factory=lambda: os.environ.get("GOOGLE_CSE_KEY"))
    google_cse_cx: str | None = field(default_factory=lambda: os.environ.get("GOOGLE_CSE_CX"))
