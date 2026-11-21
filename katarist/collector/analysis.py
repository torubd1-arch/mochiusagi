"""関連度判定と投資仮説の抽出（ルールベース。AI API は使わない）。

方針:
- 関連度（対象銘柄の記事か）と投資仮説の評価は分離する。
- 投資用語が少ないことを理由に記事を除外しない。除外するのは「対象銘柄に一切言及がない」場合だけ。
- 抽出した文は原文のまま保持する。観点の分類・保有判定はシステムの推測であり、出力でもそう明示する。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .company import Company, nfkc

# ---------------------------------------------------------------------------
# 関連度
# ---------------------------------------------------------------------------

BRACKET_CODE_RE = re.compile(r"[【(\[（［〔<＜]\s*(\d{4}|\d{3}[A-Z])\s*[】)\]）］〕>＞]")
# 「2750 石光商事」のように行頭に証券コード＋銘柄名が並ぶ形式
LINE_CODE_RE = re.compile(r"(?m)^[\s・\-*•>]*(\d{4}|\d{3}[A-Z])[\s:：]+(?=[^\s\d,.%円年月日株])")


def _code_patterns(company: Company) -> list[re.Pattern]:
    c = re.escape(company.code)
    names = "|".join(re.escape(n) for n in company.match_names)
    return [
        re.compile(rf"[【(\[（［〔<＜]\s*{c}\s*(?:\.T|/T|:JP)?\s*[】)\]）］〕>＞]"),
        re.compile(rf"(?:証券コード|コード|東証\S{{0,6}}|銘柄)\s*[:：]?\s*{c}(?![0-9])"),
        re.compile(rf"[#＃$＄]{c}(?![0-9])"),
        re.compile(rf"(?<![0-9,.\-/:¥$]){c}\s*[ 　:：]?\s*(?:{names})"),
        re.compile(rf"(?:{names})\s*[ 　:：、]?\s*{c}(?![0-9])"),
    ]


def count_mentions(text: str, company: Company) -> int:
    t = nfkc(text)
    n = sum(t.count(name) for name in company.match_names)
    if n == 0:
        n = sum(len(p.findall(t)) for p in _code_patterns(company))
    return n


def mentions(text: str, company: Company) -> bool:
    return count_mentions(text, company) > 0


def other_codes(text: str, company: Company) -> set[str]:
    t = nfkc(text)
    return {c for c in BRACKET_CODE_RE.findall(t) + LINE_CODE_RE.findall(t) if c != company.code}


@dataclass
class Relevance:
    level: str          # 主題 / 言及 / スニペットのみ / 無関係 / 未確認
    mention_count: int
    note: str


def assess_relevance(company: Company, title: str, body: str, snippet: str = "") -> Relevance:
    title_hit = mentions(title, company)
    if not body:
        if title_hit or mentions(snippet, company):
            return Relevance("スニペットのみ", 0, "本文未取得。タイトル・検索スニペットに銘柄名あり")
        return Relevance("未確認", 0, "本文未取得。スニペットにも銘柄名なし")
    n = count_mentions(body, company)
    others = other_codes(body, company)
    note = f"本文中の言及 {n} 回" + (f"、他銘柄コード {len(others)} 種" if others else "")
    if n == 0:
        if title_hit:
            return Relevance("言及", 0, "タイトルのみに銘柄名（本文抽出漏れの可能性）")
        return Relevance("無関係", 0, "本文・タイトルに銘柄名・コードなし")
    if title_hit or (n >= 3 and len(others) < 5) or n >= 6:
        return Relevance("主題", n, note)
    return Relevance("言及", n, note)


# ---------------------------------------------------------------------------
# 記事の種類（並び順と統計用）
# ---------------------------------------------------------------------------

FIRST_PERSON_RE = re.compile(r"私|僕|わたし|ぼく|自分|筆者|ワイ|俺|うちの|我が家")
OPINION_RE = re.compile(
    r"思います|思う|思っ|考えます|考えて|考える|でしょう|だろう|気がし|期待して|注目して|見ています|"
    r"判断し|狙い|妙味|はず|かもしれ|と見る|と見て|個人的|印象"
)
AUTO_PAGE_TITLE_RE = re.compile(r"株価|チャート|掲示板|時系列|配当金|株主優待|銘柄情報|基本情報|決算速報|適時開示")


STOCK_CONTEXT_RE = re.compile(
    r"株|投資|銘柄|配当|決算|PER|PBR|ROE|利回り|東証|時価総額|業績|ポートフォリオ|NISA|上方修正|下方修正|"
    r"増配|減配|含み益|含み損|S高|ストップ高|ストップ安|権利確定|IR|売買|買い増|損切|利確|証券"
)
COMPANY_SUFFIX_RE = re.compile(r"株式会社|\(株\)|㈱")


def has_stock_context(title: str, body: str) -> bool:
    """株式・投資の話題が一語でもあるか。社名の「株式会社」は除いて判定する。"""
    return bool(STOCK_CONTEXT_RE.search(COMPANY_SUFFIX_RE.sub("", nfkc(title + "\n" + body))))


def content_kind(source_type: str, title: str, body: str) -> str:
    if (body or title) and not has_stock_context(title, body):
        return "投資以外の話題"
    if source_type == "sns":
        return "X等"
    if source_type == "forum":
        return "掲示板"
    if source_type == "news":
        return "ニュース・株価情報"
    head = nfkc(body[:20000])
    markers = len(FIRST_PERSON_RE.findall(head)) + len(OPINION_RE.findall(head))
    if source_type in ("blog", "note"):
        if markers == 0 and AUTO_PAGE_TITLE_RE.search(title or ""):
            return "ニュース・株価情報"
        return "個人の見解"
    return "個人の見解" if markers >= 3 else "その他"


# ---------------------------------------------------------------------------
# 投資仮説の抽出
# ---------------------------------------------------------------------------

PERSPECTIVES: list[tuple[str, str, re.Pattern]] = [
    ("buy_reason", "① 買った理由・投資理由", re.compile(
        r"買った理由|購入理由|投資理由|保有理由|買いの理由|購入した理由|買った決め手|購入の決め手|"
        r"(?:買|購入|保有|投資|注目|仕込)[^。]{0,25}(?:理由|ため|から|ので|と判断|と考え)|"
        r"(?:理由|ポイント)は[^。]{0,10}(?:\d|つ|以下|次)|投資妙味|(?:銘柄|株)としての魅力|"
        r"(?:新規|打診)(?:買い|購入)|買い増し|PF入り|ポートフォリオ(?:入り|に追加|に組み入れ)")),
    ("valuation", "② 割安と判断する根拠", re.compile(
        r"割安|PER|PBR|EV/EBITDA|EV/EBIT|時価総額|ネットキャッシュ|ネットネット|清算価値|解散価値|"
        r"含み益|含み資産|益回り|理論株価|適正株価|目標株価|妥当株価|バリュエーション|過小評価|見直し余地|"
        r"倍(?:台|程度|前後|水準)|PSR|FCF利回り|配当利回り")),
    ("downside", "③ 財務安全性・下値余地", re.compile(
        r"自己資本比率|無借金|実質無借金|現預金|現金同等|有利子負債|ネットキャッシュ|下値|下支え|"
        r"安全域|安全マージン|BPS|1株(?:当たり)?純資産|純資産|投資有価証券|政策保有株|含み益|"
        r"不動産|財務(?:基盤|体質|健全|安全)|潰れ|倒産|下落余地|下方硬直")),
    ("earnings", "④ 業績改善のシナリオ", re.compile(
        r"増収|増益|黒字化|黒字転換|利益率|営業利益|経常利益|受注(?:残|高)?|上方修正|会社予想|会社計画|"
        r"進捗率?|ガイダンス|保守的|過去最高|最高益|回復|改善|V字|単価|数量|稼働率|需要|新製品|"
        r"シェア|市場拡大|コスト削減|固定費|採算|利益成長|成長ドライバー|業績拡大|ストック収益|リカーリング")),
    ("capital", "⑤ 株主還元・資本配分", re.compile(
        r"増配|配当方針|配当性向|DOE|累進配当|自社株買い|自己株式|消却|株主還元|総還元|株主優待|"
        r"資本効率|ROE|ROIC|資本コスト|PBR1倍|政策保有株(?:の)?(?:売却|縮減|削減)|持ち合い解消|"
        r"資本配分|キャピタルアロケーション|成長投資|余剰資金|内部留保")),
    ("catalyst", "⑥ カタリスト候補", re.compile(
        r"カタリスト|M&A|買収|TOB|MBO|完全子会社|親子上場|再編|経営統合|事業売却|事業譲渡|撤退|"
        r"スピンオフ|値上げ|価格改定|価格転嫁|中期経営計画|中計|アクティビスト|物言う株主|大量保有|"
        r"株主提案|指数(?:への)?採用|東証の要請|新工場|増産|大型受注|受注獲得|IR強化|市場変更|"
        r"株式分割|業績予想の修正|上方修正|材料視|見直し買い|テーマ|政策|補助金|規制緩和|万博|再開発|"
        r"新規事業|提携|資本業務提携|上場廃止|非公開化")),
    ("risk", "⑦ 投資仮説が崩れる条件・リスク", re.compile(
        r"リスク|懸念|不安|下方修正|減益|赤字|減配|バリュートラップ|シクリカル|景気|市況|為替|原材料|"
        r"競争激化|希薄化|増資|撤退(?:します|しました)|崩れ|想定外|"
        r"(?:もし|仮に)[^。]{0,40}(?:なら|れば|場合)|場合は売|売る条件|注意点|弱み|課題")),
]
PERSPECTIVE_LABEL = {k: label for k, label, _ in PERSPECTIVES}

BUY_RE = re.compile(
    r"買いました|購入しました|買い増し(?:しました|した|て|ました)?|新規(?:で)?(?:購入|買い|IN|イン)|打診買い|"
    r"(?:買|購入し)(?:った|ってみ|い付けました)|保有(?:しています|している|してます|中|継続)|"
    r"ホールド(?:中|継続|します)|PF(?:入り|に追加|イン)|ポートフォリオ(?:入り|に追加|に組み入れ)|"
    r"仕込(?:みました|んだ|んでいます|みました)|NISAで(?:購入|買)|\d+株(?:を)?(?:購入|買|保有)|持ち株|主力銘柄|保有銘柄"
)
SELL_RE = re.compile(
    r"売却しました|売りました|全(?:株)?売却|利確(?:しました|した)|利益確定(?:しました|した)|"
    r"損切り(?:しました|した)|手放しました|(?:一部|全部)売却"
)
WATCH_RE = re.compile(r"監視銘柄|ウォッチ(?:リスト|中)|買い候補|購入を検討|様子見|気になる銘柄|狙っている")
NOT_SELF_RE = re.compile(r"大量保有|政策保有|保有比率|保有割合|筆頭株主|ファンドが|氏が|社が保有|保有株式|保有する(?:土地|不動産|株式)")
VIEW_RE = re.compile(
    r"思|考え|期待|見込|予想|判断|評価|注目|狙|はず|だろう|でしょう|かもしれ|可能性|と見|私|僕|自分|個人的|印象|妙味"
)

SENT_SPLIT_RE = re.compile(r"(?<=[。！？!?])")


@dataclass
class Passage:
    perspectives: list[str]   # 該当する観点（システム判定。1文に複数あり得る）
    text: str                 # 原文の抜粋
    is_view: bool             # 筆者の見解表現を含むか（含まなければ事実・数値の記述）
    pos: int


@dataclass
class Thesis:
    passages: list[Passage] = field(default_factory=list)
    holding: str = "記載なし"
    holding_evidence: list[str] = field(default_factory=list)
    score: int = 0
    has_reason: bool = False
    has_catalyst: bool = False

    def by_perspective(self, key: str) -> list[Passage]:
        return [p for p in self.passages if key in p.perspectives]

    @property
    def perspectives(self) -> list[str]:
        return [k for k, _, _ in PERSPECTIVES if self.by_perspective(k)]


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n+", text or "") if p.strip()]


def split_sentences(paragraph: str) -> list[str]:
    out = []
    for s in SENT_SPLIT_RE.split(paragraph):
        s = s.strip(" ・-*•●◆■□▼▲>　")
        if s:
            out.append(s)
    return out


def target_paragraphs(text: str, company: Company, whole: bool) -> list[tuple[int, str]]:
    """対象銘柄について書かれた段落だけを選ぶ（複数銘柄をまとめた記事での誤抽出を防ぐ）。"""
    paras = split_paragraphs(text)
    if whole:
        return list(enumerate(paras))
    picked: set[int] = set()
    for i, p in enumerate(paras):
        if not mentions(p, company):
            continue
        picked.add(i)
        if i > 0 and len(paras[i - 1]) < 40 and not other_codes(paras[i - 1], company):
            picked.add(i - 1)   # 直前の短い見出し
        for j in range(i + 1, min(len(paras), i + 5)):
            if other_codes(paras[j], company) and not mentions(paras[j], company):
                break   # 次の銘柄の話題に移った
            picked.add(j)
    return [(i, paras[i]) for i in sorted(picked)]


def _trim(sentence: str, start_at: int, limit: int = 320) -> str:
    if len(sentence) <= limit:
        return sentence
    start = max(0, start_at - limit // 2)
    return ("…" if start else "") + sentence[start:start + limit] + "…"


# 「レントを売却しました」のように、目的語が別銘柄の売買文を見分ける
OBJECT_TRADE_RE = re.compile(r"([^\s、。,.「」()（）]{2,15})を(?:\d+株)?(?:全部|一部|全株)?(?:売却|売り|買い|購入|買い増し|損切り|利確)")


def _trade_is_about_target(sent: str, recent: list[str], company: Company) -> bool:
    """売買・保有の文が対象銘柄についてのものか。"""
    if mentions(sent, company):
        return True
    m = OBJECT_TRADE_RE.search(sent)
    if m and not mentions(m.group(1), company) and m.group(1) not in ("株", "全て", "すべて", "これ", "それ", "同社", "当銘柄", "この銘柄"):
        return False   # 目的語が別の銘柄
    return any(mentions(r, company) for r in recent)


def extract_thesis(company: Company, text: str, relevance: str, kind: str, max_per_perspective: int = 3,
                   max_passages: int = 14) -> Thesis:
    th = Thesis()
    if relevance in ("無関係", "未確認") or not text:
        return th
    t = nfkc(text)
    whole = relevance == "主題" and len(other_codes(t, company)) < 5
    paras = target_paragraphs(t, company, whole)

    seen: set[str] = set()
    cands: list[Passage] = []
    evidence: list[tuple[str, str]] = []
    recent: list[str] = []
    pos = 0
    for _, para in paras:
        sents = split_sentences(para)
        for k, sent in enumerate(sents):
            pos += 1
            if len(sent) < 8:
                recent = (recent + [sent])[-2:]
                continue
            # 短すぎる文は次の文とつなげて文脈を補う
            ctx = sent if len(sent) >= 30 or k + 1 >= len(sents) else sent + sents[k + 1]
            # 保有・売買の判定（対象銘柄についての文に限る）
            if not NOT_SELF_RE.search(sent):
                kind_ev = ("sell" if SELL_RE.search(sent) else "buy" if BUY_RE.search(sent)
                           else "watch" if WATCH_RE.search(sent) else None)
                if kind_ev and _trade_is_about_target(sent, recent, company):
                    evidence.append((kind_ev, ctx))
            recent = (recent + [sent])[-2:]
            keys, first = [], None
            for key, _, rx in PERSPECTIVES:
                m = rx.search(sent)
                if m:
                    keys.append(key)
                    first = m.start() if first is None else min(first, m.start())
            if not keys:
                continue
            snippet = _trim(ctx, first or 0)
            sig = re.sub(r"\W", "", snippet)[:80]
            if sig in seen:
                continue
            seen.add(sig)
            cands.append(Passage(keys, snippet, bool(VIEW_RE.search(ctx)), pos))

    # 観点ごとに上位を選ぶ（見解表現を含む文を優先）。同じ文は1回だけ載せ、元の順序に戻す
    chosen: dict[int, Passage] = {}
    for key, _, _ in PERSPECTIVES:
        ps = [p for p in cands if key in p.perspectives]
        for p in sorted(ps, key=lambda p: (not p.is_view, p.pos))[:max_per_perspective]:
            chosen[p.pos] = p
    th.passages = sorted(chosen.values(), key=lambda p: p.pos)[:max_passages]

    kinds = {k for k, _ in evidence}
    if "buy" in kinds and "sell" in kinds:
        th.holding = "購入・売却の両方に言及"
    elif "buy" in kinds:
        th.holding = "保有・購入を明言"
    elif "sell" in kinds:
        th.holding = "売却を明言"
    elif "watch" in kinds:
        th.holding = "監視・検討中"
    order = {"buy": 0, "sell": 1, "watch": 2}
    th.holding_evidence = [s for _, s in sorted(evidence, key=lambda x: order[x[0]])][:3]

    # 並び順用のスコア（投資仮説の正しさの評価ではない）
    persp = th.perspectives
    views = sum(1 for p in th.passages if p.is_view and p.perspectives != ["risk"])
    score = len(persp) + min(views, 4)
    if "buy_reason" in persp:
        score += 2
    if th.holding in ("保有・購入を明言", "購入・売却の両方に言及"):
        score += 3
    if kind in ("個人の見解", "X等"):
        score += 2
    elif kind == "ニュース・株価情報":
        score -= 2
    th.score = max(score, 0)

    substantive = {"valuation", "downside", "earnings", "capital", "catalyst"} & set(persp)
    personal = kind in ("個人の見解", "X等", "掲示板")
    th.has_reason = personal and (
        "buy_reason" in persp
        or (th.holding != "記載なし" and bool(substantive))
        or (views >= 2 and len(substantive) >= 2)
    )
    th.has_catalyst = any("catalyst" in p.perspectives for p in th.passages)
    return th
