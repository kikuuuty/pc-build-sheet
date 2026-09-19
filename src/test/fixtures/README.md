# Catalog fixtures

2026-09-19に本番API `https://pc-parts-catalog.kikuuuty.workers.dev` で確認したレスポンスです。Backend HEAD: `04a9d37`。

- `categories.json`: `GET /v1/categories`（30カテゴリ）
- `cpu-search.json`: `GET /v1/search?category=cpu&q=9800x3d&limit=20&offset=0`
- `cpu-listing.json`: `GET /v1/search?category=cpu&limit=1`（nullable windowとopaque cursorの検証用）

保存したcursorは固定テスト専用です。実APIテストでは毎回レスポンスから次のcursorを取得します。E2Eの合成ページもkeyword/listingそれぞれのmetadata契約に合わせています。

製品データ: Contains information from [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db), made available under the [ODC Attribution License (ODC-By 1.0)](https://opendatacommons.org/licenses/by/1-0/).
