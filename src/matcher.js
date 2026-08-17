'use strict';

/**
 * ブランチ名の正規化とルール照合。
 *
 * DOM に触らない純粋関数だけを置く。test/matcher.test.js から直接読み込んで検証する。
 */
(() => {
  globalThis.PMMS = globalThis.PMMS || {};
  const PMMS = globalThis.PMMS;

  /**
   * DOM から読んだブランチ名を照合可能な形に整える。
   *
   * - 前後の空白を落とす
   * - fork からの PR などで "owner:branch" 形式になっている場合はコロンより前を捨てる
   * - 末尾のスラッシュを除く
   */
  PMMS.normalizeBranch = (raw) => {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const colon = trimmed.indexOf(':');
    const afterColon = colon === -1 ? trimmed : trimmed.slice(colon + 1);
    return afterColon.replace(/\/+$/, '').trim();
  };

  /**
   * ブランチ名に対応するルールを返す。一致しなければ null。
   */
  PMMS.resolveRule = (rawBranch) => {
    const branch = PMMS.normalizeBranch(rawBranch);
    if (!branch) return null;
    for (const rule of PMMS.RULES) {
      if (rule.branches.some((pattern) => pattern.test(branch))) return rule;
    }
    return null;
  };

  /** バナーに出すマージ方法の表示名。 */
  PMMS.describeMethod = (method) => {
    const labels = PMMS.METHOD_LABELS[method];
    return labels ? labels.display : method;
  };

  /**
   * テキストがマージ方法のどれに該当するかを判定する。
   * kind は 'menu'(ドロップダウン項目) か 'button'(マージボタン)。
   */
  PMMS.detectMethodFromText = (text, kind) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    const normalized = text.replace(/\s+/g, ' ').trim();
    for (const method of Object.keys(PMMS.METHOD_LABELS)) {
      const patterns = PMMS.METHOD_LABELS[method][kind] || [];
      if (patterns.some((pattern) => pattern.test(normalized))) return method;
    }
    return null;
  };
})();
