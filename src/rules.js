'use strict';

/**
 * 設定ファイル。
 *
 * 運用でブランチの表記揺れが増えたときに触るのはこのファイルだけ。
 * DOM には一切触らない。
 */
(() => {
  globalThis.PMMS = globalThis.PMMS || {};
  const PMMS = globalThis.PMMS;

  /** GitHub が受け付けるマージ方法の識別子。 */
  PMMS.METHODS = {
    MERGE: 'merge',
    SQUASH: 'squash',
    REBASE: 'rebase',
  };

  /**
   * ブランチ名とマージ方法の対応。
   *
   * 上から順に評価し、最初に一致したルールを採用する。
   * どのルールにも一致しないブランチでは、拡張は何もしない。
   *
   * - id: ログとバナーに出る識別子
   * - method: PMMS.METHODS のいずれか
   * - branches: マージ先ブランチ名に対する正規表現の配列(表記揺れをここに列挙する)
   */
  PMMS.RULES = [
    {
      id: 'production',
      method: PMMS.METHODS.MERGE,
      branches: [/^master$/i, /^main$/i, /^production$/i, /^prod$/i],
    },
    {
      id: 'development',
      method: PMMS.METHODS.SQUASH,
      branches: [/^development$/i, /^develop$/i, /^devel$/i, /^dev$/i],
    },
    // 例: リリースブランチ向けを通常マージにしたい場合
    // {
    //   id: 'release',
    //   method: PMMS.METHODS.MERGE,
    //   branches: [/^release\/.+$/i],
    // },
  ];

  /**
   * マージ方法ごとの表示文言。
   *
   * GitHub の表示言語によって文言が変わるため、英語と日本語の両方を候補に持つ。
   * - menu: ドロップダウンの項目テキストに対する判定
   * - button: マージボタン本体のテキストに対する判定(選択結果の検証に使う)
   * - display: バナーに出す名前
   */
  PMMS.METHOD_LABELS = {
    [PMMS.METHODS.MERGE]: {
      display: 'Create a merge commit',
      menu: [/create a merge commit/i, /merge commit/i, /マージコミットを作成/],
      button: [/merge pull request/i, /create a merge commit/i, /プルリクエストをマージ/, /マージコミットを作成/],
    },
    [PMMS.METHODS.SQUASH]: {
      display: 'Squash and merge',
      menu: [/squash and merge/i, /スカッシュ(して)?マージ/, /squash/i],
      button: [/squash and merge/i, /スカッシュ(して)?マージ/],
    },
    [PMMS.METHODS.REBASE]: {
      display: 'Rebase and merge',
      menu: [/rebase and merge/i, /リベース(して)?マージ/, /rebase/i],
      button: [/rebase and merge/i, /リベース(して)?マージ/],
    },
  };

  /** 動作の調整値。 */
  PMMS.CONFIG = {
    /** DOM の変化をまとめる時間(ms)。 */
    debounceMs: 200,
    /** マージボックスが判定中でないか確認し直す間隔(ms)。 */
    pollIntervalMs: 1500,
    /** 1つの PR ページで再確認を繰り返す上限回数。 */
    pollMaxTicks: 20,
    /** 選択と検証を繰り返す上限回数。 */
    maxApplyAttempts: 3,
    /** 選択が反映されたかを待つ時間(ms)。 */
    verifyTimeoutMs: 1500,
    /** ドロップダウンが開くのを待つ時間(ms)。 */
    menuOpenTimeoutMs: 2000,
  };

  /**
   * ログ出力。既定では無効。
   * DevTools のコンソールで実行コンテキストをこの拡張に切り替え、
   * PMMS.DEBUG = true とすると動作を追える。
   */
  PMMS.DEBUG = false;
  PMMS.log = (...args) => {
    if (PMMS.DEBUG) console.log('[PMMS]', ...args);
  };
  PMMS.warn = (...args) => {
    if (PMMS.DEBUG) console.warn('[PMMS]', ...args);
  };
})();
