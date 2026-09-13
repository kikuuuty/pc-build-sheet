# 自作PC構成シート

PCパーツを検索・追加し、単価・数量を入力して構成と見積もりを作成できるWebツールです。商品一覧ではなく構成シートを起点に、全カテゴリを同じ操作で扱えます。Phase 2まで実装済みです。

## 技術スタック

- React / TypeScript / Vite
- TanStack Query：カテゴリ・製品検索のサーバーステート
- Zustand + persist：構成のクライアントステート・localStorage保存
- Zod：APIレスポンスと保存データの境界検証
- Lucide React / 通常CSS（UIフレームワークなし）
- Vitest / Playwright

## 開発

Node.js **22.12以上（24 LTS推奨）**、npmを使用します。APIキー・環境変数の設定は不要です。

```sh
npm ci
npm run dev
```

表示されたローカルURL（通常 `http://localhost:5173`）を開いてください。

```sh
npm run build
npm run preview
```

本番成果物は `dist/` に出力されます。静的ホスティングに配置できます。

## 検証

```sh
npm run lint
npm run typecheck
npm test
npm run build

# 初回のみChromiumをインストール
npx playwright install chromium
npm run test:e2e

# 実際の公開APIに接続する任意のスモークテスト
npm run test:live
```

- 単体テスト：単価×数量、購入合計、流用/未入力/0円の区別、数量ベースの集計、価格入力の正規化と上限、部分更新のinvariant、任意項目の追加・更新・削除、persist対象・復元・v1→v2 migration・不正データ・保存障害。既存のAPI schema・HTTP/通信エラー・中断・retry方針・スペック表示も検証します。
- E2E：APIを固定レスポンスに置き換え、PC/モバイルで検索→追加→単価/数量→流用/購入→メモ→リロード→任意項目→削除の一連の操作、複数Storage、旧データ移行、入力エラー、320px幅・長文のレイアウトを検証します。検索Dialogのdebounce・IME・pagination・0件・エラー・中断・フォーカス制御の既存テストも維持しています。E2E/実APIテストは実行前に本番ビルドを作成し、PlaywrightがVite previewを起動・終了します。
- `test:live`：9カテゴリの実レスポンスをschema検証し、ブラウザから `9800x3d` 検索 → 追加 → リロード → 削除まで確認します。ネットワークと公開APIの稼働状況に依存します。
- スクリーンショット・失敗時traceは `test-results/` に出力します（Git対象外）。
- GitHub Actions（`.github/workflows/ci.yml`）：PRとmainへのpushでNode.js 24上の `npm ci` → lint → typecheck → unit test → production build → Playwright Chromiumセットアップ → desktop/mobile E2Eを実行します。通常CIは公開APIに依存せず、`test:live` は含めません。

## APIとの接続

**pc-parts-catalog**：<https://pc-parts-catalog.kikuuuty.workers.dev>

- `GET /v1/categories`：サーバーが提供するカテゴリを確認。表示名・表示順は `src/domain/categories.ts` に集約しています。
- `GET /v1/search?category=cpu&q=9800x3d&limit=20&offset=0`：製品検索。空の検索語は `q` を省略し、カテゴリ一覧を取得します。
- 1ページ20件。続きは `meta.next_offset` を使用します。`meta.returned` は表示中の件数で、総ヒット数ではありません。
- 認証なし、`credentials: 'omit'`、公開CORSを使ってブラウザから直接接続します。
- 300ms debounce、IME変換中の検索抑制、検索語変更・モーダル終了時のAbortSignalによる中断。
- Queryのメモリキャッシュは60秒。通信/timeout/502/503/504は最大1回のbackoff再試行（`Retry-After` が60秒を超える場合は自動再試行なし）。429や400/500、schemaエラーは自動再試行しません。手動再試行も `Retry-After` を尊重します。
- 個々のHTTPリクエストは15秒でtimeout。利用者には日本語のエラーを表示し、レスポンス本文やstack traceは表示しません。

契約は2026-09-13に以下と実レスポンスで確認しました。

- [Consumer API契約](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/cloudflare-production.md#frontend-integration-quick-reference)
- [Workerのレスポンス生成](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/worker.js)
- [カテゴリ別spec型](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/model.js)

`CatalogProduct` はカテゴリで判別できるZod schemaから型を導出しています。未知の追加フィールドは除去し、既知の欠損spec値は `null` として扱います。製品参照にはカテゴリを含む `upstream_key` を保持します。APIのDB内部IDやUUID単体を恒久的な製品識別子として扱いません。

## 主な構成

```text
src/
  api/catalog/        client・Zod schemas・型・Query hooks
  components/         共通Dialog・出典表記
  domain/             9カテゴリ定義・主要スペックの表示変換・共通円フォーマット
  features/
    build/            構成シート・行内編集・詳細Dialog・サマリー・計算・schema/migration・store
    search/           検索Dialog・debounce・検索状態表示
  test/fixtures/      実APIから取得したCPU検索レスポンス
  App.tsx             画面と検索Dialogの組み立て
  main.tsx            React・QueryClientの初期化
  styles.css          デザイン変数・レスポンシブCSS
e2e/                  固定レスポンスE2E・実APIスモークテスト
```

責務は `UI → Query hook → API client → pc-parts-catalog` に分離しています。

構成は `BuildItem[]` です。Zod schemaから導出する判別可能なunionです。

```ts
type EditableFields = {
  quantity: number
  price: number | null
  source: 'buy' | 'owned'
  memo: string
}
type BuildItem =
  | (EditableFields & { id: string; kind: 'catalog'; category: PartCategory; product: CatalogProduct })
  | (EditableFields & { id: string; kind: 'custom'; name: string })
```

各Itemに独立したIDを持ち、同じカテゴリ/製品を複数追加できます。ユーザーの価格・数量・購入区分・メモを `CatalogProduct` へ書き込みません。任意項目に偽のカタログ製品や既存9カテゴリを割り当てません。

Store actionsは `addItem` / `addCustomItem` / `updateItem`（価格・数量・購入区分・メモの部分更新）/ `updateCustomDetails`（名前・メモ）/ `removeItem` / `clearBuild`。編集actionはZod検証後に更新し、不正な更新はまとめて拒否します。ID・kind・製品・カテゴリは部分更新の対象外です。

### 保存schema / migration

- 保存キー：`pc-build-sheet:build`、**schema version：`2`**。保存対象は `items` のみで、検索結果・モーダル状態・入力途中のdraft・actionsは保存しません。
- **version 1 → 2**：`checkedStorage` で旧形式を検証した後、Zustand persistの `migrate` で各Itemへ `kind: 'catalog'` を補完します。ID・製品スナップショット・quantity・price（0/nullを含む）・source・memoを保持し、version 2形式で保存し直します。
- 未知version、重複ID、製品とカテゴリの不一致、必須フィールド欠落、編集値の範囲違反などはmigrationしません。値を推測・丸め・切り詰めして復元することはありません。
- 保存データもZod検証し、読込/書込失敗を画面に表示します。読めない保存データは自動消去せず、次の構成変更時に更新します。保存失敗時も画面上の構成は保持します。
- 保存はこのブラウザ内のみで、端末間同期はありません。次のschema変更でもversionを上げ、v1/v2からの移行経路を維持してください。

### 見積もりの入力・計算ルール

**価格はユーザーが手入力する1個あたりの単価**です。ECサイトからの取得・自動更新は行いません。

| 項目 | ルール |
| --- | --- |
| 単価 | 日本円の整数、0〜100,000,000円。未入力は `null`、0円とは別扱い |
| 入力確定 | フォーカスを外すかEnterで保存。空欄確定で `null`。入力中はdraftを維持し、Escで未確定変更を取消 |
| 入力エラー | 負数・小数・指数表記・上限超過などは保存せずエラー表示。全角数字と正しい3桁区切りは正規化可能 |
| 数量 | 1〜99の整数。−/＋で編集。メモリkitなどもカタログ製品1商品を数量1として扱う |
| 購入/流用 | 初期値は購入。流用へ切り替えても単価を保持し、購入へ戻すと再利用 |
| 名前 / メモ | 任意項目名は空白以外の1〜200文字、メモは最大1,000文字 |

計算は `features/build/totals.ts` の純粋関数 `getItemSubtotal` / `getBuildSummary`、円表示は `domain/currency.ts` の `formatYen` に集約しています。

- **パーツ**：すべてのItemのquantity合計（任意項目も含む）。SSD ×2は2点。
- **購入合計**：`source === 'buy' && price !== null` の `price × quantity` の合計。
- **流用品**：`source === 'owned'` のquantity合計。**単価があっても購入合計には含めません**。
- **価格未入力**：`source === 'buy' && price === null` のquantity合計。流用の価格未入力は数えません。
- 未入力があっても購入合計を表示し、**「価格未入力 N点。購入合計は入力済み分のみで、構成全体の総額ではありません」**と明示します。全購入品が未入力の場合も同じ注意付きの0円表示となります。
- 行の小計は購入・価格ありで金額、購入・未入力で `—`、流用で `流用` と表示します。

## 現在の機能

- 9カテゴリを常時表示する構成シート、PCの2カラム/スマートフォンの1カラム
- 各カテゴリ共通の中央配置wide modal、基本検索、ページ移動、主要スペック表示
  - PC：幅最大900px・高さ85dvh。モバイル（幅700px以下）：四辺に12pxの余白を残すほぼ全画面表示。タイトル・検索欄を上部に残し、結果領域だけをスクロールします。
  - 共通 `Dialog` は用途を明示する `variant="wide" | "confirm" | "edit"` を必須指定。検索は `ProductSearchDialog`、構成リセットは小型confirm、名前・メモ編集は独立した小型editを使用します。
- 商品名・主要スペックを主情報とするシート行に、コンパクトな購入/流用toggle・単価入力・数量stepper・小計を配置。狭い画面はカテゴリと商品を縦積みにし、入力操作は2列に折り返します。
- メモは「メモを追加/編集」から編集。保存済みメモを行内で表示し、長文は最大3行のスクロール領域に収めます。
- 「その他」セクションの「任意項目を追加」からOS・ケーブル・アクセサリ等を追加。名前・メモを入力した後、シート上で価格・数量・購入/流用を編集できます。
- パーツ/任意項目の追加・個別削除・構成リセット、ブラウザへの自動保存
- パーツ数・購入合計・流用品数・価格未入力数。小計/サマリー変更の読み上げと、Item別の入力/数量操作ラベル
- 検索中・入力待ち・0件・APIエラー・保存障害の表示
- キーボード操作、Escape・backdropクリックで閉じる、モーダル内フォーカス制御と終了時の復帰。文字選択のドラッグが背景へ抜けても閉じません。

## 今後の予定 / TODO

- **Phase 3**：消費電力概算、推奨電源容量、基本的な互換性警告。
- **Phase 4**：構成のURL圧縮・共有、共有モード/編集モードの分離。
- **Phase 5**：外部Price Provider連携。

Phase 3へ進む前に、電力/互換性に必要なカタログspecの欠損時の扱い、同一カテゴリ複数Itemやkitの数量解釈、流用品も判定対象にするルール、任意項目の情報不足、概算/警告の根拠と表示密度を検討します。保存に新しいユーザー設定を追加する場合はmigrationも必要です。

外部価格取得・互換性判定・電力計算・URL共有・ログイン・クラウド保存・高度なフィルターは未実装です。

## データ出典

製品データはpc-parts-catalogを経由して **BuildCores OpenDB** を利用しています。画面のフッターと検索結果に出典・ライセンスを表示します。テストfixtureも同データに由来します。

> Contains information from [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db),
> which is made available under the [ODC Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/).

データの加工はカテゴリ/スペックの表示整形と、選択した製品のブラウザ内保存です。価格や互換性の保証を意味するデータではありません。
