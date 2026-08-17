'use strict';

/**
 * GitHub の DOM に触るのはこのファイルだけ。
 *
 * ============================================================================
 * セレクタは 2026-08-18 に採取した実物 DOM(CI 成功時 / CI 失敗時の両方)に基づく。
 *
 * 確定している構造:
 *   <div data-testid="mergebox-partial">                       … 外枠。描画前から存在する
 *     <div class="MergeBox-module__mergeboxLoading__XXXX">      … 判定中はこれだけ
 *       <span data-component="Spinner">…<span>Loading</span>
 *     <div data-testid="mergebox-border-container">            … 判定後
 *       <section aria-label="Checks">…                          … 失敗時は展開されケバブ有り
 *       <div data-component="ButtonGroup">
 *         <button data-component="Button">…Merge pull request   … 主ボタン
 *         <button data-component="IconButton" aria-haspopup="true"
 *                 aria-labelledby="ID">                         … 開閉ボタン
 *         <span id="ID">Select merge method</span>              … ツールチップ
 *   <div data-component="Portal">                              … メニューは外に出る
 *     <ul role="menu" aria-labelledby="ID">
 *       <li role="menuitemradio" aria-checked="true">
 *         <span data-component="ActionList.Item.Label">Create a merge commit</span>
 *         <span data-component="ActionList.Description">All commits from …</span>
 *
 * 注意点:
 *  - CSS Modules のクラス名は末尾にハッシュが付き、デプロイごとに変わる。
 *    完全一致ではなく [class*="..."] の部分一致で書く。
 *  - CI 失敗時はチェック欄が展開され、各行に aria-haspopup="true" のケバブボタンが
 *    出る。これは DOM 順でマージ方法の開閉ボタンより前にあるため、
 *    button[aria-haspopup="true"] だけで探すと取り違える。開閉ボタンは
 *    「主ボタンと同じ ButtonGroup の中」または「アクセシブルネーム」で特定する。
 *  - メニュー項目は説明文を含む。説明文まで混ぜて判定すると誤検出しうるため、
 *    ラベル要素があればラベルだけを見る。
 *
 * 差し替えは CANDIDATES と BUSY_HINTS の2定数で足りるようにしている。
 * 公開している関数(PMMS.dom.*)の名前・引数・戻り値の意味は変えないこと。
 * 呼び出し側(merge-box.js / content.js)はこの契約にだけ依存している。
 *
 * 採取には PMMS.dom.capture() を使う(README 参照)。
 * ============================================================================
 */
(() => {
  globalThis.PMMS = globalThis.PMMS || {};
  const PMMS = globalThis.PMMS;

  /** セレクタ候補。上から順に試す。 */
  const CANDIDATES = {
    /** マージボックス全体。React の描画先で、ローディング中から存在し続ける。 */
    mergeBox: [
      '[data-testid="mergebox-partial"]',
      '[data-testid="mergebox-border-container"]',
      // 旧 UI 向けの保険
      '.js-merge-pr',
      '#partial-pull-merging',
      '.merge-pr',
    ],

    /**
     * マージ先ブランチを埋め込み JSON から取る経路。
     * payload.pullRequestsLayoutRoute.pullRequest.baseBranch に入っている。
     */
    embeddedData: ['script[type="application/json"][data-target="react-app.embeddedData"]'],

    /**
     * PR ヘッダの「wants to merge N commits into <base> from <head>」部分。
     * 先頭の BranchName が base。href が /owner/repo/tree/<branch> 形式。
     */
    baseRefHeader: [
      '[class*="PullRequestHeaderSummary-module__summaryContainer"] a[data-component="BranchName"]',
      'a[data-component="BranchName"]',
    ],

    /** 旧 UI 向けの base 取得。 */
    baseRefLegacy: [
      '#partial-discussion-header .base-ref',
      '[data-testid="base-ref"]',
      '.base-ref',
    ],

    /** 主ボタンと開閉ボタンをまとめている入れ物。 */
    buttonGroup: [
      '[data-component="ButtonGroup"]',
      '[class*="prc-ButtonGroup-ButtonGroup"]',
    ],

    /** マージボタン(主ボタン)。 */
    primaryButton: [
      'button[data-component="Button"]',
      'button.js-merge-commit-button',
      'button[name="do"]',
      'button.btn-primary',
      'button',
    ],

    /**
     * ドロップダウンの開閉ボタン。
     * これらは ButtonGroup 内かアクセシブルネーム一致に限って使う。
     * 単独で document 全体に当てるとケバブボタンを拾うため、使い方に注意。
     */
    menuToggle: [
      'button[data-component="IconButton"][aria-haspopup="true"]',
      'button[aria-haspopup="menu"]',
      'button[aria-haspopup="true"]',
    ],

    /** 旧 UI の開閉ボタン。取り違えの恐れがない形だけを並べる。 */
    menuToggleLegacy: [
      'summary[aria-haspopup="menu"]',
      'button.dropdown-caret',
      '.js-merge-method-menu-button',
    ],

    /** マージ方法のラジオボタン(旧 UI)。 */
    methodRadio: [
      'input[type="radio"][name="merge_method"]',
      'input[type="radio"][name="method"]',
    ],

    /** ドロップダウン本体。 */
    menu: ['ul[role="menu"]', '[role="menu"]'],

    /** ドロップダウンの項目。 */
    menuItem: [
      'li[role="menuitemradio"]',
      '[role="menuitemradio"]',
      '[role="menuitem"]',
      '[role="option"]',
      '.select-menu-item',
      '.dropdown-item',
    ],

    /** 項目のラベル部分(説明文と区別するため)。 */
    menuItemLabel: [
      '[data-component="ActionList.Item.Label"]',
      '[class*="prc-ActionList-ItemLabel"]',
      '[class*="ActionListItem-label"]',
      '.ActionListItem-label',
    ],

    /** メニューが描画されるポータル(採取用)。 */
    portal: ['[data-component="Portal"]', '#__primerPortalRoot__'],
  };

  /** 開閉ボタンのアクセシブルネーム。 */
  const MENU_TOGGLE_LABELS = [/select merge method/i, /マージ方法/];

  /**
   * 「マージ可否の判定中」を示す目印。
   * CI の進捗表示を判定中と取り違えないよう、選択 UI が描画済みなら
   * isBusy() 側で先に false を返す。
   */
  const BUSY_HINTS = {
    selectors: [
      '[class*="mergeboxLoading"]',
      '[data-component="Spinner"]',
      '[class*="prc-Spinner"]',
      '[data-loading="true"]',
      '[aria-busy="true"]',
      '[data-testid*="loading"]',
      '.is-loading',
      '.spinner',
      'svg.anim-rotate',
    ],
    textPatterns: [
      /checking (if|whether) (this|the) branch can be merged/i,
      /checking mergeability/i,
      /マージできるか(どうか)?(を)?確認中/,
    ],
  };

  /** 埋め込み JSON 内の base ブランチの位置。 */
  const BASE_BRANCH_PATH = ['payload', 'pullRequestsLayoutRoute', 'pullRequest', 'baseBranch'];

  // --- 小さな道具 -----------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** predicate が真値を返すまで待つ。時間内に返らなければ null。 */
  const waitFor = async (predicate, { timeout = 1000, interval = 100 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = predicate();
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(interval);
    }
  };

  /** セレクタ候補を上から試し、最初に見つかった要素を返す。 */
  const queryFirst = (root, selectors) => {
    if (!root) return null;
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  };

  /** セレクタ候補すべてに一致する要素をまとめて返す(重複は除く)。 */
  const queryAll = (root, selectors) => {
    if (!root) return [];
    const result = [];
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (!result.includes(element)) result.push(element);
      }
    }
    return result;
  };

  /** 要素の見た目上のテキスト。 */
  const textOf = (element) => {
    if (!element) return '';
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  };

  /** アクセシブルネーム。aria-label と aria-labelledby の参照先を見る。 */
  const accessibleNameOf = (element) => {
    if (!element || !element.getAttribute) return '';
    const direct = element.getAttribute('aria-label');
    if (direct) return direct.replace(/\s+/g, ' ').trim();
    const ids = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(' ')
      .trim();
  };

  /** メニュー項目の判定に使うテキスト。ラベル部分があればそこだけを使う。 */
  const menuItemTextOf = (item) => {
    const label = queryFirst(item, CANDIDATES.menuItemLabel);
    return textOf(label || item);
  };

  const isVisible = (element) => {
    if (!element || !element.isConnected) return false;
    if (typeof element.getClientRects !== 'function') return true;
    return element.getClientRects().length > 0;
  };

  /** 要素が持つ値属性からマージ方法を判定する(data-value="squash" など)。 */
  const methodFromValueAttribute = (element) => {
    if (!element || !element.getAttribute) return null;
    for (const name of ['data-value', 'value', 'data-method', 'data-merge-method']) {
      const raw = element.getAttribute(name);
      if (!raw) continue;
      const method = PMMS.METHODS[raw.trim().toUpperCase()];
      if (method) return method;
    }
    return null;
  };

  /** href の /tree/<branch> からブランチ名を取り出す。スラッシュ入りの名前も扱える。 */
  const branchFromHref = (anchor) => {
    const href = anchor && anchor.getAttribute('href');
    if (!href) return null;
    const matched = href.match(/^\/[^/]+\/[^/]+\/tree\/(.+)$/);
    if (!matched) return null;
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  };

  /** 埋め込み JSON から base ブランチを読む。 */
  const readBaseRefFromEmbeddedData = () => {
    for (const script of queryAll(document, CANDIDATES.embeddedData)) {
      let data;
      try {
        data = JSON.parse(script.textContent || '');
      } catch {
        continue;
      }
      let node = data;
      for (const key of BASE_BRANCH_PATH) {
        if (!node || typeof node !== 'object') {
          node = null;
          break;
        }
        node = node[key];
      }
      if (typeof node === 'string' && node.trim()) return node.trim();
    }
    return null;
  };

  /** React 側が pointer 系イベントを見ている場合に備えた押下。 */
  const dispatchPointerClick = (element) => {
    const make = (type) => {
      const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
      if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
        return new PointerEvent(type, { ...init, pointerId: 1, isPrimary: true });
      }
      return new MouseEvent(type.replace('pointer', 'mouse'), init);
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(make(type));
    }
  };

  // --- 公開 API -------------------------------------------------------------

  PMMS.dom = {
    /** 待機系の道具。merge-box.js からも使う。 */
    util: { sleep, waitFor, textOf },

    /** PR の詳細ページかどうか。 */
    isPullRequestPage() {
      return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(location.pathname);
    },

    /**
     * マージ先ブランチ名を返す。取得できなければ null。
     * 正規化は呼び出し側(PMMS.normalizeBranch)に任せる。
     */
    readBaseRef() {
      const fromData = readBaseRefFromEmbeddedData();
      if (fromData) return fromData;

      // ヘッダの先頭の BranchName が base。表示は省略されうるので href を優先する。
      for (const anchor of queryAll(document, CANDIDATES.baseRefHeader)) {
        const fromHref = branchFromHref(anchor);
        if (fromHref) return fromHref;
        const text = textOf(anchor);
        if (text && !/\s/.test(text)) return text;
      }

      for (const element of queryAll(document, CANDIDATES.baseRefLegacy)) {
        const candidate = (element.getAttribute('title') || textOf(element)).trim();
        if (candidate && !/\s/.test(candidate) && /[\w.\-/]/.test(candidate)) return candidate;
      }

      // 最後の手段: 英語表記の "wants to merge N commits into X from Y" から拾う
      const header = document.querySelector('#partial-discussion-header, .gh-header-meta');
      const matched = textOf(header).match(/into\s+([^\s]+)\s+from\s+/i);
      return matched ? matched[1] : null;
    },

    /** マージボックスを返す。見つからなければ null。 */
    findMergeBox() {
      for (const selector of CANDIDATES.mergeBox) {
        for (const element of document.querySelectorAll(selector)) {
          if (isVisible(element)) return element;
        }
      }
      return null;
    },

    /**
     * マージ可否の判定中(ローディング)かどうか。
     * 判定中に選択を触っても、判定完了時の再描画で失われるため待つ必要がある。
     */
    isBusy(box) {
      if (!box) return false;
      // 選択 UI が描画済みなら、CI の進捗表示などが残っていても待たない
      if (this.hasMethodControls(box)) return false;

      for (const selector of BUSY_HINTS.selectors) {
        if (Array.from(box.querySelectorAll(selector)).some(isVisible)) return true;
      }
      if (BUSY_HINTS.textPatterns.some((pattern) => pattern.test(textOf(box)))) return true;

      // 選択 UI もマージボタンも無い間は、まだ描画途中とみなす
      return !this.findPrimaryButton(box);
    },

    /** マージ方法を選べる UI があるか(権限が無い PR では存在しない)。 */
    hasMethodControls(box) {
      if (!box) return false;
      if (queryAll(box, CANDIDATES.methodRadio).length > 0) return true;
      return Boolean(this.findMenuToggle(box));
    },

    /** マージボタン(主ボタン)を返す。 */
    findPrimaryButton(box) {
      if (!box) return null;
      // テキストがマージ方法のどれかに一致するボタンを優先する
      for (const button of queryAll(box, CANDIDATES.primaryButton)) {
        if (!isVisible(button)) continue;
        if (PMMS.detectMethodFromText(textOf(button), 'button')) return button;
      }
      const fallback = queryFirst(box, CANDIDATES.primaryButton);
      return isVisible(fallback) ? fallback : null;
    },

    /**
     * ドロップダウンの開閉ボタンを返す。
     * CI 失敗時はチェック行のケバブボタンが同じ属性を持つため、
     * 「主ボタンと同じ ButtonGroup の中」を第一の手掛かりにする。
     */
    findMenuToggle(box) {
      if (!box) return null;

      const primary = this.findPrimaryButton(box);
      const group = primary ? primary.closest(CANDIDATES.buttonGroup.join(',')) : null;
      if (group) {
        for (const toggle of queryAll(group, CANDIDATES.menuToggle)) {
          if (toggle !== primary && isVisible(toggle)) return toggle;
        }
      }

      // アクセシブルネーム(ツールチップの「Select merge method」)で特定する
      for (const toggle of queryAll(box, CANDIDATES.menuToggle)) {
        if (!isVisible(toggle)) continue;
        const name = accessibleNameOf(toggle);
        if (MENU_TOGGLE_LABELS.some((pattern) => pattern.test(name))) return toggle;
      }

      for (const toggle of queryAll(box, CANDIDATES.menuToggleLegacy)) {
        if (isVisible(toggle)) return toggle;
      }

      return null;
    },

    /**
     * 現在選択されているマージ方法を返す。判定できなければ null。
     * ラジオボタン、マージボタンのラベル、選択済みメニュー項目の順に見る。
     */
    readCurrentMethod(box) {
      if (!box) return null;

      for (const radio of queryAll(box, CANDIDATES.methodRadio)) {
        if (!radio.checked) continue;
        const byValue = methodFromValueAttribute(radio);
        if (byValue) return byValue;
        const byLabel = PMMS.detectMethodFromText(textOf(radio.closest('label') || radio.parentElement), 'menu');
        if (byLabel) return byLabel;
      }

      const byButton = PMMS.detectMethodFromText(textOf(this.findPrimaryButton(box)), 'button');
      if (byButton) return byButton;

      for (const item of queryAll(document, CANDIDATES.menuItem)) {
        if (item.getAttribute('aria-checked') !== 'true' && item.getAttribute('aria-selected') !== 'true') continue;
        const byValue = methodFromValueAttribute(item);
        if (byValue) return byValue;
        const byText = PMMS.detectMethodFromText(menuItemTextOf(item), 'menu');
        if (byText) return byText;
      }

      return null;
    },

    /**
     * 目的のマージ方法を選択する。クリックまでを行い、反映の検証は呼び出し側に任せる。
     * 戻り値は「操作できたか」。true でも反映されたとは限らない。
     */
    async selectMethod(box, method) {
      if (!box) return false;

      // 旧 UI: ラジオボタン
      const radio = queryAll(box, CANDIDATES.methodRadio).find((input) => {
        if (methodFromValueAttribute(input) === method) return true;
        return PMMS.detectMethodFromText(textOf(input.closest('label') || input.parentElement), 'menu') === method;
      });
      if (radio) {
        if (radio.checked) return true;
        const label = radio.id ? box.querySelector(`label[for="${radio.id}"]`) : radio.closest('label');
        (label || radio).click();
        PMMS.log('ラジオボタンで選択', method);
        return true;
      }

      // 新 UI: ドロップダウン
      const toggle = this.findMenuToggle(box);
      if (!toggle) return false;

      let item = this.findMenuItem(method, toggle);
      if (!item) {
        await this.openMenu(toggle);
        item = await waitFor(() => this.findMenuItem(method, toggle), {
          timeout: PMMS.CONFIG.menuOpenTimeoutMs,
          interval: 100,
        });
      }
      if (!item) {
        this.closeMenu(toggle);
        PMMS.warn('ドロップダウンに該当項目が見つからない', method);
        return false;
      }
      item.click();
      PMMS.log('ドロップダウンで選択', method);
      await this.releaseFocus(toggle);
      return true;
    },

    /**
     * 選択後に開閉ボタンからフォーカスを外す。
     * Primer はメニューを閉じたあと開閉ボタンへフォーカスを戻すため、そのままだと
     * ツールチップ(Select merge method)が出続けて邪魔になる。
     * フォーカスの復帰を待ってから外す。
     */
    async releaseFocus(toggle) {
      if (!toggle || typeof toggle.blur !== 'function') return;
      const closed = () => toggle.getAttribute('aria-expanded') !== 'true';
      await waitFor(closed, { timeout: 1000, interval: 50 });
      // 閉じた直後にフォーカスが戻るため、復帰を待ってから外す
      await waitFor(() => document.activeElement === toggle, { timeout: 500, interval: 50 });
      if (document.activeElement === toggle) {
        toggle.blur();
        PMMS.log('開閉ボタンのフォーカスを外した');
      }
    },

    /** ドロップダウンを開く。開けたかどうかを返す。 */
    async openMenu(toggle) {
      if (!toggle) return false;
      const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
      if (isOpen()) return true;

      toggle.click();
      if (await waitFor(isOpen, { timeout: 400, interval: 50 })) return true;

      // click() だけで開かない実装に備える
      dispatchPointerClick(toggle);
      return Boolean(await waitFor(isOpen, { timeout: PMMS.CONFIG.menuOpenTimeoutMs, interval: 50 }));
    },

    /**
     * 開いているドロップダウンから、目的のマージ方法の項目を探す。
     * メニューはポータルに描画されマージボックスの外に出るため、探索は document 全体。
     * toggle を渡した場合は、その開閉ボタンに紐づくメニューを優先する
     * (aria-labelledby が一致する role="menu" が、そのボタンのメニュー)。
     */
    findMenuItem(method, toggle) {
      const scopes = [];
      const labelledBy = toggle && toggle.getAttribute('aria-labelledby');
      if (labelledBy) {
        for (const menu of queryAll(document, CANDIDATES.menu)) {
          if (menu.getAttribute('aria-labelledby') === labelledBy) scopes.push(menu);
        }
      }
      if (!scopes.length) scopes.push(document);

      for (const scope of scopes) {
        for (const item of queryAll(scope, CANDIDATES.menuItem)) {
          if (!isVisible(item)) continue;
          if (methodFromValueAttribute(item) === method) return item;
          if (PMMS.detectMethodFromText(menuItemTextOf(item), 'menu') === method) return item;
        }
      }
      return null;
    },

    /** 開いたままのドロップダウンを閉じる。 */
    closeMenu(toggle) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (toggle && toggle.getAttribute('aria-expanded') === 'true') toggle.click();
    },

    /**
     * 実物の HTML 採取用。
     * DevTools のコンソールで実行コンテキストをこの拡張に切り替えて呼ぶ。
     * マージボックスと、開いているメニュー(ポータル配下)をまとめて返す。
     */
    capture() {
      const parts = [];

      const box = this.findMergeBox();
      parts.push(box ? `<!-- mergebox -->\n${box.outerHTML}` : '<!-- mergebox: 見つからない -->');

      for (const portal of queryAll(document, CANDIDATES.portal)) {
        if (portal.innerHTML.trim()) parts.push(`<!-- portal -->\n${portal.outerHTML}`);
      }

      for (const menu of queryAll(document, CANDIDATES.menu)) {
        if (!isVisible(menu)) continue;
        if (parts.some((part) => part.includes(menu.outerHTML))) continue;
        parts.push(`<!-- menu -->\n${menu.outerHTML}`);
      }

      return parts.join('\n\n');
    },
  };
})();
