# Yahoo価格表示・比較

## 公開状況（2026-09-23）

`GET /v1/products/:id/offers` はバックエンドの [正式仕様](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/product-offers.md) に合わせて接続済みです。
商品／seller画像を含むレスポンス全体をZodで検証し、リンクはHTTP(S) URLのみ許可します。

**検索一覧価格にはbulk summary backendが必要です。** 公開ドキュメントにSummary APIはなく、本番
`POST /v1/products/offers/summary` は404 `NOT_FOUND`でした。
そのため `VITE_CATALOG_OFFERS_SUMMARY_ENABLED` は既定で無効です。一覧は「価格情報なし」、選択時は未入力になります。
単一Offer APIへフォールバックしません。比較popoverはこのフラグに関係なく利用できます。

## 一覧の接続境界

`ProductSearchDialog` → `useOffersSummary` → `getOffersSummary` → bulk POST。
検索結果は価格を待たず表示します。query keyは `['catalog', 'offers-summary', sortedUniqueProductIds]`。
前ページのplaceholder dataは使わず、価格は製品IDで対応付けます。条件変更・ページ変更でobserverが切り替わり、不要な通信は中断されます。

仮contract（`src/api/catalog/offers.ts`）:

```json
{ "product_ids": [372, 1234] }
```

```json
{ "products": [
  { "id": 372, "status": "complete", "lowest_price": 57629, "offer_count": 28 },
  { "id": 1234, "status": "unsupported", "lowest_price": null, "offer_count": 0 }
] }
```

各IDに1件の結果を要求します。仮の `pending` / `error` は価格null・件数0として行単位の状態表示も可能です。
欠落ID・重複ID・不一致ID・矛盾した最低価格／件数は失敗扱いです。検索・選択自体は継続できます。
本番接続前に正式contractにschema/clientを合わせ、bulk APIが外部MISSを安全に処理することを確認し、ビルド時に
`VITE_CATALOG_OFFERS_SUMMARY_ENABLED=true` を設定してください。フラグだけで提供済み扱いにはしないでください。

## 構成価格と市場価格

`addItem(product, { initialPrice })` / `replaceItem(id, product, { initialPrice })` の実行時に一覧の最安価格を初期値としてコピーします。
価格未取得・失敗・非対応はnull。既存入力上限（1億円）超も選択を妨げずnullにします。
追加後は `PriceInput` のユーザー編集、またはpopoverのショップ名・価格部分の選択で明示的に変更できます。遅れて届くsummary、Offer refresh、popover開閉による価格変更はありません。
ショップ選択は開いた構成行のpriceだけを更新し、未保存の価格draftも置き換えます。反映後はpopoverを閉じ、Storeへfocusを戻して変更を読み上げます。
送料は加算せず、販売店の選択状態は保存しません。入力上限（1億円）を超えるOfferの反映ボタンは無効です。
構成storeはOffer queryを参照しません。保存対象は従来どおりproductとprice等の構成項目だけ、storage versionは5です。

## 比較popover

- catalog行の価格と削除の間にStoreボタン1個。customにはボタンも通信もありません。
- 開いた時だけ取得。行が所有する `['catalog', 'offers', productId]` のqueryをpanelに渡し、同一製品の別行とも共有します。
- staleTime 5分、window focusによる再取得なし。メモリのみのQuery cacheです。閉じてからの再openはfresh cacheを再利用します。
- 既存catalogのtimeout／最大1回retry／Retry-After方針を共用。失敗はpanel内表示と再試行に限定されます。
- React state + fixed positioned portalの非モーダルdialog。Escape・外側クリック・Store再クリック・閉じるボタンでclose。
  開いた時はpanelへfocus、Escape／明示closeでStoreへ復帰。Tabで外へ移動した時もcloseし、移動先のfocusを維持します。
- 価格をコピーした配列で昇順sortし、同額最安すべてに文字バッジ。送料名をそのまま表示し、金額の推測なし。
- ショップ名・価格・送料・最安バッジの領域を1つの選択ボタンとして扱い、クリック／タップ／Enter／Spaceで価格を反映します。ホバー・キーボードfocus時に背景を強調し、タップ領域の高さは44px以上です。右端の外部リンクは独立した要素で、商品ページを新規タブで開くだけで構成価格を変更しません。ロゴ・画像は表示しません。
- 最大480px・内部scroll、viewport内に位置補正。mobileは商品名と価格／44px店舗／44px削除の2段、狭い比較行は送料を折り返します。

## 検証

`npm test` でschema・HTTP・summary境界・選択価格・保存形式を検証します。
`npm run test:e2e` は既定（bulk無効）の既存UI回帰、`npm run test:offers` はbulkフラグ有効の専用Vite dev serverを起動し、
全APIをmockしてdesktop/mobileで検索価格・遅延・エラー・ページ切替・初期値・非同期非上書き・比較・focus・scroll・cacheを検証します。
Offer価格の明示反映・行単位更新・未保存draftの取消・手動再編集・保存復元・外部リンクとの独立も検証します。
どちらも実Yahoo APIは呼びません。後者はproduction buildのフラグを変更しません。
