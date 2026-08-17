'use strict';

/**
 * 入口。
 *
 * GitHub は Turbo による部分描画で画面を差し替えるうえ、マージボックスは
 * 「マージ可否の判定中」のローディング状態を経てから確定する。さらに判定完了時の
 * 再描画で選択が初期値へ戻ることがある。そのため一度だけ実行するのではなく、
 * DOM の変化を監視して繰り返し確認する。
 */
(() => {
  globalThis.PMMS = globalThis.PMMS || {};
  const PMMS = globalThis.PMMS;

  const state = {
    /** 「URL + マージ先 + 目的のマージ方法」の組。変わったら状態をリセットする。 */
    key: null,
    /** 現在の key で選択に失敗したか。失敗後は無限に再試行しない。 */
    failed: false,
    /** 実行中フラグ(多重実行の防止)。 */
    inFlight: false,
    /** 実行中に届いた変化を1回分だけ持ち越す。 */
    pending: false,
    /** デバウンス用のタイマー。 */
    debounceTimer: null,
    /** 定期確認の状況。 */
    pollPath: null,
    pollTicks: 0,
  };

  const run = async () => {
    if (!PMMS.dom.isPullRequestPage()) {
      PMMS.mergeBox.removeBanner();
      return;
    }

    const rawBaseRef = PMMS.dom.readBaseRef();
    const rule = PMMS.resolveRule(rawBaseRef);
    if (!rule) {
      // ルールに一致しないブランチでは何もしない
      PMMS.mergeBox.removeBanner();
      return;
    }

    const box = PMMS.dom.findMergeBox();
    if (!box) {
      // まだ描画されていない、または権限が無い。変化の監視だけ続ける。
      PMMS.mergeBox.removeBanner();
      return;
    }

    if (PMMS.dom.isBusy(box)) {
      // マージ可否の判定中。ここで触ると判定完了時の再描画で選択が失われる。
      PMMS.log('マージボックスが判定中のため待機する');
      return;
    }

    const baseRef = PMMS.normalizeBranch(rawBaseRef);
    const key = `${location.pathname}|${baseRef}|${rule.method}`;
    if (state.key !== key) {
      state.key = key;
      state.failed = false;
      PMMS.log('対象を認識', { baseRef, rule: rule.id, method: rule.method });
    }

    const current = PMMS.dom.readCurrentMethod(box);
    if (current === rule.method) {
      PMMS.mergeBox.renderBanner(box, {
        status: PMMS.mergeBox.STATUS.ALREADY,
        method: rule.method,
        baseRef,
      });
      return;
    }

    if (state.failed) return;

    const result = await PMMS.mergeBox.apply(box, rule.method);
    if (result.status === PMMS.mergeBox.STATUS.FAILED) state.failed = true;
    PMMS.log('適用結果', result);

    PMMS.mergeBox.renderBanner(box, { ...result, baseRef });
  };

  /** 多重実行を防ぎつつ、実行中に来た変化を1回分だけ持ち越す。 */
  const runExclusive = async () => {
    if (state.inFlight) {
      state.pending = true;
      return;
    }
    state.inFlight = true;
    try {
      await run();
    } catch (error) {
      PMMS.warn('処理中に例外', error);
    } finally {
      state.inFlight = false;
      if (state.pending) {
        state.pending = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(runExclusive, PMMS.CONFIG.debounceMs);
  };

  /** 自前のバナーの変化は無視する(監視と描画で往復しないため)。 */
  const isOwnMutation = (mutation) => {
    const target = mutation.target;
    const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    return Boolean(element && element.closest(`.${PMMS.mergeBox.WRAPPER_CLASS}`));
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnMutation)) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Turbo による画面差し替えと履歴移動にも明示的に反応する
  for (const type of ['turbo:load', 'turbo:render', 'turbo:frame-render', 'pjax:end']) {
    document.addEventListener(type, schedule);
  }
  window.addEventListener('popstate', schedule);

  /**
   * 保険の定期確認。
   * ローディングの終了が MutationObserver で拾えない構造だった場合に備え、
   * 1つの URL につき上限回数まで確認し直す。
   */
  setInterval(() => {
    if (state.pollPath !== location.pathname) {
      state.pollPath = location.pathname;
      state.pollTicks = 0;
    }
    if (state.pollTicks >= PMMS.CONFIG.pollMaxTicks) return;
    state.pollTicks += 1;
    schedule();
  }, PMMS.CONFIG.pollIntervalMs);

  schedule();
})();
