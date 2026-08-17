'use strict';

/**
 * 判定ロジックの単体テスト。
 *
 *   node --test test/
 *
 * 拡張のソースにテスト用の分岐を持ち込まないため、src の JavaScript を
 * ファイルとして読み、vm のコンテキストで評価してから検証する。
 * DOM に触らない rules.js と matcher.js だけを読む。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const loadPMMS = () => {
  const context = vm.createContext({});
  for (const file of ['rules.js', 'matcher.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return vm.runInContext('PMMS', context);
};

const PMMS = loadPMMS();

test('master と main は通常のマージコミットになる', () => {
  for (const branch of ['master', 'main', 'production', 'prod']) {
    assert.strictEqual(PMMS.resolveRule(branch).method, 'merge', branch);
  }
});

test('development の表記揺れはすべて squash になる', () => {
  for (const branch of ['development', 'develop', 'devel', 'dev']) {
    assert.strictEqual(PMMS.resolveRule(branch).method, 'squash', branch);
  }
});

test('大文字小文字は区別しない', () => {
  assert.strictEqual(PMMS.resolveRule('Master').method, 'merge');
  assert.strictEqual(PMMS.resolveRule('DEVELOP').method, 'squash');
});

test('ルールに一致しないブランチは null を返す', () => {
  for (const branch of ['feature/foo', 'develop-x', 'mymaster', 'release/1.0', '']) {
    assert.strictEqual(PMMS.resolveRule(branch), null, branch);
  }
});

test('owner:branch 形式と前後の空白を正規化する', () => {
  assert.strictEqual(PMMS.normalizeBranch('  master  '), 'master');
  assert.strictEqual(PMMS.normalizeBranch('shucream0117:master'), 'master');
  assert.strictEqual(PMMS.normalizeBranch('develop/'), 'develop');
  assert.strictEqual(PMMS.normalizeBranch(null), '');
  assert.strictEqual(PMMS.resolveRule('shucream0117:development').method, 'squash');
});

test('マージ方法をボタンの文言から判定できる', () => {
  assert.strictEqual(PMMS.detectMethodFromText('Merge pull request', 'button'), 'merge');
  assert.strictEqual(PMMS.detectMethodFromText('Squash and merge', 'button'), 'squash');
  assert.strictEqual(PMMS.detectMethodFromText('Rebase and merge', 'button'), 'rebase');
  assert.strictEqual(PMMS.detectMethodFromText('プルリクエストをマージ', 'button'), 'merge');
  assert.strictEqual(PMMS.detectMethodFromText('スカッシュしてマージ', 'button'), 'squash');
  assert.strictEqual(PMMS.detectMethodFromText('Close pull request', 'button'), null);
});

test('マージ方法をドロップダウンの文言から判定できる', () => {
  assert.strictEqual(PMMS.detectMethodFromText('Create a merge commit', 'menu'), 'merge');
  assert.strictEqual(PMMS.detectMethodFromText('Squash and merge', 'menu'), 'squash');
  assert.strictEqual(PMMS.detectMethodFromText('Rebase and merge', 'menu'), 'rebase');
  assert.strictEqual(PMMS.detectMethodFromText('マージコミットを作成', 'menu'), 'merge');
});
