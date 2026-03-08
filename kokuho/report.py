"""
report.py ─ HTML レポート生成
Jinja2 + Plotly
"""
from __future__ import annotations

import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATE_DIR = Path(__file__).parent / "templates"


def _plotly_bar_prefecture(pref_stats: list[dict]) -> str:
    """都道府県別達成率棒グラフ (Plotly JSON)"""
    # 表示は総数>0の都道府県のみ、達成率順
    data = [r for r in pref_stats if r["total"] > 0]
    prefectures = [r["prefecture"] for r in data]
    rates = [round(r["rate"] * 100, 1) for r in data]
    viewed = [r["viewed"] for r in data]
    total = [r["total"] for r in data]

    fig_data = {
        "data": [
            {
                "type": "bar",
                "x": prefectures,
                "y": rates,
                "text": [f"{v}/{t}" for v, t in zip(viewed, total)],
                "textposition": "outside",
                "marker": {
                    "color": rates,
                    "colorscale": "RdYlGn",
                    "cmin": 0,
                    "cmax": 100,
                    "showscale": False,
                },
                "hovertemplate": "%{x}<br>達成率: %{y}%<br>(%{text})<extra></extra>",
            }
        ],
        "layout": {
            "title": {"text": "都道府県別達成率（所在県基準）", "font": {"size": 16}},
            "xaxis": {"title": "", "tickangle": -45, "tickfont": {"size": 11}},
            "yaxis": {"title": "達成率 (%)", "range": [0, 110]},
            "margin": {"b": 120, "t": 60},
            "height": 420,
            "plot_bgcolor": "#fafafa",
            "paper_bgcolor": "#ffffff",
        },
    }
    return json.dumps(fig_data, ensure_ascii=False)


def _plotly_pie_category(cat_stats: list[dict]) -> str:
    """カテゴリ別（円グラフ）"""
    labels_viewed = []
    values_viewed = []
    labels_not = []
    values_not = []

    label_map = {"art": "美術工芸品", "architecture": "建造物"}
    for r in cat_stats:
        lbl = label_map.get(r["category"], r["category"])
        labels_viewed.append(f"{lbl} 観覧済")
        values_viewed.append(r["viewed"])
        labels_not.append(f"{lbl} 未達")
        values_not.append(r.get("not_viewed", r["total"] - r["viewed"]))

    fig_data = {
        "data": [
            {
                "type": "pie",
                "labels": labels_viewed + labels_not,
                "values": values_viewed + values_not,
                "hole": 0.4,
                "marker": {
                    "colors": ["#4CAF50", "#2196F3", "#FF9800", "#F44336"]
                },
                "textinfo": "label+value",
            }
        ],
        "layout": {
            "title": {"text": "カテゴリ別 観覧状況", "font": {"size": 15}},
            "height": 350,
            "margin": {"t": 50, "b": 20},
            "showlegend": True,
        },
    }
    return json.dumps(fig_data, ensure_ascii=False)


def _plotly_bar_type(type_stats: list[dict]) -> str:
    """種別別達成率棒グラフ"""
    data = [r for r in type_stats if r["total"] >= 2]  # 2件以上の種別のみ
    types = [r["type"] or "不明" for r in data]
    rates = [round(r["rate"] * 100, 1) for r in data]
    viewed = [r["viewed"] for r in data]
    total = [r["total"] for r in data]

    fig_data = {
        "data": [
            {
                "type": "bar",
                "x": types,
                "y": rates,
                "text": [f"{v}/{t}" for v, t in zip(viewed, total)],
                "textposition": "outside",
                "marker": {"color": "#5c6bc0"},
                "hovertemplate": "%{x}<br>達成率: %{y}%<br>(%{text})<extra></extra>",
            }
        ],
        "layout": {
            "title": {"text": "種別別達成率", "font": {"size": 15}},
            "xaxis": {"tickangle": -30, "tickfont": {"size": 11}},
            "yaxis": {"title": "達成率 (%)", "range": [0, 110]},
            "height": 360,
            "margin": {"b": 100, "t": 50},
            "plot_bgcolor": "#fafafa",
            "paper_bgcolor": "#ffffff",
        },
    }
    return json.dumps(fig_data, ensure_ascii=False)


def generate_html_report(
    overall: dict,
    pref_stats: list[dict],
    cat_stats: list[dict],
    type_stats: list[dict],
    not_viewed: list[dict],
) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=True,
    )
    template = env.get_template("report.html.j2")

    # グラフJSON
    chart_pref = _plotly_bar_prefecture(pref_stats)
    chart_cat  = _plotly_pie_category(cat_stats)
    chart_type = _plotly_bar_type(type_stats)

    # 都道府県フィルタ用リスト（未達一覧に存在する県のみ）
    pref_options = sorted({r["prefecture"] for r in not_viewed if r.get("prefecture")})

    return template.render(
        overall=overall,
        pref_stats=pref_stats,
        cat_stats=cat_stats,
        type_stats=type_stats,
        not_viewed=not_viewed,
        chart_pref=chart_pref,
        chart_cat=chart_cat,
        chart_type=chart_type,
        pref_options=pref_options,
        cat_label={"art": "美術工芸品", "architecture": "建造物"},
        generated_at=__import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
