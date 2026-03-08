"""
app.py ─ 国宝チェックリスト Streamlit GUI
起動: streamlit run app.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))
import db

# ================================================================
# ページ設定
# ================================================================
st.set_page_config(
    page_title="国宝チェックリスト",
    page_icon="🏯",
    layout="wide",
    initial_sidebar_state="expanded",
)

CAT_LABEL = {"art": "美術工芸品", "architecture": "建造物"}

# ── Map 用定数 ────────────────────────────────────────────────
GEOJSON_PATH = Path(__file__).parent / "data" / "japan_prefectures.geojson"

# 7 段階の離散色（0% / 1-20% / 21-40% / 41-60% / 61-80% / 81-99% / 100%）
BAND_COLORS = [
    "#D9D9D9",  # 0%       ─ 灰（未着手）
    "#C6DBEF",  # 1–20%   ─ 薄青
    "#6BAED6",  # 21–40%  ─ 青
    "#A1D99B",  # 41–60%  ─ 薄緑
    "#41AB5D",  # 61–80%  ─ 緑
    "#006D2C",  # 81–99%  ─ 濃緑
    "#FFD700",  # 100%    ─ ゴールド（コンプリート）
]
BAND_LABELS = ["0%", "1–20%", "21–40%", "41–60%", "61–80%", "81–99%", "100%"]
N_BANDS = len(BAND_COLORS)  # 7

# ================================================================
# セッション状態の初期化
# ================================================================
_DEFAULTS: dict = {
    "page": "dashboard",        # dashboard / map / treasures / detail / not_yet
    "treasure_id": None,        # 詳細表示中の国宝ID
    "prev_page": "treasures",   # 詳細から戻る先
    "map_selected_pref": None,  # Map でクリックされた都道府県
    "map_filters": (None, None),# Map の現在フィルタ（category, type）
}
for _k, _v in _DEFAULTS.items():
    if _k not in st.session_state:
        st.session_state[_k] = _v

db.init_db()


# ================================================================
# ナビゲーションヘルパー
# ================================================================
def goto(page: str, treasure_id: str | None = None) -> None:
    if treasure_id is not None:
        st.session_state.prev_page = st.session_state.page
        st.session_state.treasure_id = treasure_id
    else:
        st.session_state.treasure_id = None
    st.session_state.page = page


# ================================================================
# サイドバー
# ================================================================
with st.sidebar:
    st.markdown("### 🇯🇵 国宝チェックリスト")
    st.markdown("---")

    overall = db.get_overall_stats()
    st.metric(
        "達成率",
        f"{overall['rate'] * 100:.1f}%",
        f"{overall['viewed']} / {overall['total']} 件",
    )
    st.progress(overall["rate"])
    st.markdown("---")

    cur = st.session_state.page
    for _label, _key in [
        ("📊 Dashboard", "dashboard"),
        ("🗾 Map", "map"),
        ("📋 Treasures", "treasures"),
        ("🎯 Not Yet", "not_yet"),
    ]:
        _is_active = cur == _key or (
            cur == "detail" and st.session_state.prev_page == _key
        )
        if st.button(
            _label,
            width="stretch",
            type="primary" if _is_active else "secondary",
        ):
            goto(_key)
            st.rerun()


# ================================================================
# ページ: Dashboard
# ================================================================
def page_dashboard() -> None:
    st.title("📊 Dashboard")

    ov = db.get_overall_stats()
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("国宝総数", ov["total"])
    c2.metric("観覧済み", ov["viewed"])
    c3.metric("未達", ov["not_viewed"])
    c4.metric("達成率", f"{ov['rate'] * 100:.1f}%")
    st.progress(ov["rate"])
    st.markdown("---")

    col_left, col_right = st.columns([3, 2])

    with col_left:
        st.subheader("都道府県別達成率（所在県基準）")
        pref_stats = db.get_prefecture_stats()
        pref_data = [r for r in pref_stats if r["total"] > 0]
        df_pref = pd.DataFrame(pref_data)
        df_pref["rate_pct"] = (df_pref["rate"] * 100).round(1)
        df_pref["label"] = df_pref.apply(
            lambda r: f"{r['viewed']}/{r['total']}", axis=1
        )
        fig = px.bar(
            df_pref,
            x="prefecture",
            y="rate_pct",
            text="label",
            color="rate_pct",
            color_continuous_scale="RdYlGn",
            range_color=[0, 100],
            labels={"prefecture": "", "rate_pct": "達成率 (%)"},
            height=430,
        )
        fig.update_layout(
            coloraxis_showscale=False,
            margin=dict(b=130, t=30),
            plot_bgcolor="#fafafa",
        )
        fig.update_xaxes(tickangle=-45)
        st.plotly_chart(fig, width="stretch")

    with col_right:
        st.subheader("カテゴリ別")
        cat_stats = db.get_category_stats()
        labels, values, colors = [], [], []
        palette = {
            "art_viewed": "#4CAF50", "art_not": "#EF9A9A",
            "arch_viewed": "#2196F3", "arch_not": "#90CAF9",
        }
        for r in cat_stats:
            lbl = CAT_LABEL.get(r["category"], r["category"])
            ck = "art" if r["category"] == "art" else "arch"
            labels += [f"{lbl} 観覧済", f"{lbl} 未達"]
            values += [r["viewed"], r["not_viewed"]]
            colors += [palette[f"{ck}_viewed"], palette[f"{ck}_not"]]

        fig_pie = go.Figure(go.Pie(
            labels=labels, values=values, hole=0.4,
            marker_colors=colors, textinfo="label+value",
        ))
        fig_pie.update_layout(height=300, margin=dict(t=20, b=10))
        st.plotly_chart(fig_pie, width="stretch")

        st.subheader("種別別達成率")
        type_stats = db.get_type_stats()
        df_type = pd.DataFrame([r for r in type_stats if r["total"] >= 2])
        if not df_type.empty:
            df_type["rate_pct"] = (df_type["rate"] * 100).round(1)
            df_type["type"] = df_type["type"].fillna("不明")
            fig_t = px.bar(
                df_type.head(15),
                x="type", y="rate_pct",
                labels={"type": "", "rate_pct": "達成率 (%)"},
                color_discrete_sequence=["#5c6bc0"],
                height=280,
            )
            fig_t.update_layout(margin=dict(b=80, t=20))
            fig_t.update_xaxes(tickangle=-30)
            st.plotly_chart(fig_t, width="stretch")

    st.markdown("---")
    st.subheader("最近の閲覧ログ（最新10件）")
    recent = db.get_recent_view_logs(10)
    if recent:
        df_r = pd.DataFrame([dict(r) for r in recent])[
            ["view_date", "treasure_name", "prefecture", "venue", "memo"]
        ]
        df_r.columns = ["観覧日", "国宝名", "都道府県", "場所", "メモ"]
        st.dataframe(df_r, width="stretch", hide_index=True)
    else:
        st.info("まだ観覧ログがありません")


# ================================================================
# ページ: Treasures（一覧）
# ================================================================
def page_treasures() -> None:
    st.title("📋 Treasures")

    all_rows = [dict(r) for r in db.get_all_with_status()]
    type_set = sorted({r["type"] for r in all_rows if r.get("type")})

    c1, c2, c3, c4, c5 = st.columns([3, 2, 2, 2, 1])
    kw       = c1.text_input("🔍 名称キーワード", key="t_kw")
    pref     = c2.selectbox("都道府県", ["（全て）"] + db.ALL_PREFECTURES, key="t_pref")
    cat      = c3.selectbox("カテゴリ", ["（全て）", "美術工芸品", "建造物"], key="t_cat")
    type_sel = c4.selectbox("種別", ["（全て）"] + type_set, key="t_type")
    not_only = c5.checkbox("未達のみ", key="t_not_only")

    rows = all_rows
    if kw:
        rows = [r for r in rows if kw in r["name"]]
    if pref != "（全て）":
        rows = [r for r in rows if r["prefecture"] == pref]
    if cat != "（全て）":
        cv = "art" if cat == "美術工芸品" else "architecture"
        rows = [r for r in rows if r["category"] == cv]
    if type_sel != "（全て）":
        rows = [r for r in rows if r["type"] == type_sel]
    if not_only:
        rows = [r for r in rows if not r["viewed"]]

    st.caption(f"{len(rows)} 件")
    if not rows:
        st.info("該当する国宝が見つかりません")
        return

    df = pd.DataFrame([{
        "都道府県": r["prefecture"],
        "名称": r["name"],
        "カテゴリ": CAT_LABEL.get(r["category"], r["category"]),
        "種別": r["type"] or "",
        "達成": "✅" if r["viewed"] else "─",
        "初見日": r["first_view_date"] or "",
        "_id": r["id"],
    } for r in rows])

    disp = ["都道府県", "名称", "カテゴリ", "種別", "達成", "初見日"]
    event = st.dataframe(
        df[disp + ["_id"]],
        width="stretch",
        hide_index=True,
        column_config={"_id": None},
        on_select="rerun",
        selection_mode="single-row",
    )

    sel_rows = event.selection.rows if event and event.selection else []
    if sel_rows:
        sel_id = df.iloc[sel_rows[0]]["_id"]
        sel_name = df.iloc[sel_rows[0]]["名称"]
        st.success(f"選択中: {sel_name}")
        if st.button("📄 詳細を見る", type="primary"):
            goto("detail", treasure_id=sel_id)
            st.rerun()


# ================================================================
# ページ: Treasure Detail（詳細）
# ================================================================
def page_detail() -> None:
    tid = st.session_state.treasure_id
    if not tid:
        st.warning("国宝が選択されていません")
        return

    treasure = db.get_treasure_by_id(tid)
    if not treasure:
        st.error("国宝が見つかりません")
        return
    t = dict(treasure)

    if st.button("← 一覧に戻る"):
        goto(st.session_state.prev_page)
        st.rerun()

    st.title(t["name"])

    # ── マスタ情報 ──────────────────────────────────────────
    st.subheader("マスタ情報")
    c1, c2, c3 = st.columns(3)
    c1.markdown(f"**都道府県:** {t['prefecture']}")
    c1.markdown(f"**市区町村:** {t.get('city') or '─'}")
    c2.markdown(f"**カテゴリ:** {CAT_LABEL.get(t['category'], t['category'])}")
    c2.markdown(f"**種別:** {t.get('type') or '─'}")
    c3.markdown(f"**所蔵者:** {t.get('holder') or '─'}")
    c3.markdown(f"**施設:** {t.get('facility') or '─'}")

    st.markdown("---")

    # ── 新規観覧ログ入力フォーム ────────────────────────────
    st.subheader("「見た」を記録する ✅")
    with st.form("add_view_form", clear_on_submit=True):
        f_date  = st.date_input("観覧日", value=date.today())
        f_venue = st.text_input("場所")
        f_memo  = st.text_area("メモ", height=80)
        f_ev    = st.text_input("写真パス/URL")
        if st.form_submit_button("保存", type="primary"):
            db.add_view_log(tid, str(f_date), f_venue, f_memo, f_ev)
            st.success("記録しました！")
            st.rerun()

    st.markdown("---")

    # ── 閲覧ログ一覧（編集・削除）──────────────────────────
    logs = db.get_view_logs_for_treasure(tid)
    st.subheader(f"閲覧ログ（{len(logs)} 件）")
    if not logs:
        st.info("まだ観覧ログがありません")
        return

    for raw_lg in logs:
        lg = dict(raw_lg)
        header = f"📅 {lg['view_date']}"
        if lg.get("venue"):
            header += f"　{lg['venue']}"
        if lg.get("memo"):
            header += f"　{lg['memo']}"
        with st.expander(header):
            with st.form(key=f"edit_{lg['log_id']}"):
                ed_date  = st.date_input(
                    "観覧日", value=date.fromisoformat(lg["view_date"])
                )
                ed_venue = st.text_input("場所", value=lg.get("venue") or "")
                ed_memo  = st.text_area(
                    "メモ", value=lg.get("memo") or "", height=70
                )
                ed_ev    = st.text_input(
                    "写真/URL", value=lg.get("evidence") or ""
                )
                col_upd, col_del, _ = st.columns([1, 1, 4])
                if col_upd.form_submit_button("💾 更新", type="primary"):
                    db.update_view_log(
                        lg["log_id"], str(ed_date), ed_venue, ed_memo, ed_ev
                    )
                    st.success("更新しました")
                    st.rerun()
                if col_del.form_submit_button("🗑 削除"):
                    db.delete_view_log(lg["log_id"])
                    st.success("削除しました")
                    st.rerun()


# ================================================================
# ページ: Not Yet（未達）
# ================================================================
def page_not_yet() -> None:
    st.title("🎯 Not Yet ─ 未達一覧")

    pref_stats = db.get_prefecture_stats()
    not_yet = sorted(
        [r for r in pref_stats if r["not_viewed"] > 0],
        key=lambda x: -x["not_viewed"],
    )

    # ── 次に攻める県の提案 ────────────────────────────────
    st.subheader("🗺 次に攻める県（未達数順）")
    top5 = not_yet[:5]
    if top5:
        cols = st.columns(len(top5))
        for i, r in enumerate(top5):
            cols[i].metric(
                r["prefecture"],
                f"未達 {r['not_viewed']}件",
                f"達成率 {r['rate'] * 100:.0f}%",
                delta_color="inverse",
            )

    st.markdown("---")

    # ── 都道府県フィルタ ──────────────────────────────────
    pref_opts = ["全都道府県"] + [r["prefecture"] for r in not_yet]
    selected_pref = st.selectbox("都道府県を選ぶ", pref_opts, key="ny_pref")
    pref_filter = None if selected_pref == "全都道府県" else selected_pref

    nv_rows = db.get_not_viewed(pref_filter)
    st.caption(f"{len(nv_rows)} 件の未達国宝")

    if not nv_rows:
        st.balloons()
        st.success("この都道府県の国宝は全て観覧済みです！🎉")
        return

    df = pd.DataFrame([{
        "都道府県": dict(r)["prefecture"],
        "カテゴリ": CAT_LABEL.get(dict(r)["category"], dict(r)["category"]),
        "種別": dict(r).get("type") or "",
        "名称": dict(r)["name"],
        "所蔵者": dict(r).get("holder") or "",
        "施設": dict(r).get("facility") or "",
        "_id": dict(r)["id"],
    } for r in nv_rows])

    disp = ["都道府県", "カテゴリ", "種別", "名称", "所蔵者", "施設"]
    event = st.dataframe(
        df[disp + ["_id"]],
        width="stretch",
        hide_index=True,
        column_config={"_id": None},
        on_select="rerun",
        selection_mode="single-row",
    )

    sel_rows = event.selection.rows if event and event.selection else []
    if sel_rows:
        sel_id = df.iloc[sel_rows[0]]["_id"]
        sel_name = df.iloc[sel_rows[0]]["名称"]
        st.success(f"選択中: {sel_name}")
        if st.button("📄 詳細を見る / 「見た」を記録する", type="primary"):
            goto("detail", treasure_id=sel_id)
            st.rerun()


# ================================================================
# ページ: Map（コロプレス）
# ================================================================
@st.cache_resource
def load_geojson() -> dict:
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def rate_to_band(rate: float) -> int:
    if rate == 0.0:   return 0
    elif rate <= 0.20: return 1
    elif rate <= 0.40: return 2
    elif rate <= 0.60: return 3
    elif rate <= 0.80: return 4
    elif rate < 1.0:   return 5
    else:              return 6


def build_discrete_colorscale() -> list:
    """隣接エントリを重複させて離散ステップを作る Plotly colorscale"""
    n = N_BANDS - 1  # 正規化の分母（= 6）
    cs: list = []
    for i, c in enumerate(BAND_COLORS):
        lo = i / n
        cs.append([lo, c])
        if i < n:
            cs.append([(i + 1) / n, c])  # 次のバンドが始まるまで同色を保持
    return cs


def page_map() -> None:
    st.title("🗾 Map ─ 都道府県別達成率")

    # ── フィルタ ─────────────────────────────────────────────
    type_list = sorted({r["type"] for r in db.get_type_stats() if r.get("type")})
    c1, c2 = st.columns([2, 3])
    cat_sel  = c1.selectbox("カテゴリ", ["（全て）", "美術工芸品", "建造物"], key="map_cat")
    type_sel = c2.selectbox("種別", ["（全て）"] + type_list, key="map_type")

    cat_filter  = None if cat_sel == "（全て）" else ("art" if cat_sel == "美術工芸品" else "architecture")
    type_filter = None if type_sel == "（全て）" else type_sel

    # フィルタ変更時は選択クリア
    cur_filters = (cat_filter, type_filter)
    if st.session_state.map_filters != cur_filters:
        st.session_state.map_selected_pref = None
        st.session_state.map_filters = cur_filters

    # ── 統計（フィルタ適用） ──────────────────────────────────
    pref_stats = db.get_prefecture_stats_filtered(cat_filter, type_filter)

    df_map = pd.DataFrame([{
        "prefecture": r["prefecture"],
        "total":      r["total"],
        "viewed":     r["viewed"],
        "not_viewed": r["not_viewed"],
        "rate_pct":   round(r["rate"] * 100, 1),
        "band":       rate_to_band(r["rate"]),
        "band_label": BAND_LABELS[rate_to_band(r["rate"])],
    } for r in pref_stats])

    # ── Plotly Choropleth ─────────────────────────────────────
    geojson = load_geojson()
    cs = build_discrete_colorscale()

    fig = go.Figure(go.Choropleth(
        geojson=geojson,
        locations=df_map["prefecture"],
        z=df_map["band"],
        featureidkey="properties.nam_ja",
        colorscale=cs,
        zmin=0,
        zmax=N_BANDS - 1,
        colorbar=dict(
            title=dict(text="達成率", side="right"),
            tickvals=list(range(N_BANDS)),
            ticktext=BAND_LABELS,
            thickness=14,
            len=0.65,
            x=1.01,
        ),
        hovertemplate=(
            "<b>%{location}</b><br>"
            "達成率: %{customdata[0]:.1f}%<br>"
            "見た: %{customdata[1]} / 総数: %{customdata[2]}<br>"
            "段階: %{customdata[3]}"
            "<extra></extra>"
        ),
        customdata=df_map[["rate_pct", "viewed", "total", "band_label"]].values,
        marker_line_color="white",
        marker_line_width=0.5,
    ))

    fig.update_geos(
        visible=True,
        resolution=50,
        showland=True,
        landcolor="#f0f0ed",
        showocean=True,
        oceancolor="#d6eaf8",
        showcoastlines=True,
        coastlinecolor="white",
        coastlinewidth=0.5,
        showlakes=False,
        fitbounds="locations",
        projection_type="mercator",
    )
    fig.update_layout(
        height=580,
        margin=dict(l=0, r=60, t=20, b=0),
    )

    event = st.plotly_chart(fig, on_select="rerun", width="stretch")

    # クリックされた都道府県を保存
    if event and event.selection and event.selection.points:
        clicked_loc = event.selection.points[0].get("location")
        if clicked_loc:
            st.session_state.map_selected_pref = clicked_loc

    # ── サマリ ───────────────────────────────────────────────
    st.markdown("---")
    with_data = [r for r in pref_stats if r["total"] > 0]
    achieved  = sum(1 for r in with_data if r["viewed"] > 0)
    completed = sum(1 for r in with_data if r["rate"] == 1.0)

    sc1, sc2, sc3 = st.columns(3)
    sc1.metric("国宝がある県数", len(with_data))
    sc2.metric("攻略済み県数（> 0%）", achieved, f"/ {len(with_data)}")
    sc3.metric("コンプリート県数（100%）", completed)

    # ── クリックした県の未達一覧 ─────────────────────────────
    selected = st.session_state.map_selected_pref
    if not selected:
        st.caption("地図上の県をクリックすると未達一覧を表示します")
        return

    st.markdown("---")
    st.subheader(f"📋 {selected} の未達国宝")

    nv_rows = db.get_not_viewed(
        prefecture=selected,
        category=cat_filter,
        type_filter=type_filter,
    )

    if not nv_rows:
        st.success(f"🎉 {selected} の国宝は（フィルタ条件内で）全て観覧済みです！")
        return

    df_nv = pd.DataFrame([{
        "カテゴリ": CAT_LABEL.get(dict(r)["category"], dict(r)["category"]),
        "種別":    dict(r).get("type") or "",
        "名称":    dict(r)["name"],
        "所蔵者":  dict(r).get("holder") or "",
        "施設":    dict(r).get("facility") or "",
        "_id":    dict(r)["id"],
    } for r in nv_rows])

    st.caption(f"{len(df_nv)} 件")
    disp = ["カテゴリ", "種別", "名称", "所蔵者", "施設"]
    ev2 = st.dataframe(
        df_nv[disp + ["_id"]],
        width="stretch",
        hide_index=True,
        column_config={"_id": None},
        on_select="rerun",
        selection_mode="single-row",
    )
    sel2 = ev2.selection.rows if ev2 and ev2.selection else []
    if sel2:
        sel_id   = df_nv.iloc[sel2[0]]["_id"]
        sel_name = df_nv.iloc[sel2[0]]["名称"]
        st.success(f"選択中: {sel_name}")
        if st.button("📄 詳細を見る", type="primary", key="map_detail_btn"):
            goto("detail", treasure_id=sel_id)
            st.rerun()


# ================================================================
# ルーティング
# ================================================================
_page = st.session_state.page
if _page == "dashboard":
    page_dashboard()
elif _page == "map":
    page_map()
elif _page == "treasures":
    page_treasures()
elif _page == "detail":
    page_detail()
elif _page == "not_yet":
    page_not_yet()
