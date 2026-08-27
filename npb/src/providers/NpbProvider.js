/**
 * 実データ提供元用の Provider スタブ（未接続）。
 *
 * 現状、このサンドボックス環境からは npb.jp への outbound アクセスが
 * ネットワークegressプロキシでブロックされており、robots.txt の内容や
 * 実際のHTML構造をこの場で検証できなかった。そのため実装は行わず、
 * BaseballDataProvider インターフェースを満たす「差し替え先」の型だけ
 * 用意してある。実装時は README.md の「データ取得元の調査結果」を参照し、
 * 必ず利用規約・robots.txt・アクセス頻度を人手で確認してから着手すること。
 *
 * 実装方針の候補:
 *   1. npb.jp/bis/{年度}/stats/ 等の公開ページを、規約の範囲内・低頻度で取得する
 *   2. 有償/契約ベースのデータAPI（プロ野球データプラットフォーム等）を契約して使う
 *   3. 個人利用として、ユーザー自身が試合結果ページを見ながら手動でJSONを
 *      cache/ 配下に保存する「手動インポート」方式にする（規約リスクが最小）
 *
 * どの方式でも、他のレイヤー(services/components)は一切変更せずに
 * 差し替えられるよう、このクラスだけを実装すればよい構造になっている。
 */
(function (global) {
  "use strict";

  class NpbProvider {
    async getGames(date) {
      throw new global.NPB.NotImplementedError("getGames");
    }

    async getGameBattingStats(gameId) {
      throw new global.NPB.NotImplementedError("getGameBattingStats");
    }

    async getGamePitchingStats(gameId) {
      throw new global.NPB.NotImplementedError("getGamePitchingStats");
    }

    async getSeasonBattingStats(date) {
      throw new global.NPB.NotImplementedError("getSeasonBattingStats");
    }
  }

  global.NPB.NpbProvider = NpbProvider;
})(window);
