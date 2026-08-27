/**
 * エントリーポイント。日付ナビゲーション・当日の自動更新ポーリング・
 * URLへの日付保持(?date=YYYY-MM-DD) を統括する。
 *
 * データ取得元を切り替えたい場合は、下の `provider` の生成部分だけを
 * 差し替えればよい（例: new NPB.NpbProvider()）。UI・services 側は変更不要。
 */
(function () {
  "use strict";

  const provider = new NPB.MockProvider();
  const { getGamesForDate, todayString } = NPB.gameService;
  const { renderDateSelector, renderGameCard, formatDateJa } = NPB.components;
  const { nextPollIntervalMs } = NPB.cacheService;

  const dateNavEl = document.getElementById("date-nav");
  const gamesEl = document.getElementById("games");

  const state = {
    date: getDateFromUrl(),
    lastUpdated: null,
    isRefreshing: false,
    pollTimer: null,
  };

  function getDateFromUrl() {
    const params = new URLSearchParams(location.search);
    const d = params.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return todayString();
  }

  function updateUrl(date) {
    const params = new URLSearchParams(location.search);
    params.set("date", date);
    history.pushState({ date }, "", `${location.pathname}?${params.toString()}`);
  }

  function renderHeader() {
    renderDateSelector(
      dateNavEl,
      {
        date: state.date,
        lastUpdated: state.lastUpdated,
        isToday: state.date === todayString(),
        isRefreshing: state.isRefreshing,
      },
      {
        onDateChange: (d) => {
          if (d !== state.date) load(d);
        },
        onRefresh: () => load(state.date, { forceRefresh: true, pushUrl: false }),
      }
    );
  }

  function renderEmptyState(date) {
    const sampleDate = NPB.sampleData.TODAY_FIXTURE;
    const isSampleDate = date === sampleDate || date === NPB.sampleData.PAST_FIXTURE;
    gamesEl.innerHTML = `
      <p class="empty-note">この日の試合データはありません。</p>
      ${
        isSampleDate
          ? ""
          : `<p class="empty-hint">サンプルデータは <button type="button" class="link-btn" id="jump-sample">${formatDateJa(sampleDate)}</button> にあります。</p>`
      }`;
    const jumpBtn = document.getElementById("jump-sample");
    if (jumpBtn) jumpBtn.addEventListener("click", () => load(sampleDate));
  }

  function renderGames(games) {
    if (games.length === 0) {
      renderEmptyState(state.date);
      return;
    }
    gamesEl.innerHTML = games.map(renderGameCard).join("");
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePolling(games, date) {
    stopPolling();
    if (date !== todayString()) return; // 自動更新は当日表示のときだけ
    const interval = nextPollIntervalMs(games);
    state.pollTimer = setTimeout(() => load(state.date, { forceRefresh: true, pushUrl: false }), interval);
  }

  async function load(date, { forceRefresh = false, pushUrl = true } = {}) {
    if (pushUrl) updateUrl(date);
    state.date = date;
    state.isRefreshing = true;
    renderHeader();
    stopPolling();
    gamesEl.setAttribute("aria-busy", "true");

    try {
      const games = await getGamesForDate(provider, date, { forceRefresh });
      state.lastUpdated = new Date().toISOString();
      state.isRefreshing = false;
      renderHeader();
      renderGames(games);
      schedulePolling(games, date);
    } catch (e) {
      console.error(e);
      state.isRefreshing = false;
      renderHeader();
      gamesEl.innerHTML = `<p class="error-note">データの取得に失敗しました。しばらくしてから再度お試しください。</p>`;
    } finally {
      gamesEl.removeAttribute("aria-busy");
    }
  }

  window.addEventListener("popstate", () => {
    load(getDateFromUrl(), { pushUrl: false });
  });

  load(state.date, { pushUrl: true });
})();
