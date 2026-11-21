"""ネットワークに接続しない単体テスト。実行: python -m unittest discover -s tests"""

import base64
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.analysis import assess_relevance, content_kind, extract_thesis  # noqa: E402
from collector.blogs import detect_platform  # noqa: E402
from collector.company import Company, make_aliases  # noqa: E402
from collector.db import Database  # noqa: E402
from collector.discovery import Hit, _unwrap_bing, build_queries, WEB_QUERY_TEMPLATES, parse_feed  # noqa: E402
from collector.extract import body_hash, extract  # noqa: E402
from collector.report import diagnose, write_report  # noqa: E402
from collector.sources import source_type  # noqa: E402
from collector.urlnorm import fetch_url, site_root, url_key  # noqa: E402

TOYO = Company("6505", "東洋電機製造", make_aliases("東洋電機製造"))


class TestUrlNorm(unittest.TestCase):
    def test_tracking_and_scheme(self):
        a = url_key("http://www.example.com/post/1/?utm_source=x&fbclid=y#top")
        b = url_key("https://example.com/post/1")
        self.assertEqual(a, b)

    def test_language_variants_merge(self):
        self.assertEqual(url_key("https://kabutan.jp/en/news/?b=n1"), url_key("https://kabutan.jp/news/?b=n1"))
        self.assertEqual(url_key("https://example.com/a?hl=en"), url_key("https://example.com/a?hl=ja"))
        self.assertEqual(url_key("https://example.com/a/amp/"), url_key("https://example.com/a"))

    def test_wordpress_query_kept(self):
        self.assertNotEqual(url_key("https://soto-kouro.com/?p=3605"), url_key("https://soto-kouro.com/?p=3606"))

    def test_x_and_note(self):
        self.assertEqual(url_key("https://twitter.com/foo/status/123?s=20"), url_key("https://x.com/bar/status/123"))
        self.assertEqual(url_key("https://note.com/u/n/nabc123?magazine_key=m1"), "note.com/n/nabc123")

    def test_percent_encoding(self):
        self.assertEqual(url_key("https://a.blog.jp/%E9%89%84"), url_key("https://a.blog.jp/鉄"))

    def test_fetch_url_drops_lang_and_tracking(self):
        self.assertEqual(fetch_url("https://example.com/a?hl=en&utm_medium=x&id=3"), "https://example.com/a?id=3")
        self.assertEqual(fetch_url("https://note.com/u/n/nabc?hl=en"), "https://note.com/u/n/nabc")

    def test_site_root(self):
        self.assertEqual(site_root("https://note.com/abc/n/n123"), "https://note.com/abc/")
        self.assertEqual(site_root("https://foo.hatenablog.com/entry/2026/01/01"), "https://foo.hatenablog.com/")


class TestSources(unittest.TestCase):
    def test_types(self):
        self.assertEqual(source_type("https://pandapoint.hatenablog.com/entry/x"), "blog")
        self.assertEqual(source_type("https://note.com/a/n/n1"), "note")
        self.assertEqual(source_type("https://kabutan.jp/stock/?code=6505"), "news")
        self.assertEqual(source_type("https://minkabu.jp/stock/6505/bbs"), "forum")
        self.assertEqual(source_type("https://x.com/a/status/1"), "sns")
        self.assertEqual(source_type("https://example.com/a"), "web")


class TestCompany(unittest.TestCase):
    def test_aliases(self):
        self.assertIn("ABCHD", make_aliases("ABCホールディングス"))
        self.assertEqual(make_aliases("株式会社テスト"), ["テスト"])
        # 曖昧な略称は自動生成しない
        self.assertNotIn("東洋電機", make_aliases("東洋電機製造"))


class TestRelevance(unittest.TestCase):
    def test_subject(self):
        r = assess_relevance(TOYO, "東洋電機製造を買いました", "東洋電機製造について。" + "本文です。" * 10)
        self.assertEqual(r.level, "主題")
        # タイトルにしか社名がない場合は本文抽出漏れの可能性として「言及」に留める
        r = assess_relevance(TOYO, "東洋電機製造を買いました", "本文です。" * 10)
        self.assertEqual(r.level, "言及")

    def test_unrelated(self):
        r = assess_relevance(TOYO, "今日の相場", "日経平均が上昇した。" * 10)
        self.assertEqual(r.level, "無関係")

    def test_similar_company_not_matched(self):
        # 東洋電機（6655）は別会社
        r = assess_relevance(TOYO, "東洋電機【6655】の決算", "東洋電機の受注が伸びた。" * 5)
        self.assertEqual(r.level, "無関係")

    def test_code_with_context(self):
        r = assess_relevance(TOYO, "保有株まとめ", "【6505】は鉄道向けが好調。株価は6,505円ではない。")
        self.assertEqual(r.mention_count, 1)
        r2 = assess_relevance(TOYO, "相場", "売上高は6505百万円でした。")
        self.assertEqual(r2.level, "無関係")

    def test_snippet_only(self):
        r = assess_relevance(TOYO, "", "", "東洋電機製造の決算を見て買い増し")
        self.assertEqual(r.level, "スニペットのみ")


SAMPLE = """東洋電機製造(6505)を買いました。
購入理由は、PBRが0.5倍と割安で、ネットキャッシュが時価総額の半分あるからです。
鉄道車両向けの受注残が増えており、来期は増益に転じると考えています。
中期経営計画で配当性向40%を掲げ、増配と自社株買いが期待できます。
もし受注が減って下方修正となる場合は売却を検討します。
"""


class TestThesis(unittest.TestCase):
    def test_extract(self):
        th = extract_thesis(TOYO, SAMPLE, "主題", "個人の見解")
        self.assertEqual(th.holding, "保有・購入を明言")
        for key in ("buy_reason", "valuation", "earnings", "capital", "catalyst", "risk"):
            self.assertTrue(th.by_perspective(key), key)
        self.assertTrue(th.has_reason)
        self.assertTrue(th.has_catalyst)
        # 抜粋は原文そのもの
        for p in th.passages:
            self.assertIn(p.text.rstrip("…").lstrip("…")[:20], SAMPLE.replace("\n", ""))

    def test_multi_stock_window(self):
        text = ("今月の売買です。\n【7203】トヨタを買いました。PBRが割安です。\n"
                "【6505】東洋電機製造は監視銘柄です。受注が回復しています。\n"
                "【9984】ソフトバンクGを購入しました。")
        th = extract_thesis(TOYO, text, "言及", "個人の見解")
        texts = " ".join(p.text for p in th.passages)
        self.assertNotIn("トヨタ", texts)
        self.assertEqual(th.holding, "監視・検討中")

    def test_other_stock_trade_not_attributed(self):
        text = "金曜はレントを売却しました。代わりに東洋電機製造を500株買いました。増配が魅力です。"
        th = extract_thesis(TOYO, text, "主題", "個人の見解")
        self.assertEqual(th.holding, "保有・購入を明言")

    def test_one_sentence_multiple_tags(self):
        th = extract_thesis(TOYO, "東洋電機製造は上方修正に増配、自社株買いと材料が多い。", "主題", "個人の見解")
        self.assertEqual(len(th.passages), 1)
        self.assertGreaterEqual(len(th.passages[0].perspectives), 2)

    def test_offtopic(self):
        self.assertEqual(content_kind("blog", "電車の話", "東洋電機製造株式会社製のVVVFインバータを搭載。"), "投資以外の話題")
        self.assertEqual(content_kind("blog", "電車の話", "東洋電機製造の株価が上がった。"), "個人の見解")

    def test_line_code_list(self):
        text = ("大量保有報告まとめ\n2750 石光商事(大量保有:マリンフード)\n7603 ジーイエット(大量保有:Evo Fund)\n"
                "6505 東洋電機製造(大量保有:東日本旅客鉄道)\n4444 テスト(大量保有:某ファンド)\n5555 テスト2(TOB)\n6666 テスト3(TOB)")
        th = extract_thesis(TOYO, text, "主題", "個人の見解")
        joined = " ".join(p.text for p in th.passages)
        self.assertIn("東日本旅客鉄道", joined)
        self.assertNotIn("石光商事", joined)
        self.assertNotIn("テスト2", joined)

    def test_company_holdings_not_personal(self):
        th = extract_thesis(TOYO, "東洋電機製造は政策保有株式を保有しています。売却で資金が生まれる。", "主題", "個人の見解")
        self.assertEqual(th.holding, "記載なし")

    def test_unrelated_returns_empty(self):
        th = extract_thesis(TOYO, SAMPLE, "無関係", "個人の見解")
        self.assertEqual(th.passages, [])

    def test_kind(self):
        self.assertEqual(content_kind("news", "株価", "x"), "ニュース・株価情報")
        self.assertEqual(content_kind("blog", "投資日記", "私はこう思います"), "個人の見解")
        self.assertEqual(content_kind("web", "記事", "決算の事実だけ"), "その他")


class TestFeedAndSearch(unittest.TestCase):
    def test_rss1(self):
        xml = """<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <item rdf:about="https://a.hatenablog.com/entry/1"><title>東洋電機製造</title><link>https://a.hatenablog.com/entry/1</link>
        <description>買いました</description><dc:date>2026-01-01T00:00:00+09:00</dc:date></item></rdf:RDF>"""
        hits = parse_feed(xml)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].published[:10], "2026-01-01")

    def test_atom(self):
        xml = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>t</title>
        <link rel="alternate" href="https://b.example/1"/><author><name>me</name></author>
        <content type="html">&lt;p&gt;本文&lt;/p&gt;</content><published>2026-02-02</published></entry></feed>"""
        hits = parse_feed(xml)
        self.assertEqual(hits[0].url, "https://b.example/1")
        self.assertEqual(hits[0].author, "me")
        self.assertEqual(hits[0].snippet, "本文")

    def test_bing_unwrap(self):
        target = "https://example.com/x"
        enc = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
        self.assertEqual(_unwrap_bing(f"https://www.bing.com/ck/a?!&&p=1&u=a1{enc}&ntb=1"), target)

    def test_queries(self):
        qs = build_queries(WEB_QUERY_TEMPLATES, TOYO, ['"{name}" 値上げ'])
        self.assertIn('"東洋電機製造" 値上げ', qs)
        self.assertEqual(len(qs), len(set(qs)))

    def test_platform(self):
        self.assertEqual(detect_platform("https://x.hatenablog.com/").search_url, "https://x.hatenablog.com/search?q={q}")
        self.assertEqual(detect_platform("https://note.com/abc/").feed_url, "https://note.com/abc/rss")
        self.assertIsNone(detect_platform("https://ameblo.jp/abc/").feed_url)


class TestExtractAndDb(unittest.TestCase):
    def test_extract_html(self):
        html = """<html lang="ja"><head><title>東洋電機製造を買った理由</title>
        <link rel="canonical" href="https://a.example/p/1"><link rel="alternate" hreflang="en" href="https://a.example/en/p/1">
        <meta name="author" content="山田"></head><body><article><h1>東洋電機製造を買った理由</h1>
        """ + "<p>" + SAMPLE.replace("\n", "</p><p>") + "</p></article></body></html>"
        ex = extract(html, "https://a.example/p/1")
        self.assertIn("割安", ex.text)
        self.assertEqual(ex.canonical, "https://a.example/p/1")
        self.assertEqual(ex.alternates, ["https://a.example/en/p/1"])

    def test_body_hash(self):
        self.assertEqual(body_hash("あ" * 300), body_hash("あ " * 300))
        self.assertEqual(body_hash("短い"), "")

    def test_db_dedupe_and_report(self):
        with tempfile.TemporaryDirectory() as d:
            db = Database(Path(d) / "t.db")
            db.save_company("6505", "東洋電機製造", TOYO.aliases, "test")
            aid, new = db.upsert_article("https://a.example/p/1", url_key("https://a.example/p/1"), "t", "blog")
            self.assertTrue(new)
            aid2, new2 = db.upsert_article("http://www.a.example/p/1/?utm_source=x",
                                           url_key("http://www.a.example/p/1/?utm_source=x"), "t", "blog")
            self.assertEqual((aid, False), (aid2, new2))
            # 別名（英語版）登録 → 同じ URL が後から来ても同一記事
            self.assertIsNone(db.add_alias(url_key("https://a.example/en-us/p/1"), aid))
            self.assertEqual(db.find_article(url_key("https://a.example/en-us/p/1")), aid)
            db.link_stock(aid, "6505")
            db.add_discovery(aid, "6505", "web", "test", "q", 1, "t", "東洋電機製造", 1)
            db.x("UPDATE articles SET body=?, fetch_status='ok', title='東洋電機製造を買った理由' WHERE id=?", (SAMPLE, aid))
            db.commit()
            stats = {"elapsed_sec": 1, "new_articles": 1,
                     "search": {"web:ddgs_yahoo": {"ok": 3, "failed": 1, "hits": 10, "new": 5}},
                     "fetch": {"ok": 1}, "analysis": {"has_reason": 1}}
            path = write_report(db, TOYO, stats, Path(d))
            text = path.read_text(encoding="utf-8")
            self.assertIn("東洋電機製造（6505）", text)
            self.assertIn("保有・購入を明言", text)
            self.assertIn("https://a.example/p/1", text)
            self.assertIn("〔システム判定〕", text)
            db.close()

    def test_diagnose(self):
        lines = diagnose({"search": {"web:x": {"failed": 8, "ok": 1}}, "fetch": {}, "analysis": {}})
        self.assertTrue(any("検索に失敗" in x for x in lines))
        lines = diagnose({"search": {"web:x": {"ok": 9}}, "fetch": {"ok": 4, "timeout": 5, "http_404": 9}, "analysis": {"has_reason": 0}})
        self.assertTrue(any("抽出に失敗" in x for x in lines))
        self.assertTrue(any("実際に少ない" in x for x in lines))
        self.assertTrue(any("削除済み" in x for x in lines))
        lines = diagnose({"search": {"web:x": {"ok": 9}}, "fetch": {"ok": 3, "http_404": 10}, "analysis": {}})
        self.assertFalse(any("抽出に失敗" in x for x in lines))


if __name__ == "__main__":
    unittest.main()
