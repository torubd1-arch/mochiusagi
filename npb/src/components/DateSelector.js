/**
 * 画面上部の日付ナビゲーション。
 * ＜ 前日 / 日付(タップでカレンダー) / 翌日 ＞ ＋ 今日ボタン ＋ 最終更新時刻 ＋ 手動更新。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;

  const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

  function formatDateJa(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `${y}年${m}月${d}日（${WEEKDAY_JA[dt.getDay()]}）`;
  }

  function formatTimeJa(isoOrNull) {
    if (!isoOrNull) return "-";
    const d = new Date(isoOrNull);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function addDays(dateStr, delta) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  /**
   * @param {HTMLElement} container
   * @param {{date: string, lastUpdated: string|null, isToday: boolean, isRefreshing: boolean}} state
   * @param {{onDateChange: (date:string)=>void, onRefresh: ()=>void}} handlers
   */
  function renderDateSelector(container, state, handlers) {
    container.innerHTML = `
      <div class="date-nav">
        <button type="button" class="nav-btn" data-action="prev" aria-label="前日">＜</button>
        <button type="button" class="date-label" data-action="pick">${escapeHtml(formatDateJa(state.date))}</button>
        <button type="button" class="nav-btn" data-action="next" aria-label="翌日">＞</button>
      </div>
      <input type="date" class="date-picker-input" value="${escapeHtml(state.date)}" aria-label="日付を選択" />
      <div class="date-sub-row">
        <button type="button" class="today-btn ${state.isToday ? "is-active" : ""}" data-action="today">今日</button>
        <span class="last-updated">${state.isRefreshing ? "更新中…" : `最終更新 ${escapeHtml(formatTimeJa(state.lastUpdated))}`}</span>
        <button type="button" class="refresh-btn" data-action="refresh" aria-label="手動更新">⟳</button>
      </div>`;

    const picker = container.querySelector(".date-picker-input");

    container.querySelector('[data-action="prev"]').addEventListener("click", () => handlers.onDateChange(addDays(state.date, -1)));
    container.querySelector('[data-action="next"]').addEventListener("click", () => handlers.onDateChange(addDays(state.date, 1)));
    container.querySelector('[data-action="today"]').addEventListener("click", () => handlers.onDateChange(global.NPB.gameService.todayString()));
    container.querySelector('[data-action="refresh"]').addEventListener("click", () => handlers.onRefresh());
    container.querySelector('[data-action="pick"]').addEventListener("click", () => {
      if (typeof picker.showPicker === "function") picker.showPicker();
      else picker.focus();
    });
    picker.addEventListener("change", () => {
      if (picker.value) handlers.onDateChange(picker.value);
    });
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderDateSelector = renderDateSelector;
  global.NPB.components.formatDateJa = formatDateJa;
})(window);
