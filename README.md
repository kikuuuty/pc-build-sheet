# 自作PC構成シート

PCパーツを検索・追加して、1画面で構成全体を見渡せるWebツールです。商品一覧ではなく構成シートを起点に、全カテゴリを同じ操作で扱えます。

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

- 単体テスト：追加・同一製品の複数追加・個別削除・リセット・persist対象・復元・保存障害、API schema・HTTP/通信エラー・中断・retry方針・スペック表示。
- E2E：APIを固定レスポンスに置き換え、PC/モバイルで操作・保存・debounce・0件・エラー・中断・フォーカス復帰を検証します。E2E/実APIテストは実行前に本番ビルドを作成し、PlaywrightがVite previewを起動・終了します。
- `test:live`：9カテゴリの実レスポンスをschema検証し、ブラウザから `9800x3d` 検索 → 追加 → リロード → 削除まで確認します。ネットワークと公開APIの稼働状況に依存します。
- スクリーンショット・失敗時traceは `test-results/` に出力します（Git対象外）。

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
  domain/             9カテゴリ定義・主要スペックの表示変換
  features/
    build/            構成シート・サマリー・Build Item・Zustand store
    search/           検索Dialog・debounce・検索状態表示
  test/fixtures/      実APIから取得したCPU検索レスポンス
  App.tsx             画面と検索Dialogの組み立て
  main.tsx            React・QueryClientの初期化
  styles.css          デザイン変数・レスポンシブCSS
e2e/                  固定レスポンスE2E・実APIスモークテスト
```

責務は `UI → Query hook → API client → pc-parts-catalog` に分離しています。

構成は `BuildItem[]` です。各Itemに独立したID・category・製品スナップショット・quantity・price・source（購入/流用）・memoを持ち、ユーザーの価格やメモをCatalogProductへ書き込みません。同じカテゴリ/製品を複数追加できます。

保存キーは `pc-build-sheet:build`、schema versionは `1`。保存対象は `items` のみで、検索結果・モーダル状態・actionsは保存しません。保存データもZod検証し、読込/書込失敗を画面に表示します。読めない保存データは自動消去せず、次の構成変更時に更新します。保存はこのブラウザ内のみで、端末間同期はありません。

## 現在の機能

- 9カテゴリを常時表示する構成シート、PCの2カラム/スマートフォンの1カラム
- 各カテゴリ共通の中央配置wide modal、基本検索、ページ移動、主要スペック表示
  - PC：幅最大900px・高さ85dvh。モバイル（幅700px以下）：四辺に12pxの余白を残すほぼ全画面表示。タイトル・検索欄を上部に残し、結果領域だけをスクロールします。
  - 共通 `Dialog` は用途を明示する `variant="wide" | "confirm"` を必須指定。検索は `ProductSearchDialog`、構成リセットは小型のconfirmを使用します。
- パーツの追加・個別削除・構成リセット、ブラウザへの自動保存
- 選択済みパーツ数、合計金額/推定消費電力の未計算欄（`—`）
- 検索中・入力待ち・0件・APIエラー・保存障害の表示
- キーボード操作、Escape・backdropクリックで閉じる、モーダル内フォーカス制御と終了時の復帰。文字選択のドラッグが背景へ抜けても閉じません。

## 今後の予定 / TODO

- **Phase 2**：価格手入力、数量編集、購入/流用、メモ、合計金額、任意項目、複数パーツ操作改善。まずItem編集UIと「未入力価格を含む合計」の表示ルールを整備する予定です。
- **Phase 3**：消費電力概算、推奨電源容量、基本的な互換性警告。
- **Phase 4**：構成のURL圧縮・共有、共有モード/編集モードの分離。
- **Phase 5**：外部Price Provider連携。
- 次に保存schemaを変更するときはversionを上げ、既存の構成からのmigrationを追加してください。

価格検索・互換性判定・電力計算・共有・ログインは未実装です。初期サマリーの価格/電力は推測値を表示しません。

## データ出典

製品データはpc-parts-catalogを経由して **BuildCores OpenDB** を利用しています。画面のフッターと検索結果に出典・ライセンスを表示します。テストfixtureも同データに由来します。

> Contains information from [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db),
> which is made available under the [ODC Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/).

データの加工はカテゴリ/スペックの表示整形と、選択した製品のブラウザ内保存です。価格や互換性の保証を意味するデータではありません。
