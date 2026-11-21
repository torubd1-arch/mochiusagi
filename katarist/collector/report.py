"""銘柄ごとの ChatGPT アップロード用 Markdown を生成する。

本文全体は出力せず、投資判断に関係する箇所の短い原文抜粋と出典 URL のみを載せる。
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from .analysis import PERSPECTIVES, assess_relevance, content_kind, extract_thesis
from .company import Company
from .db import Database
from .sources import SOURCE_LABEL

PERSONAL_KINDS = ("個人の見解", "X等", "掲示板")
FETCH_STATUS_LABEL = {
    "ok": "取得済み", "short": "本文が短い", "snippet_only": "検索結果の抜粋のみ", "pending": "未取得",
    "blocked": "アクセス制限", "robots_disallowed": "robots.txtで禁止", "host_blocked": "アクセス制限（同一サイト）",
    "timeout": "タイムアウト", "conn_error": "接続エラー", "ssl_error": "SSLエラー", "non_html": "HTML以外",
    "extract_error": "本文抽出エラー", "duplicate": "重複",
}


def md(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).replace("|", "｜").strip()


def quote_block(s: str) -> str:
    return "> " + md(s)


def fmt_date(s: str | None) -> str:
    if not s:
        return "不明"
    m = re.match(r"(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?", s)
    if m:
        return m.group(1)
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return md(s)[:20]


def status_label(s: str) -> str:
    if s.startswith("http_"):
        return f"HTTPエラー {s[5:]}"
    return FETCH_STATUS_LABEL.get(s, s)


def _load(db: Database, company: Company) -> list[dict]:
    rows = db.q(
        "SELECT a.*, s.relevance, s.relevance_note, s.content_kind, s.thesis_score, s.holding FROM articles a "
        "JOIN article_stocks s ON s.article_id=a.id WHERE s.code=? AND a.duplicate_of IS NULL", (company.code,))
    items = []
    for a in rows:
        disc = db.q("SELECT channel, engine, query, snippet FROM discoveries WHERE article_id=? AND code=?",
                    (a["id"], company.code))
        snippets = " ".join(d["snippet"] or "" for d in disc)
        body = a["body"] if a["fetch_status"] in ("ok", "short", "snippet_only") else ""
        rel = assess_relevance(company, a["title"] or "", body or "", snippets)
        kind = content_kind(a["source_type"] or "web", a["title"] or "", body or snippets)
        text = body or (snippets if rel.level == "スニペットのみ" else "")
        th = extract_thesis(company, text, "主題" if rel.level == "スニペットのみ" else rel.level, kind)
        items.append({"a": a, "rel": rel, "kind": kind, "th": th, "disc": disc, "snippets": snippets})
    return items


def _discovered_by(disc) -> str:
    seen = []
    for d in disc:
        label = {"web": "Web検索", "hatena": "はてブ検索", "realtime": "Yahoo!リアルタイム検索",
                 "rss": "RSS", "blogsearch": "ブログ内検索", "bloglist": "ブログ一覧",
                 "ameba": "アメーバ検索", "antenna": "株ライン ブログアンテナ",
                 "note_tag": "noteハッシュタグ"}.get(d["channel"], d["channel"])
        eng = d["engine"] if d["channel"] == "web" else ""
        q = d["query"].split(" :: ")[0] if d["channel"] in ("web", "hatena", "realtime", "ameba", "note_tag") else ""
        s = f"{label}" + (f"/{eng}" if eng else "") + (f"「{q}」" if q else "")
        if s not in seen:
            seen.append(s)
    return "、".join(seen[:4]) + (f" 他{len(seen) - 4}件" if len(seen) > 4 else "")


CIRCLED = "①②③④⑤⑥⑦"


def _tags(p) -> str:
    keys = [k for k, _, _ in PERSPECTIVES]
    return "".join(CIRCLED[keys.index(k)] for k in p.perspectives if k in keys)


def _author(a) -> str:
    parts = [md(a["author"]), md(a["site_name"])]
    return " / ".join(p for p in parts if p) or "不明"


def write_report(db: Database, company: Company, stats: dict | None, out_dir: Path) -> Path:
    items = _load(db, company)
    relevant = [i for i in items if i["rel"].level in ("主題", "言及", "スニペットのみ")]
    def ranked(group):
        # 投資仮説らしさの高い順、同点なら新しい順
        group = sorted(group, key=lambda i: fmt_date(i["a"]["published_at"]).replace("不明", ""), reverse=True)
        return sorted(group, key=lambda i: -i["th"].score)

    personal = ranked([i for i in relevant if i["kind"] in PERSONAL_KINDS and i["a"]["source_type"] != "sns"])
    xposts = ranked([i for i in relevant if i["a"]["source_type"] == "sns"])
    others = ranked([i for i in relevant if i["kind"] not in PERSONAL_KINDS + ("投資以外の話題",)])
    offtopic = [i for i in relevant if i["kind"] == "投資以外の話題"]
    unrelated = [i for i in items if i["rel"].level == "無関係"]
    unfetched = [i for i in items if i["rel"].level == "未確認"]

    # 記事番号（A: 個人の見解, X: X投稿, N: ニュース等）
    for prefix, group in (("A", personal), ("X", xposts), ("N", others), ("Z", offtopic)):
        for n, i in enumerate(group, 1):
            i["id"] = f"{prefix}{n:02d}"

    L: list[str] = []
    w = L.append
    gen = datetime.now().strftime("%Y-%m-%d %H:%M")
    w(f"# {company.name}（{company.code}）投資仮説 収集資料")
    w("")
    w(f"- 生成日時: {gen}")
    w(f"- 対象銘柄に関連する記事: {len(relevant)} 件（個人の見解 {len(personal)} / X投稿 {len(xposts)} / ニュース・株価情報等 {len(others)} / 投資以外の話題 {len(offtopic)}）")
    w(f"- うち投資理由の記載あり〔システム判定〕: {sum(i['th'].has_reason for i in relevant)} 件、"
      f"カタリスト候補の記述あり: {sum(i['th'].has_catalyst for i in relevant)} 件")
    w("")
    w("## 0. この資料の読み方")
    w("")
    w("- **【原文】** と引用ブロック（`>`）は記事からの機械的な抜粋です。要約・言い換えはしていません。")
    w("- **〔システム判定〕** は本システムがキーワード規則で推測した分類です（観点の分類、保有判定、記事種別など）。誤分類があり得ます。")
    w("- 引用文末の「（見解）」は筆者の意見・推測表現を含む文、「（事実・数値）」は意見表現を含まない記述です。")
    w("- 引用文末の〔②⑥〕などは、その文が該当するとシステムが判定した観点です（下の凡例参照）。")
    w("- 観点の凡例: " + " ".join(label for _, label, _ in PERSPECTIVES))
    w("- 投資仮説の正しさは評価していません。記事の主張は必ず出典 URL と一次情報（決算短信・適時開示・有報）で確認してください。")
    w("- 記事の並び順は「投資仮説らしさ」の目安であり、主張の確からしさとは無関係です。")
    w("- 本文全文はローカルの SQLite にのみ保存しており、この資料には抜粋だけを載せています。")
    w("")

    # ---- 収集記事の一覧 ----
    w("## 1. 収集記事の一覧")
    w("")
    w("| No | 種別〔判定〕 | タイトル | 著者・ブログ | 公開日 | 保有・購入〔判定〕 | 抜粋のある観点 |")
    w("|---|---|---|---|---|---|---|")
    for i in personal + xposts + others:
        a = i["a"]
        title = md(a["title"])[:60] or "(タイトルなし)"
        persp = "".join(label[0] for key, label, _ in PERSPECTIVES if i["th"].by_perspective(key)) or "—"
        w(f"| {i['id']} | {i['kind']} | [{title}]({a['url']}) | {_author(a)[:30]} | {fmt_date(a['published_at'])} | "
          f"{i['th'].holding} | {persp} |")
    w("")
    w("観点の記号: " + " ".join(label for _, label, _ in PERSPECTIVES))
    w("")

    # ---- 記事ごとの抜粋 ----
    def article_section(i, max_quotes: int | None = None) -> None:
        a, th = i["a"], i["th"]
        w(f"### [{i['id']}] {md(a['title']) or '(タイトルなし)'}")
        w("")
        w(f"- URL: {a['url']}")
        w(f"- 著者・ブログ: {_author(a)}")
        w(f"- 公開日: {fmt_date(a['published_at'])} ／ 取得日: {fmt_date(a['fetched_at'])}")
        w(f"- 媒体〔判定〕: {SOURCE_LABEL.get(a['source_type'] or 'web', 'その他')} ／ 記事種別〔判定〕: {i['kind']}"
          f" ／ 関連度〔判定〕: {i['rel'].level}（{i['rel'].note}）")
        w(f"- 発見元: {_discovered_by(i['disc'])}")
        if a["fetch_status"] != "ok":
            w(f"- 取得状態: {status_label(a['fetch_status'])}")
        w(f"- 保有・購入の明言〔システム判定〕: **{th.holding}**")
        for ev in th.holding_evidence:
            w(f"  - 【原文】「{md(ev)[:240]}」")
        w("")
        if not th.passages:
            w("投資判断に関係する記述は抽出できませんでした（観点キーワードに該当なし）。")
            src = (a["body"] or i["snippets"] or "")
            if src:
                w("")
                w("冒頭部分【原文】:")
                w(quote_block(src[:300]))
            w("")
            return
        w("投資判断に関係する記述の抜粋【原文】（記事内の出現順）:")
        w("")
        ps = th.passages if max_quotes is None else th.passages[:max_quotes]
        for p in ps:
            w(quote_block(p.text) + ("（見解）" if p.is_view else "（事実・数値）") + f"〔{_tags(p)}〕")
            w("")
        w(f"出典: {a['url']}")
        w("")

    w("## 2. 個人投資家の見解（記事ごとの投資理由・根拠の抜粋）")
    w("")
    if not personal:
        w("該当する記事は見つかりませんでした。第7節の収集上の制約を確認してください。")
        w("")
    for i in personal:
        article_section(i)

    # ---- カタリスト横断 ----
    w("## 3. カタリスト候補に関する抜粋（全記事横断）")
    w("")
    w("記事の種別を問わず、⑥カタリスト候補に分類された文を集めています。発表済み事項か今後の変化かは原文と一次情報で確認してください。")
    w("")
    cat_rows = [(i, p) for i in personal + xposts + others for p in i["th"].by_perspective("catalyst")]
    if not cat_rows:
        w("確認できず")
    for i, p in cat_rows:
        w(f"- [{i['id']}] {i['kind']}〔判定〕 {fmt_date(i['a']['published_at'])}: 「{md(p.text)[:260]}」（{_author(i['a'])[:20]}） — {i['a']['url']}")
    w("")

    # ---- リスク横断 ----
    w("## 4. 投資仮説が崩れる条件・リスクに関する抜粋（個人の見解・X投稿）")
    w("")
    risk_rows = [(i, p) for i in personal + xposts for p in i["th"].by_perspective("risk")]
    if not risk_rows:
        w("確認できず")
    for i, p in risk_rows:
        w(f"- [{i['id']}] 「{md(p.text)[:260]}」 — {i['a']['url']}")
    w("")

    # ---- X ----
    w("## 5. X（旧Twitter）の公開投稿")
    w("")
    w("Yahoo!リアルタイム検索・Web検索の結果に表示された投稿本文です（x.com 本体は robots.txt により取得していません）。")
    w("")
    if not xposts:
        w("確認できず")
    for i in xposts:
        a = i["a"]
        w(f"- [{i['id']}] {fmt_date(a['published_at'])} {md(a['author']) or ''} 保有〔判定〕: {i['th'].holding}")
        w(f"  > {md(a['body'] or i['snippets'])[:400]}")
        w(f"  — {a['url']}")
    w("")

    # ---- ニュース等 ----
    w("## 6. ニュース・株価情報・その他（参考）")
    w("")
    w("個人の見解ではないと判定した記事です。会社開示の要約や株価情報が中心のため、抜粋は各記事2件までにしています。")
    w("")
    if not others:
        w("確認できず")
        w("")
    for i in others:
        article_section(i, max_quotes=2)

    # ---- 投資以外の話題 ----
    if offtopic:
        w("## 6-2. 銘柄名は出てくるが株式・投資の話題がない記事（参考・一覧のみ）")
        w("")
        w("製品・事業の紹介や趣味の記事など、株・投資に関する語が見つからなかった記事です。除外はせず一覧だけ載せます。")
        w("")
        for i in offtopic:
            w(f"- [{i['id']}] {md(i['a']['title'])[:70] or '(タイトルなし)'}（{_author(i['a'])[:25]}、{fmt_date(i['a']['published_at'])}） — {i['a']['url']}")
        w("")

    # ---- 制約 ----
    w("## 7. 取得できなかった情報・収集上の制約")
    w("")
    if stats:
        w(f"- 今回の実行: 処理時間 {stats.get('elapsed_sec')} 秒、新規発見 {stats.get('new_articles')} 件")
        w("- 検索経路別の結果（ok=結果あり / empty=0件 / failed=失敗 / blocked=アクセス制限 / cached=前回結果を再利用 / skipped=未使用）:")
        for k, v in sorted((stats.get("search") or {}).items()):
            parts = ", ".join(f"{s}={v[s]}" for s in ("ok", "empty", "failed", "blocked", "cached", "skipped") if v.get(s))
            w(f"  - {k}: {parts}（ヒット {v.get('hits', 0)} 件、新規 {v.get('new', 0)} 件）")
        f = stats.get("fetch") or {}
        if f:
            w("- 本文取得: " + ", ".join(f"{status_label(k)}={v}" for k, v in sorted(f.items()) if v))
        if stats.get("blocked_hosts"):
            w("- アクセス制限を検知して取得を中止したサイト: " + ", ".join(stats["blocked_hosts"].keys()))
        for line in diagnose(stats):
            w(f"- 診断: {line}")
    w("- 公式検索 API のキーが未設定の場合、Web 検索は ddgs 等の非公式経路に依存し、結果件数が日によって変動します。")
    w("- X の投稿は検索サービスに表示されたものだけで、網羅的ではありません。ログイン必須・有料記事・JavaScript 必須ページの本文は取得できません。")
    w("")
    failed = [i for i in items if i["a"]["fetch_status"] not in ("ok", "snippet_only", "short")]
    if failed:
        w(f"### 本文を取得できなかった記事（{len(failed)} 件）")
        w("")
        for i in failed[:60]:
            a = i["a"]
            w(f"- {md(a['title'])[:60] or '(タイトルなし)'} — {status_label(a['fetch_status'])} — {a['url']}")
            if i["snippets"]:
                w(f"  - 検索スニペット: {md(i['snippets'])[:200]}")
        w("")
    if unrelated or unfetched:
        w(f"### 対象銘柄への言及がないため除外した記事（{len(unrelated)} 件）")
        w("")
        w("本文・タイトルに会社名・証券コードが見つからなかった記事です（判定の検証用）。")
        w("")
        for i in unrelated[:80]:
            w(f"- {md(i['a']['title'])[:60] or '(タイトルなし)'} — {i['a']['url']}")
        w("")

    out_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", f"{company.code}_{company.name}")
    path = out_dir / f"{safe}_投資仮説.md"
    path.write_text("\n".join(L), encoding="utf-8")
    return path


def diagnose(stats: dict) -> list[str]:
    """収集件数が少ない理由を「検索失敗」「抽出失敗」「記事が少ない」で区別する。"""
    out = []
    search = stats.get("search") or {}
    tried = ok = failed = 0
    for k, v in search.items():
        if k.startswith(("rss", "blogsearch", "bloglist")):
            continue
        ok += v.get("ok", 0) + v.get("empty", 0) + v.get("cached", 0)
        failed += v.get("failed", 0) + v.get("blocked", 0)
    tried = ok + failed
    rate = ok / tried if tried else 0
    if tried == 0:
        out.append("検索を実行していません（全経路が無効またはキャッシュなし）。")
    elif rate < 0.5:
        out.append(f"検索の成功率が {rate:.0%} と低く、**検索に失敗した**ことが件数不足の主因の可能性があります。")
    else:
        out.append(f"検索の成功率は {rate:.0%} です。")
    f = stats.get("fetch") or {}
    gone = sum(v for k, v in f.items() if k in ("http_404", "http_410"))
    refused = sum(v for k, v in f.items() if k in ("robots_disallowed", "blocked", "host_blocked"))
    neutral = {"ok", "duplicate", "deferred_over_limit", "snippet_only", "http_404", "http_410",
               "robots_disallowed", "blocked", "host_blocked"}
    bad = sum(v for k, v in f.items() if k not in neutral)
    total_f = bad + f.get("ok", 0)
    if total_f >= 5 and bad / total_f > 0.3:
        out.append(f"本文取得の失敗（タイムアウト・接続エラー・本文が短い等）が {bad}/{total_f} 件と多く、"
                   "**抽出に失敗した**記事が件数不足に影響しています。")
    if gone:
        out.append(f"{gone} 件は削除済み（HTTP 404/410）でした。古いブックマーク等に由来し、抽出失敗ではありません。")
    if refused:
        out.append(f"{refused} 件は robots.txt またはアクセス制限により取得しませんでした（突破は試みていません）。")
    an = stats.get("analysis") or {}
    if rate >= 0.5 and an.get("has_reason", 0) < 3:
        out.append("検索・取得は概ね成功しているため、投資理由を書いた公開記事が**実際に少ない**可能性があります。")
    if f.get("deferred_over_limit"):
        out.append(f"取得上限のため {f['deferred_over_limit']} 件を次回実行に回しました。")
    return out
