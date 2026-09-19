# 自作PC構成シート

PCパーツを検索・追加し、価格を入力して構成と見積もりを作成できるWebツールです。商品一覧ではなく構成シートを起点に、全カテゴリを同じ操作で扱えます。1行＝1商品とし、複数必要なパーツは「追加」から行を増やします。

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

- 単体テスト：各行の価格合計、未入力/0円の区別、行数ベースの集計、価格入力の正規化と上限、部分更新のinvariant、カテゴリごとのsingle/multiple制約、製品置換と価格リセット、任意項目の追加・名前変更・削除、persist対象・復元・v1/v2/v3/v4→v5 migration・不正データ・保存障害。旧数量の行展開で金額・点数を保ち、IDが衝突しないことも検証します。既存のAPI schema・HTTP/通信エラー・中断・retry方針・スペック表示も検証します。
- E2E：APIを固定レスポンスに置き換え、PC/モバイルで検索→追加→価格入力→0円入力→リロード→任意項目→削除、製品名からの置換、複数Storageの独立編集、旧データの0円変換・行展開と移行後の再編集、入力エラーを検証します。9カテゴリを埋めたシートの高さ、desktop列の整列、320px幅を含む操作要素の重なり・横スクロールも確認します。検索Dialogのdebounce・IME・pagination・0件・エラー・中断・フォーカス制御の既存テストを維持し、追加/置換両モードでpagination・中断・フォーカス復帰を検証しています。E2E/実APIテストは実行前に本番ビルドを作成し、PlaywrightがVite previewを起動・終了します。
- `test:live`：カテゴリ一覧と既存9カテゴリの実レスポンスをschema検証します。ブラウザでCPU空欄一覧のcursorページ移動・前へ、`ryzen` のoffsetページ移動・前へ、`9800x3d` 検索 → 追加 → リロード → 削除まで確認します。ネットワークと公開APIの稼働状況に依存します。
- スクリーンショット・失敗時traceは `test-results/` に出力します（Git対象外）。
- GitHub Actions（`.github/workflows/ci.yml`）：PRとmainへのpushでNode.js 24上の `npm ci` → lint → typecheck → unit test → production build → Playwright Chromiumセットアップ → desktop/mobile E2Eを実行します。通常CIは公開APIに依存せず、`test:live` は含めません。

## APIとの接続

**pc-parts-catalog**：<https://pc-parts-catalog.kikuuuty.workers.dev>

- `GET /v1/categories`：API側の30カテゴリと将来追加される非空のカテゴリIDを受け入れます。UIは `src/domain/categories.ts` の既存9カテゴリを維持し、選択カテゴリがAPI一覧に存在することを確認してから検索します。
- 検索語あり：`GET /v1/search?category=cpu&q=9800x3d&limit=20&offset=0`。続きは `meta.next_offset`、前へは使用済みoffsetの履歴を使用します。`next_cursor` はnull、検索windowは1000件です。
- 検索語なし：`GET /v1/search?category=cpu&limit=20`。続きは `cursor=meta.next_cursor`、前へは使用済みcursor（初回は省略）の履歴を使用します。`q` / `offset` は送信しません。`window_limit` / `next_offset` はnull、レスポンスの `offset` は全ページ0です。
- `SearchParams` とDialogのpagination状態はkeyword/listingの判別可能なunionです。cursorは不透明な値として扱い、検索語変更時に履歴を初期化します。
- 1ページ20件。次のoffset/cursorがnullなら「次へ」を無効化します。keywordの `window_exhausted` は絞り込み案内を表示します。`meta.returned` は表示中の件数で、総ヒット数ではありません。
- 認証なし、`credentials: 'omit'`、公開CORSを使ってブラウザから直接接続します。
- 300ms debounce、IME変換中の検索抑制、検索語変更・モーダル終了時のAbortSignalによる中断。
- Queryのメモリキャッシュは60秒。通信/timeout/502/503/504は最大1回のbackoff再試行（`Retry-After` が60秒を超える場合は自動再試行なし）。429や400/500、schemaエラーは自動再試行しません。手動再試行も `Retry-After` を尊重します。
- 個々のHTTPリクエストは15秒でtimeout。利用者には日本語のエラーを表示し、レスポンス本文やstack traceは表示しません。

契約は2026-09-19にBackend HEAD `04a9d37` の以下の実装・ドキュメントと本番レスポンスで確認しました。

- [Consumer API契約](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/cloudflare-production.md#frontend-integration-quick-reference)
- [Workerのレスポンス生成](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/worker.js)
- [カテゴリ別spec型](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/model.js)
- [追加カテゴリのspec型](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/extended-models.js)
- [Pagination契約](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/pagination.md)

`CatalogProduct` は既存9カテゴリで判別できるZod schemaから型を導出しています。既存9カテゴリのspec型はBackendと一致し、未知の追加フィールドは除去、既知の欠損spec値は `null` として扱います。HTTP製品schemaは `source` を必須とし、以前の保存済み製品はsourceなしでも復元できます（保存versionは5を維持）。製品参照には `source` とカテゴリを含む `upstream_key` を保持します。APIのDB内部IDやUUID単体を恒久的な製品識別子として扱いません。

将来30カテゴリをUIへ追加する際は、`extended-models.js` に対応する製品schemaのunion分岐、`PartCategory`・表示名・表示順・追加制約、スペック要約、Store/保存データの対応とテストを拡張する必要があります。今回のカテゴリ一覧schemaはUIカテゴリ定義に依存しませんが、製品検索・構成シートは引き続き既存9カテゴリが対象です。

## 主な構成

```text
src/
  api/catalog/        client・Zod schemas・型・Query hooks
  components/         共通Dialog・出典表記
  domain/             9カテゴリ定義・主要スペックの表示変換・共通円フォーマット
  features/
    build/            高密度シート・行内編集・任意項目名Dialog・サマリー・計算・schema/migration・store
    search/           検索Dialog・debounce・検索状態表示
  test/fixtures/      実APIのカテゴリ一覧・CPU keyword検索・cursor一覧レスポンス
  App.tsx             画面と検索Dialogの組み立て
  main.tsx            React・QueryClientの初期化
  styles.css          デザイン変数・レスポンシブCSS
e2e/                  固定レスポンスE2E・実APIスモークテスト
```

責務は `UI → Query hook → API client → pc-parts-catalog` に分離しています。

構成は `BuildItem[]` です。Zod schemaから導出する判別可能なunionです。

```ts
type EditableFields = {
  price: number | null
}
type BuildItem =
  | (EditableFields & { id: string; kind: 'catalog'; category: PartCategory; product: CatalogProduct })
  | (EditableFields & { id: string; kind: 'custom'; name: string })
```

各Itemに独立したIDを持ち、1行＝1商品として扱います。ユーザーの価格を `CatalogProduct` へ書き込みません。任意項目に偽のカタログ製品や既存9カテゴリを割り当てません。費用のかからないパーツは価格0円で登録できます。

Store actionsは `addItem` / `replaceItem` / `addCustomItem` / `updateItem`（価格の更新）/ `renameCustomItem` / `removeItem` / `clearBuild`。編集actionはZod検証後に更新し、不正な更新はまとめて拒否します。ID・kind・製品・カテゴリは部分更新の対象外です。旧 `quantity` の追加・更新も拒否します。

### カテゴリと製品変更

`src/domain/categories.ts` の `cardinality` がUIとStore共通の定義です。

| 追加制約 | カテゴリ | 操作 |
| --- | --- | --- |
| single | CPU、CPUクーラー、マザーボード、GPU、電源、ケース | 空欄で「選択」。選択後は追加ボタンなし。製品名から置換 |
| multiple | メモリ、ストレージ、ケースファン、その他/任意項目 | 選択後もカテゴリヘッダー右側に「＋ 追加」。同じ製品も複数追加可能 |

- カタログ製品名（スペックと余白を含む表示領域）のクリック/Enter/Spaceで、同じ中央配置検索Dialogを**置換モード**で開きます。追加と置換は検索結果ボタン・Store actionを区別します。
- `replaceItem(id, product)` は同じカテゴリのカタログ製品のみを受け付け、**IDを保持し、priceを必ず `null` へリセット**します。明示的に同じ製品を選び直した場合も価格をリセットします。他の行には影響しません。
- 置換をキャンセルした場合は元の見積もりを保持します。検索終了後は元の製品名にフォーカスを戻し、singleカテゴリの初回追加後は新しく表示された製品名へ移動します。
- 任意項目名をクリックすると、名前だけを編集する小型Dialogが開きます。名前変更は価格を保持します。
- singleは新規追加の制約です。旧保存データにsingleカテゴリの複数行がある場合や、旧数量を複数行へ展開した場合も、各行を表示して個別置換/削除できます。

### 保存schema / migration

- 保存キー：`pc-build-sheet:build`、**schema version：`5`**。保存対象は `items` のみで、検索結果・モーダル状態・入力途中のdraft・actionsは保存しません。category cardinalityは静的なUI/Store設定で、保存データには含めません。
- **version 1 → 5**：`checkedStorage` で旧形式を検証し、Zustand persistの `migrate` で `kind: 'catalog'` を補完します。
- **version 1 / 2 / 3 → 5 共通**：旧購入/流用フィールド `source` と旧 `memo` を除去します。流用品（`source === 'owned'`）の価格は、元の値が金額・0・nullのいずれでも **0円へ変換**します。購入扱いの価格は0/nullを含めて維持します。
- **version 1 / 2 / 3 / 4 → 5 共通**：旧 `quantity`（1〜99）を検証し、その数だけ同じ商品・価格の行へ展開してフィールドを除去します。各元行の最初の行は元のIDを保持し、追加行には既存IDと衝突しないIDを付け、直後に並べます。カタログ/任意項目ともに製品/名前、合計金額・パーツ数・価格未入力数を引き継ぎます。version 5形式で保存し直し、再読込で二重展開しません。移行後の価格編集・置換・削除は各行に独立して適用します。
- 未知version、重複ID、製品とカテゴリの不一致、必須フィールド欠落、編集値の範囲違反などはmigrationしません。値を推測・丸め・切り詰めして復元することはありません。
- 保存データもZod検証し、読込/書込失敗を画面に表示します。読めない保存データは自動消去せず、次の構成変更時に更新します。保存失敗時も画面上の構成は保持します。
- 保存はこのブラウザ内のみで、端末間同期はありません。次のschema変更でもversionを上げ、v1/v2/v3/v4/v5からの移行経路を維持してください。

### 見積もりの入力・計算ルール

**価格はユーザーが手入力する1商品（1行）の金額**です。ECサイトからの取得・自動更新は行いません。

| 項目 | ルール |
| --- | --- |
| 価格 | 日本円の整数、0〜100,000,000円。未入力は `null`、0円とは別扱い |
| 入力確定 | フォーカスを外すかEnterで保存。空欄確定で `null`。入力中はdraftを維持し、Escで未確定変更を取消 |
| 価格の表示 | 通常は `￥96,800`、フォーカス時は数値＋円のinline edit。入力要素の数値をフォーカス時に書き換えず、選択や削除操作を安定させる |
| 入力エラー | 負数・小数・指数表記・上限超過などは保存せずエラー表示。全角数字と正しい3桁区切りは正規化可能 |
| 複数商品の登録 | multipleカテゴリの「追加」で行を増やす。メモリkitなどのセット商品は1商品＝1行として扱う |
| 名前 | 任意項目名は空白以外の1〜200文字 |

計算は `features/build/totals.ts` の純粋関数 `getBuildSummary`、円表示は `domain/currency.ts` の `formatYen` に集約しています。

- **パーツ**：すべてのItemの行数（任意項目も含む）。SSDを2行追加すると2点。
- **見積もり合計**：`price !== null` の全Itemの `price` の合計。
- **価格未入力**：`price === null` の行数。0円は入力済みとして扱います。
- 未入力があっても見積もり合計を表示し、**「価格未入力 N点。見積もり合計は入力済み分のみで、構成全体の総額ではありません」**と明示します。全パーツが未入力の場合も同じ注意付きの0円表示となります。
- 行の価格欄は価格ありで金額（0円も表示）、未入力で `未入力` と表示します。数量・小計列はありません。

## 現在の機能

- 9カテゴリを常時表示する構成シート。広いPC画面はシート＋サマリーの2カラム、幅1100px以下ではシート幅を優先してサマリーを下に配置
- 各カテゴリ共通の中央配置wide modal、基本検索、ページ移動、主要スペック表示
  - PC：幅最大900px・高さ85dvh。モバイル（幅700px以下）：四辺に12pxの余白を残すほぼ全画面表示。タイトル・検索欄を上部に残し、結果領域だけをスクロールします。
  - 共通 `Dialog` は用途を明示する `variant="wide" | "confirm" | "edit"` を必須指定。検索は追加/置換共通の `ProductSearchDialog`、構成リセットは小型confirm、任意項目名は小型editを使用します。
- desktop：列見出しを上部に一度だけ表示し、製品名（主要スペックは小さな2行目）・価格・削除を共通CSS Gridで横一列に配置。空カテゴリ約70px、1製品入り約75px、multipleの追加1行約46pxを目安にしています。長い製品名/specは省略表示し、titleとアクセシブル名で全文を確認できます。
- 幅800px以下：製品名と削除ボタンを上段、価格を下段の右側に配置。320px幅でも操作領域の重なりと横スクロールを防ぎます。モバイルの製品名は最大2行です。
- 「その他」セクションの「任意項目を入力」からOS・ケーブル・アクセサリ等を追加。名前を入力した後、共通のシート行で価格を編集できます。2件目以降は「＋追加」から登録します。
- パーツ/任意項目の追加・個別削除・構成リセット、ブラウザへの自動保存
- 見積もり合計・パーツ数・価格未入力数。サマリー変更の読み上げと、Item別の価格入力ラベル
- 検索中・入力待ち・0件・APIエラー・保存障害の表示
- キーボード操作、Escape・backdropクリックで閉じる、モーダル内フォーカス制御と終了時の復帰。文字選択のドラッグが背景へ抜けても閉じません。

## 今後の予定 / TODO

- **Phase 3**：消費電力概算、推奨電源容量、基本的な互換性警告。
- **Phase 4**：構成のURL圧縮・共有、共有モード/編集モードの分離。
- **Phase 5**：外部Price Provider連携。

Phase 3へ進む前に、電力/互換性に必要なカタログspecの欠損時の扱い、同一カテゴリ複数Itemやkitの内容数の解釈、価格0円のパーツも判定対象にするルール、任意項目の情報不足、概算/警告の根拠と表示密度を検討します。保存に新しいユーザー設定を追加する場合はmigrationも必要です。

外部価格取得・互換性判定・電力計算・URL共有・ログイン・クラウド保存・高度なフィルターは未実装です。

## データ出典

製品データはpc-parts-catalogを経由して **BuildCores OpenDB** を利用しています。画面のフッターと検索結果に出典・ライセンスを表示します。テストfixtureも同データに由来します。

> Contains information from [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db),
> which is made available under the [ODC Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/).

データの加工はカテゴリ/スペックの表示整形と、選択した製品のブラウザ内保存です。価格や互換性の保証を意味するデータではありません。
