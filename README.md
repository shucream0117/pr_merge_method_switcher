# これは何

GitHubのマージメソッドをターゲットブランチによって切り替えるChrome拡張。
(GitHubの機能で実現しようと思うとTeamプランへの課金が必要なため)

github.com の PR ページで、マージ先(base)ブランチ名からマージ方法を判定し、
マージボックスの選択状態を自動で切り替える。何をしたかはマージボックスの直前に
バナーで表示する。バナーはマージボックスと同じ幅・同じ左位置に揃える。
選択後は開閉ボタンのフォーカスを外し、ツールチップが出たままにならないようにする。
**マージボタン自体は押さない。**

- `master` / `main` 系へのPR → 通常のマージコミット
- `development` / `develop` / `dev` 系へのPR → Squash and merge
- どのルールにも一致しないブランチ → 何もしない

## インストール

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」で、このリポジトリのルートを選ぶ

ソースを変更したら、同じ画面の再読み込みボタンを押して読み込み直す。

## ルールの追加・変更

`src/rules.js` の `PMMS.RULES` だけを編集する。上から順に評価し、最初に一致した
ルールを採用する。表記揺れは `branches` に正規表現を足して吸収する。

```js
{
  id: 'release',
  method: PMMS.METHODS.MERGE,
  branches: [/^release\/.+$/i],
},
```

編集後は `node --test` を実行し、判定が壊れていないか確認する。

## ファイル構成

| ファイル | 責務 |
| --- | --- |
| `manifest.json` | MV3宣言。github.com の PR ページに content script を注入する |
| `src/rules.js` | ブランチ名とマージ方法の対応、文言定義、動作の調整値。**運用で触るのはここだけ** |
| `src/matcher.js` | ブランチ名の正規化とルール照合。DOMに触らない純粋関数 |
| `src/dom-adapter.js` | GitHubのDOM依存部分。セレクタ候補を集約している(下記参照) |
| `src/merge-box.js` | 選択・検証・再試行の手順と、バナーの描画 |
| `src/content.js` | 入口。DOMの監視、画面遷移への追従、適用済み状態の管理 |
| `src/banner.css` | バナーの見た目。GitHubのCSS変数を参照しダークテーマにも追従する |
| `test/matcher.test.js` | 判定ロジックの単体テスト |

権限(permissions)は要求していない。background、外部通信、ストレージも使わない。

## GitHubのDOMに合わせる手順

DOMに依存する記述は `src/dom-adapter.js` に閉じ込めてある。差し替えるのは次の2つの
定数だけで足りる。公開関数(`PMMS.dom.*`)のシグネチャと戻り値の意味は変えないこと。
呼び出し側はそこにだけ依存している。

- `CANDIDATES` … セレクタ候補(上から順に試す)
- `BUSY_HINTS` … 「マージ可否の判定中」を示す目印

### 実物のDOM(2026-08-18 採取・CI成功時と失敗時の両方)

```
<div data-testid="mergebox-partial">                       … 外枠。描画前から存在する
  <div class="MergeBox-module__mergeboxLoading__XXXX">      … 判定中はこれだけ
    <span data-component="Spinner">…<span>Loading</span>
  <div data-testid="mergebox-border-container">            … 判定後
    <section aria-label="Checks">…                          … 失敗時は展開されケバブ有り
    <div data-component="ButtonGroup">
      <button data-component="Button">…Merge pull request   … 主ボタン
      <button data-component="IconButton" aria-haspopup="true"
              aria-labelledby="ID">                         … 開閉ボタン
      <span id="ID">Select merge method</span>              … ツールチップ
<div data-component="Portal">                              … メニューは外に出る
  <ul role="menu" aria-labelledby="ID">
    <li role="menuitemradio" aria-checked="true">
      <span data-component="ActionList.Item.Label">Create a merge commit</span>
      <span data-component="ActionList.Description">All commits from …</span>
```

マージ先ブランチは埋め込みJSONの
`payload.pullRequestsLayoutRoute.pullRequest.baseBranch` から取り、無ければヘッダの
`a[data-component="BranchName"]` の `href`(`/owner/repo/tree/<branch>`)を使う。

### 保守するときの注意

- **CSS Modulesのクラス名は末尾にハッシュが付く**(`MergeBox-module__mergeboxLoading__FAuwT`)。
  デプロイごとに変わるため、完全一致ではなく `[class*="..."]` の部分一致で書く
- **`button[aria-haspopup="true"]` だけで開閉ボタンを探してはいけない**。CI失敗時は
  チェック欄が展開され、各行の「More actions」ケバブボタンが同じ属性を持ち、DOM順では
  マージ方法の開閉ボタンより**前**に来る。そのため `findMenuToggle()` は
  「主ボタンと同じ `ButtonGroup` の中」を第一の手掛かりにし、次にアクセシブルネーム
  (`Select merge method`)で特定する
- **メニュー項目は説明文を含む**。説明文まで混ぜて判定すると誤検出しうるので、
  `[data-component="ActionList.Item.Label"]` があればラベルだけを見る
- **メニューはポータル(`div[data-component="Portal"]`)に描画され、マージボックスの外に出る**。
  探索は `document` 全体で行い、`aria-labelledby` が開閉ボタンのものと一致する
  `role="menu"` に絞ることで他のメニューと混ざらないようにしている
- CI失敗でもマージボタンは `aria-disabled="false"` のまま(このリポジトリの設定では
  チェック必須ではない)。無効化されていても文言は読めるので検証は成立する
- **選択後は開閉ボタンのフォーカスを外す**。Primerはメニューを閉じたあと開閉ボタンへ
  フォーカスを戻すため、そのままだとツールチップ(Select merge method)が出続ける。
  `PMMS.dom.releaseFocus()` がフォーカスの復帰を待ってから `blur()` する
- **バナーの外枠に `margin` ショートハンドを使わない**。マージボックスの左余白クラス
  (`tmp-ml-md-6` など)を外枠に写して位置を合わせているため、`margin: 0 0 8px` のような
  指定は写した左マージンを打ち消してしまう。`margin-bottom` だけを指定する

### DOMを再採取する手順

UI変更で動かなくなったときは、ライブDOMから採り直す。**ページを保存したHTMLでは採れない**
(Reactが後から描画するため、サーバー応答にはローディング表示しか含まれない)。

1. write 権限のあるリポジトリで open な PR を開き、マージボックスの描画完了を待つ
2. マージ方法のドロップダウンを**開く**(閉じているとメニューが存在しない)
3. DevToolsのコンソールで次を実行する(クリップボードにコピーされる)

```js
copy([
  document.querySelector('[data-testid="mergebox-partial"]')?.outerHTML,
  document.querySelector('[data-component="Portal"]')?.outerHTML,
].filter(Boolean).join('\n\n<!-- ---- -->\n\n'))
```

CI成功時と失敗時の両方を採ると、チェック欄の展開状態の差による影響が確認できる。
拡張を読み込んだ状態なら、DevToolsの実行コンテキストをこの拡張に切り替えて
`PMMS.dom.capture()` でも同じものが得られる。動作を追いたいときは `PMMS.DEBUG = true`。

## ローディング状態の扱い

マージボックスは「このブランチがマージ可能か」の判定中はローディング表示になり、
判定完了時に再描画される。判定中に選択を触っても再描画で失われるため、
`PMMS.dom.isBusy()` が真の間は何もしない。

ただしスピナーの有無だけで判定すると、CI実行中の進捗表示を判定中と誤認して永久に
待ち続ける。そのため `isBusy()` は**選択UIが既に描画されていれば、スピナーが残って
いても false を返す**。

判定結果の更新などで選択が初期値に戻された場合は、MutationObserver と保険の定期確認
(`PMMS.CONFIG.pollIntervalMs`)が変化を拾い、選択し直す。

## テスト

```bash
node --test
```

`src/rules.js` と `src/matcher.js` を `node:vm` で読み込んで検証する。DOMを使う部分は
対象外なので、実際のPRページでの確認が必要。確認するときは `PMMS.DEBUG = true` にして
コンソールを見る。見るべき点は次の4つ。

1. `development` 系へのPRで、主ボタンが `Squash and merge` に変わる
2. `master` 系へのPRでは選択が変わらない(`Merge pull request` のまま)
3. CI失敗のPRでも、チェック行の「More actions」メニューが開かない
4. ローディング中に何も起きず、描画完了後に選択される

## 制限

- 選択状態を変えるだけで強制力はない。手で選び直せば別の方法でマージできる
- 拡張を入れていない人には効かない
- GitHubのUI変更で選択に失敗する可能性がある。その場合は赤いバナーで通知する
- github.com のみが対象。GitHub Enterprise Server で使う場合は `manifest.json` の `matches` を追加する
