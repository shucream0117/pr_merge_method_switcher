'use strict';

/**
 * マージ方法を適用する手順と、結果を伝えるバナー。
 *
 * DOM の探索そのものは dom-adapter.js に任せ、ここでは
 * 「選択して、反映を検証して、駄目なら再試行する」という手順だけを持つ。
 */
(() => {
  globalThis.PMMS = globalThis.PMMS || {};
  const PMMS = globalThis.PMMS;

  const BANNER_CLASS = 'pmms-banner';
  /**
   * バナーの外枠。マージボックスの左寄せ用クラスをここに写して、
   * 枠線の開始位置をマージボックスと揃える。
   */
  const WRAPPER_CLASS = 'pmms-banner-wrap';

  /**
   * マージボックスが持つ左側の余白クラス(例: tmp-ml-md-6 tmp-pl-md-3)。
   * アバター用の余白の分だけ本文が右へ寄っているため、同じ値を使う。
   */
  const ALIGNMENT_CLASS_PATTERN = /^tmp-(ml|pl|mr|pr)-/;

  /** apply() の戻り値の status。 */
  const STATUS = {
    /** 選択を変更した。 */
    APPLIED: 'applied',
    /** 既に目的の方法が選ばれていた。 */
    ALREADY: 'already',
    /** 選択できなかった。 */
    FAILED: 'failed',
    /** 選択 UI が無い(権限が無い、マージ済みなど)。 */
    UNAVAILABLE: 'unavailable',
  };

  /**
   * 目的のマージ方法を選択する。
   *
   * 判定中(ローディング)の呼び出しは呼び出し側で除外しておく。
   * 戻り値: { status, method, verified }
   */
  const apply = async (box, method) => {
    if (!PMMS.dom.hasMethodControls(box)) {
      // マージボタンは認識できているのに選択 UI が見つからない場合は、
      // セレクタが実物とずれている疑いがあるため失敗として通知する。
      const button = PMMS.dom.findPrimaryButton(box);
      const recognizable = PMMS.detectMethodFromText(PMMS.dom.util.textOf(button), 'button');
      return {
        status: recognizable ? STATUS.FAILED : STATUS.UNAVAILABLE,
        method,
        verified: false,
      };
    }

    if (PMMS.dom.readCurrentMethod(box) === method) {
      return { status: STATUS.ALREADY, method, verified: true };
    }

    for (let attempt = 1; attempt <= PMMS.CONFIG.maxApplyAttempts; attempt += 1) {
      const operated = await PMMS.dom.selectMethod(box, method);
      if (!operated) {
        PMMS.warn(`選択操作に失敗 (${attempt}回目)`, method);
        continue;
      }

      // 反映を待つ。判定できないまま時間切れになる場合もある。
      const verified = await PMMS.dom.util.waitFor(
        () => PMMS.dom.readCurrentMethod(box) === method,
        { timeout: PMMS.CONFIG.verifyTimeoutMs, interval: 100 },
      );
      if (verified) return { status: STATUS.APPLIED, method, verified: true };

      // 現在の選択が読めない UI では、操作できた時点で成功とみなし警告だけ残す
      if (PMMS.dom.readCurrentMethod(box) === null) {
        PMMS.warn('選択したが現在の選択を読み取れなかった', method);
        return { status: STATUS.APPLIED, method, verified: false };
      }

      PMMS.warn(`選択が反映されなかった (${attempt}回目)`, method);
    }

    return { status: STATUS.FAILED, method, verified: false };
  };

  /**
   * バナーを描画する。同じ内容のバナーが既にあれば何もしない。
   * マージボックスの直前に置く。
   */
  const renderBanner = (box, { status, method, baseRef }) => {
    const message = buildMessage({ status, method, baseRef });
    if (!message) {
      removeBanner();
      return;
    }

    const existing = document.querySelector(`.${BANNER_CLASS}`);
    if (existing && existing.dataset.pmmsMessage === message.body && existing.dataset.pmmsStatus === message.tone) {
      return;
    }
    removeBanner();

    const banner = document.createElement('div');
    banner.className = BANNER_CLASS;
    banner.dataset.pmmsStatus = message.tone;
    banner.dataset.pmmsMessage = message.body;

    const title = document.createElement('span');
    title.className = 'pmms-banner-title';
    title.textContent = 'PR Merge Method Switcher';

    const body = document.createElement('span');
    body.className = 'pmms-banner-body';
    body.textContent = message.body;

    banner.append(title, body);

    // マージボックスと同じ左余白を持つ外枠に入れて、枠線の開始位置を揃える
    const wrapper = document.createElement('div');
    wrapper.className = [WRAPPER_CLASS, ...alignmentClassesOf(box)].join(' ');
    wrapper.append(banner);

    if (box.parentElement) {
      box.parentElement.insertBefore(wrapper, box);
    } else {
      box.prepend(wrapper);
    }
  };

  /**
   * マージボックスの左寄せ用クラスを取り出す。
   * 余白クラスは外枠(mergebox-partial)側に付いているため、そこから読む。
   */
  const alignmentClassesOf = (box) => {
    const source = box.closest('[data-testid="mergebox-partial"]') || box;
    return Array.from(source.classList).filter((name) => ALIGNMENT_CLASS_PATTERN.test(name));
  };

  const buildMessage = ({ status, method, baseRef }) => {
    const methodName = PMMS.describeMethod(method);
    switch (status) {
      // 既に選ばれていた場合も文言は分けない(読み手にとっては同じ結果のため)
      case STATUS.APPLIED:
      case STATUS.ALREADY:
        return {
          tone: 'ok',
          body: `マージ先が ${baseRef} のため、マージ方法を「${methodName}」にしました。`,
        };
      case STATUS.FAILED:
        return {
          tone: 'failed',
          body: `マージ方法を自動設定できませんでした。手動で「${methodName}」を選んでください。`,
        };
      default:
        return null;
    }
  };

  const removeBanner = () => {
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((element) => element.remove());
    // 外枠なしで挿入された古い版が残っている場合の掃除
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach((element) => element.remove());
  };

  PMMS.mergeBox = { STATUS, apply, renderBanner, removeBanner, BANNER_CLASS, WRAPPER_CLASS };
})();
