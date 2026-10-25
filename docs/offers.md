# Pricing Gatewayによる参考価格

## 責務と制約

- 製品検索・フィルター・Dynamic Facet・製品情報は **pc-parts-catalog**。
- 一覧価格・構成行の参考価格確認は **pc-parts-pricingの公開Gateway** の `POST /v1/prices/summary` のみ。
- 旧Catalogのsummary/個別Offer API、実Provider直接接続、旧経路へのfallbackは撤去した。
- **店舗別比較・店舗別価格選択・購入リンクは一時的に提供しない。** Gatewayはsummaryのみであり、Offer、店舗名、購入URL、送料明細を返さない。`offer_count`は市場全体の店舗数・出品数ではなく、UIにも件数として表示しない。
- 対応取得先はYahoo!ショッピングのみ。送料・ポイントを推測・加減算せず、横断最安値とも説明しない。

## 契約・fixture

参照したPricing commit: **`a3ac223ae9756ab813e3a080ea7e468c66f49832`**。
参照ファイルは `docs/gateway-http.md`, `docs/interfaces.md`, `test/fixtures/gateway-http.json`, `src/gateway/http.ts`, `src/pricing/model.ts`。
Sheet着手時HEADは `61eea725984c1b7864f349a4f21aa685400c85c8`。既存の未コミットCatalog summary対応を土台に移行した。
Catalogは参照時HEAD `1a5188ad8e9e1d82c03352a055fdc5ffb1eb7406`。製品の `source` / `upstream_key` を利用し、Catalogのコード・設定は変更していない。

`src/test/fixtures/gateway-http.json` はPricingの同名fixtureの全named caseをコピーし、`_source` / `_commit` を追記したもの。
**価格・製品ref・時刻は架空のテストデータであり、本番価格や実測値ではない。**
更新時はPricingの契約差分を読み、対象commitのJSONを手動コピーし、メタデータと本書のcommitを更新して単体・E2Eを実行する。
テスト中のネットワーク取得や、他repoのNode/Cloudflare runtime importは行わない。

## 設定（Viteのビルド時設定）

`.env.example` を `.env.local` へコピーする。既定は次のとおり。

```dotenv
VITE_PRICING_ENABLED=false
VITE_PRICING_API_BASE_URL=
```

`VITE_PRICING_ENABLED=true` のときだけ通信する。無効と正常な販売情報0件は別状態。
有効でURLが欠落・不正なら設定エラーを表示し、検索・構成編集は継続できる。
無効化は `false` にして**再build・配信**する。既に開いている旧bundleを遠隔で停止する機能ではない。
環境変数は起動済みのVite dev serverにも再起動が必要。productionでは変更後に必ず再buildする。
ブラウザ用変数にAPI Secret、Cloudflare資格情報、独自Authorizationを設定しない。

- 接続先はHTTPS。credentials、query（空の`?`も含む）、fragmentを拒否する。
- HTTPは**表示ページのhostnameとGatewayのhostnameの両方がloopback**（`localhost`, `127.x.x.x`, `[::1]`）のときのみ許可。
- 開発環境は `import.meta.env.DEV` ではなく実行時のページhostnameで判断するので、localhost上のproduction previewも検証できる。リモートページからHTTP Gatewayへは接続できない。
- 実在未確認の本番URLを既定値にしない。接続先はQuery keyにも含み、別Gatewayのcacheを混ぜない。
- 旧 `VITE_CATALOG_OFFERS_SUMMARY_ENABLED` は機能設定から削除済み。残存していても無視され、旧経路は復活しない。E2Eだけは回帰検証のため意図的にtrueを渡す。

## ローカル開発

Pricing repoで、既存のoffline driverの**いずれか一方**を起動する（Pricingのコード・設定編集は不要）。

```sh
npm run dev:gateway
# または実Service Binding RPC + ローカルD1/Queue、Catalog/Providerはmock
npm run dev:gateway:rpc
```

Sheetの `.env.local`:

```dotenv
VITE_PRICING_ENABLED=true
VITE_PRICING_API_BASE_URL=http://127.0.0.1:8788
```

Sheetを起動:

```sh
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

ブラウザは `http://127.0.0.1:5173` を開く。driverの許可Originは `http://localhost:5173` と `http://127.0.0.1:5173` だけ。
**自動port変更はCORS不一致になるためstrictPortを使う。** ローカルproduction previewも同じOriginで確認できる。

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Pricing driverはofflineでも、Sheetの通常の製品検索先は既存の公開Catalogである。完全mockの確認は後述の通常テストを使う。
通常テストではdriverの手動起動も外部サービスも必要ない。driverの終了は起動terminalでCtrl+C。

## API境界

`src/api/pricing/` の `config.ts`, `client.ts`, `schemas.ts`, `control.ts`, `queries.ts` に分離。
既存のTanStack Query/Zodを使い、ライブラリは追加していない。

```json
{"products":[{"source":"buildcores","upstream_key":"CPU/test-fixture"}]}
```

これは架空refの形式例。実要求はCatalogから得たrefを内容・大小文字を変えず送る。
数値ID・名称・JAN/EAN・URL・provider指定は送らない。安全なJSON tupleでキーを表現し、ref集合を重複除去して安定ソートする。
入力は1〜100件。空は通信なし、100件超は入力エラーであり切り捨て・自動大量分割はしない。
応答の件数、refの不足・余分・重複・不一致・順序、provider keyとsummary.providerを検証する。
provider mapは境界でYahooの表示モデルへ変換し、UIは配列indexや数値IDではなくdurable refで対応付ける。

`Content-Type: application/json`, `credentials: omit`, AbortSignalを使用。独自header、Origin偽装、no-cors、公開されていないrefresh APIは使わない。
fetchからbody読取まで15秒でtimeout。利用者のAbortとtimeoutを区別し、Abortを障害表示や自動retryの対象にしない。
通信・JSON/schema障害をemptyに変換しない。取得時刻はサーバーの `fetched_at` のまま。

## 一覧・パネル・状態

Catalogの1ページ20件を先に表示し、表示中のrefsを1 bulkで取得する。行ごと、未表示ページ、全カテゴリへの価格要求はしない。
検索語・IME・条件・カテゴリ・ページ切替で旧価格Queryのobserverを解除し、最後のobserverが外れた不要要求はAbortする。
同じQueryに他の利用者がいるとき、その要求まではcancelしない。

|状態|表示・自動確認|
|---|---|
|初回通信中|価格を確認中|
|fresh complete|参考価格 `￥xx,xxx～`、自動確認終了|
|stale/期限切れcomplete|古い参考価格＋取得日時、有限再確認|
|pending（staleも含む）|更新待ち、有限再確認|
|fresh empty|販売情報なし、終了（市場全体の在庫なしではない）|
|stale/期限切れempty|前回は販売情報なし・再確認待ち|
|unsupported（staleも含む）|価格取得非対応、終了（在庫切れではない）|
|missing（staleも含む）|製品情報を確認できません、終了|
|初回障害|価格を取得できませんでした|
|再確認障害・前回値あり|前回値と再確認失敗を表示。最新取得成功と説明しない|
|無効/設定不備|専用の説明を表示、通信しない|

`stale`は更新処理の実行中を保証しない。pendingの過去expiryやstale unsupportedも受け入れる。
cacheが期限切れになった場合は前回値として表示し、サーバーによる後続のpending/empty等は前回のcompleteを混ぜず**全置換**する。

一覧の共通フッターには、pending/stale complete/stale emptyが残って自動確認が停止した場合、または価格エラーで停止した場合だけ「価格を再確認」を表示する。
初回取得・継続中のpolling/retry・正常な終端結果だけの一覧・無効/設定不備・空一覧では表示しない。
unsupported/missingはstaleでも未解決扱いにしない。製品追加前でも、表示中refsの既存bulkを手動で再確認できる。
cooldown中と通信中は操作不可。既存hookの `recheck` / `canRecheck` を使い、別fetchやtimer、保存価格の変更は追加していない。
手動要求中はボタンを維持し、完了後もそのボタンがfocusを持つ間は結果の文言を表示して残す。Tabやクリックで離れた後に隠す。
待機/通信中もfocusを不自然に失わないよう `aria-disabled` と操作ガードを併用する。

構成行の円マークボタンはcatalog行だけにある。パネルを開いたときだけ1件bulkを取得し、適切な一覧/同一製品cacheがあれば再利用する。
パネルには取得先、参考価格、取得日時、状態、制限付き手動再確認と「この価格を適用」を表示する。
閉じる・Escape・外側クリック・Tab離脱とフォーカス復帰を維持。閉じた後は不要な自動確認を止める。
古い保存製品にsourceがない場合は推測して送信せず、製品参照を確認できない旨を表示して通信しない。

## 有限polling・retry・cooldown・cache

定数は `PRICING_POLICY`。Queryの自動retry/mount/focus/reconnectは無効にし、1つの専用schedulerへまとめる。

- 20件以下：初回応答後10秒 → 20秒 → 30秒、その後30秒。
- 21〜100件：最低35秒。大batchの成功後も接続先単位で35秒待機する。
- 同じref集合につき**初回・retry込み最大12 HTTP試行、最初の要求開始から5分**。両方を満たす範囲のみ要求する。
- 上限到達はpending/empty等への変換ではなく、自動確認のみ停止。手動再確認を残す。数分以内の取得は保証しない。
- network/timeout/429/502/503/504だけ連続失敗の自動retryを最大1回。2連続失敗、その他HTTP、schema不一致は停止。
- Retry-Afterの秒・HTTP-dateに対応。429のheaderが読めない/不正なら60秒待機。通常pollingや手動操作も待機を追い越さない。
- cooldownはGateway接続先単位で共有。ページ/パネル切替で回避できない。Catalog検索のretryとは独立。
- 長い待機が5分の期限を越えるなら自動再確認は終了。手動再開もcooldown終了後のみ。
- 同じsessionの手動要求は同時実行しない。通常成功後も最低1秒待機。停止/上限後の明示再開だけ新予算とし、短時間のremountでは予算をリセットしない。
- 非表示/offlineでは新規要求を出さず、復帰後は一度だけ次の必要な確認を行う。過去timerの一斉発火はしない。
- cacheとsessionはメモリのみ。Queryはobserverなし10分でGCされ、対応sessionも削除する。期限切れcooldownはGC時に削除する。ページreloadで消え、localStorageへ保存しない。

## 構成価格・保存互換性

- 製品追加/置換の**選択時点**で利用可能なcompleteだけ初期価格へコピー。stale completeも明示した古い値として利用可能。上限超過・障害・その他状態はnull。
- 遅延summary、再取得、cache更新、パネル開閉で保存済みprice/0/null/未保存draftを自動変更しない。
- パネルの明示適用だけ対象行を変更し、既存のMAX_PRICE検証を使う。未保存draftの置換、通知とfocus復帰も維持。
- 適用直前に現在の行kindとdurable refを再照合。削除/別製品への置換後に古い製品の価格を適用しない。数値ID変更だけなら同一refとして扱う。
- 保存キー/形式はversion 5のまま。既存migrationとcustom行、0円、null、旧versionからの復元を維持。summary、polling、APIエラーは保存しない。

## 検証

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:pricing
git diff --check
```

`test:e2e` は無効のproduction build、`test:pricing` は有効な専用production previewをPlaywrightがbuild/起動/終了する。
どちらもdesktop/mobileで確認し、外部Pricing serverは不要。
通常E2Eの出力先は `test-results/standard/`、Pricingは `test-results/pricing/`。それぞれ独立にcleanupし、JSON結果・失敗trace・error-context・取得可能な失敗画像を保持する。
CIはブラウザ導入までの前提成功を条件に、通常E2Eが失敗してもPricing E2Eを実行する。キャンセル/前提失敗時は開始せず、どちらかの失敗を成功に置き換えない。
画像保存失敗の調査・反復検証・限定retry・診断添付の詳細は [E2E追跡記録](e2e-pricing-followup.md) を参照。
全通常E2Eは未mockの外部通信を拒否し、旧Catalog価格APIへの要求はmockされていても失敗させる。
旧フラグtrueを意図的に残し、新Pricing要求以外が復活しないことも検証する。`test:offers` は `test:pricing` へ置き換えた。
単体では契約、ref照合、各状態、HTTP/body timeout/Abort、有限retry/polling、cooldown、cache、remount/非表示/offline/復帰/GC、行の安全な適用を検証する。
**`test:live` は公開Catalog依存の任意試験であり、通常CIに含めず、今回も実行しない。**

## 本番接続前の残作業（未確認）

フロント実装完了、ローカルmock検証、CI成功、本番接続、デプロイは別の段階。
本対応ではPricing/Catalogのコード・設定・デプロイ状態、本番環境を変更していない。本番Gateway/Providerの試験も行わない。

別repo/本番運用側で次を確認する必要がある。

1. **実Gateway URLの確認**（推測しない）。
2. GatewayでSheet本番HTTPS Originを許可し、受付を有効化する承認済み運用。
3. Pricing本体の必要稼働version/commit、既存migrationの適用状態の確認。
4. 確定URLをSheetビルド環境へ設定し、明示承認後にbuild/配信・接続確認。

未確認のURL/Origin/受付/version/migrationを、フロントのmock成功を根拠に確認済みとは扱わない。
