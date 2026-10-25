# Pricing統合後のE2E・一覧再確認の追跡

## 対象と観測したCI失敗

- 対象HEAD: `96b409dd2fa1e2fbc4806fcd9014147618e912f7`、main。着手時の作業ツリーはclean、repo/祖先に適用されるAGENTS.mdなし。
- CI: [40197598270](https://github.com/kikuuuty/pc-build-sheet/actions/runs/40197598270)。ログと `playwright-results` artifactをGitHub CLIで取得し、trace/error-contextと保存画像を確認した。
- lint/typecheck/545単体/build/ブラウザ導入は成功。通常E2Eは157成功・1失敗、Pricing E2Eはskipped。
- 直接の失敗はdesktopの `broad selection and product areas...` の **最初の320×960へのresize後のfullPage撮影**。
- traceの `setViewportSize` とframe snapshotは320×960。寸法・各行の高さ・横スクロールのassertionは通過し、fonts loaded後の `Page.captureScreenshot` が `Unable to capture screenshot` を返した。
- 失敗したdesktopのPNGはない。mobileの同じ320px幅の保存画像は正常に取得されていた。失敗時のページ全体の高さは旧診断に記録がなく、成功したmobile画像の高さをdesktopの値と同一視しない。
- traceにpageerror/crash/disconnectの記録はないが、旧テストは専用イベント診断を備えていなかったため、それらやcompositor/実行資源の問題を完全には除外できない。
- traceはLinux / Playwright 1.63.0。通常E2E設定はPricing無効のproduction buildで、CIの無効・旧フラグtrue回帰テストも成功していた。Pricing通信が原因だと示す証拠はない。

**撮影処理の失敗は確定。根本原因は未確定。** 寸法違反、Pricingの不具合、一時的な不安定テストなどとは断定しない。

## ローカル反復

Windows、Node 24.16.0、npm 11.13.0、Playwright 1.63.0、既存lockfileのChromium。依存更新なし。
すべてloopbackのproduction previewとmockを利用し、通常E2EはPricing無効。

```sh
npx playwright test e2e/build.spec.ts --project=desktop --grep "broad selection and product areas" --repeat-each=10 --workers=1
npx playwright test e2e/build.spec.ts --project=desktop --grep "broad selection and product areas" --repeat-each=10 --workers=4
```

実行時は調査結果を混ぜないよう `--output=test-results/investigation-...` と `--reporter=dot` を指定した。

|コード|workers|試行|撮影失敗の再現|結果|
|---|---:|---:|---:|---|
|着手時の元コード|1|10|0|10成功、40.2秒|
|着手時の元コード|4|10|0|10成功、14.6秒|
|安定待ち・限定retry・診断追加後|1|10|0|10成功、36.3秒|
|安定待ち・限定retry・診断追加後|4|10|0|10成功、15.3秒|

1 workerとCI相当の4 workersに差となる失敗は再現しなかった。Linux CI固有条件の再現・根本解消を保証する結果ではない。
通常スイート全体でも既存のdesktop/mobile寸法・操作検証を維持する。

最終の通常スイート（4 workers）の診断ではChromium `153.0.8010.12`、DPR 1（desktop）、fonts loaded/readyState complete。
desktopのviewportとdocument幅は一致し、document高さは次のとおり。全7撮影（6幅＋hover）は初回で成功し、pageerror/crash/close/disconnectは0件。

|viewport幅×高さ|document幅×高さ（CSS px）|
|---|---|
|320×960|320×1991|
|393×960|393×1991|
|740×960|740×1969|
|1024×960|1024×2011|
|1280×960|1280×1190|
|1440×960|1440×1190|

実測JSONは `test-results/standard/build-broad-selection-and--bd5b7-t-intercepting-row-controls-desktop/screenshot-diagnostics.json`。
これらは今回のローカル実測であり、過去のCI失敗時のページ高さを復元した値ではない。

## 撮影処理の変更と証拠の保持

- 対象テストの各viewportをstep名に記録し、機能assertionと診断撮影を別stepに分けた。
- フォント読込と、連続する描画frame間でのviewport/ページ/本文寸法の一致を待つ。固定sleepは追加しない。
- 撮影のみanimationsを無効化。元の全viewport、寸法、横スクロール、クリック、キーボード、focus検証は維持。
- **この `Page.captureScreenshot` protocol errorだけ最大1回再試行**する。再試行前も安定待ちを行い、annotationとwarningを残す。
- 2回目の失敗、timeout、ページ終了、レイアウトassertion等はthrowし、テスト全体の無条件retryはしない。単体でこの境界を検証する。
- `screenshot-diagnostics.json` に各撮影のviewport、document/body/visual viewport寸法、DPR、fonts/readyState、試行結果、pageerror/crash/close/disconnect、Node/platform/browser/workers/repeat番号を保存・添付する。
- 復旧した1回目の撮影エラーもJSONとannotationに残る。最終失敗はtrace・error-contextとともに可視化する。画像取得自体が不可能な場合にもJSONを残す。

これは再現しなかった現象への**診断・限定的な耐障害性の改善**であり、根本原因の修正済み宣言ではない。

## 両スイートを実行するCI

既存jobを維持し、ブラウザ導入stepへ `id: browsers` を設定した。それ以前の各前提は既定の成功条件で順次実行する。
Pricing stepだけ `!cancelled() && steps.browsers.outcome == 'success'` とし、通常E2E失敗後でも前提が成功していれば起動する。
前提失敗/キャンセル時は開始しない。continue-on-errorは使わず、どちらかの失敗でjobは失敗のまま。

- 通常: `test-results/standard/`、Pricing: `test-results/pricing/`。兄弟ディレクトリなので後続のcleanupが前段を削除しない。
- 各スイートに独立した `results.json` を保存。失敗trace/error-context/画像とともに共通artifactへアップロードし、7日保持する。
- `screenshot: only-on-failure` / `trace: retain-on-failure` は両方に適用。対象テストは成功時も診断画像・JSONを保存する。
- 変更後のGitHub Actionsはまだ実行していない。ローカルでの両スイート実行とCI成功は区別する。

cleanupの実測確認として、新追加テストの初回Pricing失敗時のtrace/error-context/PNGが、後続の通常スイート実行後も同じSHA-256で残ることを確認した。
通常スイート後のJSON/診断JSON/PNGも、その後のPricingスイートのcleanup後に同じSHA-256で残ることを個別に確認した。
同一スイートを再実行すると自身の出力は更新されるが、他方の出力は保持する。

## 一覧の控えめな再確認

フッター1か所だけに補助操作を追加。表示条件・focus維持は [参考価格ドキュメント](offers.md#一覧パネル状態) を参照。
stopped単独ではなく、未解決なpending/stale complete/emptyまたは停止エラーがあることを必要条件にする。
完了済みのcomplete/empty、unsupported/missingは、セッションの時間上限やstaleだけで再確認対象にしない。
既存hookの操作・cooldown・bulk・session再開を利用し、取得制御の定数/方針、保存形式version 5は変更していない。

追加E2Eでは、停止後の一覧からの復旧と初期価格コピー、Retry-Afterの維持とページ/再open、連打防止、遅い旧応答の分離、既存価格/0円/invalid draftの非上書き、320px含むfooter・keyboard/focusを確認する。
新しい長時間待機E2Eの初回実行では2件が失敗した。mockの503応答に `Access-Control-Expose-Headers: Retry-After` がなく、ブラウザから600秒の指示を読めず通常retry扱いになっていたため。
Gatewayの既存契約どおりmockでheaderを公開するよう修正した。実Gatewayや制御側の変更ではない。修正後の該当2件は成功。

## 最終検証

|コマンド|最終結果|
|---|---|
|`npm run lint`|成功|
|`npm run typecheck`|成功|
|`npm test`|16 files / 564件成功|
|`npm run build`|成功|
|上記の単独反復（元コード/変更後、各1/4 workers）|各10回、計40回成功。撮影失敗の再現0|
|`npm run test:e2e`|desktop/mobile 158件成功（最終61.6秒）|
|`npm run test:pricing`|desktop/mobile 46件成功（最終14.5秒）|
|`git diff --check`|成功|

両E2Eの `results.json` はそれぞれskipped / unexpected / flakyすべて0で、別々に確認した。
途中の新規Retry-After E2Eの2件失敗は前述のmock CORS不足を修正し、対象2件の再実行と全46件で成功を確認した。
変更後のGitHub Actionsは未実行であり、前回のCI失敗を新CI成功へ読み替えていない。
本番API、実Yahoo、test:live、Cloudflare操作は行わない。バックエンドのコード・設定、Gateway契約、保存形式は変更しない。
本番URL/Origin許可/受付/稼働version・migration等は従来どおり未確認。本対応やローカル成功だけを根拠に本番接続へ進めない。
