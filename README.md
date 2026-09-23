# 自作PC構成シート

PCパーツを検索・追加し、価格を入力して構成と見積もりを作成できるWebツールです。商品一覧ではなく構成シートを起点に、全カテゴリを同じ操作で扱えます。1行＝1商品とし、複数必要なパーツは「追加」から行を増やします。

## 電力の概算

構成サマリーに「推定消費電力 約640W（800W以上推奨） 詳細」の形でコンパクトに表示します。消費電力と推奨容量は別の値です。「詳細」から現在のカテゴリ別内訳・計算方法・対象範囲・欠損情報の説明を開けます。閉じるボタン・Esc・背景クリックで閉じ、フォーカスは詳細ボタンへ戻ります。実測値ではなく、選択した製品から電源容量を検討するための目安です。

| パーツ | 計算方法 |
|---|---|
| CPU | `specs.ppt_w` → `tdp_w` の順で有効な正数を使用 |
| GPU | `specs.tdp_w` の有効な正数を使用 |
| マザーボード | Mini-ITX 35W、Micro ATX / mATX 45W、ATX 50W、E-ATX / EATX 60W、その他50W |
| RAM | `kit_quantity` × 5W。不明なら1製品10W |
| ストレージ | NVMe / PCIe SSD 8W、SATA SSD 5W、HDD / SSHD 12W、不明8W |
| CPUクーラー | `water_cooled === 1` なら20W、それ以外5W。付属ファン・ポンプを含む |
| ケースファン | `quantity` × 3W。不明なら1製品3W |
| 拡張カード・照明 | `network_card` / `sound_card` / `capture_card` / `lighting` は1製品10W |

PSU自体、ケース、サーマルペースト、OS、周辺機器、ノートPC・完成品PC、アクセサリー、旧保存データの任意項目は加算しません。製品名からスペックを推測しません。

- 内部合計は小数を維持し、推定最大消費電力の表示時だけ整数Wに丸めます。推奨電源容量は内部合計の **1.25倍** を、450 / 500 / 550 / 600 / 650 / 700 / 750 / 800 / 850 / 900 / 1000 / 1200 / 1300 / 1500 / 1600 / 2000Wへ切り上げます。2000W超は実際の計算値を整数Wへ切り上げます。
- CPU/GPUの欠損・無効値は0Wとして集計し、消費電力に「※」を付けます。詳細内に不足情報の注意と該当製品を表示します。有効なCPUまたはGPUの電力値が1つもない場合、推奨容量の括弧部分を省略します。空構成や対象外製品のみなら消費電力は「―」です。
- サマリーには選択電源容量や推奨容量未満の注意文を表示しません。通常は1行に収め、狭い画面・大きな数値では自然に折り返します。
- 1行＝1製品として各行を1回加算します。同じカタログ製品の別行も加算し、RAMの枚数・ケースファンのセット個数だけを掛けます。旧保存形式の構成数量は既存のmigrationで行へ展開されるため再乗算しません。CPUクーラーの `fan_quantity` はケースファンへ加算しません。
- 定数は `src/features/build/power-constants.ts`、純粋関数は `power.ts`。内訳・欠損した行・PSU比較を返し、計算結果は保存せず構成から導出します。

2026-09-23にバックエンド `f2781af` のモデル・正規化・レスポンス生成と公開APIを照合しました。必要なスペックは既存の `product.specs` に保存されています。検索API、Dynamic Facet API、D1スキーマ、保存形式は変更していません。

## 技術スタック

- React / TypeScript / Vite
- TanStack Query：カテゴリ・製品検索のサーバーステート
- Zustand + persist：構成のクライアントステート・localStorage保存
- Zod：APIレスポンスと保存データの境界検証
- Lucide React / 通常CSS（UIフレームワークなし）
- Vitest / Playwright

## Yahoo!ショッピング価格比較

カタログ製品の価格欄と削除ボタンの間にある店舗ボタンで、販売店・価格・送料区分・最安バッジ・商品ページへのリンクを比較できます。
比較は非モーダルpopoverで、Offerの取得・更新が手入力した構成価格を上書きすることはありません。
各販売店のショップ名・価格の表示部分を選ぶと、その商品の表示価格を該当する構成行へ入力してpopoverを閉じます。送料は加算せず、反映後も手動編集できます。右端の商品ページへのリンクは独立しています。

検索一覧の最安価格はbulk summary API専用の経路を用意しています。2026-09-23時点では本番APIが未提供（404）のため既定で無効です。
**検索一覧価格にはbulk summary backendが必要です。** 正式仕様への接続後は、製品追加・置換時だけ取得済みの最安値を初期価格にできます。
接続フラグ・データフロー・保存／cache・UX・検証方法は [Yahoo価格表示・比較](docs/offers.md) を参照してください。

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
npm run test:offers

# 実際の公開APIに接続する任意のスモークテスト
npm run test:live
```

- 単体テスト：各行の価格合計、未入力/0円の区別、行数ベースの集計、価格入力の正規化と上限、部分更新のinvariant、カテゴリごとのsingle/multiple制約、製品置換と価格リセット、任意項目の追加・名前変更・削除、persist対象・復元・v1/v2/v3/v4→v5 migration・不正データ・保存障害。旧数量の行展開で金額・点数を保ち、IDが衝突しないことも検証します。既存のAPI schema・HTTP/通信エラー・中断・retry方針・スペック表示も検証します。
- E2E：APIを固定レスポンスに置き換え、PC/モバイルで検索→追加→価格入力→0円入力→リロード→任意項目→削除、製品名からの置換、複数Storageの独立編集、旧データの0円変換・行展開と移行後の再編集、入力エラーを検証します。主10カテゴリを埋めたシートの高さ、desktop列の整列、320px幅を含む操作要素の重なり・横スクロールも確認します。検索Dialogのdebounce・IME・pagination・0件・エラー・中断・フォーカス制御の既存テストを維持し、追加/置換両モードでpagination・中断・フォーカス復帰を検証しています。E2E/実APIテストは実行前に本番ビルドを作成し、PlaywrightがVite previewを起動・終了します。
- `test:live`：カテゴリ一覧と全30カテゴリの実レスポンス・スペック要約を検証します。ブラウザでCPU空欄一覧のcursorページ移動・前へ、`ryzen` のoffsetページ移動・前へ、`9800x3d` 検索 → 追加 → リロード → 削除まで確認します。ネットワークと公開APIの稼働状況に依存します。
- スクリーンショット・失敗時traceは `test-results/` に出力します（Git対象外）。
- 30カテゴリ対応：registryとProductionカテゴリ一覧の一致、optional 20カテゴリのGET検索・typed/空spec・null要約、全30カテゴリの保存復元、v1〜5の旧主9カテゴリ保持を単体テストします。E2Eでは追加候補13カテゴリの検索→追加→置換→リロード→削除、候補の非表示/再表示、multipleの複数行、フォーカス復帰をdesktop/mobileで検証します。OSの常設・single制約・追加/置換/削除・既存v5保存データの復元、4グループの表示と空グループの非表示、候補から除外した7カテゴリの保存データ復元・削除も確認します。
- GitHub Actions（`.github/workflows/ci.yml`）：PRとmainへのpushでNode.js 24上の `npm ci` → lint → typecheck → unit test → production build → Playwright Chromiumセットアップ → desktop/mobile E2Eを実行します。通常CIは公開APIに依存せず、`test:live` は含めません。

## APIとの接続

**pc-parts-catalog**：<https://pc-parts-catalog.kikuuuty.workers.dev>

- `GET /v1/categories`：API側の30カテゴリと将来追加される非空のカテゴリIDを受け入れます。UIは `src/domain/categories.ts` の30カテゴリを扱い、選択カテゴリがAPI一覧に存在することを確認してから検索します。
- `GET /v1/categories/:category/filters`：カテゴリ全体の候補・型・数値範囲を取得。Zodで検証し、決定済みの表示項目・順序と組み合わせます。OSは取得しません。
- フィルターあり：`POST /v1/search` に `filters` / `ranges` / `facets` を送ります。検索語は `keyword`。検索語ありはoffset、なしはcursorです。条件なしでは既存のGET経路を使用します。
- 検索語あり：`GET /v1/search?category=cpu&q=9800x3d&limit=20&offset=0`。続きは `meta.next_offset`、前へは使用済みoffsetの履歴を使用します。`next_cursor` はnull、検索windowは1000件です。
- 検索語なし：`GET /v1/search?category=cpu&limit=20`。続きは `cursor=meta.next_cursor`、前へは使用済みcursor（初回は省略）の履歴を使用します。`q` / `offset` は送信しません。`window_limit` / `next_offset` はnull、レスポンスの `offset` は全ページ0です。
- `SearchParams` とDialogのpagination状態はkeyword/listingの判別可能なunionです。cursorは不透明な値として扱い、検索語変更時に履歴を初期化します。
- 1ページ20件。次のoffset/cursorがnullなら「次へ」を無効化します。keywordの `window_exhausted` は絞り込み案内を表示します。`meta.returned` は表示中の件数で、総ヒット数ではありません。
- 認証なし、`credentials: 'omit'`、公開CORSを使ってブラウザから直接接続します。
- キーワード・数値入力・選択変更・解除をまとめた300ms debounce。IME変換中と入力エラー時は検索抑制、条件変更・モーダル終了時はAbortSignalで中断。選択肢内検索はローカル処理です。
- Queryのメモリキャッシュは60秒。通信/timeout/502/503/504は最大1回のbackoff再試行（`Retry-After` が60秒を超える場合は自動再試行なし）。429や400/500、schemaエラーは自動再試行しません。手動再試行も `Retry-After` を尊重します。
- 個々のHTTPリクエストは15秒でtimeout。利用者には日本語のエラーを表示し、レスポンス本文やstack traceは表示しません。

契約は2026-09-19にBackend HEAD `04a9d37` の以下の実装・ドキュメントと本番レスポンスで確認しました。

- [Consumer API契約](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/cloudflare-production.md#frontend-integration-quick-reference)
- [Workerのレスポンス生成](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/worker.js)
- [カテゴリ別spec型](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/model.js)
- [追加カテゴリのspec型](https://github.com/kikuuuty/pc-parts-catalog/blob/main/src/extended-models.js)
- [Pagination契約](https://github.com/kikuuuty/pc-parts-catalog/blob/main/docs/pagination.md)

`CatalogProduct` は30カテゴリのZod discriminated unionから型を導出しています。既存9カテゴリに加え、モニター・キーボード・マウス・ヘッドホン・Webカメラのtyped scalar specをBackendに合わせて検証します。それ以外はregistryから空specの分岐を生成します。未知の追加フィールドは除去し、既知のspecは `null` を許容しますが、フィールド自体の欠落や型違いは拒否します。HTTP製品schemaは `source` を必須とし、以前の保存済み製品はsourceなしでも復元できます（保存versionは5を維持）。製品参照には `source` とカテゴリを含む `upstream_key` を保持します。APIのDB内部IDやUUID単体を恒久的な製品識別子として扱いません。

2026-09-20に `src/model.js` / `src/extended-models.js` / README / API文書を再確認し、全30カテゴリに対応しました。通常のGET検索に含まれない接続方式などのfacetsは推測せず、取得できたscalar specだけを要約します。specが空のカテゴリもメーカー名・製品名で検索・選択・保存できます。

2026-09-22にBackend HEAD `13e28b4` の [Filter metadata契約](https://github.com/kikuuuty/pc-parts-catalog/blob/13e28b4cac95b8f91bfb59721756122bd6fab2e5/docs/category-filters.md)・Worker・検索compilerと本番APIを照合し、カテゴリ別フィルターを追加しました。詳細な確定仕様・カテゴリ別表示順は [検索フィルター仕様](docs/search-filters.md) を参照してください。接続方式等を検索条件に使っても、通常検索結果のspecに補完はしません。

## 主な構成

```text
src/
  api/catalog/        client・Zod schemas・型・Query hooks
  components/         共通Dialog・出典表記
  domain/             30カテゴリregistry・主要スペックの表示変換・共通円フォーマット
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

各Itemに独立したIDを持ち、1行＝1商品として扱います。ユーザーの価格を `CatalogProduct` へ書き込みません。任意項目に偽のカタログ製品やカタログカテゴリを割り当てません。費用のかからないパーツは価格0円で登録できます。

Store actionsは `addItem` / `replaceItem` / `addCustomItem` / `updateItem`（価格の更新）/ `renameCustomItem` / `removeItem` / `clearBuild`。編集actionはZod検証後に更新し、不正な更新はまとめて拒否します。ID・kind・製品・カテゴリは部分更新の対象外です。旧 `quantity` の追加・更新も拒否します。

### カテゴリと製品変更

`src/domain/categories.ts` のregistryがID・日本語ラベル・表示順・`placement`（main/optional）・`cardinality`（single/multiple）・`additionGroup`（追加候補のグループ）の唯一の定義です。`PartCategory` と保存用enum、main/optional一覧、追加候補一覧をここから導出します。中カテゴリの名前と順序も同ファイルの `additionGroups` で管理します。

- 主カテゴリはCPU → CPUクーラー → メモリ → マザーボード → GPU → ストレージ → 電源 → ケース → ケースファン → OSの順に10カテゴリを常設します。OSは未選択でもエラーにせず、削除すると空のOS行に戻ります。
- optionalのうち13カテゴリは構成サマリーの下の「製品を追加」ボタンから共通の検索Dialogを開きます。選択後だけ、主カテゴリの下にregistry順でセクションを表示します。
- 追加候補は「拡張カード」（キャプチャーカード・ネットワークカード・サウンドカード）→「周辺機器」（モニター・キーボード・マウス・マウスパッド）→「音声・映像機器」（ヘッドホン・スピーカー・マイク・Webカメラ）→「その他」（サーマルペースト・アクセサリー）の順の4グループです。各グループ内は等幅2列、高さ34pxのコンパクトなボタンで揃えます。候補がなくなったグループは隠し、すべて選択済みならその旨を表示します。
- ノートPC・完成品PC・デスク・チェア・VRヘッドセット・照明・スタンドは `additionGroup: null` として追加候補から除外します。30カテゴリのAPI型・保存schemaは維持し、既存データは引き続き表示・削除できます。除外カテゴリは削除後も候補へ戻しません。
- PCでは左に構成シート、右に構成サマリーと「製品を追加」を縦に配置します。幅1100px以下ではシート → サマリー → 製品を追加の順です。
- 「その他」の任意項目入力欄は廃止しました。既存の保存データに任意項目がある場合だけ、シート末尾に「保存済みの任意項目」を表示し、名前・価格の編集と削除ができます。
- OSは主カテゴリのsingleです。optionalのsingleはチェア・デスク・ノートPC・完成品PC・VRヘッドセット（すべて新規カテゴリ候補から除外済み）。追加候補13カテゴリはすべてmultipleです。
- single/multipleともに選択後は「製品を追加」の候補を隠し、最後の製品を削除すると候補とフォーカスを戻します。multipleの2件目以降はカテゴリ行の「追加」から同じセクション内に追加します。

| 追加制約 | カテゴリ | 操作 |
| --- | --- | --- |
| single | CPU、CPUクーラー、マザーボード、GPU、電源、ケース、OS、singleのoptional | 空欄で選択。選択後は追加ボタンなし。製品名から置換 |
| multiple | メモリ、ストレージ、ケースファン、multipleのoptional | 選択後もカテゴリヘッダー右側に「＋ 追加」。同じ製品も複数追加可能 |

- カタログ製品名（スペックと余白を含む表示領域）のクリック/Enter/Spaceで、同じ中央配置検索Dialogを**置換モード**で開きます。追加と置換は検索結果ボタン・Store actionを区別します。
- `replaceItem(id, product, { initialPrice })` は同じカテゴリのカタログ製品のみを受け付け、**IDを保持し、選択時の最安値（未取得なら `null`）を新しいpriceへ設定**します。明示的に同じ製品を選び直した場合も再設定します。他の行には影響しません。`addItem` も同じ任意の初期価格引数を受け付けます。
- 置換をキャンセルした場合は元の見積もりを保持します。検索終了後は元の製品名にフォーカスを戻し、singleカテゴリの初回追加後は新しく表示された製品名へ移動します。
- 任意項目名をクリックすると、名前だけを編集する小型Dialogが開きます。名前変更は価格を保持します。
- singleは新規追加の制約です。旧保存データにsingleカテゴリの複数行がある場合や、旧数量を複数行へ展開した場合も、各行を表示して個別置換/削除できます。

### 保存schema / migration

- 保存キー：`pc-build-sheet:build`、**schema version：`5`**。保存対象は `items` のみで、検索結果・モーダル状態・入力途中のdraft・actionsは保存しません。category cardinalityは静的なUI/Store設定で、保存データには含めません。
- 30カテゴリ対応は許容カテゴリを増やすだけで保存形式を変更しないため、versionを上げず追加migrationも不要です。v1〜4の既存migrationとv5の直接復元を維持します。optionalの表示セクションは復元したitemsから導出します。
- OSの主カテゴリ化も表示設定だけの変更です。カテゴリID `os`・製品・価格・行IDを保持し、以前optionalとして保存したOSを常設行に復元します。保存versionは5のままです。
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

- OSを含む主カテゴリ10個を常時表示し、4グループのoptional 13カテゴリを必要に応じて追加できる構成シート。広いPC画面はシート＋サマリーの2カラム、幅1100px以下ではシート幅を優先してサマリーを下に配置
- 各カテゴリ共通の中央配置wide modal、キーワード＋カテゴリ別フィルター、ページ移動、主要スペック表示
  - PC：幅最大900px・高さ85dvh。左にフィルター、右に結果を配置し、独立してスクロール。モバイル（幅700px以下）：四辺に12pxの余白を残すほぼ全画面表示。タイトル・検索欄・条件タグを上部に残し、折りたたみのフィルターと結果を下部でスクロールします。
  - 検索欄付き複数選択、数値範囲、条件タグの個別解除・全解除。キーワードと条件はカテゴリ別にメモリ内保持し、追加/置換で共有。開き直すと1ページ目、リロードでリセットします。
  - 共通 `Dialog` は用途を明示する `variant="wide" | "confirm" | "edit"` を必須指定。検索は追加/置換共通の `ProductSearchDialog`、構成リセットは小型confirm、任意項目名は小型editを使用します。
- desktop：列見出しを上部に一度だけ表示し、製品名（主要スペックは小さな2行目）・価格・削除を共通CSS Gridで横一列に配置。空カテゴリ約70px、1製品入り約75px、multipleの追加1行約46pxを目安にしています。長い製品名/specは省略表示し、titleとアクセシブル名で全文を確認できます。
- 幅800px以下：製品名と削除ボタンを上段、価格を下段の右側に配置。320px幅でも操作領域の重なりと横スクロールを防ぎます。モバイルの製品名は最大2行です。
- OSは構成シートの常設行から選択し、拡張カード・周辺機器などは構成サマリーの下の「製品を追加」から検索して追加。任意項目の新規入力UIはなく、保存済みの任意項目だけ編集・削除できます。
- パーツの追加・個別削除・構成リセット、ブラウザへの自動保存
- 見積もり合計・パーツ数・価格未入力数。サマリー変更の読み上げと、Item別の価格入力ラベル
- 検索中・入力待ち・0件・APIエラー・保存障害の表示
- キーボード操作、Escape・backdropクリックで閉じる、モーダル内フォーカス制御と終了時の復帰。文字選択のドラッグが背景へ抜けても閉じません。

## 今後の予定 / TODO

- **Phase 3**：消費電力概算、推奨電源容量、基本的な互換性警告。
- **Phase 4**：構成のURL圧縮・共有、共有モード/編集モードの分離。
- **Phase 5**：外部Price Provider連携。

Phase 3へ進む前に、電力/互換性に必要なカタログspecの欠損時の扱い、同一カテゴリ複数Itemやkitの内容数の解釈、価格0円のパーツも判定対象にするルール、任意項目の情報不足、概算/警告の根拠と表示密度を検討します。保存に新しいユーザー設定を追加する場合はmigrationも必要です。

外部価格取得・互換性判定・電力計算・URL共有・ログイン・クラウド保存・条件連動の候補件数表示は未実装です。

## データ出典

製品データはpc-parts-catalogを経由して **BuildCores OpenDB** を利用しています。画面のフッターと検索結果に出典・ライセンスを表示します。テストfixtureも同データに由来します。

> Contains information from [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db),
> which is made available under the [ODC Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/).

データの加工はカテゴリ/スペックの表示整形と、選択した製品のブラウザ内保存です。価格や互換性の保証を意味するデータではありません。
